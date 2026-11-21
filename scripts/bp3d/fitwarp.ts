// Fit warp.json: procedural space -> BP3D app space. Bundle with esbuild, run with node from project root:
//   npx esbuild scripts/bp3d/fitwarp.ts --bundle --platform=node --format=esm --outfile=$TMP/fitwarp.mjs && node $TMP/fitwarp.mjs
import * as fs from 'node:fs';
import { parts } from '../../src/anatomy/registry';
import { defineSkin } from '../../src/anatomy/skin';
import { defineSkeleton } from '../../src/anatomy/skeleton';
import { defineMuscles } from '../../src/anatomy/muscles';
import { defineCardio } from '../../src/anatomy/cardio';
import { defineNervous } from '../../src/anatomy/nervous';
import { defineOrgans } from '../../src/anatomy/organs';
import { defineLymphatic } from '../../src/anatomy/lymphatic';
import { defineHeadNeck } from '../../src/anatomy/headneck';

type V = [number, number, number];
const ROOT = process.cwd();
const OBJ = ROOT + '/data/bp3d/obj/isa_BP3D_4.0_obj_99/';

// BP3D name -> files (data is only read as text)
const nameFiles = new Map<string, string[]>();
let skinFile = '';
for (const line of fs.readFileSync(ROOT + '/data/bp3d_leaf.tsv', 'utf8').split('\n')) {
  const c = line.split('\t');
  if (c.length < 3) continue;
  if (c[1] === 'FMA7163') skinFile = c[0];
  const a = nameFiles.get(c[2]) ?? [];
  a.push(c[0]);
  nameFiles.set(c[2], a);
}
function readObj(file: string): Float64Array {
  const t = fs.readFileSync(OBJ + file + '.obj', 'utf8');
  const out: number[] = [];
  for (const l of t.split('\n')) {
    if (l.charCodeAt(0) !== 118 || l.charCodeAt(1) !== 32) continue;
    const s = l.trim().split(/\s+/);
    out.push(+s[1] * 0.001, (+s[3] + 78) * 0.001, -(+s[2]) * 0.001);
  }
  return new Float64Array(out);
}
const catF = (arrs: ArrayLike<number>[]) => { let n = 0; for (const a of arrs) n += a.length; const o = new Float64Array(n); let k = 0; for (const a of arrs) for (let i = 0; i < a.length; i++) o[k++] = a[i]; return o; };

