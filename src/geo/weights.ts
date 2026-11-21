/**
 * Skinning weights (P1). Runs in the build worker on world-space positions.
 * Rigid parts -> 1 bone; soft tissue -> up to 4 bones, weights from smoothstep falloff of the
 * *excess* distance over the nearest bone (so thick limbs still blend), restricted to nearby bones in the tree.
 */
import { BONE_DEFS, BONE_INDEX, ribPoly } from '../anatomy/bones3d';
import { eyelidWeight, skinShape } from '../anatomy/skin';
import { SIDES } from '../anatomy/rig';

const NB = BONE_DEFS.length;
const IDX = BONE_INDEX;

// ---------------------------------------------------------------- bone geometry tables
const segs: Float32Array[] = [];
const bmin = new Float32Array(NB * 3);
const bmax = new Float32Array(NB * 3);
const R = new Float32Array(NB);
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

(() => {
  for (let b = 0; b < NB; b++) {
    const d = BONE_DEFS[b];
    let pts: number[][] = [d.head, d.tail];
    if (d.name === 'pelvis') pts = [d.tail, d.head];
    const sg: number[] = [];
    const addPoly = (p: number[][]) => { for (let i = 0; i + 1 < p.length; i++) sg.push(...p[i], ...p[i + 1]); };
    if (/^rib\d+\.[LR]$/.test(d.name)) {
      const m = d.name.match(/^rib(\d+)\.([LR])$/)!;
      const full = ribPoly(m[2] === 'L' ? 1 : -1, +m[1]);
      const k = Math.min(7, full.length);
      const sub: number[][] = [];
      for (let i = 0; i < k; i++) sub.push(full[Math.round((i * (full.length - 1)) / (k - 1))]);
      addPoly(sub);
    } else addPoly(pts);
    if (d.name === 'pelvis') for (const s of SIDES) { const h = BONE_DEFS[IDX[s === 1 ? 'thigh.L' : 'thigh.R']].head; sg.push(...d.head, ...h); }
    const f = new Float32Array(sg);
    segs.push(f);
    const R0 = radiusOf(d.name);
    R[b] = R0;
    for (let a = 0; a < 3; a++) {
      let lo = Infinity, hi = -Infinity;
      for (let i = a; i < f.length; i += 3) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
      bmin[b * 3 + a] = lo; bmax[b * 3 + a] = hi;
    }
    if (!/^(scapula|jaw|eye|lid)/.test(d.name)) soft.push(b);
  }
})();

// allowed[n*NB+b]: tree distance <= 3
const allowed = new Uint8Array(NB * NB);
(() => {
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
})();

// region exclusivity: arms never mix with the trunk (except via clavicle/spine_T1), legs never with each other
const grp = (n: string): string => {
  const m = n.match(/^(upperarm|forearm|hand|f\d_\d)\.([LR])$/);
  if (m) return 'arm' + m[2];
  const l = n.match(/^(thigh|shin|foot|toes)\.([LR])$/);
  if (l) return 'leg' + l[2];
  if (n.startsWith('clavicle')) return 'clav' + n.slice(-1);
  return 'trunk';
};
(() => {
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
})();

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

// ---------------------------------------------------------------- rigid assignment
const FINGER_KEY: Record<string, number> = { index: 2, middle: 3, ring: 4, little: 5 };
const TRUNK_Y = (y: number) => (y >= 1.58 ? 'head' : y >= 1.46 ? 'neck' : y >= 1.17 ? 'spine_T7' : y >= 0.98 ? 'spine_L3' : 'pelvis');

const SOFT_TISSUE = new Set(['skin', 'fat', 'muscle', 'tendon', 'artery', 'vein', 'nerve', 'cord', 'esophagus', 'ligament', 'disc', 'lymph', 'node', 'mucosa']);

