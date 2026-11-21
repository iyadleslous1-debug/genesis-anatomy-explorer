import { V3 } from './math';
import { tube, TubeOpts, merge } from './tube';
import type { Geo } from './mesher';

/** Radius multiplier at normalized length t, arc length s (m), angle th around the lumen, world radial direction dir. */
export type RadMod = (t: number, s: number, th: number, dir: V3) => number;

function recomputeNormals(g: Geo, ringV: number, rings: number) {
  const { pos, idx, nor } = g;
  nor.fill(0);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { nor[k] += nx; nor[k + 1] += ny; nor[k + 2] += nz; }
  }
  // weld the seam (j=0 and j=radial share a position)
  for (let r = 0; r < rings; r++) {
    const a = r * ringV * 3, b = (r * ringV + ringV - 1) * 3;
    for (let k = 0; k < 3; k++) { const v = nor[a + k] + nor[b + k]; nor[a + k] = v; nor[b + k] = v; }
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
  }
}

/** Build a capless tube then modulate the radius per vertex. Returns geo + ring count. */
function modded(points: V3[], o: TubeOpts, mod?: RadMod, flip = false): { g: Geo; rings: number; ringV: number } {
  const radial = o.radial ?? 10;
  const ringV = radial + 1;
  const g = tube(points, { ...o, caps: false });
  const rings = Math.floor(g.pos.length / 3 / ringV);
  if (mod) {
    const along = g.attrs!.along.data;
    let s = 0;
    let px = 0, py = 0, pz = 0;
    for (let r = 0; r < rings; r++) {
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < radial; j++) { const k = (r * ringV + j) * 3; cx += g.pos[k]; cy += g.pos[k + 1]; cz += g.pos[k + 2]; }
      cx /= radial; cy /= radial; cz /= radial;
      if (r > 0) s += Math.hypot(cx - px, cy - py, cz - pz);
      px = cx; py = cy; pz = cz;
      const t = along[r * ringV];
      for (let j = 0; j <= radial; j++) {
        const k = (r * ringV + j) * 3;
        const dx = g.pos[k] - cx, dy = g.pos[k + 1] - cy, dz = g.pos[k + 2] - cz;
        const l = Math.hypot(dx, dy, dz) || 1;
        const m = mod(t, s, (j / radial) * Math.PI * 2, [dx / l, dy / l, dz / l]);
        g.pos[k] = cx + dx * m; g.pos[k + 1] = cy + dy * m; g.pos[k + 2] = cz + dz * m;
      }
    }
  }
  if (flip) for (let i = 0; i < g.idx.length; i += 3) { const t = g.idx[i + 1]; g.idx[i + 1] = g.idx[i + 2]; g.idx[i + 2] = t; }
  recomputeNormals(g, ringV, rings);
  if (flip) for (let i = 0; i < g.nor.length; i++) g.nor[i] = -g.nor[i];
  return { g, rings, ringV };
}

export interface WallTubeOpts {
  r: number | ((t: number, s: number) => number);
  radial?: number;
  seg?: number;
  innerSeg?: number;
  ellipse?: [number, number];
  up?: V3;
  flow0?: number;
  /** wall thickness (m) */
  wall: number | ((t: number, s: number) => number);
  outerMod?: RadMod;
  /** multiplier of the lumen radius: folds, plicae, rugae */
  innerMod?: RadMod;
}

/** Hollow tube: outer wall + inner lumen surface (with folds) + rim, so sections show wall thickness and mucosal folds. */
export function wallTube(points: V3[], o: WallTubeOpts): Geo {
  const radial = o.radial ?? 14;
  const rf = typeof o.r === 'number' ? (() => o.r as number) : o.r;
  const wallF = typeof o.wall === 'number' ? (() => o.wall as number) : o.wall;
  const outer = modded(points, { r: rf, radial, seg: o.seg, ellipse: o.ellipse, up: o.up, flow0: o.flow0 }, o.outerMod);
  const inner = modded(points, { r: (t, s) => Math.max(0.0005, rf(t, s) - wallF(t, s)), radial, seg: o.innerSeg ?? o.seg, ellipse: o.ellipse, up: o.up, flow0: o.flow0 }, o.innerMod, true);
  // rims joining outer and inner at both ends (only valid when ring counts match the rim rings used)
  const rim: number[] = [];
  const nI = inner.g.pos.length / 3;
  const oOff = 0;
  const lastO = (outer.rings - 1) * outer.ringV, lastI = (inner.rings - 1) * inner.ringV;
  const base = outer.g.pos.length / 3;
  for (let j = 0; j < radial; j++) {
    const a = oOff + j, b = a + 1, c = base + j, d = c + 1;
    rim.push(a, c, b, b, c, d);
    const a2 = lastO + j, b2 = a2 + 1, c2 = base + lastI + j, d2 = c2 + 1;
    rim.push(a2, b2, c2, b2, d2, c2);
  }
  void nI;
  const m = merge([outer.g, inner.g]);
  const idx = new Uint32Array(m.idx.length + rim.length);
  idx.set(m.idx);
  idx.set(rim, m.idx.length);
  return { ...m, idx };
}

/** Single-surface tube with radius modulation (colon, etc.). */
export function modTube(points: V3[], o: TubeOpts, mod: RadMod): Geo {
  const { g } = modded(points, { ...o, caps: false }, mod);
  return g;
}