interface Stat { c: V; ax: V; s1: number; s2: number }
function stat(p: ArrayLike<number>): Stat {
  const n = p.length / 3; const c: V = [0, 0, 0];
  for (let i = 0; i < p.length; i += 3) { c[0] += p[i]; c[1] += p[i + 1]; c[2] += p[i + 2]; }
  c[0] /= n; c[1] /= n; c[2] /= n;
  const m = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] - c[0], y = p[i + 1] - c[1], z = p[i + 2] - c[2];
    m[0] += x * x; m[1] += x * y; m[2] += x * z; m[3] += y * y; m[4] += y * z; m[5] += z * z;
  }
  const A = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]].map((r) => r.map((v) => v / n));
  const top = (M: number[][]): [V, number] => {
    let v: V = [0.577, 0.6, 0.55]; let l = 0;
    for (let it = 0; it < 80; it++) {
      const w: V = [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
      l = Math.hypot(w[0], w[1], w[2]) || 1e-12;
      v = [w[0] / l, w[1] / l, w[2] / l];
    }
    return [v, l];
  };
  const [v1, l1] = top(A);
  const B = A.map((r, i) => r.map((x, j) => x - l1 * v1[i] * v1[j]));
  const [, l2] = top(B);
  return { c, ax: v1, s1: Math.sqrt(l1), s2: Math.sqrt(Math.max(l2, 0)) };
}

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const sideW = (s: string) => (s === 'L' ? 'left' : 'right');
const FINGER: Record<string, string> = { index: 'index finger', middle: 'middle finger', ring: 'ring finger', little: 'little finger' };
const TOE: Record<string, string> = { second: 'second toe', third: 'third toe', fourth: 'fourth toe', fifth: 'little toe' };
function bpNames(id: string): string[] | null {
  let m: RegExpMatchArray | null;
  if ((m = id.match(/^bone\.vert\.([CTL])(\d+)$/))) { const r = { C: 'cervical', T: 'thoracic', L: 'lumbar' }[m[1]]; const n = +m[2]; if (m[1] === 'C' && n === 1) return ['atlas']; return [`${ORD[n]} ${r} vertebra`]; }
  if ((m = id.match(/^bone\.rib\.(\d+)\.([LR])$/))) return [`${sideW(m[2])} ${ORD[+m[1]]} rib`];
  const one: Record<string, string[]> = {
    'bone.sternum': ['body of sternum', 'manubrium'], 'bone.sacrum': ['sacrum'], 'bone.mandible': ['mandible'], 'bone.hyoid': ['hyoid bone'],
    'bone.frontal': ['frontal bone'], 'bone.occipital': ['occipital bone'], 'bone.sphenoid': ['sphenoid bone'],
    'bone.maxilla': ['left maxilla', 'right maxilla'], 'bone.nasal': ['left nasal bone', 'right nasal bone'],
    'resp.trachea': ['trachea'], 'dig.stomach': ['stomach'], 'dig.esophagus': ['esophagus'], 'dig.spleen': ['spleen'], 'dig.pancreas': ['pancreas'],
    'uri.bladder': ['urinary bladder'], 'dig.tongue': ['tongue'], 'rep.prostate': ['prostate'], 'dig.duodenum': ['duodenum'], 'dig.rectum': ['rectum'],
  };
  if (one[id]) return one[id];
  if ((m = id.match(/^bone\.(parietal|temporal|zygomatic|clavicle|scapula|humerus|radius|ulna|femur|tibia|fibula|patella|talus|calcaneus|hip)\.([LR])$/))) return [`${sideW(m[2])} ${m[1]}${['parietal', 'temporal', 'zygomatic', 'hip'].includes(m[1]) ? ' bone' : ''}`];
  if ((m = id.match(/^bone\.(scaphoid|lunate|pisiform|trapezium|trapezoid|capitate|hamate)\.([LR])$/))) return [`${sideW(m[2])} ${m[1]}`];
  if ((m = id.match(/^bone\.triquetrum\.([LR])$/))) return [`${sideW(m[1])} triquetral`];
  if ((m = id.match(/^bone\.navicular\.([LR])$/))) return [`navicular bone of ${sideW(m[1])} foot`];
  if ((m = id.match(/^bone\.cuboid\.([LR])$/))) return [`${sideW(m[1])} cuboid bone`];
  if ((m = id.match(/^bone\.cuneiform\.(medial|intermediate|lateral)\.([LR])$/))) return [`${sideW(m[2])} ${m[1]} cuneiform bone`];
  if ((m = id.match(/^bone\.mc(\d)\.([LR])$/))) return [`${sideW(m[2])} ${ORD[+m[1]]} metacarpal bone`];
  if ((m = id.match(/^bone\.mt(\d)\.([LR])$/))) return [`${sideW(m[2])} ${ORD[+m[1]]} metatarsal bone`];
  if ((m = id.match(/^bone\.phalanx\.(index|middle|ring|little)\.2\.([LR])$/))) return [`distal phalanx of ${sideW(m[2])} ${FINGER[m[1]]}`];
  if ((m = id.match(/^bone\.phalanx\.thumb\.2\.([LR])$/))) return [`distal phalanx of ${sideW(m[1])} thumb`];
  if ((m = id.match(/^bone\.toe\.(second|third|fourth|fifth)\.2\.([LR])$/))) return [`distal phalanx of ${sideW(m[2])} ${TOE[m[1]]}`];
  if ((m = id.match(/^bone\.toe\.hallux\.1\.([LR])$/))) return [`distal phalanx of ${sideW(m[1])} big toe`];
  return null;
}
const GROUPS: [string, string[], string[]][] = [
  ['heart', ['heart.lv', 'heart.rv', 'heart.la', 'heart.ra'], ['wall of ventricle', 'wall of left atrium', 'wall of right atrium']],
  ['kidney.L', ['uri.cortex.L', 'uri.medulla.L', 'uri.pelvis.L'], ['left kidney']],
  ['kidney.R', ['uri.cortex.R', 'uri.medulla.R', 'uri.pelvis.R'], ['right kidney']],
];

