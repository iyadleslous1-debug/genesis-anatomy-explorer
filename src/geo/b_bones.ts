/** Piece B helpers: swept bone shafts with arbitrary cross-sections, surface roughness, bowl-bending. */
import { V3, add, mul, sub, norm, cross, dot, spline } from './math';
import { Shape, displace } from './sdf';
import { noise3 } from './noise';

/** radius of the cross-section in direction (c = cosine toward the frame's "forward", s = sine toward its "lateral") */
export type Sec = (t: number, c: number, s: number) => number;

export const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const bell = (t: number, c: number, w: number) => Math.exp(-(((t - c) / w) ** 2));
export const pw = (x: number, p: number) => (x > 0 ? x ** p : 0);
/** polar radius of an ellipse with semi-axes af (forward) and al (lateral) */
export const ell = (af: number, al: number, c: number, s: number) => (af * al) / Math.sqrt((al * c) ** 2 + (af * s) ** 2);
/** rounded polygon from face normals [angle, inradius]; p controls corner rounding (higher = sharper) */
export function poly(faces: [number, number][], p: number, c: number, s: number) {
  let S = 0;
  for (const [phi, h] of faces) {
    const k = Math.cos(phi) * c + Math.sin(phi) * s;
    if (k > 0) S += (k / h) ** p;
  }
  return S > 0 ? S ** (-1 / p) : 0.01;
}

/**
 * Shape swept along a spline with a per-station cross-section.
 * `fwd` is a reference "forward" direction; the frame's lateral axis is side * (fwd x tangent).
 */
export function sweep(ctrl: V3[], fwd: V3, side: number, sec: Sec, maxR: number, n = 40): Shape {
  const P = spline(ctrl, n);
  const N = P.length, M = N - 1;
  const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N);
  const fx = new Float64Array(N), fy = new Float64Array(N), fz = new Float64Array(N);
  const lx = new Float64Array(N), ly = new Float64Array(N), lz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = norm(sub(P[Math.min(i + 1, N - 1)], P[Math.max(i - 1, 0)]));
    const f = norm(sub(fwd, mul(t, dot(t, fwd))));
    const l = mul(cross(f, t), side);
    px[i] = P[i][0]; py[i] = P[i][1]; pz[i] = P[i][2];
    fx[i] = f[0]; fy[i] = f[1]; fz[i] = f[2];
    lx[i] = l[0]; ly[i] = l[1]; lz[i] = l[2];
  }
  const abx = new Float64Array(M), aby = new Float64Array(M), abz = new Float64Array(M), il2 = new Float64Array(M), sl = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    abx[i] = px[i + 1] - px[i]; aby[i] = py[i + 1] - py[i]; abz[i] = pz[i + 1] - pz[i];
    const l2 = abx[i] ** 2 + aby[i] ** 2 + abz[i] ** 2;
    il2[i] = 1 / l2; sl[i] = Math.sqrt(l2);
  }
  const lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9];
  for (let i = 0; i < N; i++) {
    lo[0] = Math.min(lo[0], px[i] - maxR); hi[0] = Math.max(hi[0], px[i] + maxR);
    lo[1] = Math.min(lo[1], py[i] - maxR); hi[1] = Math.max(hi[1], py[i] + maxR);
    lo[2] = Math.min(lo[2], pz[i] - maxR); hi[2] = Math.max(hi[2], pz[i] + maxR);
  }
  return {
    lo, hi,
    d: (x, y, z) => {
      let bi = 0, bd = 1e18;
      const test = (i: number) => {
        const dx = x - px[i], dy = y - py[i], dz = z - pz[i];
        let u = (dx * abx[i] + dy * aby[i] + dz * abz[i]) * il2[i];
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = dx - abx[i] * u, ey = dy - aby[i] * u, ez = dz - abz[i] * u;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < bd) { bd = d2; bi = i; }
      };
      for (let i = 0; i < M; i += 4) test(i);
      test(M - 1);
      const c0 = bi;
      for (let i = Math.max(0, c0 - 4); i <= Math.min(M - 1, c0 + 4); i++) test(i);
      const dx = x - px[bi], dy = y - py[bi], dz = z - pz[bi];
      const uRaw = (dx * abx[bi] + dy * aby[bi] + dz * abz[bi]) * il2[bi];
      const u = uRaw < 0 ? 0 : uRaw > 1 ? 1 : uRaw;
      const qx = dx - abx[bi] * u, qy = dy - aby[bi] * u, qz = dz - abz[bi] * u;
      const i1 = bi + 1, v = 1 - u;
      const Fx = fx[bi] * v + fx[i1] * u, Fy = fy[bi] * v + fy[i1] * u, Fz = fz[bi] * v + fz[i1] * u;
      const Lx = lx[bi] * v + lx[i1] * u, Ly = ly[bi] * v + ly[i1] * u, Lz = lz[bi] * v + lz[i1] * u;
      const qf = qx * Fx + qy * Fy + qz * Fz, ql = qx * Lx + qy * Ly + qz * Lz;
      const rp = Math.sqrt(qf * qf + ql * ql);
      const t = (bi + u) / M;
      const R = rp > 1e-9 ? sec(t, qf / rp, ql / rp) : sec(t, 1, 0);
      let dd = (rp - R) * 0.75;
      let ex = 0;
      if (bi === 0 && uRaw < 0) ex = -uRaw * sl[0];
      else if (bi === M - 1 && uRaw > 1) ex = (uRaw - 1) * sl[M - 1];
      if (ex > 0) dd = Math.hypot(Math.max(dd, 0), ex * 0.75) + Math.min(dd, 0);
      return dd;
    },
  };
}

/** Displace a thin shape along n by k*r^2 (r = distance from the axis through c along n): makes plates dished. */
export function bend(a: Shape, c: V3, n: V3, k: number, cap = 0.012): Shape {
  const nn = norm(n);
  return {
    d: (x, y, z) => {
      const dx = x - c[0], dy = y - c[1], dz = z - c[2];
      const al = dx * nn[0] + dy * nn[1] + dz * nn[2];
      const r2 = dx * dx + dy * dy + dz * dz - al * al;
      const sh = Math.min(k * r2, cap);
      return a.d(x - nn[0] * sh, y - nn[1] * sh, z - nn[2] * sh);
    },
    lo: [a.lo[0] - cap, a.lo[1] - cap, a.lo[2] - cap],
    hi: [a.hi[0] + cap, a.hi[1] + cap, a.hi[2] + cap],
  };
}

/** subtle organic bone-surface roughness (about 0.15-0.2 mm) */
export function rough(s: Shape, amp = 0.0002): Shape {
  return {
    lo: [s.lo[0] - amp, s.lo[1] - amp, s.lo[2] - amp],
    hi: [s.hi[0] + amp, s.hi[1] + amp, s.hi[2] + amp],
    d: (x, y, z) => {
      const d = s.d(x, y, z);
      if (d > amp * 3 || d < -amp * 3) return d;
      const v = 0.65 * noise3(x * 170, y * 170, z * 170) + 0.5 * noise3(x * 55 + 9, y * 55, z * 55 + 3);
      return d + Math.max(-amp, Math.min(amp, amp * v));
    },
  };
}
