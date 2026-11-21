import { V3, add, mul, sub, norm, lerp, spline } from '../geo/math';
import {
  Shape, ellipsoid, capsule, roundCone, union, subtract, sphere, region, PlaneFn, displace, intersect, plane,
  cylinder, frameY, hollow, offset,
} from '../geo/sdf';
import { meshShape, Geo } from '../geo/mesher';
import { tube, merge } from '../geo/tube';
import { twigs } from '../geo/branch';
import { noise3 } from '../geo/noise';
import { Sulcus, densify, branches, sulcalField } from '../geo/f_brain';
import { G, P, Tissue } from './registry';
import { conform } from './skin';
import { underSkin } from './cardio';
import { brainSpace } from './skeleton';
import { ribPaths } from './skeleton';
import {
  HEAD, VERTEBRAE, canalPoint, armPt, forePt, handPt, handFrame, fingerJoints, thumbJoints, footPt, toeJoints, TOES,
  Side, SIDES, sideName, sid,
} from './rig';
import { lc } from './util';

const SYS = 'nervous' as const;
const X = (s: Side, p: V3): V3 => [p[0] * s, p[1], p[2]];
const XS = (s: Side, pts: V3[]) => pts.map((p) => X(s, p));
const ng = (f: PlaneFn): PlaneFn => (x, y, z) => -f(x, y, z);

// ====================================================================== CEREBRUM
/** tentorium cerebelli: separates occipital lobes (above) from cerebellum (below) */
const TENT = (x: number, z: number) => 1.65 + 0.27 * (z + 0.065) - 0.45 * Math.abs(x);
const bigBox = (f: (x: number, y: number, z: number) => number, lo: V3, hi: V3): Shape => ({ d: f, lo, hi });

const baseCache = new Map<number, Shape>();
/** hemisphere envelope (smooth, before sulci). Inside brainSpace(). */
function hemisphereBase(s: Side): Shape {
  if (baseCache.has(s)) return baseCache.get(s)!;
  let h = intersect(offset(brainSpace(), -0.0004), plane([-s, 0, 0], [s * 0.0016, 0, 0]), 0.004);
  h = subtract(h, bigBox((x, y, z) => Math.max(y - (TENT(x, z) + 0.0004), z + 0.028), [-0.09, 1.55, -0.13], [0.09, 1.7, -0.028]), 0.004);
  h = subtract(h, ellipsoid([0, 1.603, -0.018], [0.019, 0.032, 0.045]), 0.01);
  for (const e of SIDES) h = subtract(h, sphere(add(HEAD.eye(e), [0, 0.0, 0.004]), 0.026), 0.012);
  baseCache.set(s, h);
  return h;
}

/** Sulcal pattern of one hemisphere (landmark sulci + tributaries), world coordinates. */
const sulciCache = new Map<number, Sulcus[]>();
function sulci(s: Side): Sulcus[] {
  if (sulciCache.has(s)) return sulciCache.get(s)!;
  const base = hemisphereBase(s);
  const bl: Shape = { d: (x, y, z) => base.d(s * x, y, z), lo: base.lo, hi: base.hi };
  const LAT = (z: number, y: number): V3 => { let x = 0.004; while (x < 0.09 && bl.d(x, y, z) < 0) x += 0.0007; return [x - 0.0004, y, z]; };
  const TOP = (x: number, z: number): V3 => { let y = 1.78; while (y > 1.55 && bl.d(x, y, z) > 0) y -= 0.0007; return [x, y, z]; };
  const INF = (x: number, z: number): V3 => { let y = 1.56; while (y < 1.78 && bl.d(x, y, z) > 0) y += 0.0007; return [x, y, z]; };
  const MED = (y: number, z: number): V3 => [0.0016, y, z];
  const syl = (z: number) => 1.652 - 0.25 * z;
  const cz = (x: number, y: number) => -0.019 + 0.35 * x + 0.25 * (1.74 - y);
  const cs = (off: number, tx: number[], ly: number[]): V3[] => [...tx.map((x) => TOP(x, cz(x, 1.738) + off)), ...ly.map((y) => LAT(cz(0.054, y) + off, y))];
  const mk = (rough: V3[], w: number, depth: number, ends = 0.35, seed = 1, jit = 0.0009): Sulcus => ({ pts: densify(bl, rough, jit, seed + (s > 0 ? 0 : 50)), w, depth, ends });

  const prim: Sulcus[] = [];
  const sylv = mk([0.05, 0.04, 0.028, 0.014, 0.0, -0.014, -0.03, -0.045, -0.056].map((z) => LAT(z, syl(z) + (z < -0.04 ? 0.006 : 0))), 0.0034, 0.0095, 0.55, 1, 0.0006);
  const central = mk(cs(0, [0.004, 0.016, 0.03, 0.042], [1.718, 1.695, 1.672, 1.658]), 0.0022, 0.0078, 0.3, 2, 0.0008);
  const pre = mk(cs(0.017, [0.012, 0.026, 0.04], [1.72, 1.7, 1.68, 1.662]), 0.002, 0.0062, 0.25, 3);
  const post = mk(cs(-0.015, [0.012, 0.026, 0.04], [1.72, 1.7, 1.68, 1.665]), 0.002, 0.0062, 0.25, 4);
  const sfs = mk([TOP(0.017, 0.004), TOP(0.019, 0.025), TOP(0.02, 0.045), TOP(0.018, 0.06), TOP(0.014, 0.073)], 0.0019, 0.0056, 0.3, 5);
  const ifs = mk([LAT(0.027, 1.7), LAT(0.04, 1.696), LAT(0.054, 1.688), LAT(0.066, 1.678)], 0.0019, 0.0056, 0.3, 6);
  const sts = mk([0.03, 0.01, -0.01, -0.03, -0.05, -0.062, -0.07, -0.078].map((z) => LAT(z, syl(z) - 0.014 + (z < -0.05 ? (-0.05 - z) * 1.2 : 0))), 0.002, 0.0066, 0.3, 7);
  const its = mk([0.04, 0.02, 0.0, -0.02, -0.045, -0.065].map((z) => LAT(z, syl(z) - 0.031)), 0.0018, 0.0052, 0.3, 8);
  const ips = mk([TOP(0.03, cz(0.03, 1.74) - 0.0235), TOP(0.03, -0.04), TOP(0.027, -0.058), TOP(0.036, -0.075), LAT(-0.088, 1.7)], 0.0019, 0.0058, 0.3, 9);
  const lot = mk([LAT(-0.082, 1.69), LAT(-0.09, 1.668), LAT(-0.094, 1.645)], 0.0017, 0.0048, 0.3, 10);
  const pos = mk([MED(1.738, -0.05), MED(1.715, -0.054), MED(1.69, -0.058), MED(1.668, -0.063), MED(1.66, -0.065)], 0.0022, 0.0085, 0.3, 11, 0.0005);
  const calc = mk([MED(1.668, -0.099), MED(1.664, -0.085), MED(1.66, -0.07), MED(1.659, -0.06)], 0.002, 0.0075, 0.35, 12, 0.0005);
  const cing = mk([MED(1.684, 0.07), MED(1.702, 0.054), MED(1.712, 0.036), MED(1.716, 0.012), MED(1.715, -0.01), MED(1.713, -0.024), MED(1.728, -0.031), MED(1.74, -0.032)], 0.0021, 0.0066, 0.3, 13, 0.0006);
  const col = mk([INF(0.038, 0.025), INF(0.037, -0.01), INF(0.034, -0.035), INF(0.03, -0.06)], 0.0018, 0.0052, 0.3, 14);
  const olf = mk([INF(0.009, 0.078), INF(0.0095, 0.058), INF(0.01, 0.04)], 0.0014, 0.0058, 0.3, 15);
  const orb = mk([INF(0.02, 0.078), INF(0.021, 0.06), INF(0.022, 0.042)], 0.0014, 0.0048, 0.3, 16);
  const orb2 = mk([INF(0.03, 0.07), INF(0.022, 0.06), INF(0.012, 0.052)], 0.0013, 0.0042, 0.3, 17);
  const aar = mk([LAT(0.036, 1.644), LAT(0.044, 1.662), LAT(0.049, 1.684)], 0.0015, 0.0052, 0.3, 18);
  const har = mk([LAT(0.038, 1.647), LAT(0.052, 1.657), LAT(0.064, 1.657)], 0.0014, 0.0046, 0.3, 19);
  const par = mk([LAT(-0.052, 1.664), LAT(-0.062, 1.686), LAT(-0.07, 1.703)], 0.0019, 0.0056, 0.3, 20);
  const mfs = mk([LAT(0.032, 1.712), TOP(0.036, 0.04), TOP(0.036, 0.062)], 0.0016, 0.0045, 0.3, 21);
  const prim_ = [sylv, central, pre, post, sfs, ifs, sts, its, ips, lot, pos, calc, cing, col, olf, orb, orb2, aar, har, par, mfs];
  prim.push(...prim_);
  const sec: Sulcus[] = [];
  const opt = (every: number, a: number, b: number) => ({ every, len: [a, b] as [number, number] });
  sec.push(...branches(bl, sfs, 31, opt(0.011, 0.008, 0.016)), ...branches(bl, ifs, 32, opt(0.011, 0.008, 0.015)), ...branches(bl, sts, 33, opt(0.012, 0.007, 0.014)));
  sec.push(...branches(bl, its, 34, opt(0.011, 0.007, 0.013)), ...branches(bl, ips, 35, opt(0.011, 0.008, 0.016)), ...branches(bl, cing, 36, opt(0.014, 0.006, 0.012)));
  sec.push(...branches(bl, mfs, 37, opt(0.012, 0.008, 0.014)), ...branches(bl, pre, 38, opt(0.016, 0.008, 0.013)), ...branches(bl, post, 39, opt(0.016, 0.008, 0.013)));
  sec.push(...branches(bl, par, 40, opt(0.012, 0.007, 0.012)), ...branches(bl, lot, 41, opt(0.012, 0.006, 0.01)), ...branches(bl, col, 42, opt(0.014, 0.006, 0.01)));
  const out = [...prim, ...sec].map((q) => ({ ...q, pts: q.pts.map((p): V3 => [p[0] * s, p[1], p[2]]) }));
  sulciCache.set(s, out);
  return out;
}