function nearestBone(c: [number, number, number]): number {
  let best = -1, bd = Infinity;
  for (const b of soft) {
    const d = segDistSq(segs[b], c[0], c[1], c[2]);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Returns bone index for rigid parts, -1 for soft-skinned parts. */
export function rigidBone(id: string, tissue: string, c: [number, number, number]): number {
  const sm = id.match(/\.([LR])$/);
  const S = sm ? sm[1] : (c[0] >= 0 ? 'L' : 'R');
  const bn = (n: string) => IDX[n];
  let m: RegExpMatchArray | null;
  if ((m = id.match(/^bone\.rib\.(\d+)\./))) return bn(`rib${m[1]}.${S}`);
  if ((m = id.match(/^bone\.vert\.([CTL])(\d+)$/))) {
    const r = m[1], n = +m[2];
    if (r === 'C') return bn(n === 1 ? 'head' : 'neck');
    if (r === 'T') return bn(n <= 6 ? 'spine_T1' : n <= 11 ? 'spine_T7' : 'spine_T12');
    return bn(n <= 3 ? 'spine_L3' : 'pelvis');
  }
  if (id === 'bone.sternum') return bn('sternum');
  if (id.startsWith('bone.clavicle')) return bn(`clavicle.${S}`);
  if (id.startsWith('bone.scapula')) return bn(`scapula.${S}`);
  if (id.startsWith('bone.humerus')) return bn(`upperarm.${S}`);
  if (id.startsWith('bone.radius') || id.startsWith('bone.ulna')) return bn(`forearm.${S}`);
  if (id.startsWith('bone.mc1')) return bn(`f1_1.${S}`);
  if (id.startsWith('bone.mc') || /^bone\.(scaphoid|lunate|triquetrum|pisiform|trapezium|trapezoid|capitate|hamate)/.test(id)) return bn(`hand.${S}`);
  if ((m = id.match(/^bone\.phalanx\.thumb\.(\d)/))) return bn(`f1_${+m[1] === 0 ? 2 : 3}.${S}`);
  if ((m = id.match(/^bone\.phalanx\.(\w+)\.(\d)/)) && FINGER_KEY[m[1]]) return bn(`f${FINGER_KEY[m[1]]}_${+m[2] + 1}.${S}`);
  if (/^bone\.(hip|sacrum|coccyx)/.test(id) || id === 'cart.symphysis') return bn('pelvis');
  if (id.startsWith('bone.femur') || id.startsWith('bone.patella')) return bn(`thigh.${S}`);
  if (id.startsWith('bone.tibia') || id.startsWith('bone.fibula') || id.startsWith('cart.menisci')) return bn(`shin.${S}`);
  if (id.startsWith('bone.toe.')) return bn(`toes.${S}`);
  if (/^bone\.(talus|calcaneus|navicular|cuboid|cuneiform|mt\d)/.test(id)) return bn(`foot.${S}`);
  if (/^bone\.(frontal|occipital|parietal|temporal|zygomatic|sphenoid|maxilla|nasal)/.test(id) || id === 'teeth.upper') return bn('head');
  if (id === 'bone.mandible' || id === 'teeth.lower' || id === 'dig.tongue') return bn('jaw');
  if (id === 'bone.hyoid') return bn('neck');
  if (id.startsWith('eye.')) return bn(`eye.${S}`);
  if (tissue === 'brain' || tissue === 'brainstem' || tissue === 'cerebellum') return bn('head');
  if (id === 'resp.trachea' || id.startsWith('cart.costal') || id.startsWith('lig.')) return -1;
  if (SOFT_TISSUE.has(tissue)) return -1;
  if (tissue === 'lung' || tissue === 'liver' || tissue === 'spleen' || tissue === 'myocardium' || tissue === 'atrium' || tissue === 'valve' || tissue === 'coronary' || tissue === 'gallbladder') return bn('spine_T7');
  if (tissue === 'diaphragm') return bn('spine_T12');
  if (tissue === 'stomach' || tissue === 'intestine' || tissue === 'colon' || tissue === 'pancreas' || tissue === 'kidney' || tissue === 'medulla') return bn('spine_L3');
  if (tissue === 'bladder' || tissue === 'prostate') return bn('pelvis');
  return bn(TRUNK_Y(c[1])) ?? nearestBone(c);
}

// ---------------------------------------------------------------- main
const IJAW = IDX['jaw'], ILU = [IDX['lidU.L'], IDX['lidU.R']], ILL = [IDX['lidL.L'], IDX['lidL.R']];
const lbs = new Float32Array(NB), cd = new Float32Array(NB), cb = new Int32Array(NB), cs = new Float32Array(NB);
const eb = new Int32Array(NB + 8), ew = new Float32Array(NB + 8), tmp = new Float32Array(NB + 8);
const bgrp = BONE_DEFS.map((d) => grp(d.name));
const isArm = bgrp.map((g) => g.startsWith('arm'));
const isClav = bgrp.map((g, i) => g.startsWith('clav') || BONE_DEFS[i].name === 'spine_T1');
const isTrunk = bgrp.map((g, i) => g === 'trunk' && !/^(jaw|eye|lid)/.test(BONE_DEFS[i].name));
const SHO = [BONE_DEFS[IDX['upperarm.L']].head, BONE_DEFS[IDX['upperarm.R']].head];
const AX_Y = SHO[0][1] - 0.05; // axilla height: trunk skin takes no arm weight below it
const SCAP = [IDX['scapula.L'], IDX['scapula.R']];
const NEAR = 0.03, FULL = 0.012; // skin-coupling depth band (m)

/** keep the 4 largest weights, subtracting the 5th so the cut is continuous (no rank flips). */
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

/**
 * The smooth soft-tissue weight field at a world position. Fills eb/ew (normalised), returns the count.
 * One function for the skin and, evaluated at the nearest skin point, for every layer beneath it.
 */
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
  let nc = 0, dmin = Infinity, nearest = bi, da = 9, dt = 9;
  for (let k = 0; k < soft.length; k++) {
    const b = soft[k];
    if (lbs[b] > lim) continue;
    const d = Math.sqrt(segDistSq(segs[b], x, y, z));
    cb[nc] = b; cd[nc] = d; nc++;
    if (d < dmin) { dmin = d; nearest = b; }
    if (isArm[b]) { if (d < da) da = d; } else if (isTrunk[b]) { if (d < dt) dt = d; }
  }
  // arm vs trunk side: same oblique plane skin.ts cuts skin.arm.* from skin.trunk (one-sided, so trunk skin gets exactly 0)
  void da; void dt;
  const ac = sstep(0, 0.008, Math.abs(x) - (0.17 + 0.1 * (1.25 - y)));
  const armF = 1 - (1 - sstep(AX_Y, AX_Y + 0.05, y)) * (1 - ac);
  const sh0 = Math.hypot(x - SHO[0][0], y - SHO[0][1], z - SHO[0][2]);
  const sh1 = Math.hypot(x - SHO[1][0], y - SHO[1][1], z - SHO[1][2]);
  const dsh = Math.min(sh0, sh1);
  const near = 1 - sstep(0.1, 0.2, dsh);
  const shF = 1 - ac * (1 - near); // clavicle / spine_T1 influence on arm-side skin only near the shoulder
  for (let k = 0; k < nc; k++) {
    const t = 1 - (cd[k] - dmin) / R[cb[k]];
    cs[k] = t > 0 ? t * t * (3 - 2 * t) : 0;
  }
  let ne = 0;
  for (let k = 0; k < nc; k++) {
    if (cs[k] <= 0) continue;
    const b = cb[k];
    // continuous gating: allowed if any strongly weighted bone permits it
    let g = 0;
    for (let j = 0; j < nc; j++) if (cs[j] > g && allowed[cb[j] * NB + b]) g = cs[j];
    let s = cs[k] * g;
    if (isArm[b]) s *= armF;
    else if (isClav[b]) s *= shF;
    if (s <= 1e-5) continue;
    eb[ne] = b; ew[ne] = s; ne++;
  }
  if (dsh < 0.25 && ac > 0.001) {
    // scapula only for arm-side points near the shoulder
    const sb = sh0 <= sh1 ? SCAP[0] : SCAP[1];
    const d = Math.sqrt(segDistSq(segs[sb], x, y, z));
    const t = 1 - (d - dmin) / 0.08;
    const s = t > 0 ? t * t * (3 - 2 * t) * ac * near : 0;
    if (s > 1e-5) { eb[ne] = sb; ew[ne] = s; ne++; }
  }
  if (ne === 0) { eb[0] = nearest; ew[0] = 1; ne = 1; }
  // jaw (mask based)
  if (y > 1.49 && y < 1.6 && x < 0.08 && x > -0.08 && z > -0.035) {
    const jw = sstep(1.582, 1.562, y) * sstep(-0.03, 0.0, z) * sstep(1.49, 1.525, y);
    if (jw > 0.001) {
      let sum = 0;
      for (let k = 0; k < ne; k++) sum += ew[k];
      const sc = sum > 0 ? (1 - jw) / sum : 0;
      for (let k = 0; k < ne; k++) ew[k] *= sc;
      eb[ne] = IJAW; ew[ne] = jw; ne++;
    }
  }
  // eyelids
  if (y > 1.62 && y < 1.69 && z > 0.06 && x > -0.075 && x < 0.075) {
    const si = x >= 0 ? 0 : 1;
    const e = eyelidWeight(x >= 0 ? 1 : -1, x, y, z);
    const tot = e.upper + e.lower;
    if (tot > 0.001) {
      const t = Math.min(1, tot);
      let sum = 0;
      for (let k = 0; k < ne; k++) sum += ew[k];
      const sc = sum > 0 ? (1 - t) / sum : 0;
      for (let k = 0; k < ne; k++) ew[k] *= sc;
      eb[ne] = ILU[si]; ew[ne] = (e.upper / tot) * t; ne++;
      eb[ne] = ILL[si]; ew[ne] = (e.lower / tot) * t; ne++;
    }
  }
  ne = trim4(ne);
  let tot = 0;
  for (let k = 0; k < ne; k++) tot += ew[k];
  if (tot > 0) { const inv = 1 / tot; for (let k = 0; k < ne; k++) ew[k] *= inv; }
  else { eb[0] = nearest; ew[0] = 1; ne = 1; }
  return ne;
}

// nearest-skin projection (forward-difference Newton steps on the skin SDF; p is within a few cm inside)
let SH: ReturnType<typeof skinShape> | null = null;
const qp = [0, 0, 0];
function projectSkin(x: number, y: number, z: number, d0: number): void {
  const sh = SH!;
  const e = 0.002;
  const gx = sh.d(x + e, y, z) - d0, gy = sh.d(x, y + e, z) - d0, gz = sh.d(x, y, z + e) - d0;
  const gl = Math.hypot(gx, gy, gz) || 1;
  qp[0] = x - (gx / gl) * d0; qp[1] = y - (gy / gl) * d0; qp[2] = z - (gz / gl) * d0;
}

const acc = new Float32Array(NB);
const touched = new Int32Array(4 * NB);
let nt = 0;
function addField(ne: number, f: number): void {
  for (let j = 0; j < ne; j++) {
    const b = eb[j];
    if (acc[b] === 0) touched[nt++] = b;
    acc[b] += ew[j] * f;
  }
}

export function computeWeights(
  partId: string, system: string, tissue: string, pos: Float32Array, center: [number, number, number],
): { idx: Uint16Array; w: Float32Array } {
  void system;
  const n = pos.length / 3;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  const rb = rigidBone(partId, tissue, center);
  if (rb >= 0) {
    for (let i = 0; i < n; i++) { idx[i * 4] = rb; w[i * 4] = 1; }
    return { idx, w };
  }
  // skin & fat are the field itself; other soft tissue follows the skin point above it
  const own = tissue === 'skin' || tissue === 'fat';
  if (!own && !SH) SH = skinShape();
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    nt = 0;
    let k = 0;
    let sd = 0;
    if (!own) {
      sd = SH!.d(x, y, z); // negative inside
      k = sd > 0.003 ? 0 : 1 - sstep(FULL, NEAR, -sd);
      if (sd > 0.003 || sd < -0.4) k = 0;
    }
    if (k > 0) {
      projectSkin(x, y, z, sd);
      addField(field(qp[0], qp[1], qp[2]), k);
    }
    if (k < 1) addField(field(x, y, z), 1 - k);
    // top 4 of the blended set, normalised
    let tot = 0;
    const o = v * 4;
    for (let j = 0; j < 4; j++) {
      let bk = -1, bw = 0;
      for (let q = 0; q < nt; q++) { const b = touched[q]; if (acc[b] > bw) { bw = acc[b]; bk = b; } }
      if (bk < 0) break;
      idx[o + j] = bk; w[o + j] = bw; tot += bw; acc[bk] = -1;
    }
    for (let q = 0; q < nt; q++) acc[touched[q]] = 0;
    if (tot > 0) { const inv = 1 / tot; for (let j = 0; j < 4; j++) w[o + j] *= inv; }
    else { idx[o] = nearestBone([x, y, z]); w[o] = 1; }
  }
  return { idx, w };
}
