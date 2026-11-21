/**
 * Skin-weight field for BP3D parts (bundled with esbuild by convert.cjs).
 * Same math as src/geo/weights.ts (segment falloff, region gating, arm/trunk split), but the skin SDF is replaced by a
 * caller-supplied nearest-skin query and eyelids/jaw are defined from the real eye centres / jaw bone.
 */
import { BONE_DEFS, BONE_INDEX, ribPoly } from '../../src/anatomy/bones3d';

const NB = BONE_DEFS.length;
const IDX = BONE_INDEX;
export const BONE_NAMES = BONE_DEFS.map((b) => b.name);
export const boneIndex = (n: string): number => (n in IDX ? IDX[n] : -1);

const segs: Float32Array[] = [];
const bmin = new Float32Array(NB * 3), bmax = new Float32Array(NB * 3), R = new Float32Array(NB);
const soft: number[] = [];
function radiusOf(name: string): number {
  if (/^f\d_/.test(name) || name.startsWith('toes')) return 0.03;
  if (name.startsWith('rib') || name === 'sternum' || name.startsWith('clavicle')) return 0.05;
  if (name.startsWith('hand') || name.startsWith('foot')) return 0.045;
  if (/^thigh/.test(name)) return 0.09;
  if (/^(upperarm|forearm|shin|neck)/.test(name)) return 0.06;
  if (/^(pelvis|spine_L3|spine_T12)/.test(name)) return 0.13;
  return 0.08;
}
for (let b = 0; b < NB; b++) {
  const d = BONE_DEFS[b];
  let pts: number[][] = [d.head, d.tail];
  if (d.name === 'pelvis') pts = [d.tail, d.head];
  const sg: number[] = [];
  const addPoly = (p: number[][]) => { for (let i = 0; i + 1 < p.length; i++) sg.push(...p[i], ...p[i + 1]); };
  const m = d.name.match(/^rib(\d+)\.([LR])$/);
  if (m) {
    const full = ribPoly(m[2] === 'L' ? 1 : -1, +m[1]);
    const k = Math.min(7, full.length);
    const sub: number[][] = [];
    for (let i = 0; i < k; i++) sub.push(full[Math.round((i * (full.length - 1)) / (k - 1))]);
    addPoly(sub);
  } else addPoly(pts);
  if (d.name === 'pelvis') for (const n of ['thigh.L', 'thigh.R']) sg.push(...d.head, ...BONE_DEFS[IDX[n]].head);
  const f = new Float32Array(sg);
  segs.push(f);
  R[b] = radiusOf(d.name);
  for (let a = 0; a < 3; a++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i < f.length; i += 3) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
    bmin[b * 3 + a] = lo; bmax[b * 3 + a] = hi;
  }
  if (!/^(scapula|jaw|eye|lid)/.test(d.name)) soft.push(b);
}

const allowed = new Uint8Array(NB * NB);
{
  const adj: number[][] = Array.from({ length: NB }, () => []);
  BONE_DEFS.forEach((d, i) => { if (d.parent) { const p = IDX[d.parent]; adj[i].push(p); adj[p].push(i); } });
  for (let s = 0; s < NB; s++) {
    let front = [s];
    const seen = new Set([s]);
    allowed[s * NB + s] = 1;
    for (let depth = 0; depth < 3; depth++) {
      const nx: number[] = [];
      for (const u of front) for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); allowed[s * NB + v] = 1; nx.push(v); }
      front = nx;
    }
  }
}
const grp = (n: string): string => {
  const m = n.match(/^(upperarm|forearm|hand|f\d_\d)\.([LR])$/);
  if (m) return 'arm' + m[2];
  const l = n.match(/^(thigh|shin|foot|toes)\.([LR])$/);
  if (l) return 'leg' + l[2];
  if (n.startsWith('clavicle')) return 'clav' + n.slice(-1);
  return 'trunk';
};
for (let a = 0; a < NB; a++) {
  const ga = grp(BONE_DEFS[a].name);
  for (let b = 0; b < NB; b++) {
    if (!allowed[a * NB + b]) continue;
    const nb = BONE_DEFS[b].name, gb = grp(nb);
    let ok: boolean;
    if (ga === gb) ok = true;
    else if (ga.startsWith('arm')) ok = gb === 'clav' + ga[3] || nb === 'spine_T1';
    else if (ga.startsWith('leg')) ok = nb === 'pelvis';
    else if (ga.startsWith('clav')) ok = gb === 'trunk' || gb === 'arm' + ga[4];
    else ok = (ga === 'trunk' && gb.startsWith('clav')) || (BONE_DEFS[a].name === 'pelvis' && gb.startsWith('leg'));
    if (!ok) allowed[a * NB + b] = 0;
  }
}