// all procedural parts, unfiltered (index.ts filters by KEEP_PROCEDURAL)
defineSkin(); defineSkeleton(); defineMuscles(); defineOrgans(); defineCardio(); defineNervous(); defineLymphatic(); defineHeadNeck();
const byId = new Map(parts.map((p) => [p.id, p]));
const geoCache = new Map<string, Float32Array>();
const procPos = (id: string) => { let g = geoCache.get(id); if (!g) { g = byId.get(id)!.build().pos; geoCache.set(id, g); } return g; };

interface LM { name: string; src: V; dst: V; kind: 'c' | 'e' }
const lms: LM[] = [];
const unmatched: string[] = [];
let pairs = 0;
function addPair(label: string, P: Float64Array, B: Float64Array) {
  const sp = stat(P), sb = stat(B);
  lms.push({ name: label, src: sp.c, dst: sb.c, kind: 'c' });
  pairs++;
  const d = sp.ax[0] * sb.ax[0] + sp.ax[1] * sb.ax[1] + sp.ax[2] * sb.ax[2];
  if (sb.s1 / Math.max(sb.s2, 1e-9) > 1.8 && sp.s1 / Math.max(sp.s2, 1e-9) > 1.8 && Math.abs(d) > 0.8 && sb.s1 > +(process.env.EP ?? 0.15)) {
    const sg = d < 0 ? -1 : 1, k = 1.7;
    for (const e of [1, -1]) lms.push({ name: label + (e > 0 ? '+' : '-'), kind: 'e',
      src: [sp.c[0] + e * k * sp.s1 * sp.ax[0], sp.c[1] + e * k * sp.s1 * sp.ax[1], sp.c[2] + e * k * sp.s1 * sp.ax[2]],
      dst: [sb.c[0] + e * sg * k * sb.s1 * sb.ax[0], sb.c[1] + e * sg * k * sb.s1 * sb.ax[1], sb.c[2] + e * sg * k * sb.s1 * sb.ax[2]] });
  }
}
const bpFiles = (names: string[]) => { const f: string[] = []; for (const n of names) { const a = nameFiles.get(n); if (!a) return null; f.push(...a); } return f; };
const bpPos = (f: string[]) => catF(f.map(readObj));
for (const p of parts) {
  const names = bpNames(p.id);
  if (!names) continue;
  const f = bpFiles(names);
  if (!f) { unmatched.push(p.id + ' <- ' + names.join('|')); continue; }
  addPair(p.id, catF([procPos(p.id)]), bpPos(f));
}
for (const [label, pids, names] of GROUPS) {
  if (!pids.every((i) => byId.has(i))) { unmatched.push(label + ' (no proc part)'); continue; }
  const f = bpFiles(names); if (!f) { unmatched.push(label + ' <- ' + names.join('|')); continue; }
  addPair(label, catF(pids.map(procPos)), bpPos(f));
}
if (skinFile) {
  const P = catF(parts.filter((p) => p.id.startsWith('skin.')).map((p) => procPos(p.id)));
  const B = readObj(skinFile);
  const ext = (a: Float64Array, ax: number, hi: boolean) => { let b = hi ? -1e9 : 1e9; for (let i = ax; i < a.length; i += 3) b = hi ? Math.max(b, a[i]) : Math.min(b, a[i]); return b; };
  for (const [ax, nm] of [[1, 'y'], [2, 'z']] as [number, string][]) for (const hi of [true, false]) {
    const s: V = [0, 0, 0], d: V = [0, 0, 0];
    s[ax] = ext(P, ax, hi); d[ax] = ext(B, ax, hi);
    if (ax === 2) { s[1] = 1.2; d[1] = 1.2; }
    lms.push({ name: `skin.${nm}${hi ? 'max' : 'min'}`, kind: 'e', src: s, dst: d });
  }
}
console.log('pairs', pairs, 'landmarks', lms.length, 'unmatched', unmatched.length);
if (unmatched.length) console.log('unmatched:', unmatched.slice(0, 40).join('; '));