const hemiCache = new Map<number, Shape>();
function hemisphere(s: Side): Shape {
  if (hemiCache.has(s)) return hemiCache.get(s)!;
  const f = sulcalField(sulci(s));
  const fn = (x: number, y: number, z: number) => {
    const g = f(x, y, z);
    // low-amplitude tertiary wrinkling
    const n = noise3(x * 130 + 3, y * 130, z * 130);
    return g + 0.0007 * Math.pow(1 - Math.abs(n), 9) * (1 - Math.min(1, g / 0.0015));
  };
  const h = displace(hemisphereBase(s), fn, 0.0105);
  hemiCache.set(s, h);
  return h;
}

// lobe boundaries follow the central sulcus, the lateral fissure and the parieto-occipital sulcus
const frontalFn: PlaneFn = (x, y, z) => -0.019 + 0.35 * Math.abs(x) + 0.25 * (1.74 - y) - z;
const sylFn: PlaneFn = (x, y, z) => y - (1.652 - 0.25 * z);
const tempCore: PlaneFn = (x, y, z) => Math.max(sylFn(x, y, z), 0.024 - Math.abs(x));
const occFn: PlaneFn = (x, y, z) => z - (-0.05 + 0.22 * (y - 1.725) - 0.25 * (Math.abs(x) - 0.003));

function lobeShape(a: Shape, planes: PlaneFn[], gap: number, lo: V3, hi: V3): Shape {
  return {
    d: (x, y, z) => {
      let pm = -1e9;
      for (const p of planes) { const v = p(x, y, z) + gap; if (v > pm) pm = v; }
      if (pm > 0.009) return pm;
      return Math.max(a.d(x, y, z), pm);
    },
    lo, hi,
  };
}
void region;

// ====================================================================== CEREBELLUM
function cerebellum(): Shape {
  const parts: Shape[] = [
    ...SIDES.map((s) => ellipsoid([s * 0.031, 1.626, -0.068], [0.034, 0.03, 0.033])),
    ellipsoid([0, 1.632, -0.068], [0.013, 0.026, 0.031]),
    ...SIDES.map((s) => ellipsoid([s * 0.011, 1.601, -0.057], [0.0095, 0.012, 0.012])), // tonsils
  ];
  let c = union(parts, 0.012);
  c = intersect(c, bigBox((x, y, z) => y - (TENT(x, z) - 0.0004), [-0.09, 1.5, -0.13], [0.09, 1.72, 0.0]), 0.002);
  c = intersect(c, offset(brainSpace(), -0.0009), 0.003);
  c = subtract(c, ellipsoid([0, 1.596, -0.036], [0.011, 0.022, 0.02]), 0.005);
  const y0 = 1.628, z0 = -0.058;
  return displace(c, (x, y, z) => {
    const a = Math.atan2(y - y0, -(z - z0));
    const ax = Math.abs(x);
    let q = (a * 0.034) / 0.002 + 8 * (ax / 0.04) * (ax / 0.04) + 0.9 * noise3(x * 45, y * 45, z * 45);
    q += 0.4 * noise3(x * 120 + 9, y * 120, z * 120);
    const idx = Math.round(q);
    const deep = idx % 6 === 0 ? 1.8 : 1;
    const f = 1 - Math.abs(Math.sin(Math.PI * q));
    const folia = 0.0011 * deep * Math.pow(f, 5) * (0.65 + 0.35 * noise3(x * 70, y * 70 + 4, z * 70));
    // paravermian grooves
    const pv = ax - 0.0105;
    const groove = 0.0016 * Math.exp(-(pv * pv) / (0.0012 * 0.0012)) * (z < -0.05 ? 1 : 0.4);
    return folia + groove;
  }, 0.0034);
}

// ====================================================================== BRAINSTEM
function ponsShape(): Shape {
  const core = union([
    ellipsoid([0, 1.615, -0.025], [0.0145, 0.0125, 0.0125]),
    ...SIDES.map((s) => roundCone([s * 0.011, 1.617, -0.03], [s * 0.025, 1.619, -0.047], 0.0062, 0.0045)), // middle cerebellar peduncles
  ], 0.004);
  return displace(core, (x, y, z) => {
    const ventral = z > -0.03 ? Math.min(1, (z + 0.03) / 0.008) : 0;
    const stri = Math.pow(1 - Math.abs(Math.sin(Math.PI * ((y - 1.6) / 0.0021 + 2.2 * x * x / 0.0145 + 0.5 * noise3(x * 90, y * 90, z * 90)))), 3);
    const basil = 0.0011 * Math.exp(-(x * x) / (0.0012 * 0.0012));
    return ventral * (0.00045 * stri + basil) + 0.00012 * noise3(x * 300, y * 300, z * 300);
  }, 0.0017);
}
function midbrainShape(): Shape {
  return union([
    roundCone([0, 1.645, -0.022], [0, 1.628, -0.028], 0.0095, 0.0098),
    ...SIDES.map((s) => roundCone([s * 0.0075, 1.648, -0.017], [s * 0.0055, 1.629, -0.025], 0.0058, 0.0062)), // cerebral peduncles
    ...SIDES.map((s) => sphere([s * 0.0045, 1.649, -0.0335], 0.0034)), // superior colliculi
    ...SIDES.map((s) => sphere([s * 0.0045, 1.6385, -0.0345], 0.0032)), // inferior colliculi
  ], 0.0022);
}
function medullaShape(): Shape {
  const m = union([
    roundCone([0, 1.604, -0.031], [0, 1.578, -0.038], 0.0088, 0.0062),
    ...SIDES.map((s) => ellipsoid([s * 0.0078, 1.592, -0.0285], [0.0038, 0.0085, 0.0042])), // olives
    ...SIDES.map((s) => roundCone([s * 0.0027, 1.607, -0.0235], [s * 0.0014, 1.584, -0.0305], 0.0033, 0.0029)), // pyramids
  ], 0.0016);
  return displace(m, (x, y, z) => (z > -0.034 ? 0.0009 * Math.exp(-(x * x) / (0.0009 * 0.0009)) : 0) + 0.00012 * noise3(x * 250, y * 250, z * 250), 0.0014);
}

// ====================================================================== CORD & NERVE HELPERS
function cordPath(): V3[] {
  const pts: V3[] = [[0, 1.579, -0.038]];
  for (const v of VERTEBRAE) {
    if (v.region === 'L' && v.n > 1) break;
    pts.push(canalPoint(v));
  }
  return pts;
}
const CORD_R = [0.004, 0.0042, 0.0043, 0.0045, 0.005, 0.0056, 0.0058, 0.0057, 0.0052, 0.0047, 0.0043, 0.0043, 0.0043, 0.0043, 0.0043, 0.0043, 0.0045, 0.005, 0.0054, 0.005, 0.0018];