function segDistSq(f: Float32Array, x: number, y: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < f.length; i += 6) {
    const ax = f[i], ay = f[i + 1], az = f[i + 2];
    const dx = f[i + 3] - ax, dy = f[i + 4] - ay, dz = f[i + 5] - az;
    const px = x - ax, py = y - ay, pz = z - az;
    const l2 = dx * dx + dy * dy + dz * dz;
    let t = l2 > 1e-12 ? (px * dx + py * dy + pz * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - dx * t, ey = py - dy * t, ez = pz - dz * t;
    const d = ex * ex + ey * ey + ez * ez;
    if (d < best) best = d;
  }
  return best;
}
const boxDistSq = (b: number, x: number, y: number, z: number) => {
  const o = b * 3;
  const dx = x < bmin[o] ? bmin[o] - x : x > bmax[o] ? x - bmax[o] : 0;
  const dy = y < bmin[o + 1] ? bmin[o + 1] - y : y > bmax[o + 1] ? y - bmax[o + 1] : 0;
  const dz = z < bmin[o + 2] ? bmin[o + 2] - z : z > bmax[o + 2] ? z - bmax[o + 2] : 0;
  return dx * dx + dy * dy + dz * dz;
};
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function nearestBone(x: number, y: number, z: number): number {
  let best = -1, bd = Infinity;
  for (const b of soft) { const d = segDistSq(segs[b], x, y, z); if (d < bd) { bd = d; best = b; } }
  return best;
}

const IJAW = IDX['jaw'], ILU = [IDX['lidU.L'], IDX['lidU.R']], ILL = [IDX['lidL.L'], IDX['lidL.R']];
const lbs = new Float32Array(NB), cd = new Float32Array(NB), cb = new Int32Array(NB), cs = new Float32Array(NB);
const eb = new Int32Array(NB + 8), ew = new Float32Array(NB + 8), tmp = new Float32Array(NB + 8);
const bgrp = BONE_DEFS.map((d) => grp(d.name));
const isArm = bgrp.map((g) => g.startsWith('arm'));
const isClav = bgrp.map((g, i) => g.startsWith('clav') || BONE_DEFS[i].name === 'spine_T1');
const isTrunk = bgrp.map((g, i) => g === 'trunk' && !/^(jaw|eye|lid)/.test(BONE_DEFS[i].name));
const SHO = [BONE_DEFS[IDX['upperarm.L']].head, BONE_DEFS[IDX['upperarm.R']].head];
const AX_Y = SHO[0][1] - 0.05;
const SCAP = [IDX['scapula.L'], IDX['scapula.R']];
const NEAR = 0.03, FULL = 0.012;

// real-body landmarks, set by convert.cjs
let EYE: (number[] | null)[] = [null, null];
const JH = BONE_DEFS[IDX['jaw']].head, JT = BONE_DEFS[IDX['jaw']].tail;
export function setEyes(l: number[] | null, r: number[] | null): void { EYE = [l, r]; }

function trim4(ne: number): number {
  if (ne <= 4) return ne;
  for (let k = 0; k < ne; k++) tmp[k] = ew[k];
  let t5 = 0;
  for (let r = 0; r < 5; r++) {
    let bk = 0, bv = -1;
    for (let k = 0; k < ne; k++) if (tmp[k] > bv) { bv = tmp[k]; bk = k; }
    t5 = bv; tmp[bk] = -1;
  }
  let m = 0;
  for (let k = 0; k < ne; k++) { const v = ew[k] - t5; if (v > 1e-6) { eb[m] = eb[k]; ew[m] = v; m++; } }
  return m;
}