const L: LM[] = [];
for (const l of lms) if (!L.some((m) => Math.hypot(m.src[0] - l.src[0], m.src[1] - l.src[1], m.src[2] - l.src[2]) < +(process.env.DD ?? 0.01))) L.push(l);
const N = L.length;

const KP = +(process.env.KP ?? 1);
const phi = (r: number) => (KP === 1 ? r : r * r * r);
const dphi = (r: number) => (KP === 1 ? 1 : 3 * r * r);
function solve(lambda: number) {
  const n = N + 4, M = n + 3;
  const A = new Float64Array(n * M);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) A[i * M + j] = i === j ? (KP === 1 ? -lambda : lambda) : phi(Math.hypot(L[i].src[0] - L[j].src[0], L[i].src[1] - L[j].src[1], L[i].src[2] - L[j].src[2]));
    for (let k = 0; k < 3; k++) { A[i * M + N + k] = L[i].src[k]; A[(N + k) * M + i] = L[i].src[k]; A[i * M + n + k] = L[i].dst[k]; }
    A[i * M + N + 3] = 1; A[(N + 3) * M + i] = 1;
  }
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r * M + c]) > Math.abs(A[piv * M + c])) piv = r;
    if (piv !== c) for (let k = 0; k < M; k++) { const t = A[c * M + k]; A[c * M + k] = A[piv * M + k]; A[piv * M + k] = t; }
    const d = A[c * M + c] || 1e-12;
    for (let r = c + 1; r < n; r++) { const f = A[r * M + c] / d; if (f) for (let k = c; k < M; k++) A[r * M + k] -= f * A[c * M + k]; }
  }
  const X = new Float64Array(n * 3);
  for (let k = 0; k < 3; k++) for (let r = n - 1; r >= 0; r--) {
    let s = A[r * M + n + k]; for (let c = r + 1; c < n; c++) s -= A[r * M + c] * X[c * 3 + k];
    X[r * 3 + k] = s / (A[r * M + r] || 1e-12);
  }
  const w = new Float64Array(N * 3); for (let i = 0; i < N * 3; i++) w[i] = X[i];
  const aff = new Array(12).fill(0);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) aff[3 * j + i] = X[(N + j) * 3 + i];
  for (let i = 0; i < 3; i++) aff[9 + i] = X[(N + 3) * 3 + i];
  return { w, aff };
}
const ev = (w: Float64Array, aff: number[], p: V): V => {
  let x = aff[0] * p[0] + aff[3] * p[1] + aff[6] * p[2] + aff[9], y = aff[1] * p[0] + aff[4] * p[1] + aff[7] * p[2] + aff[10], z = aff[2] * p[0] + aff[5] * p[1] + aff[8] * p[2] + aff[11];
  for (let i = 0; i < N; i++) { const c = L[i].src; const r = phi(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])); x += w[i * 3] * r; y += w[i * 3 + 1] * r; z += w[i * 3 + 2] * r; }
  return [x, y, z];
};
function minDet(w: Float64Array, aff: number[]) {
  let mn = 1e9, bad = 0, cnt = 0; const h = 0.02;
  for (let x = -0.4; x <= 0.4001; x += h) for (let y = -0.05; y <= 1.8; y += h) for (let z = -0.25; z <= 0.3; z += h) {
    const J = [aff[0], aff[3], aff[6], aff[1], aff[4], aff[7], aff[2], aff[5], aff[8]];
    for (let i = 0; i < N; i++) {
      const c = L[i].src; const dx = x - c[0], dy = y - c[1], dz = z - c[2]; const r = Math.hypot(dx, dy, dz) + 1e-9;
      const q = dphi(r) / r; const g = [dx * q, dy * q, dz * q];
      for (let o = 0; o < 3; o++) for (let j = 0; j < 3; j++) J[o * 3 + j] += w[i * 3 + o] * g[j];
    }
    const d = J[0] * (J[4] * J[8] - J[5] * J[7]) - J[1] * (J[3] * J[8] - J[5] * J[6]) + J[2] * (J[3] * J[7] - J[4] * J[6]);
    cnt++; if (d <= 0) { bad++; if (process.env.DBG && bad % 12 === 1) console.log("fold", x.toFixed(2), y.toFixed(2), z.toFixed(2), d.toFixed(2)); } mn = Math.min(mn, d);
  }
  return { mn, bad, cnt };
}
const rms = (w: Float64Array, aff: number[]) => { let s = 0; for (const l of L) { const q = ev(w, aff, l.src); s += (q[0] - l.dst[0]) ** 2 + (q[1] - l.dst[1]) ** 2 + (q[2] - l.dst[2]) ** 2; } return Math.sqrt(s / N) * 1000; };

