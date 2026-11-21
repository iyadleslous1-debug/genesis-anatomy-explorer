// C2 owns this file. Contract: maps a point from the procedural body space to the BodyParts3D body space.
import W from '../data/warp.json';
import type { V3 } from './math';
const D = W as { centers: number[]; weights: number[]; affine: number[] };
const A = D.affine;
const C = Float64Array.from(D.centers);
const WT = Float64Array.from(D.weights);
const N = C.length / 3;
export function warpPoint(p: V3): V3 {
  const x = p[0], y = p[1], z = p[2];
  let ox = A[0] * x + A[3] * y + A[6] * z + A[9], oy = A[1] * x + A[4] * y + A[7] * z + A[10], oz = A[2] * x + A[5] * y + A[8] * z + A[11];
  for (let i = 0, k = 0; i < N; i++, k += 3) {
    const dx = x - C[k], dy = y - C[k + 1], dz = z - C[k + 2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    ox += WT[k] * r; oy += WT[k + 1] * r; oz += WT[k + 2] * r;
  }
  return [ox, oy, oz];
}
/** Warp positions in place (world space) and recompute normals from the index buffer. */
export function warpGeo(pos: Float32Array, nor: Float32Array, idx: Uint32Array): void {
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const w = warpPoint([pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
    pos[3 * i] = w[0]; pos[3 * i + 1] = w[1]; pos[3 * i + 2] = w[2];
  }
  nor.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { nor[o] += nx; nor[o + 1] += ny; nor[o + 2] += nz; }
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
  }
}