type NOpts = { twigs?: number; twigLen?: [number, number]; seed?: number; conformDepth?: number; conformRange?: [number, number]; extra?: () => Geo[]; tissue?: Tissue; rfn?: (t: number) => number };
function nerve(id: string, name: string, parent: string, pts: V3[] | (() => V3[]), r0: number, r1: number, desc: string, o: NOpts = {}) {
  P({
    id, name, parent, system: SYS, tissue: o.tissue ?? 'nerve', desc,
    build: () => {
      let p = typeof pts === 'function' ? pts() : pts;
      if (o.conformDepth !== undefined) {
        const [a, b] = o.conformRange ?? [0, 1];
        const L = p.reduce((acc, q, i) => (i ? acc + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1], q[2] - p[i - 1][2]) : 0), 0);
        p = spline(p, Math.max(p.length, Math.ceil(L / 0.015)));
        p = p.map((q, i) => {
          const t = i / (p.length - 1);
          return t >= a && t <= b ? conform(q, o.conformDepth! + r0) : q;
        });
      }
      const geos: Geo[] = p.length >= 2 ? [tube(p, { r: o.rfn ? (t) => o.rfn!(t) : (t) => r0 + (r1 - r0) * t, radial: r0 > 0.004 ? 14 : r0 > 0.0012 ? 10 : 7 })] : [];
      if (o.twigs) geos.push(...twigs(p, o.twigs, { seed: o.seed ?? 3, len: o.twigLen ?? [0.015, 0.04], r: Math.max(0.0005, r1 * 0.5), depth: 1, map: o.conformDepth !== undefined ? (q) => conform(q, o.conformDepth! + 0.001) : undefined, inside: o.conformDepth !== undefined ? undefined : underSkin() }));
      if (o.extra) geos.push(...o.extra());
      return merge(geos);
    },
  });
}
const tb = (pts: V3[], r: number | ((t: number) => number), radial = 7): Geo => tube(pts, { r: typeof r === 'number' ? r : (t) => r(t), radial });
/** tapered fan of fine branches from one point */
const fan = (from: V3, targets: V3[], r: number, bow = 0.2): Geo[] =>
  targets.map((t, i) => {
    const m = lerp(from, t, 0.5);
    const d = sub(t, from);
    const off: V3 = [-d[2] * bow * (i % 2 ? 1 : -1) * 0.5, d[1] * 0.0, d[0] * bow * (i % 2 ? 1 : -1) * 0.5];
    return tb([from, add(m, off), t], (u) => r * (1 - 0.55 * u), 6);
  });
/** points projected on skin at given depth (for muscular/cutaneous branches) */
const surf = (pts: [number, number, number, number][]): V3[] => pts.map(([x, y, z, d]) => conform([x, y, z], d));

/** exit point of spinal nerve at vertebra */
function foramen(i: number, s: Side, out = 0.0): V3 {
  const v = VERTEBRAE[i];
  return add(add(add(v.c, mul(v.lat, s * (v.bodyR * 0.7 + v.canalR + 0.006 + out))), mul(v.fwd, -(v.bodyR * 0.85 + v.canalR * 0.6))), mul(v.up, -v.bodyH * 0.6));
}