let best: { lambda: number; w: Float64Array; aff: number[]; r: number; det: ReturnType<typeof minDet> } | null = null;
for (const lambda of (process.env.LAM ?? "0.01,0.015,0.02,0.03,0.05").split(",").map(Number)) {
  const { w, aff } = solve(lambda); if (process.env.DBG) console.log(aff.map((v) => v.toFixed(3)).join(" "), w[0], w[1]); const r = rms(w, aff); const det = minDet(w, aff);
  console.log('lambda', lambda, 'rms_mm', r.toFixed(2), 'minDet', det.mn.toFixed(3), 'folds', det.bad + '/' + det.cnt);
  if (det.bad === 0 && r <= 7.5) { best = { lambda, w, aff, r, det }; break; }
  if (det.bad === 0 && !best) best = { lambda, w, aff, r, det };
}
if (!best) throw new Error('no fold-free fit');
console.log('chosen lambda', best.lambda, 'rms_mm', best.r.toFixed(2), 'minDet', best.det.mn.toFixed(3), 'centres', N);
const want = ['bone.femur.L', 'bone.humerus.R', 'bone.hip.L', 'bone.vert.L3', 'bone.vert.T6', 'bone.sternum', 'bone.mandible', 'heart', 'kidney.L', 'bone.talus.R', 'bone.capitate.L', 'resp.trachea', 'dig.stomach', 'bone.occipital'];
let shown = 0;
for (const nm of want) { const l = L.find((q) => q.name === nm); if (!l || shown >= 10) continue; shown++;
  const q = ev(best.w, best.aff, l.src);
  console.log(nm.padEnd(16), 'before_mm', (Math.hypot(l.src[0] - l.dst[0], l.src[1] - l.dst[1], l.src[2] - l.dst[2]) * 1000).toFixed(1), 'after_mm', (Math.hypot(q[0] - l.dst[0], q[1] - l.dst[1], q[2] - l.dst[2]) * 1000).toFixed(1)); }
const rnd = (a: ArrayLike<number>) => Array.from(a, (v) => +v.toPrecision(7));
const centers: number[] = []; for (const l of L) centers.push(...l.src);
fs.writeFileSync(ROOT + '/src/data/warp.json', JSON.stringify({ version: 1, centers: rnd(centers), weights: rnd(best.w), affine: rnd(best.aff) }));
