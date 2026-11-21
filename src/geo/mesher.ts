import type { Shape } from './sdf';

export interface Attr {
  data: Float32Array;
  size: number;
}
export interface Geo {
  pos: Float32Array;
  nor: Float32Array;
  idx: Uint32Array;
  attrs?: Record<string, Attr>;
}

const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Surface Nets mesher with sparse block evaluation.
 * Blocks far from the surface are filled with their center distance (sign-correct),
 * so only a thin shell of grid points is evaluated exactly.
 */
export function meshShape(shape: Shape, cellIn: number, opts: { maxPoints?: number; project?: boolean } = {}): Geo {
  const maxPoints = opts.maxPoints ?? 14_000_000;
  const B = 4;
  let cell = cellIn;
  const lo = shape.lo.map((v) => v - cell * 2.5);
  const hi = shape.hi.map((v) => v + cell * 2.5);
  for (let i = 0; i < 3; i++) if (!isFinite(lo[i]) || !isFinite(hi[i])) throw new Error('unbounded shape');
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  let count = (size[0] / cell + 1) * (size[1] / cell + 1) * (size[2] / cell + 1);
  if (count > maxPoints) cell *= Math.cbrt(count / maxPoints);
  const nb = size.map((s) => Math.max(1, Math.ceil(s / cell / B)));
  const nx = nb[0] * B + 1, ny = nb[1] * B + 1, nz = nb[2] * B + 1;
  const nxy = nx * ny;
  const F = new Float32Array(nx * ny * nz);
  const S = new Uint8Array(nx * ny * nz); // 0 unset, 1 exact, 2 approx
  const d = shape.d;
  const ox = lo[0], oy = lo[1], oz = lo[2];
  const halfDiag = (B * cell * Math.sqrt(3)) / 2;
  const thr = halfDiag * 1.25 + cell * 2;
  const active: number[] = [];

  for (let bz = 0; bz < nb[2]; bz++)
    for (let by = 0; by < nb[1]; by++)
      for (let bx = 0; bx < nb[0]; bx++) {
        const cx = ox + (bx * B + B / 2) * cell;
        const cy = oy + (by * B + B / 2) * cell;
        const cz = oz + (bz * B + B / 2) * cell;
        const dc = d(cx, cy, cz);
        const exact = Math.abs(dc) <= thr;
        if (exact) active.push(bx, by, bz);
        for (let k = bz * B; k <= bz * B + B; k++)
          for (let j = by * B; j <= by * B + B; j++) {
            let p = j * nx + k * nxy + bx * B;
            for (let i = bx * B; i <= bx * B + B; i++, p++) {
              if (exact) {
                if (S[p] !== 1) {
                  F[p] = d(ox + i * cell, oy + j * cell, oz + k * cell);
                  S[p] = 1;
                }
              } else if (S[p] === 0) {
                F[p] = dc;
                S[p] = 2;
              }
            }
          }
      }

  const cellsX = nx - 1, cellsXY = (nx - 1) * (ny - 1);
  const vmap = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const verts: number[] = [];
  const corner = new Float64Array(8);
  const cOff = [0, 1, nx, nx + 1, nxy, nxy + 1, nxy + nx, nxy + nx + 1];

  for (let a = 0; a < active.length; a += 3) {
    const bx = active[a], by = active[a + 1], bz = active[a + 2];
    for (let k = bz * B; k < bz * B + B; k++)
      for (let j = by * B; j < by * B + B; j++)
        for (let i = bx * B; i < bx * B + B; i++) {
          const p = i + j * nx + k * nxy;
          let mask = 0;
          for (let c = 0; c < 8; c++) {
            const val = F[p + cOff[c]];
            corner[c] = val;
            if (val < 0) mask |= 1 << c;
          }
          if (mask === 0 || mask === 255) continue;
          let sx = 0, sy = 0, sz = 0, n = 0;
          for (let e = 0; e < 12; e++) {
            const e0 = EDGES[e][0], e1 = EDGES[e][1];
            const m0 = (mask >> e0) & 1, m1 = (mask >> e1) & 1;
            if (m0 === m1) continue;
            const g0 = corner[e0], g1 = corner[e1];
            const t = g0 / (g0 - g1);
            sx += (e0 & 1) + t * ((e1 & 1) - (e0 & 1));
            sy += ((e0 >> 1) & 1) + t * (((e1 >> 1) & 1) - ((e0 >> 1) & 1));
            sz += ((e0 >> 2) & 1) + t * (((e1 >> 2) & 1) - ((e0 >> 2) & 1));
            n++;
          }
          vmap[i + j * cellsX + k * cellsXY] = verts.length / 3;
          verts.push(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (k + sz / n) * cell);
        }
  }

  const idx: number[] = [];
  const quad = (c0: number, c1: number, c2: number, c3: number, flip: boolean) => {
    const v0 = vmap[c0], v1 = vmap[c1], v2 = vmap[c2], v3 = vmap[c3];
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
    if (!flip) idx.push(v0, v1, v2, v0, v2, v3);
    else idx.push(v0, v2, v1, v0, v3, v2);
  };
  for (let a = 0; a < active.length; a += 3) {
    const bx = active[a], by = active[a + 1], bz = active[a + 2];
    for (let k = bz * B; k < bz * B + B; k++)
      for (let j = by * B; j < by * B + B; j++)
        for (let i = bx * B; i < bx * B + B; i++) {
          const p = i + j * nx + k * nxy;
          const inside = F[p] < 0;
          const ci = i + j * cellsX + k * cellsXY;
          // x-edge: cells (i,j-1,k-1),(i,j,k-1),(i,j,k),(i,j-1,k)   u=y v=z
          if (j > 0 && k > 0 && (F[p + 1] < 0) !== inside) {
            quad(ci - cellsX - cellsXY, ci - cellsXY, ci, ci - cellsX, !inside);
          }
          // y-edge: u=z v=x  cells (i-1,j,k-1),(i-1,j,k),(i,j,k),(i,j,k-1)
          if (i > 0 && k > 0 && (F[p + nx] < 0) !== inside) {
            quad(ci - cellsXY - 1, ci - 1, ci, ci - cellsXY, !inside);
          }
          // z-edge: u=x v=y  cells (i-1,j-1,k),(i,j-1,k),(i,j,k),(i-1,j,k)
          if (i > 0 && j > 0 && (F[p + nxy] < 0) !== inside) {
            quad(ci - 1 - cellsX, ci - cellsX, ci, ci - 1, !inside);
          }
        }
  }

  const nv = verts.length / 3;
  const pos = new Float32Array(verts);
  const nor = new Float32Array(nv * 3);
  const e = cell * 0.4;
  const project = opts.project !== false;
  for (let i = 0; i < nv; i++) {
    let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const gx = d(x + e, y, z) - d(x - e, y, z);
    const gy = d(x, y + e, z) - d(x, y - e, z);
    const gz = d(x, y, z + e) - d(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    const nx_ = gx / gl, ny_ = gy / gl, nz_ = gz / gl;
    if (project) {
      let dv = d(x, y, z);
      if (dv > cell) dv = cell;
      if (dv < -cell) dv = -cell;
      x -= nx_ * dv; y -= ny_ * dv; z -= nz_ * dv;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    nor[i * 3] = nx_; nor[i * 3 + 1] = ny_; nor[i * 3 + 2] = nz_;
  }
  return { pos, nor, idx: new Uint32Array(idx) };
}