export function defineNervous() {
  G('nervous', 'Nervous System', undefined, SYS, 'Brain, spinal cord and ~86 billion neurons coordinating every function of the body.');
  const B = G('nerv.brain', 'Brain', 'nervous', SYS, 'The ~1.4 kg command centre: cerebrum, cerebellum and brainstem.');
  const CELL = 0.00122;
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s);
    const hemi = G(`nerv.hemi.${S}`, `${N} cerebral hemisphere`, B, SYS, `The ${lc(N)} half of the cerebrum, folded into gyri and sulci; controls the ${s > 0 ? 'right' : 'left'} side of the body.`);
    const bx = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);
    const lobe = (key: string, nm: string, planes: PlaneFn[], desc: string, y: [number, number], z: [number, number]) => {
      const xr = bx(0.0, 0.075);
      P({ id: `brain.${key}.${S}`, name: `${N} ${nm} lobe`, parent: hemi, system: SYS, tissue: 'brain', desc, build: () => meshShape(lobeShape(hemisphere(s), planes, 0.0009, [xr[0], y[0], z[0]], [xr[1], y[1], z[1]]), CELL) });
    };
    lobe('frontal', 'frontal', [frontalFn, ng(tempCore)], 'Executive function, planning, personality, speech production (Broca\'s area) and the primary motor cortex (precentral gyrus, in front of the central sulcus).', [1.59, 1.755], [-0.026, 0.09]);
    lobe('temporal', 'temporal', [tempCore, ng(occFn)], 'Hearing, language comprehension (Wernicke\'s area) and memory via the hippocampus; lies below the lateral (Sylvian) fissure.', [1.59, 1.68], [-0.105, 0.09]);
    lobe('occipital', 'occipital', [occFn], 'The visual cortex, split by the calcarine sulcus, processing information from the eyes.', [1.59, 1.755], [-0.11, -0.04]);
    lobe('parietal', 'parietal', [ng(frontalFn), ng(tempCore), ng(occFn)], 'Touch, proprioception and spatial awareness (postcentral gyrus, primary somatosensory cortex).', [1.6, 1.755], [-0.1, 0.03]);
  }
  P({ id: 'brain.corpuscallosum', name: 'Corpus callosum', parent: B, system: SYS, tissue: 'brain', desc: 'The great commissure of ~200 million fibres joining the two hemispheres (rostrum, genu, body and splenium).', build: () => {
    const arc: [number, number, number][] = [[-0.047, 1.674, 0.0058], [-0.04, 1.687, 0.0048], [-0.028, 1.696, 0.0042], [-0.012, 1.7, 0.004], [0.006, 1.7, 0.004], [0.022, 1.696, 0.0045], [0.034, 1.686, 0.0055], [0.039, 1.674, 0.0058], [0.035, 1.664, 0.0042]];
    const segs: Shape[] = [];
    for (let i = 0; i < arc.length - 1; i++) {
      const a = arc[i], b = arc[i + 1];
      const c: V3 = [0, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2];
      const t = norm([0, b[1] - a[1], b[0] - a[0]]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push(ellipsoid(c, [(a[2] + b[2]) / 2, len * 0.62, 0.0135], frameY(t, [1, 0, 0])));
    }
    return meshShape(displace(union(segs, 0.004), (x, y, z) => 0.0004 * noise3(x * 150, y * 150, z * 150) + 0.0006 * Math.exp(-(x * x) / 0.0000012), 0.0012), 0.0007);
  } });
  P({ id: 'brain.cerebellum', name: 'Cerebellum', parent: B, system: SYS, tissue: 'cerebellum', desc: 'The "little brain" with tightly folded folia, a central vermis and inferior tonsils; coordinates movement, balance and motor learning. Contains over half of the brain\'s neurons.', build: () => meshShape(cerebellum(), 0.00088) });
  const BS = G('nerv.brainstem', 'Brainstem', B, SYS, 'Midbrain, pons and medulla connecting the brain to the spinal cord and controlling vital functions.');
  P({ id: 'brain.midbrain', name: 'Midbrain', parent: BS, system: SYS, tissue: 'brainstem', desc: 'Cerebral peduncles ventrally and the superior and inferior colliculi dorsally: relay for visual and auditory reflexes; contains the substantia nigra.', build: () => meshShape(midbrainShape(), 0.0006) });
  P({ id: 'brain.pons', name: 'Pons', parent: BS, system: SYS, tissue: 'brainstem', desc: 'Bulging bridge with transverse fibres and a midline basilar groove, relaying signals between cerebrum and cerebellum via the middle cerebellar peduncles; helps regulate breathing.', build: () => meshShape(ponsShape(), 0.0006) });
  P({ id: 'brain.medulla', name: 'Medulla oblongata', parent: BS, system: SYS, tissue: 'brainstem', desc: 'Pyramids and olives; controls heartbeat, breathing and blood pressure; continuous with the spinal cord at the foramen magnum.', build: () => meshShape(medullaShape(), 0.0006) });
  P({ id: 'brain.diencephalon', name: 'Thalamus & hypothalamus', parent: B, system: SYS, tissue: 'brainstem', desc: 'Deep paired relay nuclei (thalamus), the hypothalamus with mammillary bodies and infundibulum, and the pineal gland.', build: () => meshShape(union([
    ...SIDES.map((s) => ellipsoid([s * 0.0105, 1.668, -0.012], [0.0085, 0.0085, 0.0165])),
    ellipsoid([0, 1.646, 0.003], [0.0085, 0.006, 0.0095]),
    ...SIDES.map((s) => sphere([s * 0.0027, 1.6355, -0.0075], 0.0027)),
    roundCone([0, 1.641, 0.011], [0, 1.629, 0.016], 0.0018, 0.0009),
    sphere([0, 1.662, -0.036], 0.0028),
  ], 0.003), 0.0006) });
  nerve('nerv.olfactory', 'Olfactory bulbs (CN I)', B, [[0, 1.63, 0.05], [0, 1.632, 0.074]], 0.0015, 0.0018, 'Receive smell signals from the nasal mucosa.', {
    extra: () => SIDES.flatMap((s) => [
      tube([[s * 0.006, 1.631, 0.048], [s * 0.006, 1.633, 0.074]], { r: (t) => 0.0014 + 0.001 * t, radial: 8 }),
      ...fan([s * 0.006, 1.633, 0.074], [[s * 0.004, 1.628, 0.086], [s * 0.008, 1.628, 0.085], [s * 0.006, 1.626, 0.088]], 0.0004),
    ]),
  });

  // ---- spinal cord
  const SC = G('nerv.cord', 'Spinal cord & spinal nerves', 'nervous', SYS, 'The 45 cm cord in the vertebral canal and its 31 pairs of spinal nerves.');
  const cordT = () => {
    const p = cordPath();
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]));
    return cum.map((c) => c / cum[cum.length - 1]);
  };
  const cordR = (t: number) => {
    const ts = cordT();
    let i = 0;
    while (i < ts.length - 2 && ts[i + 1] < t) i++;
    const f = Math.max(0, Math.min(1, (t - ts[i]) / (ts[i + 1] - ts[i])));
    const u = f * f * (3 - 2 * f);
    return CORD_R[i] + (CORD_R[i + 1] - CORD_R[i]) * u;
  };
  nerve('nerv.spinalcord', 'Spinal cord', SC, cordPath, 0.0052, 0.0028, 'Conducts signals between brain and body and mediates reflexes, with cervical and lumbar enlargements; ends at L1–L2 as the conus medullaris.', {
    rfn: cordR,
    extra: () => {
      const end = canalPoint(VERTEBRAE[19]);
      const list: Geo[] = [];
      for (let k = 0; k < 12; k++) {
        const pts: V3[] = [end];
        for (const v of VERTEBRAE.slice(20)) pts.push(add(canalPoint(v), [((k % 5) - 2) * 0.0012, 0, (Math.floor(k / 5) - 0.5) * 0.0016]));
        pts.push(add([0, 0.97, -0.07], [((k % 5) - 2) * 0.002, 0, 0]));
        list.push(tube(pts, { r: 0.0006, radial: 5 }));
      }
      list.push(tube([end, canalPoint(VERTEBRAE[21]), canalPoint(VERTEBRAE[23]), [0, 0.96, -0.074]], { r: 0.0004, radial: 5 })); // filum terminale
      return list;
    },
  });

  // ---- cranial nerves
  const CN = G('nerv.cranial', 'Cranial nerves', 'nervous', SYS, 'Twelve pairs of nerves arising directly from the brain.');
  nerve('nerv.optic', 'Optic nerves, chiasm & tracts (CN II)', CN, [[0, 1.638, 0.018], [0.0, 1.638, 0.019]], 0.002, 0.002, 'Carry visual information from the retinas; fibres from the nasal half of each retina cross at the optic chiasm.', {
    extra: () => SIDES.flatMap((s) => [
      tube([add(HEAD.eye(s), [0, 0, -HEAD.eyeR + 0.001]), X(s, [0.02, 1.645, 0.045]), X(s, [0.006, 1.638, 0.022]), [0, 1.638, 0.018]], { r: 0.0019, radial: 10 }),
      tube([[0, 1.638, 0.018], X(s, [0.012, 1.64, 0.0]), X(s, [0.02, 1.646, -0.016])], { r: 0.0016, radial: 8 }),
    ]),
  });
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s), ln = lc(N);
    nerve(`nerv.oculomotor.${S}`, `${N} oculomotor nerve (CN III)`, CN, XS(s, [[0.004, 1.633, -0.017], [0.009, 1.638, 0.0], [0.016, 1.645, 0.03], [0.020, 1.648, 0.046], [0.021, 1.649, 0.053]]), 0.0012, 0.0009, 'Emerges between the cerebral peduncles to supply four of the six eye muscles, the levator palpebrae and the pupillary constrictor.', {
      extra: () => fan(X(s, [0.022, 1.650, 0.056]), [X(s, [0.028, 1.657, 0.066]), X(s, [0.028, 1.646, 0.066]), X(s, [0.021, 1.651, 0.066])], 0.0006),
    });
    nerve(`nerv.trochlear.${S}`, `${N} trochlear nerve (CN IV)`, CN, XS(s, [[0.003, 1.637, -0.043], [0.012, 1.632, -0.036], [0.016, 1.634, -0.02], [0.018, 1.644, 0.005], [0.02, 1.655, 0.035], [0.025, 1.662, 0.058], [0.03, 1.664, 0.068]]), 0.0007, 0.0005, 'The slenderest cranial nerve and the only one to leave the dorsal brainstem; supplies the superior oblique muscle.');
    nerve(`nerv.abducens.${S}`, `${N} abducens nerve (CN VI)`, CN, XS(s, [[0.004, 1.603, -0.0255], [0.007, 1.612, -0.012], [0.012, 1.633, 0.01], [0.019, 1.645, 0.04], [0.026, 1.649, 0.06], [0.036, 1.651, 0.07]]), 0.0009, 0.0007, 'Supplies the lateral rectus, abducting the eye.');
    nerve(`nerv.trigeminal.${S}`, `${N} trigeminal nerve (CN V)`, CN, XS(s, [[0.012, 1.617, -0.02], [0.025, 1.62, 0.0]]), 0.0022, 0.0028, 'Sensory nerve of the face with ophthalmic, maxillary and mandibular divisions; also supplies the chewing muscles.', {
      extra: () => {
        const g = X(s, [0.025, 1.62, 0.0]);
        const v1 = [g, X(s, [0.026, 1.645, 0.042]), conform(X(s, [0.024, 1.672, 0.088]), 0.0055), conform(X(s, [0.022, 1.71, 0.075]), 0.0055)];
        const v2 = [g, X(s, [0.03, 1.624, 0.045]), conform(X(s, [0.03, 1.628, 0.086]), 0.0055), conform(X(s, [0.03, 1.605, 0.09]), 0.0055)];
        const v3 = [g, X(s, [0.036, 1.598, 0.004]), X(s, [0.044, 1.575, 0.022]), conform(X(s, [0.02, 1.552, 0.075]), 0.0055)];
        return [
          meshShape(ellipsoid(g, [0.0045, 0.0038, 0.0065]), 0.0006), // trigeminal ganglion
          tube(v1, { r: 0.0012, radial: 7 }), tube(v2, { r: 0.0012, radial: 7 }), tube(v3, { r: 0.0013, radial: 7 }),
          ...fan(v1[3], [conform(X(s, [0.012, 1.722, 0.07]), 0.005), conform(X(s, [0.03, 1.716, 0.07]), 0.005)], 0.0006),
          ...fan(v2[3], [conform(X(s, [0.04, 1.595, 0.082]), 0.005), conform(X(s, [0.024, 1.6, 0.095]), 0.005), conform(X(s, [0.036, 1.618, 0.09]), 0.005)], 0.0007),
          ...fan(v3[3], [conform(X(s, [0.014, 1.538, 0.078]), 0.005), conform(X(s, [0.026, 1.548, 0.062]), 0.005)], 0.0007),
        ];
      },
    });
    nerve(`nerv.facial.${S}`, `${N} facial nerve (CN VII)`, CN, XS(s, [[0.012, 1.612, -0.024], [0.045, 1.625, -0.015], [0.055, 1.6, -0.01]]), 0.0014, 0.0016, 'Motor nerve to the muscles of facial expression, branching within the parotid gland as the pes anserinus (temporal, zygomatic, buccal, mandibular, cervical).', {
      extra: () => {
        const o = X(s, [0.055, 1.6, -0.01]);
        const tg: V3[] = [[0.066, 1.665, 0.03], [0.056, 1.635, 0.062], [0.05, 1.6, 0.075], [0.044, 1.565, 0.055], [0.05, 1.535, 0.02]];
        const geos: Geo[] = [];
        tg.forEach((t, k) => {
          const mid = conform(X(s, lerp([0.055, 1.6, -0.01], t, 0.5)), 0.008);
          const end = conform(X(s, t), 0.006);
          geos.push(tube([o, mid, end], { r: 0.001, radial: 6 }));
          // terminal twigs of each division
          const dir = sub(end, mid);
          geos.push(...fan(end, [0.2, -0.2, 0.0].map((a, j) => conform(add(end, add(mul(dir, 0.7 + 0.2 * j), mul([0, 0, 1], a * 0.05))), 0.006)), 0.0005));
          void k;
        });
        // interconnecting loops between divisions
        for (let k = 0; k < tg.length - 1; k++) geos.push(tube([conform(X(s, lerp([0.055, 1.6, -0.01], tg[k], 0.7)), 0.008), conform(X(s, lerp([0.055, 1.6, -0.01], tg[k + 1], 0.7)), 0.008)], { r: 0.0004, radial: 5 }));
        // posterior auricular & digastric branches
        geos.push(tube([X(s, [0.045, 1.625, -0.015]), conform(X(s, [0.07, 1.62, -0.03]), 0.006)], { r: 0.0006, radial: 5 }));
        return geos;
      },
    });
    nerve(`nerv.vestibulocochlear.${S}`, `${N} vestibulocochlear nerve (CN VIII)`, CN, XS(s, [[0.01, 1.61, -0.026], [0.026, 1.616, -0.02], [0.04, 1.62, -0.018]]), 0.0016, 0.0012, 'Carries hearing (cochlear) and balance (vestibular) signals from the inner ear.', {
      extra: () => fan(X(s, [0.04, 1.62, -0.018]), [X(s, [0.048, 1.627, -0.012]), X(s, [0.048, 1.614, -0.02])], 0.0008),
    });
    nerve(`nerv.glossopharyngeal.${S}`, `${N} glossopharyngeal nerve (CN IX)`, CN, XS(s, [[0.0075, 1.597, -0.031], [0.018, 1.588, -0.027], [0.027, 1.578, -0.022], [0.036, 1.56, -0.012], [0.034, 1.548, 0.005], [0.026, 1.545, 0.03], [0.018, 1.55, 0.05]]), 0.0012, 0.0008, 'Taste from the back of the tongue, sensation of the pharynx and parotid secretion; carotid sinus afferents.', { twigs: 3, seed: 61 + s });
    nerve(`nerv.accessory.${S}`, `${N} accessory nerve (CN XI)`, CN, XS(s, [[0.012, 1.5, -0.036], [0.013, 1.54, -0.036], [0.015, 1.585, -0.034], [0.02, 1.59, -0.028], [0.028, 1.58, -0.022], [0.04, 1.545, -0.01], [0.06, 1.5, -0.012]]), 0.0011, 0.0011, 'Ascends the cord from C1–C5, enters the skull, then exits to supply the sternocleidomastoid and trapezius.', {
      extra: () => [
        tube([X(s, [0.06, 1.5, -0.012]), conform(X(s, [0.075, 1.487, -0.04]), 0.012), conform(X(s, [0.09, 1.468, -0.065]), 0.012)], { r: 0.0009, radial: 6 }),
        ...[0.004, 0.012, 0.02, 0.028].map((u) => tube([X(s, [0.009, 1.52 + u * 0.9, -0.035]), X(s, [0.012, 1.5 + u * 0.9 + 0.006, -0.036])], { r: 0.0003, radial: 4 })),
      ],
    });
    nerve(`nerv.hypoglossal.${S}`, `${N} hypoglossal nerve (CN XII)`, CN, XS(s, [[0.006, 1.594, -0.027], [0.014, 1.59, -0.022], [0.026, 1.57, -0.012], [0.032, 1.552, 0.0], [0.03, 1.545, 0.02], [0.022, 1.545, 0.04], [0.012, 1.55, 0.062]]), 0.0012, 0.0008, 'Motor nerve of the tongue, arching forward below the mandible.', {
      extra: () => fan(X(s, [0.012, 1.55, 0.062]), [X(s, [0.006, 1.556, 0.07]), X(s, [0.014, 1.558, 0.07]), X(s, [0.02, 1.553, 0.064])], 0.0005),
    });
    nerve(`nerv.vagus.${S}`, `${N} vagus nerve (CN X)`, CN, XS(s, [[0.01, 1.6, -0.03], [0.035, 1.6, -0.012], [0.031, 1.5, 0.01], [0.029, 1.42, 0.01], [0.022, 1.33, -0.024], [0.01, 1.22, -0.022], [0.012 + (s > 0 ? 0.02 : 0), 1.16, -0.004]]), 0.0017, 0.0013, 'The wandering nerve: parasympathetic supply to the heart, lungs and gut down to the splenic flexure; gives off the recurrent laryngeal nerve.', {
      twigs: 6, seed: s > 0 ? 7 : 8,
      extra: () => {
        // recurrent laryngeal nerve: loops under the aortic arch (left) / subclavian artery (right)
        const loopY = s > 0 ? 1.325 : 1.37;
        return [tube([X(s, [0.025, loopY + 0.015, -0.012]), X(s, [0.012, loopY, -0.01]), X(s, [0.014, loopY + 0.03, 0.0]), X(s, [0.014, 1.43, 0.003]), X(s, [0.014, 1.5, 0.004]), X(s, [0.012, 1.525, 0.006])], { r: 0.0008, radial: 6 })];
      },
    });

    // ---- spinal nerves & plexuses
    nerve(`nerv.spinal_roots.${S}`, `${N} spinal nerve roots`, SC, [], 0.0005, 0.0005, 'Dorsal and ventral rootlets fanning out of the cord, the dorsal root ganglion in each intervertebral foramen, and the mixed spinal nerve beyond: 31 pairs.', {
      extra: () => {
        const list: Geo[] = [];
        VERTEBRAE.forEach((v, i) => {
          const c0 = add(canalPoint(v), mul(v.lat, s * 0.0046));
          const rr = v.region === 'L' ? 0.0022 : v.region === 'C' && v.n >= 5 ? 0.0021 : 0.0015;
          const gA = foramen(i, s, 0.0), gB = foramen(i, s, 0.008), gC = foramen(i, s, 0.024);
          for (let k = -1; k <= 1; k++) list.push(tb([add(add(c0, mul(v.up, k * 0.0042)), mul(v.fwd, -0.002)), lerp(add(c0, mul(v.up, k * 0.0016)), gA, 0.55), gA], 0.0004, 5)); // dorsal rootlets
          list.push(tb([add(add(c0, mul(v.fwd, 0.0025)), mul(v.up, -0.002)), lerp(c0, gA, 0.55), gA], 0.0007, 6)); // ventral root
          list.push(tb([gA, gB], (t) => rr * 0.75 + rr * 0.9 * Math.sin(Math.PI * t) ** 1.2, 9)); // dorsal root ganglion
          list.push(tb([gB, gC, add(gC, mul(v.lat, s * 0.012))], (t) => rr * (0.85 - 0.3 * t), 8)); // spinal nerve
        });
        return list;
      },
    });
    nerve(`nerv.intercostal.${S}`, `${N} intercostal nerves`, SC, [], 0.0005, 0.0005, 'Ventral rami of T1–T11 running with the intercostal vessels beneath each rib; supply the chest and abdominal walls.', {
      extra: () => {
        const list: Geo[] = [];
        for (let i = 1; i <= 11; i++) {
          const b = ribPaths(s, i)[0].slice(2);
          const path = [foramen(6 + i, s, 0.01), ...b.filter((_, k) => k % 2 === 0).map((p) => add(p, [0, -0.007, 0]))];
          list.push(tube(path, { r: (t) => 0.0012 - 0.0004 * t, radial: 6 }));
          const m = Math.floor(path.length * 0.55);
          if (path.length > 4) list.push(tube([path[m], add(path[m], [s * 0.004, -0.008, 0.004]), add(path[m], [s * 0.008, -0.02, 0.006])], { r: 0.0004, radial: 5 })); // lateral cutaneous branch
        }
        return list;
      },
    });
    nerve(`nerv.sympathetic.${S}`, `${N} sympathetic trunk`, SC, () => VERTEBRAE.slice(1).map((v) => add(add(v.c, mul(v.lat, s * (v.bodyR + 0.004))), mul(v.fwd, v.bodyR * 0.3))), 0.0011, 0.001, 'Chain of paravertebral ganglia carrying sympathetic ("fight or flight") fibres along the spine.', {
      extra: () => VERTEBRAE.slice(1).filter((_, k) => k % 2 === 0).flatMap((v) => {
        const gp = add(add(v.c, mul(v.lat, s * (v.bodyR + 0.004))), mul(v.fwd, v.bodyR * 0.3));
        return [meshShape(ellipsoid(gp, [0.0022, 0.0035, 0.0022]), 0.0007), tb([gp, add(gp, mul(v.lat, s * 0.007)), add(add(gp, mul(v.lat, s * 0.011)), mul(v.fwd, -0.006))], 0.0005, 5)];
      }),
    });
    const axilla = X(s, [0.15, 1.4, 0.0]);
    const up = G(`nerv.upper.${S}`, `Nerves of ${ln} upper limb`, 'nervous', SYS, 'Brachial plexus (C5–T1) and its terminal branches.');
    nerve(`nerv.brachial_plexus.${S}`, `${N} brachial plexus`, up, [], 0.0026, 0.0028, 'Network of the C5–T1 ventral rami: five roots join as three trunks, split into anterior and posterior divisions behind the clavicle and re-form as lateral, posterior and medial cords in the axilla.', {
      extra: () => {
        const roots = [4, 5, 6, 7, 8].map((i) => foramen(i, s, 0.012));
        const U = X(s, [0.058, 1.486, -0.018]), M = X(s, [0.06, 1.478, -0.017]), Lw = X(s, [0.062, 1.468, -0.014]);
        const tr = (a: V3, mid: V3, b: V3, r: number) => tube([a, mid, b], { r, radial: 9 });
        const list: Geo[] = [];
        list.push(tb([roots[0], lerp(roots[0], U, 0.5), U], 0.0019, 8), tb([roots[1], lerp(roots[1], U, 0.5), U], 0.0021, 8), tb([roots[2], lerp(roots[2], M, 0.5), M], 0.0023, 8), tb([roots[3], lerp(roots[3], Lw, 0.5), Lw], 0.0021, 8), tb([roots[4], lerp(roots[4], Lw, 0.5), Lw], 0.002, 8));
        const divs: { t: V3; a: V3; p: V3 }[] = [
          { t: U, a: X(s, [0.092, 1.462, -0.006]), p: X(s, [0.092, 1.458, -0.017]) },
          { t: M, a: X(s, [0.093, 1.455, -0.006]), p: X(s, [0.094, 1.451, -0.016]) },
          { t: Lw, a: X(s, [0.094, 1.446, -0.008]), p: X(s, [0.095, 1.443, -0.015]) },
        ];
        const cL = X(s, [0.125, 1.436, -0.001]), cM = X(s, [0.125, 1.425, -0.004]), cP = X(s, [0.126, 1.43, -0.012]);
        divs.forEach((d, i) => {
          list.push(tb([d.t, lerp(d.t, d.a, 0.5), d.a], 0.0016, 8), tb([d.t, lerp(d.t, d.p, 0.5), d.p], 0.0016, 8));
          list.push(tb([d.a, lerp(d.a, i < 2 ? cL : cM, 0.5), i < 2 ? cL : cM], 0.0016, 8), tb([d.p, lerp(d.p, cP, 0.5), cP], 0.0016, 8));
        });
        list.push(tr(cL, lerp(cL, axilla, 0.5), axilla, 0.0024), tr(cM, lerp(cM, axilla, 0.5), axilla, 0.0024), tr(cP, lerp(cP, axilla, 0.5), axilla, 0.0026));
        // branches: suprascapular, dorsal scapular, long thoracic, lateral/medial pectoral
        list.push(tb([U, X(s, [0.075, 1.47, -0.045]), X(s, [0.07, 1.445, -0.075])], 0.0012, 7));
        list.push(tb([roots[0], X(s, [0.045, 1.47, -0.04]), X(s, [0.055, 1.42, -0.072]), X(s, [0.06, 1.35, -0.082])], 0.0009, 7));
        list.push(tb([roots[2], X(s, [0.1, 1.44, -0.012]), conform(X(s, [0.15, 1.3, 0.0]), 0.02), conform(X(s, [0.15, 1.2, 0.03]), 0.02)], 0.0011, 7));
        list.push(tb([cL, conform(X(s, [0.1, 1.42, 0.06]), 0.014), conform(X(s, [0.07, 1.36, 0.1]), 0.012)], 0.0011, 7), tb([cM, conform(X(s, [0.11, 1.4, 0.06]), 0.016), conform(X(s, [0.1, 1.34, 0.095]), 0.012)], 0.0009, 7));
        return list;
      },
    });
    const { N: Nh, L } = handFrame(s);
    const dig = (from: V3, i: number, r: number): Geo[] => {
      const j = fingerJoints(s, i);
      return [-1, 1].map((sd) => tb([from, ...j.map((p) => add(add(p, mul(Nh, 0.0022)), mul(L, sd * 0.002 - 0.003)))], r, 5));
    };
    nerve(`nerv.median.${S}`, `${N} median nerve`, up, [axilla, armPt(s, 0.2, -0.02, 0.014), armPt(s, 0.6, -0.022, 0.012), armPt(s, 0.95, -0.01, 0.014), forePt(s, 0.1, -0.004, 0.016), forePt(s, 0.5, 0.0, 0.014), forePt(s, 0.95, 0.002, 0.011), handPt(s, 0.01, 0.0, 0.007), handPt(s, 0.045, 0.004, 0.006)], 0.0024, 0.0018, 'Passes through the carpal tunnel to supply the thenar muscles and the skin of the lateral 3½ fingers; compressed in carpal tunnel syndrome.', {
      twigs: 4, seed: 17,
      extra: () => {
        const list = [0, 1, 2].flatMap((i) => dig(handPt(s, 0.045, 0.004, 0.006), i, 0.0006));
        const t = thumbJoints(s);
        list.push(tb([handPt(s, 0.045, 0.004, 0.006), add(t[1], mul(Nh, 0.006)), add(t[2], mul(Nh, 0.0045)), add(t[3], mul(Nh, 0.003))], 0.0008, 6));
        list.push(tb([forePt(s, 0.12, 0.002, 0.006), forePt(s, 0.5, -0.004, -0.002), forePt(s, 0.92, -0.002, -0.004)], 0.0009, 6)); // anterior interosseous
        list.push(tb([handPt(s, 0.012, 0.0, 0.007), handPt(s, 0.03, 0.014, 0.008), add(t[0], mul(Nh, 0.004))], 0.0007, 6)); // recurrent thenar branch
        list.push(tb([armPt(s, 0.95, -0.01, 0.014), forePt(s, 0.04, 0.006, 0.014), forePt(s, 0.12, 0.01, 0.01)], 0.0008, 6)); // pronator teres branch
        return list;
      },
    });
    nerve(`nerv.ulnar.${S}`, `${N} ulnar nerve`, up, [axilla, armPt(s, 0.3, -0.025, 0.0), armPt(s, 0.8, -0.03, -0.015), forePt(s, 0.0, -0.033, -0.012), forePt(s, 0.3, -0.02, 0.012), forePt(s, 1.0, -0.016, 0.008), handPt(s, 0.02, -0.018, 0.008), handPt(s, 0.05, -0.022, 0.006)], 0.0021, 0.0016, 'Runs behind the medial epicondyle (the "funny bone") to supply most intrinsic hand muscles and the little finger.', {
      twigs: 3, seed: 19,
      extra: () => [
        ...[3].flatMap((i) => dig(handPt(s, 0.05, -0.022, 0.006), i, 0.0006)),
        ...dig(handPt(s, 0.05, -0.022, 0.006), 2, 0.0005).slice(0, 1),
        tb([forePt(s, 0.7, -0.016, 0.0), forePt(s, 0.9, -0.02, -0.014), handPt(s, 0.02, -0.022, -0.012), handPt(s, 0.06, -0.02, -0.013)], 0.0008, 6), // dorsal branch
        tb([handPt(s, 0.02, -0.018, 0.008), handPt(s, 0.035, -0.008, 0.002), handPt(s, 0.045, 0.006, -0.002)], 0.0008, 6), // deep branch
      ],
    });
    nerve(`nerv.radial.${S}`, `${N} radial nerve`, up, [axilla, armPt(s, 0.15, -0.012, -0.012), armPt(s, 0.35, -0.004, -0.022), armPt(s, 0.6, 0.02, -0.012), armPt(s, 0.9, 0.026, 0.006), forePt(s, 0.05, 0.023, 0.01), forePt(s, 0.6, 0.023, 0.008), forePt(s, 1.0, 0.02, -0.004), handPt(s, 0.03, 0.02, -0.01)], 0.0023, 0.0013, 'Spirals around the back of the humerus to supply the extensors of the arm, forearm and wrist.', {
      twigs: 3, seed: 23,
      extra: () => {
        const list: Geo[] = [
          tb([forePt(s, 0.05, 0.023, 0.01), forePt(s, 0.3, 0.008, -0.016), forePt(s, 0.7, 0.0, -0.014), forePt(s, 0.98, 0.0, -0.012)], 0.0013, 6), // posterior interosseous
          tb([armPt(s, 0.2, -0.005, -0.016), armPt(s, 0.4, -0.02, -0.02), armPt(s, 0.6, -0.022, -0.018)], 0.0009, 6), // to triceps
          tb([forePt(s, 0.6, 0.023, 0.008), forePt(s, 0.85, 0.024, -0.004), handPt(s, 0.01, 0.026, -0.011), handPt(s, 0.04, 0.026, -0.009)], 0.001, 6), // superficial branch
        ];
        const t = thumbJoints(s);
        list.push(tb([handPt(s, 0.04, 0.026, -0.009), add(t[1], mul(Nh, -0.006)), add(t[3], mul(Nh, -0.003))], 0.0006, 5));
        for (const i of [0, 1]) list.push(tb([handPt(s, 0.04, 0.026, -0.009), handPt(s, 0.07, FINGERS_L(i), -0.007), ...fingerJoints(s, i).slice(0, 3).map((p) => add(p, mul(Nh, -0.0022)))], 0.0006, 5));
        return list;
      },
    });
    nerve(`nerv.musculocutaneous.${S}`, `${N} musculocutaneous nerve`, up, [axilla, armPt(s, 0.3, 0.0, 0.016), armPt(s, 0.7, 0.008, 0.02), forePt(s, 0.1, 0.02, 0.013), forePt(s, 0.6, 0.026, 0.012)], 0.0016, 0.0011, 'Supplies the biceps, brachialis and coracobrachialis and the skin of the lateral forearm.', {
      conformDepth: 0.003, conformRange: [0.75, 1],
      extra: () => [
        tb([armPt(s, 0.05, -0.005, 0.0), armPt(s, 0.1, 0.0, 0.012), armPt(s, 0.18, 0.0, 0.018)], 0.0008, 6),
        tb([armPt(s, 0.35, 0.0, 0.016), armPt(s, 0.45, 0.004, 0.022), armPt(s, 0.55, 0.0, 0.026)], 0.0007, 6),
      ],
    });
    nerve(`nerv.axillary.${S}`, `${N} axillary nerve`, up, [axilla, armPt(s, 0.08, -0.012, -0.02), armPt(s, 0.12, 0.02, -0.012), armPt(s, 0.16, 0.032, 0.0)], 0.0016, 0.0012, 'Winds around the surgical neck of the humerus to supply the deltoid and teres minor.', {
      twigs: 3, seed: 29,
      extra: () => [tb([armPt(s, 0.08, -0.012, -0.02), armPt(s, 0.1, -0.02, -0.03), armPt(s, 0.14, -0.026, -0.036)], 0.0008, 6), tb([armPt(s, 0.12, 0.02, -0.012), armPt(s, 0.14, 0.03, -0.03), armPt(s, 0.17, 0.03, -0.038)], 0.0008, 6)],
    });

    const low = G(`nerv.lower.${S}`, `Nerves of ${ln} lower limb`, 'nervous', SYS, 'Lumbar (L1–L4) and sacral (L4–S4) plexuses and their branches.');
    const xc = (y: number) => 0.118 - ((0.9 - y) / 0.37) * 0.022; // thigh axis x
    nerve(`nerv.femoral.${S}`, `${N} femoral nerve`, low, [foramen(21, s, 0.012), X(s, [0.06, 1.02, -0.02]), X(s, [0.078, 0.94, 0.045]), X(s, [0.095, 0.9, 0.066]), X(s, [0.1, 0.85, 0.06])], 0.0026, 0.0022, 'Largest branch of the lumbar plexus (L2–L4), fanning below the inguinal ligament into branches for sartorius, rectus femoris and the three vasti, plus the saphenous nerve.', {
      twigs: 5, twigLen: [0.03, 0.07], seed: 31,
      extra: () => {
        const F0 = X(s, [0.1, 0.85, 0.06]);
        const sx = (x: number) => s * x;
        const bt = (pts: [number, number, number, number][], r: number) => tb([F0, ...surf(pts.map(([x, y, z, d]) => [sx(x), y, z, d] as [number, number, number, number]))], (t) => r * (1 - 0.6 * t), 6);
        return [
          tb([foramen(20, s, 0.012), X(s, [0.05, 1.05, -0.025]), X(s, [0.06, 1.02, -0.02])], 0.0021, 8),
          tb([foramen(22, s, 0.012), X(s, [0.05, 1.0, -0.028]), X(s, [0.06, 1.02, -0.02])], 0.0021, 8),
          tube([F0, X(s, [0.085, 0.72, 0.035]), X(s, [0.072, 0.6, 0.008]), X(s, [0.066, 0.49, -0.018]), X(s, [0.066, 0.3, -0.008]), X(s, [0.07, 0.1, 0.012])], { r: (t) => 0.0014 - 0.0006 * t, radial: 6 }), // saphenous
          bt([[xc(0.78), 0.78, 0.25, 0.034], [xc(0.68), 0.68, 0.25, 0.032], [xc(0.6), 0.6, 0.25, 0.03]], 0.0012), // rectus femoris
          bt([[xc(0.8) + 0.04, 0.8, 0.02, 0.028], [xc(0.7) + 0.04, 0.7, 0.02, 0.026], [xc(0.6) + 0.04, 0.6, 0.0, 0.025], [xc(0.52) + 0.04, 0.52, -0.01, 0.024]], 0.0014), // vastus lateralis
          bt([[xc(0.78) - 0.04, 0.78, 0.1, 0.028], [xc(0.68) - 0.04, 0.68, 0.1, 0.026], [xc(0.58) - 0.04, 0.58, 0.1, 0.025], [xc(0.54) - 0.04, 0.54, 0.1, 0.024]], 0.0013), // vastus medialis
          bt([[xc(0.82), 0.82, 0.25, 0.022], [xc(0.7), 0.7, 0.25, 0.02]], 0.0009), // vastus intermedius (deep)
          bt([[xc(0.84) - 0.03, 0.84, 0.25, 0.013], [xc(0.74) - 0.03, 0.74, 0.25, 0.012], [xc(0.64) - 0.03, 0.64, 0.25, 0.011]], 0.0008), // sartorius / intermediate cutaneous
        ];
      },
    });
    nerve(`nerv.obturator.${S}`, `${N} obturator nerve`, low, [foramen(21, s, 0.012), X(s, [0.032, 1.0, -0.02]), X(s, [0.045, 0.92, 0.02]), X(s, [0.05, 0.89, 0.032]), X(s, [0.06, 0.8, 0.022])], 0.0016, 0.0012, 'Passes through the obturator foramen to supply the adductor muscles of the thigh.', {
      twigs: 3, seed: 37,
      extra: () => [
        tb([foramen(20, s, 0.012), X(s, [0.03, 1.02, -0.02]), X(s, [0.032, 1.0, -0.02])], 0.0013, 7),
        tb([foramen(22, s, 0.012), X(s, [0.03, 1.0, -0.025]), X(s, [0.032, 1.0, -0.02])], 0.0013, 7),
        ...fan(X(s, [0.05, 0.89, 0.032]), [X(s, [0.07, 0.82, 0.012]), X(s, [0.065, 0.78, 0.0]), X(s, [0.075, 0.74, -0.012]), X(s, [0.055, 0.84, 0.02])], 0.0009),
      ],
    });
    const split = X(s, [0.095, 0.55, -0.042]);
    nerve(`nerv.sciatic.${S}`, `${N} sciatic nerve`, low, [X(s, [0.025, 0.975, -0.062]), X(s, [0.05, 0.925, -0.062]), X(s, [0.08, 0.87, -0.052]), X(s, [0.09, 0.75, -0.046]), X(s, [0.095, 0.62, -0.042]), split], 0.0058, 0.0048, 'The thickest and longest nerve in the body (up to 2 cm wide), formed from L4–S3 and running down the back of the thigh; gives hamstring branches then divides into tibial and common fibular nerves.', {
      twigs: 3, seed: 41,
      extra: () => {
        const br = (a: V3, pts: [number, number, number, number][], r: number) => tb([a, ...surf(pts.map(([x, y, z, d]) => [s * x, y, z, d] as [number, number, number, number]))], (t) => r * (1 - 0.6 * t), 6);
        return [
          ...[20, 21, 22, 23].map((i) => tube([foramen(i, s, 0.012), X(s, [0.03, 0.98, -0.055]), X(s, [0.05, 0.925, -0.062])], { r: 0.0026, radial: 8 })),
          br(X(s, [0.07, 0.9, -0.058]), [[xc(0.84) + 0.012, 0.84, -0.25, 0.03], [xc(0.74) + 0.012, 0.74, -0.25, 0.03], [xc(0.66) + 0.012, 0.66, -0.25, 0.03]], 0.0013), // biceps femoris long head
          br(X(s, [0.07, 0.9, -0.058]), [[xc(0.84) - 0.02, 0.84, -0.25, 0.03], [xc(0.74) - 0.02, 0.74, -0.25, 0.03], [xc(0.64) - 0.02, 0.64, -0.25, 0.03]], 0.0011), // semitendinosus
          br(X(s, [0.07, 0.9, -0.058]), [[xc(0.82) - 0.036, 0.82, -0.25, 0.03], [xc(0.72) - 0.036, 0.72, -0.25, 0.03], [xc(0.62) - 0.036, 0.62, -0.25, 0.03]], 0.0011), // semimembranosus
          tb([X(s, [0.09, 0.8, -0.05]), X(s, [0.078, 0.77, -0.035]), X(s, [0.066, 0.73, -0.02])], 0.001, 6), // adductor magnus (hamstring part)
          br(X(s, [0.095, 0.6, -0.042]), [[0.12, 0.56, -0.25, 0.026], [0.122, 0.52, -0.25, 0.025]], 0.0009), // biceps short head
        ];
      },
    });
    nerve(`nerv.tibial.${S}`, `${N} tibial nerve`, low, [split, X(s, [0.094, 0.48, -0.046]), X(s, [0.09, 0.35, -0.04]), X(s, [0.078, 0.15, -0.032]), X(s, [0.068, 0.07, -0.025]), footPt(s, 0.0, -0.01, 0.012)], 0.0036, 0.0022, 'Continuation of the sciatic nerve supplying the calf muscles and, via the medial and lateral plantar nerves, the sole of the foot.', {
      twigs: 3, seed: 43,
      extra: () => {
        const br = (a: V3, pts: [number, number, number, number][], r: number) => tb([a, ...surf(pts.map(([x, y, z, d]) => [s * x, y, z, d] as [number, number, number, number]))], (t) => r * (1 - 0.6 * t), 6);
        const A = footPt(s, 0.0, -0.01, 0.012);
        const mp = footPt(s, 0.075, -0.014, 0.01), lp = footPt(s, 0.075, 0.016, 0.01);
        const list: Geo[] = [
          br(X(s, [0.094, 0.48, -0.046]), [[0.112, 0.44, -0.25, 0.03], [0.116, 0.37, -0.25, 0.03], [0.116, 0.3, -0.25, 0.03]], 0.0012), // lateral gastrocnemius
          br(X(s, [0.094, 0.48, -0.046]), [[0.076, 0.44, -0.25, 0.03], [0.072, 0.37, -0.25, 0.03], [0.074, 0.3, -0.25, 0.03]], 0.0012), // medial gastrocnemius
          br(X(s, [0.09, 0.4, -0.04]), [[0.094, 0.36, -0.25, 0.046], [0.095, 0.28, -0.25, 0.046], [0.092, 0.22, -0.25, 0.04]], 0.0012), // soleus
          tb([X(s, [0.09, 0.35, -0.04]), X(s, [0.088, 0.3, -0.026]), X(s, [0.086, 0.24, -0.022])], 0.001, 6), // tibialis posterior / FDL / FHL
          tb([A, lerp(A, mp, 0.5), mp], 0.0014, 7), tb([A, lerp(A, lp, 0.5), lp], 0.0013, 7),
        ];
        TOES.forEach((t, i) => {
          const from = i < 3 ? mp : lp;
          const j = toeJoints(s, i);
          list.push(tb([from, footPt(s, 0.08, t.baseL, 0.009), ...j.slice(0, 2).map((p) => add(p, [0, -0.005, 0]))], 0.0007, 5));
        });
        return list;
      },
    });
    nerve(`nerv.fibular.${S}`, `${N} common fibular nerve`, low, [split, X(s, [0.12, 0.5, -0.036]), X(s, [0.132, 0.45, -0.012])], 0.0028, 0.0024, 'Winds around the neck of the fibula — vulnerable to injury causing foot drop; divides into superficial and deep branches.', {
      extra: () => {
        const sup = [X(s, [0.132, 0.45, -0.012]), X(s, [0.128, 0.35, 0.0]), X(s, [0.11, 0.12, 0.012]), footPt(s, 0.06, 0.01, 0.034), footPt(s, 0.11, 0.015, 0.024)];
        const dp = [X(s, [0.132, 0.45, -0.012]), X(s, [0.12, 0.42, 0.006]), X(s, [0.1, 0.25, 0.016]), X(s, [0.09, 0.1, 0.018]), footPt(s, 0.1, -0.015, 0.03)];
        const list: Geo[] = [tube(sup, { r: 0.0014, radial: 6 }), tube(dp, { r: 0.0013, radial: 6 })];
        // dorsal digital branches to the toes, motor twigs to the peroneal and anterior compartment
        for (let i = 0; i < 5; i++) {
          const j = toeJoints(s, i);
          list.push(tb([i < 3 ? sup[4] : sup[3], footPt(s, 0.12, TOES[i].baseL, 0.024), add(j[1], [0, 0.004, 0])], 0.0005, 5));
        }
        list.push(tb([X(s, [0.128, 0.4, 0.0]), X(s, [0.125, 0.34, -0.006]), X(s, [0.12, 0.28, -0.012])], 0.0009, 6), tb([X(s, [0.12, 0.42, 0.006]), X(s, [0.108, 0.36, 0.014]), X(s, [0.104, 0.3, 0.018])], 0.0009, 6));
        return list;
      },
    });
    nerve(`nerv.sural.${S}`, `${N} sural nerve`, low, [X(s, [0.094, 0.5, -0.06]), X(s, [0.1, 0.42, -0.07]), X(s, [0.105, 0.3, -0.06]), X(s, [0.112, 0.16, -0.04]), X(s, [0.117, 0.085, -0.02]), footPt(s, 0.05, 0.045, 0.03), footPt(s, 0.11, 0.05, 0.022)], 0.0012, 0.0008, 'Cutaneous nerve of the posterolateral leg, passing behind the lateral malleolus to the lateral border of the foot.', { conformDepth: 0.008, conformRange: [0, 1] });

    // ---- eye
    const eg = G(`nerv.eye.${S}`, `${N} eye`, 'nervous', SYS, 'Organ of vision: a 24 mm globe focusing light onto the retina.');
    const e = HEAD.eye(s);
    const r = HEAD.eyeR;
    P({ id: `eye.sclera.${S}`, name: `${N} eyeball (sclera & retina)`, parent: eg, system: SYS, tissue: 'eye', desc: 'Tough white outer coat of the eye with fine episcleral vessels, lined internally by the choroid and the light-sensitive retina; the optic nerve leaves at the back.', build: () => {
      const globe = union([sphere(e, r), roundCone(add(e, [0, 0, -r * 0.9]), add(e, [0, 0, -r - 0.0015]), 0.0034, 0.0026)], 0.002);
      const shellS = subtract(hollow(globe, 0.0009), sphere(add(e, [0, 0, 0.0052]), 0.0082), 0.0006);
      const ves = (x: number, y: number, z: number) => {
        const w = 0.5 * noise3(x * 220, y * 220, z * 220);
        const n = noise3(x * 400 + w, y * 400 - w, z * 400 + 2 * w);
        return 0.00013 * Math.pow(1 - Math.abs(n), 14) + 0.00004 * noise3(x * 900, y * 900, z * 900);
      };
      return meshShape(displace(shellS, ves, 0.00018), 0.00048);
    } });
    P({ id: `eye.iris.${S}`, name: `${N} iris & pupil`, parent: eg, system: SYS, tissue: 'iris', desc: 'Pigmented muscular diaphragm with radial fibres and a collarette, controlling the size of the pupil and thus the light entering the eye.', build: () => {
      const z0 = e[2] + r * 0.8, ro = 0.0059, rp = 0.0021;
      const f: Shape = {
        d: (x, y, z) => {
          const px = x - e[0], py = y - e[1];
          const rho = Math.hypot(px, py);
          const th = Math.atan2(py, px);
          const fib = Math.pow(1 - Math.abs(Math.sin(th * 42 + 5 * noise3(px * 160, py * 160, 1.3))), 3);
          const u = Math.max(0, Math.min(1, (rho - rp) / (ro - rp)));
          const col = Math.exp(-(((rho - 0.0034) / 0.00045) ** 2));
          const thick = 0.00032 + 0.00009 * fib * (1 - u * 0.5) + 0.00016 * col - 0.00008 * Math.max(0, (rho - 0.0049) / 0.001);
          const zc = z0 - 0.0005 * u * u + 0.0003 * (1 - u);
          const dz = Math.abs(z - zc) - thick;
          const dr = Math.max(rho - ro, rp - rho);
          return Math.max(dz, dr) + 0.00005 * Math.min(0, Math.max(dz, dr) + 0.0003);
        },
        lo: [e[0] - ro - 0.001, e[1] - ro - 0.001, z0 - 0.002], hi: [e[0] + ro + 0.001, e[1] + ro + 0.001, z0 + 0.002],
      };
      return meshShape(f, 0.00021);
    } });
    P({ id: `eye.lens.${S}`, name: `${N} lens`, parent: eg, system: SYS, tissue: 'lens', desc: 'Transparent biconvex lens (flatter in front, more curved behind) that changes shape (accommodation) to focus near and far objects.', build: () => meshShape(intersect(sphere(add(e, [0, 0, 0.0094 - 0.01]), 0.01), sphere(add(e, [0, 0, 0.0058 + 0.006]), 0.006), 0.0003), 0.00035) });
    P({ id: `eye.cornea.${S}`, name: `${N} cornea`, parent: eg, system: SYS, tissue: 'lens', desc: 'Clear dome at the front of the eye providing about two-thirds of its focusing power.', build: () => meshShape(intersect(hollow(sphere(add(e, [0, 0, 0.0052]), 0.0078), 0.0006), plane([0, 0, -1], add(e, [0, 0, 0.0094]))), 0.0003) });
  }
}

const FINGERS_L = (i: number) => [0.021, 0.004][i];

void capsule; void frameY; void cylinder;