function field(x: number, y: number, z: number): number {
  let bi = -1, bl = Infinity;
  for (let k = 0; k < soft.length; k++) {
    const b = soft[k];
    const l = boxDistSq(b, x, y, z);
    lbs[b] = l;
    if (l < bl) { bl = l; bi = b; }
  }
  const d0 = Math.sqrt(segDistSq(segs[bi], x, y, z)) + 0.09;
  const lim = d0 * d0;
  let nc = 0, dmin = Infinity, nearest = bi;
  for (let k = 0; k < soft.length; k++) {
    const b = soft[k];
    if (lbs[b] > lim) continue;
    const d = Math.sqrt(segDistSq(segs[b], x, y, z));
    cb[nc] = b; cd[nc] = d; nc++;
    if (d < dmin) { dmin = d; nearest = b; }
  }
  const ac = sstep(0, 0.008, Math.abs(x) - (0.158 + 0.15 * Math.max(0, 1.1 - y)));
  const armF = 1 - (1 - sstep(AX_Y, AX_Y + 0.05, y)) * (1 - ac);
  const sh0 = Math.hypot(x - SHO[0][0], y - SHO[0][1], z - SHO[0][2]);
  const sh1 = Math.hypot(x - SHO[1][0], y - SHO[1][1], z - SHO[1][2]);
  const dsh = Math.min(sh0, sh1);
  const near = 1 - sstep(0.1, 0.2, dsh);
  const shF = 1 - ac * (1 - near);
  for (let k = 0; k < nc; k++) {
    const t = 1 - (cd[k] - dmin) / R[cb[k]];
    cs[k] = t > 0 ? t * t * (3 - 2 * t) : 0;
  }
  let ne = 0;
  for (let k = 0; k < nc; k++) {
    if (cs[k] <= 0) continue;
    const b = cb[k];
    let g = 0;
    for (let j = 0; j < nc; j++) if (cs[j] > g && allowed[cb[j] * NB + b]) g = cs[j];
    let s = cs[k] * g;
    if (isArm[b]) s *= armF;
    else if (isClav[b]) s *= shF;
    if (s <= 1e-5) continue;
    eb[ne] = b; ew[ne] = s; ne++;
  }
  if (dsh < 0.25 && ac > 0.001) {
    const sb = sh0 <= sh1 ? SCAP[0] : SCAP[1];
    const d = Math.sqrt(segDistSq(segs[sb], x, y, z));
    const t = 1 - (d - dmin) / 0.08;
    const s = t > 0 ? t * t * (3 - 2 * t) * ac * near : 0;
    if (s > 1e-5) { eb[ne] = sb; ew[ne] = s; ne++; }
  }
  if (ne === 0) { eb[0] = nearest; ew[0] = 1; ne = 1; }
  // jaw: lower face below the mouth line, in front of the condyles
  {
    const y0 = JT[1] + 0.6 * (JH[1] - JT[1]);
    if (y < y0 + 0.02 && y > JT[1] - 0.04 && Math.abs(x) < 0.09 && z > JH[2] - 0.02) {
      const jw = sstep(y0 + 0.02, y0, y) * sstep(JT[1] - 0.03, JT[1] + 0.005, y) * sstep(JH[2] - 0.02, JH[2] + 0.015, z);
      if (jw > 0.001) {
        let sum = 0;
        for (let k = 0; k < ne; k++) sum += ew[k];
        const sc = sum > 0 ? (1 - jw) / sum : 0;
        for (let k = 0; k < ne; k++) ew[k] *= sc;
        eb[ne] = IJAW; ew[ne] = jw; ne++;
      }
    }
  }
  // eyelids from the real eye centre
  for (let si = 0; si < 2; si++) {
    const e = EYE[si];
    if (!e) continue;
    const dx = x - e[0], dy = y - e[1], dz = z - e[2];
    if (dz < -0.002 || Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) continue;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const t = (1 - sstep(0.010, 0.016, dist)) * sstep(-0.002, 0.006, dz);
    if (t < 0.001) continue;
    const u = sstep(-0.003, 0.003, dy);
    let sum = 0;
    for (let k = 0; k < ne; k++) sum += ew[k];
    const sc = sum > 0 ? (1 - t) / sum : 0;
    for (let k = 0; k < ne; k++) ew[k] *= sc;
    eb[ne] = ILU[si]; ew[ne] = u * t; ne++;
    eb[ne] = ILL[si]; ew[ne] = (1 - u) * t; ne++;
    break;
  }
  ne = trim4(ne);
  let tot = 0;
  for (let k = 0; k < ne; k++) tot += ew[k];
  if (tot > 0) { const inv = 1 / tot; for (let k = 0; k < ne; k++) ew[k] *= inv; }
  else { eb[0] = nearest; ew[0] = 1; ne = 1; }
  return ne;
}

const acc = new Float32Array(NB);
const touched = new Int32Array(4 * NB + 16);
let nt = 0;
function addField(ne: number, f: number): void {
  for (let j = 0; j < ne; j++) {
    const b = eb[j];
    if (acc[b] === 0) touched[nt++] = b;
    acc[b] += ew[j] * f;
  }
}

/** skinQ(x,y,z,out) -> signed distance to the skin (negative inside), writes nearest skin point to out. */
export type SkinQ = (x: number, y: number, z: number, out: number[]) => number;

export function softWeights(pos: Float32Array, skinQ: SkinQ | null, wide = false): { idx: Uint8Array; w: Float32Array } {
  const n = pos.length / 3;
  const idx = new Uint8Array(n * 4);
  const w = new Float32Array(n * 4);
  const q = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    nt = 0;
    let k = 0;
    if (skinQ) {
      const sd = skinQ(x, y, z, q);
      k = sd > 0.003 || sd < -0.4 ? 0 : wide ? 1 - sstep(0.025, 0.045, -sd) : 1 - sstep(FULL, NEAR, -sd);
    }
    if (k > 0) addField(field(q[0], q[1], q[2]), k);
    if (k < 1) addField(field(x, y, z), 1 - k);
    let tot = 0;
    const o = v * 4;
    for (let j = 0; j < 4; j++) {
      let bk = -1, bw = 0;
      for (let t = 0; t < nt; t++) { const b = touched[t]; if (acc[b] > bw) { bw = acc[b]; bk = b; } }
      if (bk < 0) break;
      idx[o + j] = bk; w[o + j] = bw; tot += bw; acc[bk] = -1;
    }
    for (let t = 0; t < nt; t++) acc[touched[t]] = 0;
    if (tot > 0) { const inv = 1 / tot; for (let j = 0; j < 4; j++) w[o + j] *= inv; }
    else { idx[o] = nearestBone(x, y, z); w[o] = 1; }
  }
  return { idx, w };
}
