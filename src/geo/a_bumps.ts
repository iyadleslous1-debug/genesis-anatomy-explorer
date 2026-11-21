// Piece A helper: anatomically placed surface relief (muscle bellies, ridges, grooves).
// Each feature is a soft capsule A-B (centre on the surface) with a gaussian-ish profile.
// Positive amp raises the skin, negative amp cuts a groove.
import { V3 } from './math';
import { Shape } from './sdf';

export interface Bump {
  A: V3;
  B: V3;
  w: number; // metres, 1/e radius
  amp: number; // metres (positive = outward)
  pw: number; // 1 = gaussian, 2+ = flatter plateau with sharper edge
}

/** March from o along dir until inside S, then bisect. Returns surface point or null. */
export function findSurface(S: Shape, o: V3, dir: V3, maxT = 0.9): V3 | null {
  let t = 0;
  let prev = 0;
  if (S.d(o[0], o[1], o[2]) < 0) return null;
  while (t < maxT) {
    const x = o[0] + dir[0] * t, y = o[1] + dir[1] * t, z = o[2] + dir[2] * t;
    const d = S.d(x, y, z);
    if (d < 0) {
      let a = prev, b = t;
      for (let i = 0; i < 14; i++) {
        const m = (a + b) / 2;
        if (S.d(o[0] + dir[0] * m, o[1] + dir[1] * m, o[2] + dir[2] * m) < 0) b = m;
        else a = m;
      }
      return [o[0] + dir[0] * b, o[1] + dir[1] * b, o[2] + dir[2] * b];
    }
    prev = t;
    t += Math.max(0.0015, Math.min(0.01, d * 0.7));
  }
  return null;
}

export function applyBumps(S: Shape, bs: Bump[]): Shape {
  const n = bs.length;
  const AX = new Float64Array(n), AY = new Float64Array(n), AZ = new Float64Array(n);
  const DX = new Float64Array(n), DY = new Float64Array(n), DZ = new Float64Array(n), DD = new Float64Array(n);
  const IW = new Float64Array(n), AM = new Float64Array(n), PW = new Float64Array(n), R2 = new Float64Array(n);
  const LX = new Float64Array(n), LY = new Float64Array(n), LZ = new Float64Array(n);
  const HX = new Float64Array(n), HY = new Float64Array(n), HZ = new Float64Array(n);
  let maxAmp = 0.004;
  bs.forEach((b, i) => {
    AX[i] = b.A[0]; AY[i] = b.A[1]; AZ[i] = b.A[2];
    DX[i] = b.B[0] - b.A[0]; DY[i] = b.B[1] - b.A[1]; DZ[i] = b.B[2] - b.A[2];
    DD[i] = DX[i] * DX[i] + DY[i] * DY[i] + DZ[i] * DZ[i] || 1e-12;
    IW[i] = 1 / (b.w * b.w);
    AM[i] = b.amp; PW[i] = b.pw;
    const r = Math.pow(4.6, 1 / b.pw) * b.w; // cutoff radius (profile < 1%)
    R2[i] = r * r;
    LX[i] = Math.min(b.A[0], b.B[0]) - r; HX[i] = Math.max(b.A[0], b.B[0]) + r;
    LY[i] = Math.min(b.A[1], b.B[1]) - r; HY[i] = Math.max(b.A[1], b.B[1]) + r;
    LZ[i] = Math.min(b.A[2], b.B[2]) - r; HZ[i] = Math.max(b.A[2], b.B[2]) + r;
    maxAmp = Math.max(maxAmp, Math.abs(b.amp));
  });
  const band = maxAmp * 2.6 + 0.004;
  // uniform grid so each evaluation only visits the bumps whose box overlaps its cell
  const CS = 0.02, OX = -0.6, OY = -0.1, OZ = -0.4, NX = 60, NY = 100;
  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const x0 = Math.floor((LX[i] - OX) / CS), x1 = Math.floor((HX[i] - OX) / CS);
    const y0 = Math.floor((LY[i] - OY) / CS), y1 = Math.floor((HY[i] - OY) / CS);
    const z0 = Math.floor((LZ[i] - OZ) / CS), z1 = Math.floor((HZ[i] - OZ) / CS);
    for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let c = z0; c <= z1; c++) {
      const key = a + NX * (b + NY * c);
      const l = grid.get(key);
      if (l) l.push(i); else grid.set(key, [i]);
    }
  }
  return {
    d: (x, y, z) => {
      const d = S.d(x, y, z);
      if (d > band || d < -band) return d;
      let sum = 0;
      const cell = grid.get(Math.floor((x - OX) / CS) + NX * (Math.floor((y - OY) / CS) + NY * Math.floor((z - OZ) / CS)));
      if (!cell) return d;
      for (let m = 0; m < cell.length; m++) {
        const i = cell[m];
        if (x < LX[i] || x > HX[i] || y < LY[i] || y > HY[i] || z < LZ[i] || z > HZ[i]) continue;
        const px = x - AX[i], py = y - AY[i], pz = z - AZ[i];
        let t = (px * DX[i] + py * DY[i] + pz * DZ[i]) / DD[i];
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - DX[i] * t, ey = py - DY[i] * t, ez = pz - DZ[i] * t;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > R2[i]) continue;
        const q = d2 * IW[i];
        sum += AM[i] * Math.exp(PW[i] === 1 ? -q : -Math.pow(q, PW[i]));
      }
      return d - sum;
    },
    lo: [S.lo[0] - maxAmp, S.lo[1] - maxAmp, S.lo[2] - maxAmp],
    hi: [S.hi[0] + maxAmp, S.hi[1] + maxAmp, S.hi[2] + maxAmp],
  };
}
