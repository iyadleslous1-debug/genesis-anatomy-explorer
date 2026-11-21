import { V3 } from './math';
import { Shape, roundCone } from './sdf';

export interface FSeg { a: V3; b: V3; ra: number; rb: number; f: number; g: number }

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/**
 * Fast three-level smooth union of round cones: segments within a fibre (kf), fibres within a
 * group (k), groups (kg). Uses a uniform grid so each evaluation only touches nearby segments.
 * Segs must be sorted by (g, f).
 */
export function segField(segs: FSeg[], kf: number, k: number, kg: number): Shape {
  const n = segs.length;
  const pad = Math.max(k, kg, kf) + 0.002;
  const lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9];
  const SL = new Float64Array(n * 3), SH = new Float64Array(n * 3);
  const ds: ((x: number, y: number, z: number) => number)[] = [];
  segs.forEach((s, i) => {
    const r = Math.max(s.ra, s.rb);
    for (let j = 0; j < 3; j++) {
      SL[i * 3 + j] = Math.min(s.a[j], s.b[j]) - r;
      SH[i * 3 + j] = Math.max(s.a[j], s.b[j]) + r;
      lo[j] = Math.min(lo[j], SL[i * 3 + j] - pad);
      hi[j] = Math.max(hi[j], SH[i * 3 + j] + pad);
    }
    ds.push(roundCone(s.a, s.b, s.ra, s.rb).d);
  });
  let gs = 0.012;
  const dim = (): number[] => [0, 1, 2].map((j) => Math.max(1, Math.ceil((hi[j] - lo[j]) / gs)));
  let D = dim();
  while (D[0] * D[1] * D[2] > 400000) { gs *= 1.3; D = dim(); }
  const [nx, ny, nz] = D;
  const cells: number[][] = Array.from({ length: nx * ny * nz }, () => []);
  for (let i = 0; i < n; i++) {
    const i0 = [0, 1, 2].map((j) => Math.max(0, Math.floor((SL[i * 3 + j] - pad - lo[j]) / gs)));
    const i1 = [nx, ny, nz].map((m, j) => Math.min(m - 1, Math.floor((SH[i * 3 + j] + pad - lo[j]) / gs)));
    for (let z = i0[2]; z <= i1[2]; z++)
      for (let y = i0[1]; y <= i1[1]; y++)
        for (let x = i0[0]; x <= i1[0]; x++) cells[x + nx * (y + ny * z)].push(i);
  }
  const F = Int32Array.from(segs.map((s) => s.f)), Gs = Int32Array.from(segs.map((s) => s.g));
  const FAR = pad;
  return {
    d: (x, y, z) => {
      const cx = Math.floor((x - lo[0]) / gs), cy = Math.floor((y - lo[1]) / gs), cz = Math.floor((z - lo[2]) / gs);
      if (cx < 0 || cy < 0 || cz < 0 || cx >= nx || cy >= ny || cz >= nz) return FAR;
      const list = cells[cx + nx * (cy + ny * cz)];
      const m = list.length;
      if (m === 0) return FAR;
      let tot = 1e9, grp = 1e9, fib = 1e9, cf = -1, cg = -1;
      for (let q = 0; q < m; q++) {
        const i = list[q];
        const i3 = i * 3;
        const dx = Math.max(SL[i3] - x, 0, x - SH[i3]), dy = Math.max(SL[i3 + 1] - y, 0, y - SH[i3 + 1]), dz = Math.max(SL[i3 + 2] - z, 0, z - SH[i3 + 2]);
        if (dx * dx + dy * dy + dz * dz > 0.0004) continue;
        const v = ds[i](x, y, z);
        if (Gs[i] !== cg) {
          if (cf >= 0) grp = grp < 1e8 ? smin(grp, fib, k) : fib;
          if (cg >= 0) tot = tot < 1e8 ? smin(tot, grp, kg) : grp;
          cg = Gs[i]; cf = F[i]; grp = 1e9; fib = v;
        } else if (F[i] !== cf) {
          grp = grp < 1e8 ? smin(grp, fib, k) : fib;
          cf = F[i]; fib = v;
        } else fib = fib < 1e8 ? smin(fib, v, kf) : v;
      }
      if (cf < 0) return FAR;
      grp = grp < 1e8 ? smin(grp, fib, k) : fib;
      tot = tot < 1e8 ? smin(tot, grp, kg) : grp;
      return tot;
    },
    lo, hi,
  };
}
