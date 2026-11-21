import { V3, add, mul, sub, norm, lerp, rng, spline, cross } from '../geo/math';
import {
  Shape, ellipsoid, capsule, roundCone, union, subtract, sphere, frameEuler, chain, intersect, plane, shell, hollow,
  region, PlaneFn, splineTube, displace, triangle, torus, frameAxes, offset, cylinder, frameY, Frame,
} from '../geo/sdf';
import { meshShape, Geo } from '../geo/mesher';
import { tube, merge } from '../geo/tube';
import { branchTree } from '../geo/branch';
import { fbm, noise3 } from '../geo/noise';
import { wallTube, modTube } from '../geo/d_tubes';
import { G, P, SystemId, Tissue, AnimKind } from './registry';
import { Side, SIDES, sideName, sid } from './rig';
import { autoCell, lc } from './util';
import { heartOuter } from './cardio';

function organ(id: string, name: string, parent: string, system: SystemId, tissue: Tissue, desc: string, shape: () => Shape, o: { div?: number; min?: number; max?: number; anim?: AnimKind } = {}) {
  P({
    id, name, parent, system, tissue, desc, anim: o.anim,
    build: () => {
      const s = shape();
      return liverShift(id, meshShape(s, autoCell(s, o.div ?? 55, o.min ?? 0.0009, o.max ?? 0.0028)));
    },
  });
}
function tubePart(id: string, name: string, parent: string, system: SystemId, tissue: Tissue, desc: string, geo: () => Geo, anim?: AnimKind) {
  P({ id, name, parent, system, tissue, desc, build: () => liverShift(id, geo()), anim });
}
/** v4: after the landmark warp the procedural liver sat ~9 cm below the real (BP3D) caudate lobe; lift it into the real subphrenic position. */
const LIVER_SHIFT: V3 = [0, 0.08, 0.04];
function liverShift(id: string, g: Geo): Geo {
  if (!/^dig.(liver|gallbladder|bile)/.test(id)) return g;
  for (let i = 0; i < g.pos.length; i += 3) { g.pos[i] += LIVER_SHIFT[0]; g.pos[i + 1] += LIVER_SHIFT[1]; g.pos[i + 2] += LIVER_SHIFT[2]; }
  return g;
}

// ---------------------------------------------------------------- small helpers
const ridged = (x: number, y: number, z: number, f: number) => 1 - Math.abs(noise3(x * f, y * f, z * f));
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const toLoc = (c: V3, f: Frame, p: V3): V3 => { const d = sub(p, c); return [dot3(d, f[0]), dot3(d, f[1]), dot3(d, f[2])]; };
const fromLoc = (c: V3, f: Frame, l: V3): V3 => [
  c[0] + f[0][0] * l[0] + f[1][0] * l[1] + f[2][0] * l[2],
  c[1] + f[0][1] * l[0] + f[1][1] * l[1] + f[2][1] * l[2],
  c[2] + f[0][2] * l[0] + f[1][2] * l[1] + f[2][2] * l[2],
];
/** lobulated gland surface: ridged cellular-ish relief */
const lobulate = (s: Shape, f: number, amp: number, f2 = f * 2.7) =>
  displace(s, (x, y, z) => amp * (0.65 * Math.pow(ridged(x, y, z, f), 2) + 0.35 * ridged(x, y, z, f2)), amp);

/** Hollow organ wall with a custom (folded) lumen surface. ridge > 0 pushes the lumen surface into the lumen. */
function foldedWall(outer: Shape, t: number | ((x: number, y: number, z: number) => number), ridge: (x: number, y: number, z: number) => number): Shape {
  const tf = typeof t === 'number' ? () => t : t;
  return {
    d: (x, y, z) => {
      const d = outer.d(x, y, z);
      if (d > 0) return d;
      const tt = tf(x, y, z);
      if (d < -tt - 0.004) return -d - tt - 0.004;
      return Math.max(d, -d - tt + ridge(x, y, z));
    },
    lo: outer.lo,
    hi: outer.hi,
  };
}

// ====================================================================== RESPIRATORY
const lungCache = new Map<number, Shape>();
export function lungShape(s: Side): Shape {
  if (lungCache.has(s)) return lungCache.get(s)!;
  let l = union(
    [
      ellipsoid([s * 0.07, 1.335, -0.01], [0.05, 0.105, 0.07]),
      ellipsoid([s * 0.08, 1.245, -0.012], [0.066, 0.1, 0.088]),
      ellipsoid([s * 0.088, 1.2, -0.035], [0.05, 0.06, 0.068]),
    ],
    0.03,
  );
  l = intersect(l, ellipsoid([0, 1.29, -0.008], [0.131, 0.2, 0.098]), 0.012);
  l = subtract(l, ellipsoid([0.014, 1.272, 0.03], [0.07, 0.068, 0.066]), 0.02);
  // heart bed: clearance around the heart plus an anterior window so the heart shows between the lungs
  l = subtract(l, offset(heartOuter(), 0.005), 0.014);
  l = subtract(l, ellipsoid([0.034, 1.283, 0.072], [0.047, 0.064, 0.068]), 0.016);
  if (s > 0) l = subtract(l, ellipsoid([0.06, 1.245, 0.07], [0.03, 0.04, 0.05]), 0.012); // deeper notch, lingula below
  l = subtract(l, capsule([0, 1.2, -0.032], [0, 1.47, -0.03], 0.027), 0.015);
  if (s > 0) {
    l = subtract(l, ellipsoid([0.035, 1.235, 0.075], [0.05, 0.055, 0.045]), 0.015); // cardiac notch
  }
  l = subtract(l, ellipsoid([s * 0.07, s > 0 ? 1.095 : 1.108, 0.0], [0.1, 0.085, 0.12]), 0.02);
  // hilum depression on the mediastinal face
  l = subtract(l, ellipsoid([s * 0.045, 1.318, -0.022], [0.012, 0.02, 0.016]), 0.008);
  // rib impressions (subtle), lobular septal grooves and alveolar mottling
  l = displace(
    l,
    (x, y, z) => {
      const lat = sstep(0.055, 0.1, Math.abs(x));
      const rib = Math.pow(0.5 + 0.5 * Math.cos(((y + 0.22 * z) / 0.0245) * Math.PI * 2), 3);
      const n1 = noise3(x * 55, y * 55, z * 55);
      const groove = Math.exp(-((n1 / 0.07) ** 2));
      const n2 = noise3(x * 230 + 5, y * 230, z * 230);
      return 0.0003 * lat * rib + 0.0005 * groove + 0.00035 * (0.5 + 0.5 * n2) * (0.6 + 0.4 * fbm(x * 420, y * 420, z * 420, 2));
    },
    0.0012,
  );
  lungCache.set(s, l);
  return l;
}
const obliqueFn: PlaneFn = (x, y, z) => y - 1.265 + 0.9 * z;
const horizFn: PlaneFn = (x, y) => y - 1.302;
const neg = (f: PlaneFn): PlaneFn => (x, y, z) => -f(x, y, z);

const CARINA: V3 = [0, 1.36, -0.012];
export const HILUM = (s: Side): V3 => [s * 0.048, 1.318, -0.022];
export const MAIN_BRONCHUS = (s: Side): V3[] =>
  s > 0 ? [CARINA, [0.028, 1.347, -0.017], HILUM(1)] : [CARINA, [-0.024, 1.338, -0.016], HILUM(-1)];

export function lungTree(s: Side, seed: number, r0: number, flow0?: number, offsetV: V3 = [0, 0, 0]): Geo {
  const L = lungShape(s);
  const inside = (p: V3) => L.d(p[0], p[1], p[2]);
  const h = add(HILUM(s), offsetV);
  const geos: Geo[] = [];
  const dirs: V3[] = [[s * 0.4, 0.9, 0.1], [s * 0.6, -0.5, 0.45], [s * 0.5, -0.7, -0.45]];
  if (s < 0) dirs.push([-0.9, -0.1, 0.35]);
  dirs.forEach((d, i) => {
    geos.push(branchTree(h, d, { len: 0.032, r: r0, depth: 6, seed: seed + i * 17, spread: 0.5, lenDecay: 0.8, rDecay: 0.74, inside, margin: 0.003, flow0, minR: 0.0004 }));
  });
  return merge(geos);
}

function diaphragmShape(): Shape {
  const domes = union(
    [
      ellipsoid([-0.06, 1.118, -0.005], [0.085, 0.075, 0.1]),
      ellipsoid([0.062, 1.1, -0.005], [0.08, 0.072, 0.1]),
      ellipsoid([0, 1.1, 0.005], [0.06, 0.065, 0.08]),
    ],
    0.03,
  );
  let d = shell(domes, 0.0022);
  d = intersect(d, plane([0, -1, 0.6], [0, 1.115, 0]), 0.004);
  d = intersect(d, ellipsoid([0, 1.15, -0.008], [0.128, 0.16, 0.1]), 0.004);
  // hiatuses: oesophagus, inferior vena cava, aorta
  d = subtract(d, cylinder([0.028, 1.15, -0.008], 0.0085, 0.05), 0.002);
  d = subtract(d, cylinder([-0.027, 1.15, -0.012], 0.0105, 0.05), 0.002);
  d = subtract(d, cylinder([0.006, 1.15, -0.036], 0.0075, 0.05), 0.002);
  // muscle fibres radiate from the central tendon
  d = displace(
    d,
    (x, y, z) => {
      const rho = Math.hypot(x * 0.8, z - 0.012);
      const ang = Math.atan2(z - 0.012, x);
      const muscle = sstep(0.03, 0.05, rho);
      const fib = Math.sin(ang * 60 + 3 * noise3(x * 40, y * 40, z * 40)) * 0.5 + 0.5;
      return 0.0005 * (1 - muscle) + 0.0004 * muscle * fib + 0.0002 * noise3(x * 300, y * 300, z * 300);
    },
    0.0012,
  );
  // crura descending to L1-L3
  const crus = [
    splineTube([[-0.014, 1.158, -0.016], [-0.015, 1.14, -0.012], [-0.014, 1.115, -0.004]], (t) => 0.0062 - 0.002 * t, 8, 0.002),
    splineTube([[0.016, 1.158, -0.016], [0.017, 1.14, -0.012], [0.016, 1.125, -0.008]], (t) => 0.005 - 0.0017 * t, 8, 0.002),
  ];
  return union([d, ...crus], 0.004);
}

// ====================================================================== DIGESTIVE
const STOMACH_PTS: V3[] = [[0.038, 1.152, 0.0], [0.07, 1.168, -0.006], [0.088, 1.12, 0.022], [0.076, 1.072, 0.044], [0.035, 1.058, 0.055], [0.0, 1.072, 0.05], [-0.021, 1.088, 0.04]];
const PYLORUS: V3 = [-0.021, 1.088, 0.04];
const stomachR = (t: number) => {
  const k: [number, number][] = [[0, 0.011], [0.13, 0.03], [0.33, 0.035], [0.58, 0.03], [0.8, 0.019], [1, 0.0105]];
  for (let i = 1; i < k.length; i++) if (t <= k[i][0]) { const f = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (f * f * (3 - 2 * f)); }
  return 0.0105;
};
let stomachCache: Shape | null = null;
const stomachOuter = () => (stomachCache ??= union([splineTube(STOMACH_PTS, stomachR, 24, 0.012), roundCone([-0.009, 1.081, 0.045], PYLORUS, 0.0112, 0.0118)], 0.004));

function stomachWall(): Shape {
  const o = displace(stomachOuter(), (x, y, z) => 0.0005 * noise3(x * 200, y * 200, z * 200), 0.0005);
  return foldedWall(
    o,
    (x, y, z) => {
      const dp = Math.hypot(x - PYLORUS[0], y - PYLORUS[1], z - PYLORUS[2]);
      return 0.0042 + 0.0038 * Math.exp(-((dp / 0.012) ** 2)); // pyloric sphincter thickening
    },
    (x, y, z) => {
      // rugae: sinuous folds, absent in the antrum near the pylorus
      const dp = Math.hypot(x - PYLORUS[0], y - PYLORUS[1], z - PYLORUS[2]);
      const w = sstep(0.025, 0.06, dp);
      const warp = noise3(x * 60, y * 60, z * 60) * 0.004;
      return 0.0021 * w * Math.pow(ridged(x + warp, y, z + warp, 175), 2.2) + 0.0004 * w * ridged(x, y, z, 520);
    },
  );
}

function gbShape(): Shape {
  return union([
    roundCone([-0.046, 1.069, 0.07], [-0.037, 1.092, 0.052], 0.0118, 0.0062),
    roundCone([-0.037, 1.092, 0.052], [-0.033, 1.1, 0.044], 0.0062, 0.0042),
    sphere([-0.047, 1.07, 0.071], 0.0108),
  ], 0.006);
}

function liverBase(): Shape {
  let l = union(
    [
      ellipsoid([-0.05, 1.14, 0.004], [0.088, 0.074, 0.086]),
      ellipsoid([0.03, 1.16, 0.035], [0.075, 0.04, 0.052], frameEuler(0, 0, -0.15)),
      ellipsoid([-0.02, 1.15, 0.03], [0.07, 0.055, 0.06]),
    ],
    0.03,
  );
  const domes = union([ellipsoid([-0.06, 1.118, -0.005], [0.083, 0.073, 0.098]), ellipsoid([0.062, 1.1, -0.005], [0.078, 0.07, 0.098]), ellipsoid([0, 1.1, 0.005], [0.058, 0.063, 0.078])], 0.03);
  l = intersect(l, domes, 0.01);
  // sharp inferior border
  l = intersect(l, plane([0.25, -1, -0.25], [0, 1.075, 0]), 0.004);
  // visceral impressions
  l = subtract(l, offset(stomachOuter(), 0.004), 0.01);
  l = subtract(l, capsule([-0.02, 1.05, -0.04], [-0.022, 1.25, -0.012], 0.012), 0.004); // IVC groove
  l = subtract(l, offset(gbShape(), 0.0008), 0.004); // gallbladder fossa
  l = subtract(l, capsule([-0.03, 1.098, 0.004], [-0.004, 1.097, 0.016], 0.0065), 0.005); // porta hepatis
  l = subtract(l, capsule([0.006, 1.06, 0.09], [0.002, 1.1, 0.05], 0.0042), 0.003); // ligamentum teres fissure
  l = subtract(l, ellipsoid([-0.06, 1.09, -0.052], [0.026, 0.026, 0.024], frameEuler(0.15, -0.25, 0.18)), 0.006); // renal impression
  l = subtract(l, ellipsoid([-0.082, 1.075, 0.03], [0.016, 0.018, 0.02]), 0.006); // colic impression
  l = displace(l, (x, y, z) => 0.0004 * noise3(x * 140, y * 140, z * 140), 0.0004);
  return l;
}
let liverCache: Shape | null = null;
const liver = () => (liverCache ??= liverBase());

/** Packed small-bowel loops in three layers, arranged as mesenteric fans. */
function smallIntestinePath(): V3[] {
  const R = rng(4242);
  const pts: V3[] = [[0.03, 1.05, 0.008], [0.045, 1.04, 0.022]];
  const layers: { z: number; ys: number[] }[] = [
    { z: 0.02, ys: [1.03, 1.01, 0.99, 0.97, 0.95] },
    { z: 0.046, ys: [0.955, 0.975, 0.995, 1.015, 1.035] },
    { z: 0.07, ys: [1.012, 0.99, 0.968, 0.948] },
  ];
  let dir = -1;
  let rowN = 0;
  for (const L of layers)
    for (const y of L.ys) {
      const n = 9;
      const ext = 0.052 + R() * 0.014;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const x = dir > 0 ? -ext + 2 * ext * u : ext - 2 * ext * u;
        const wave = Math.sin(u * Math.PI * 3 + rowN * 1.7);
        pts.push([x, y + wave * 0.0045 + (R() - 0.5) * 0.004, L.z + Math.cos(u * Math.PI * 2.3 + rowN) * 0.006 + (R() - 0.5) * 0.004]);
      }
      dir *= -1;
      rowN++;
    }
  pts.push([-0.062, 0.957, 0.042], [-0.068, 0.948, 0.034]);
  return pts;
}

/** Plicae circulares: transverse mucosal folds narrowing the lumen. */
const plicae = (spacing: number, depth: number) => (t: number, s: number, th: number) => {
  const f = 0.5 + 0.5 * Math.cos((s / spacing) * Math.PI * 2);
  return 1 - depth * Math.pow(f, 2.2) * (0.75 + 0.35 * noise3(s * 180, th * 1.3, 0.5));
};

/** Haustra with taeniae coli (3 longitudinal bands; parallel-transport frames keep them straight). */
const haustral = (spacing = 0.021) => (t: number, s: number, th: number) => {
  const hs = Math.pow(Math.abs(Math.sin((s * Math.PI) / spacing)), 0.6);
  const band = Math.pow(Math.max(0, Math.cos(3 * th)), 8);
  return 1 + 0.16 * hs * (1 - 0.75 * band) + 0.035 * band - 0.03 * (1 - hs) * band;
};
const semilunar = (spacing = 0.021) => (t: number, s: number, th: number) => {
  const hs = Math.abs(Math.sin((s * Math.PI) / spacing));
  return 1 - 0.3 * Math.pow(1 - hs, 3) * (0.7 + 0.3 * Math.cos(3 * th));
};

/** Appendices epiploicae: small pedunculated fatty tags along the colon (kept off the anterior surface). */
function epiploic(points: V3[], radius: number, count: number, seed: number): Geo[] {
  const R = rng(seed);
  const path = spline(points, 90);
  const out: Geo[] = [];
  for (let k = 0; k < count; k++) {
    const i = 3 + Math.floor(R() * (path.length - 6));
    const p = path[i];
    const T = norm(sub(path[i + 1], path[i - 1]));
    const a = norm(cross(T, [0.3, 0.9, 0.2]));
    const b = norm(cross(T, a));
    const th = R() * Math.PI * 2;
    let dir: V3 = norm(add(mul(a, Math.cos(th)), mul(b, Math.sin(th))));
    if (dir[2] > 0.35) dir = norm([dir[0], dir[1], -dir[2] * 0.5]);
    const base = add(p, mul(dir, radius * 1.05));
    const mid = add(base, add(mul(dir, 0.004), mul(T, (R() - 0.5) * 0.004)));
    const tip = add(mid, add(mul(dir, 0.004 + R() * 0.004), mul(T, (R() - 0.5) * 0.006)));
    out.push(tube([add(p, mul(dir, radius * 0.9)), base, mid, tip], { r: (t) => 0.0018 + 0.0014 * Math.sin(Math.min(1, t * 1.4 + 0.3) * 2.1), radial: 6, seg: 0.0025 }));
  }
  return out;
}

// ====================================================================== URINARY
export const KIDNEY = (s: Side) => ({
  c: [s * 0.058, s > 0 ? 1.122 : 1.108, -0.05] as V3,
  frame: frameEuler(0.15, s * 0.25, s * -0.18),
  hilum: [s * 0.036, s > 0 ? 1.118 : 1.104, -0.04] as V3,
});
const KR: V3 = [0.023, 0.052, 0.016];
function kidneyBase(s: Side): Shape {
  const k = KIDNEY(s);
  return ellipsoid(k.c, KR, k.frame);
}
/** hilar cleft: elongated vertical slit leading into the renal sinus */
function kidneySlit(s: Side): Shape {
  const k = KIDNEY(s);
  const hl = toLoc(k.c, k.frame, k.hilum);
  const at = (f: number, y: number) => fromLoc(k.c, k.frame, [hl[0] * f, y, hl[2] * f]);
  return union([capsule(at(0.2, -0.016), at(0.2, 0.016), 0.0105), capsule(at(1.5, -0.014), at(1.5, 0.014), 0.0115)], 0.01);
}
function kidneyOuter(s: Side): Shape {
  return subtract(kidneyBase(s), kidneySlit(s), 0.008);
}
function pyramids(s: Side) {
  const k = KIDNEY(s);
  const hl = toLoc(k.c, k.frame, k.hilum);
  const out: { base: V3; tip: V3 }[] = [];
  for (const ly of [-0.034, -0.017, 0, 0.017, 0.034]) {
    const edge = Math.sqrt(Math.max(0.05, 1 - (ly / (KR[1] * 0.85)) ** 2));
    for (const psi of [-1.05, 1.05]) {
      const bl: V3 = [s * 0.0185 * Math.cos(psi) * 0.9 * edge * s, ly * 0.95, 0.0125 * Math.sin(psi) * edge];
      // local x: lateral side is opposite the hilum
      const lat = -Math.sign(hl[0] || 1);
      bl[0] = lat * 0.0185 * Math.cos(psi) * edge;
      const tl: V3 = [hl[0] * 0.45, ly * 0.6, bl[2] * 0.3];
      out.push({ base: fromLoc(k.c, k.frame, bl), tip: fromLoc(k.c, k.frame, tl) });
    }
  }
  return out;
}

function pancreasShape(): Shape {
  const body = splineTube([[-0.014, 1.07, 0.012], [0.01, 1.08, 0.0], [0.045, 1.092, -0.016], [0.075, 1.106, -0.03], [0.098, 1.118, -0.038]], (t) => 0.0092 - 0.0032 * t, 14, 0.006);
  const head = ellipsoid([-0.027, 1.058, 0.014], [0.012, 0.02, 0.011]);
  const uncinate = ellipsoid([-0.02, 1.04, 0.004], [0.011, 0.008, 0.007], frameEuler(0, 0, 0.4));
  return lobulate(union([body, head, uncinate], 0.008), 330, 0.0016);
}

function spleenShape(): Shape {
  const c: V3 = [0.104, 1.132, -0.052];
  const f = frameEuler(0.3, 0.4, 0.25);
  let sp = ellipsoid(c, [0.021, 0.05, 0.034], f);
  sp = subtract(sp, ellipsoid([0.085, 1.13, -0.04], [0.012, 0.03, 0.02]), 0.008); // hilum
  for (const phi of [0.62, 0.18, -0.3]) {
    // notches on the anterior-superior border
    sp = subtract(sp, sphere(fromLoc(c, f, [0.0, 0.05 * Math.sin(phi), 0.034 * Math.cos(phi)]), 0.0048), 0.003);
  }
  return displace(sp, (x, y, z) => 0.0004 * noise3(x * 160, y * 160, z * 160), 0.0004);
}

function bladderOuter(): Shape {
  return union([
    ellipsoid([0, 0.902, 0.03], [0.03, 0.025, 0.026]),
    ellipsoid([0, 0.912, 0.034], [0.022, 0.02, 0.022]),
    roundCone([0, 0.889, 0.03], [0, 0.875, 0.032], 0.014, 0.0045),
    capsule([0, 0.922, 0.044], [0, 0.929, 0.052], 0.0028),
  ], 0.01);
}

function thyroidShape(): Shape {
  const lobes = SIDES.map((s) => roundCone([s * 0.0125, 1.514, 0.03], [s * 0.0172, 1.484, 0.034], 0.0042, 0.0082));
  const isthmus = capsule([-0.011, 1.488, 0.039], [0.011, 1.488, 0.039], 0.0034);
  const pyramidal = roundCone([0.003, 1.49, 0.04], [0.0045, 1.508, 0.04], 0.0027, 0.0012);
  return displace(union([...lobes, isthmus, pyramidal], 0.005), (x, y, z) => 0.0006 * noise3(x * 350, y * 350, z * 350), 0.0006);
}

function adrenalShape(s: Side): Shape {
  const k = KIDNEY(s);
  const c = add(k.c, [-s * 0.008, 0.057, 0.002]);
  // left: crescent (semilunar), right: pyramidal/triangular with two limbs
  const limbs = s > 0
    ? [roundCone(add(c, [-0.002, 0.012, 0]), add(c, [0.004, -0.012, 0.001]), 0.0028, 0.0022), roundCone(add(c, [-0.002, 0.012, 0]), add(c, [-0.007, -0.004, 0.0005]), 0.0028, 0.002)]
    : [roundCone(add(c, [0, 0.013, 0]), add(c, [-0.005, -0.011, 0.001]), 0.0026, 0.002), roundCone(add(c, [0, 0.013, 0]), add(c, [0.007, -0.009, 0]), 0.0026, 0.002), roundCone(add(c, [0, 0.013, 0]), add(c, [0, -0.012, -0.004]), 0.0024, 0.002)];
  const body = ellipsoid(c, [0.0075, 0.011, 0.0034], frameEuler(0.3, 0, s * 0.4));
  return displace(union([body, ...limbs], 0.004), (x, y, z) => 0.0006 * ridged(x, y, z, 380), 0.0006);
}

export function defineOrgans() {
  // ---------------------------------------------------------- respiratory
  const R: SystemId = 'respiratory';
  G('respiratory', 'Respiratory System', undefined, R, 'Conducts air to the lungs where oxygen and carbon dioxide are exchanged across ~70 m² of alveolar surface.');
  G('resp.larynx', 'Larynx', 'respiratory', R, 'The voice box: a cartilaginous framework housing the vocal folds and protecting the airway.');
  const cart = (id: string, nm: string, desc: string, sh: () => Shape) => organ(id, nm, 'resp.larynx', R, 'cartilage', desc, sh, { min: 0.0006, max: 0.001 });
  cart('resp.thyroid_cart', 'Thyroid cartilage', 'The largest laryngeal cartilage; its two laminae meet anteriorly forming the laryngeal prominence (Adam\'s apple).', () =>
    union(SIDES.flatMap((s) => [
      triangle([0, 1.53, 0.047], [s * 0.021, 1.536, 0.024], [s * 0.019, 1.507, 0.022], 0.0011),
      triangle([0, 1.53, 0.047], [s * 0.019, 1.507, 0.022], [0, 1.508, 0.041], 0.0011),
      capsule([s * 0.021, 1.536, 0.024], [s * 0.02, 1.546, 0.02], 0.0013),
    ]), 0.002));
  cart('resp.cricoid', 'Cricoid cartilage', 'The only complete cartilaginous ring of the airway, shaped like a signet ring.', () =>
    union([torus([0, 1.499, 0.03], 0.0102, 0.0019), ellipsoid([0, 1.504, 0.021], [0.009, 0.008, 0.0025])], 0.003));
  cart('resp.epiglottis', 'Epiglottis', 'Leaf-shaped elastic cartilage that folds over the laryngeal inlet during swallowing.', () =>
    displace(ellipsoid([0, 1.548, 0.032], [0.0085, 0.013, 0.0014], frameEuler(0.35, 0, 0)), (x, y, z) => 0.0003 * noise3(x * 600, y * 600, z * 600), 0.0003));
  const dShape = (t: number, s: number, th: number, dir: V3) => 1 - 0.17 * sstep(0.35, 0.95, -dir[2]);
  tubePart('resp.trachea', 'Trachea', 'respiratory', R, 'airway', 'The windpipe: a 10–12 cm tube reinforced by 16–20 C-shaped cartilage rings, from the larynx to the carina.', () =>
    wallTube([[0, 1.497, 0.03], [0, 1.45, 0.02], [0, 1.4, 0.004], CARINA], {
      r: (t, s) => 0.0083 + 0.0008 * Math.pow(Math.max(0, Math.sin((s * Math.PI * 2) / 0.0045)), 2), radial: 20, seg: 0.0009, innerSeg: 0.004, wall: 0.0014, outerMod: dShape, innerMod: dShape,
    }));
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s), ln = lc(N);
    const lg = G(`resp.lung.${S}`, `${N} lung`, 'respiratory', R, s > 0 ? 'Left lung: two lobes, with a cardiac notch accommodating the heart.' : 'Right lung: three lobes; wider and shorter than the left.');
    const lobe = (key: string, nm: string, planes: PlaneFn[], desc: string) =>
      organ(`resp.lung.${S}.${key}`, `${nm} lobe of ${ln} lung`, lg, R, 'lung', desc, () => region(lungShape(s), planes, 0.0011), { anim: 'lung', div: 70, max: 0.0023 });
    if (s < 0) {
      lobe('upper', 'Superior', [neg(obliqueFn), neg(horizFn)], 'Superior lobe of the right lung, above the horizontal fissure.');
      lobe('middle', 'Middle', [neg(obliqueFn), horizFn], 'The right middle lobe, between the horizontal and oblique fissures.');
      lobe('lower', 'Inferior', [obliqueFn], 'Inferior lobe of the right lung, below the oblique fissure.');
    } else {
      lobe('upper', 'Superior', [neg(obliqueFn)], 'Superior lobe of the left lung including the lingula.');
      lobe('lower', 'Inferior', [obliqueFn], 'Inferior lobe of the left lung.');
    }
    tubePart(`resp.bronchus.${S}`, `${N} main bronchus`, lg, R, 'airway', `Primary bronchus conducting air into the ${ln} lung${s > 0 ? '; longer and more horizontal than the right' : '; wider, shorter and more vertical — inhaled objects usually lodge here'}.`, () =>
      wallTube(MAIN_BRONCHUS(s), { r: (t, sl) => 0.0062 - t * 0.001 + 0.0005 * Math.pow(Math.max(0, Math.sin((sl * Math.PI * 2) / 0.004)), 2), radial: 16, seg: 0.0011, innerSeg: 0.003, wall: 0.0011 }), 'bronchi');
    tubePart(`resp.bronchtree.${S}`, `${N} bronchial tree`, lg, R, 'airway', 'Lobar, segmental and subsegmental bronchi branching ~23 times down to the bronchioles and alveoli.', () => lungTree(s, s > 0 ? 101 : 202, 0.0045), 'bronchi');
  }
  organ('resp.diaphragm', 'Diaphragm', 'respiratory', R, 'diaphragm', 'Dome-shaped musculotendinous sheet separating thorax from abdomen — the principal muscle of inspiration, with its central tendon, crura and openings for aorta, oesophagus and vena cava.', diaphragmShape, { anim: 'diaphragm', div: 100, max: 0.0028 });

  // ---------------------------------------------------------- digestive
  const D: SystemId = 'digestive';
  G('digestive', 'Digestive System', undefined, D, 'The alimentary canal from mouth to anus with its accessory organs, breaking food down and absorbing nutrients.');
  G('dig.oral', 'Oral cavity & glands', 'digestive', D, 'Tongue and salivary glands.');
  organ('dig.tongue', 'Tongue', 'dig.oral', D, 'tongue', 'Muscular organ for taste, chewing, swallowing and speech, covered with papillae.', () => {
    let t = union([ellipsoid([0, 1.584, 0.056], [0.02, 0.0085, 0.028]), ellipsoid([0, 1.575, 0.03], [0.017, 0.013, 0.016])], 0.01);
    t = subtract(t, ellipsoid([0, 1.5925, 0.058], [0.0007, 0.0025, 0.022]), 0.0015); // median sulcus
    t = subtract(t, ellipsoid([0, 1.587, 0.04], [0.016, 0.0016, 0.0016], frameEuler(0, 0.0, 0.0)), 0.002); // sulcus terminalis
    return displace(t, (x, y, z) => 0.00055 * (0.5 + 0.5 * noise3(x * 1000, y * 1000, z * 1000)) * sstep(1.578, 1.584, y), 0.0006);
  });
  for (const s of SIDES) {
    organ(`dig.parotid.${sid(s)}`, `${sideName(s)} parotid gland`, 'dig.oral', D, 'salivary', 'The largest salivary gland, in front of the ear; secretes serous saliva via the parotid duct.', () =>
      lobulate(ellipsoid([s * 0.059, 1.598, 0.003], [0.0085, 0.021, 0.0135], frameEuler(0.2, 0, 0)), 450, 0.0011), { min: 0.0006 });
    organ(`dig.submandibular.${sid(s)}`, `${sideName(s)} submandibular gland`, 'dig.oral', D, 'salivary', 'Walnut-sized salivary gland beneath the mandible producing ~70% of saliva.', () =>
      lobulate(ellipsoid([s * 0.036, 1.553, 0.03], [0.008, 0.006, 0.011]), 500, 0.0009), { min: 0.0005 });
  }
  const eFold = (t: number, s: number, th: number) => 1 - 0.34 * Math.pow(0.5 + 0.5 * Math.cos(5 * th + 0.4 * Math.sin(s * 60)), 1.5);
  tubePart('dig.esophagus', 'Esophagus', 'digestive', D, 'esophagus', 'A 25 cm muscular tube carrying food from the pharynx to the stomach by peristalsis; its collapsed lumen is lined with longitudinal mucosal folds.', () =>
    wallTube([[0, 1.535, 0.006], [0, 1.48, -0.006], [0.002, 1.4, -0.024], [0.006, 1.3, -0.034], [0.014, 1.2, -0.026], [0.028, 1.163, -0.01], [0.038, 1.152, 0.0]], {
      r: 0.0072, ellipse: [1, 0.72], up: [0, 0, 1], radial: 18, seg: 0.005, wall: 0.0027, innerMod: eFold,
    }));
  organ('dig.stomach', 'Stomach', 'digestive', D, 'stomach', 'J-shaped muscular sac (fundus, body, antrum, pylorus) that churns food with acid and pepsin; capacity ~1.5 L. Rugal folds line the lumen and the pyloric sphincter thickens the outlet.', stomachWall, { div: 80, min: 0.0008 });
  G('dig.liver', 'Liver', 'digestive', D, 'The largest internal organ (~1.5 kg): metabolises nutrients, detoxifies, produces bile and plasma proteins.');
  const falc: PlaneFn = (x, y, z) => x - 0.004 - 0.15 * (z - 0.03);
  const caud: PlaneFn = (x, y, z) => Math.max(z + 0.022, Math.abs(x + 0.012) - 0.018);
  const quad: PlaneFn = (x, y, z) => Math.max(Math.abs(x + 0.014) - 0.016, 0.03 - z, y - 1.125);
  organ('dig.liver.right', 'Right lobe of liver', 'dig.liver', D, 'liver', 'The largest hepatic lobe, lying under the right dome of the diaphragm.', () => region(liver(), [falc, neg(caud), neg(quad)], 0.001), { div: 80, max: 0.0024 });
  organ('dig.liver.left', 'Left lobe of liver', 'dig.liver', D, 'liver', 'Flattened lobe extending across the midline over the stomach.', () => region(liver(), [neg(falc), neg(caud)], 0.001), { div: 80, max: 0.0024 });
  organ('dig.liver.caudate', 'Caudate lobe', 'dig.liver', D, 'liver', 'Small posterior lobe beside the inferior vena cava with its own blood supply.', () => region(liver(), [caud, falc], 0.001), { div: 60 });
  organ('dig.liver.quadrate', 'Quadrate lobe', 'dig.liver', D, 'liver', 'Small anterior-inferior lobe between the gallbladder and the ligamentum teres.', () => region(liver(), [quad, falc, neg(caud)], 0.001), { div: 60 });
  organ('dig.gallbladder', 'Gallbladder', 'dig.liver', D, 'gallbladder', 'Pear-shaped sac beneath the liver that stores and concentrates bile; fundus, body, infundibulum and neck with a honeycomb mucosa.', () =>
    foldedWall(gbShape(), 0.0016, (x, y, z) => 0.0009 * Math.pow(ridged(x, y, z, 700), 2)), { min: 0.0005, max: 0.0012 });
  tubePart('dig.bile_ducts', 'Biliary ducts', 'dig.liver', D, 'gallbladder', 'Hepatic, cystic and common bile ducts conveying bile to the duodenum at the ampulla of Vater.', () =>
    merge([
      tube([[-0.022, 1.118, 0.024], [-0.028, 1.1, 0.03], [-0.036, 1.075, 0.025], [-0.044, 1.052, 0.019]], { r: 0.0022, radial: 8 }),
      tube([[-0.034, 1.1, 0.045], [-0.03, 1.098, 0.035], [-0.028, 1.098, 0.03]], { r: 0.0016, radial: 8 }),
      tube([[-0.022, 1.118, 0.024], [-0.03, 1.13, 0.02], [-0.042, 1.14, 0.014]], { r: 0.0013, radial: 6 }),
      tube([[-0.022, 1.118, 0.024], [-0.016, 1.13, 0.02], [-0.01, 1.14, 0.016]], { r: 0.0013, radial: 6 }),
    ]));
  organ('dig.pancreas', 'Pancreas', 'digestive', D, 'pancreas', 'Retroperitoneal gland with exocrine acini (digestive enzymes) and endocrine islets (insulin, glucagon); head in the duodenal C, uncinate process, body and tail.', pancreasShape, { div: 100, min: 0.0007, max: 0.0016 });
  organ('dig.spleen', 'Spleen', 'digestive', D, 'spleen', 'Lymphoid organ in the left upper quadrant that filters blood and recycles old red cells (lymphatic system, shown with abdominal organs).', spleenShape, { div: 60, min: 0.0008 });
  G('dig.small', 'Small intestine', 'digestive', D, 'About 6 m long: the principal site of digestion and nutrient absorption.');
  tubePart('dig.duodenum', 'Duodenum', 'dig.small', D, 'intestine', 'C-shaped first part of the small intestine (25 cm) receiving bile and pancreatic juice.', () =>
    wallTube([[-0.021, 1.088, 0.04], [-0.04, 1.085, 0.026], [-0.049, 1.06, 0.017], [-0.045, 1.034, 0.016], [-0.02, 1.024, 0.02], [0.01, 1.03, 0.013], [0.03, 1.05, 0.008]], {
      r: 0.0115, radial: 16, seg: 0.004, innerSeg: 0.0018, wall: 0.0022, innerMod: plicae(0.0055, 0.3),
    }));
  const siPts = smallIntestinePath();
  const cut = Math.floor(siPts.length * 0.45);
  tubePart('dig.jejunum', 'Jejunum', 'dig.small', D, 'intestine', 'Middle section of the small intestine with thick walls, prominent circular folds (plicae circulares) and rich blood supply.', () =>
    wallTube(siPts.slice(0, cut + 1), { r: (t) => 0.0116 - 0.0008 * t, radial: 14, seg: 0.0045, innerSeg: 0.002, wall: 0.0024, innerMod: plicae(0.0058, 0.3), outerMod: (t, s, th) => 1 + 0.025 * Math.sin(s * 220) }));
  tubePart('dig.ileum', 'Ileum', 'dig.small', D, 'intestine', 'Final, longest section of the small intestine; absorbs vitamin B12 and bile salts, ending at the ileocecal valve.', () =>
    wallTube(siPts.slice(cut), { r: (t) => 0.0108 - 0.0014 * t, radial: 14, seg: 0.0045, innerSeg: 0.0026, wall: 0.0018, innerMod: plicae(0.0068, 0.17) }));
  G('dig.large', 'Large intestine', 'digestive', D, 'About 1.5 m long: absorbs water and electrolytes and forms faeces; its sacculations are called haustra.');
  organ('dig.cecum', 'Cecum & appendix', 'dig.large', D, 'colon', 'Blind pouch at the start of the colon; the vermiform appendix hangs from it.', () =>
    displace(
      union([ellipsoid([-0.075, 0.946, 0.03], [0.024, 0.026, 0.024]), ellipsoid([-0.08, 0.958, 0.026], [0.016, 0.014, 0.016]), splineTube([[-0.07, 0.93, 0.036], [-0.062, 0.905, 0.042], [-0.05, 0.898, 0.032], [-0.046, 0.905, 0.02]], (t) => 0.0036 - 0.0014 * t, 10, 0.003)], 0.005),
      (x, y, z) => 0.0013 * Math.pow(Math.abs(Math.sin(((x + 0.075) * 3 + (y - 0.946) * 5) * 130 * 0.1)), 0.7) * sstep(0.925, 0.95, y) + 0.0006 * noise3(x * 300, y * 300, z * 300), 0.0016),
    { min: 0.0007 });
  const colon = (id: string, nm: string, desc: string, pts: V3[], base: number, taper: number, tags: number, seed: number) =>
    tubePart(id, nm, 'dig.large', D, 'colon', desc, () =>
      merge([
        wallTube(pts, { r: (t) => base - taper * t, radial: 24, seg: 0.003, innerSeg: 0.003, wall: 0.0025, outerMod: haustral(), innerMod: semilunar() }),
        ...epiploic(pts, base, tags, seed),
      ]));
  colon('dig.colon.asc', 'Ascending colon', 'Rises along the right flank from the cecum to the hepatic flexure.', [[-0.078, 0.955, 0.03], [-0.086, 1.0, 0.025], [-0.086, 1.055, 0.02], [-0.074, 1.078, 0.032]], 0.0195, 0, 5, 11);
  colon('dig.colon.trans', 'Transverse colon', 'The longest, most mobile part of the colon, hanging across the abdomen from the transverse mesocolon.', [[-0.074, 1.078, 0.032], [-0.04, 1.06, 0.07], [0.0, 1.045, 0.08], [0.04, 1.055, 0.074], [0.075, 1.09, 0.04], [0.086, 1.108, 0.018]], 0.0175, 0, 9, 23);
  colon('dig.colon.desc', 'Descending colon', 'Descends along the left flank from the splenic flexure to the pelvic brim.', [[0.086, 1.108, 0.018], [0.093, 1.05, 0.0], [0.091, 0.98, 0.006], [0.085, 0.94, 0.02]], 0.0148, 0, 5, 37);
  colon('dig.colon.sigmoid', 'Sigmoid colon', 'S-shaped loop connecting the descending colon to the rectum.', [[0.085, 0.94, 0.02], [0.062, 0.918, 0.05], [0.025, 0.922, 0.042], [0.002, 0.93, 0.0], [0.0, 0.912, -0.04]], 0.0138, 0, 5, 51);
  tubePart('dig.rectum', 'Rectum & anal canal', 'dig.large', D, 'colon', 'Final 15 cm of the large intestine storing faeces, ending at the anal sphincters.', () =>
    wallTube([[0.0, 0.912, -0.04], [0.0, 0.885, -0.056], [0.0, 0.868, -0.047], [0.0, 0.862, -0.037]], {
      r: (t) => 0.016 - 0.009 * t * t, radial: 22, seg: 0.0025, innerSeg: 0.003, wall: 0.0026, outerMod: (t, s, th) => 1 + 0.03 * Math.sin(s * 300) * (1 - t), innerMod: (t, s, th) => 1 - 0.2 * t * t * (0.5 + 0.5 * Math.cos(6 * th)),
    }));

  // ---------------------------------------------------------- urinary
  const U: SystemId = 'urinary';
  G('urinary', 'Urinary System', undefined, U, 'Filters ~180 L of blood plasma daily, producing urine and regulating fluid, electrolytes and blood pressure.');
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s);
    const k = KIDNEY(s);
    const kg = G(`uri.kidney.${S}`, `${N} kidney`, 'urinary', U, `Bean-shaped retroperitoneal organ containing about one million nephrons${s < 0 ? '; sits slightly lower than the left because of the liver' : ''}.`);
    organ(`uri.cortex.${S}`, `${N} renal cortex & capsule`, kg, U, 'kidney', 'Outer kidney layer containing the glomeruli and convoluted tubules, wrapped in a fibrous capsule.', () =>
      displace(subtract(hollow(kidneyBase(s), 0.0055), kidneySlit(s), 0.004), (x, y, z) => 0.0005 * Math.pow(ridged(x, y, z, 120), 2) + 0.0002 * noise3(x * 500, y * 500, z * 500), 0.0008), { div: 70, min: 0.0007 });
    organ(`uri.medulla.${S}`, `${N} renal pyramids (medulla)`, kg, U, 'medulla', 'Seven to eighteen cone-shaped pyramids of collecting ducts and loops of Henle draining into the calyces.', () => {
      const list = pyramids(s).map((p) => roundCone(p.base, p.tip, 0.0062, 0.0013));
      return intersect(union(list, 0.0012), offset(kidneyBase(s), -0.0046));
    }, { min: 0.0006, max: 0.0014 });
    organ(`uri.pelvis.${S}`, `${N} renal pelvis & calyces`, kg, U, 'pelvis', 'Funnel collecting urine from the minor and major calyces into the ureter.', () => {
      const hl = toLoc(k.c, k.frame, k.hilum);
      const L = (x: number, y: number, z: number) => fromLoc(k.c, k.frame, [hl[0] * x, y, hl[2] * z]);
      const nodes = [L(0.55, 0.02, 0.3), L(0.5, -0.021, 0.3), L(0.5, 0, 0.3)];
      const pel = L(0.95, 0, 0.9);
      const list: Shape[] = [roundCone(pel, add(k.hilum, [-s * 0.002, -0.014, 0.001]), 0.0055, 0.0028)];
      nodes.forEach((n) => list.push(roundCone(n, pel, 0.0028, 0.0045)));
      pyramids(s).forEach((p, i) => {
        const cup = lerp(p.base, p.tip, 0.97);
        list.push(sphere(cup, 0.0033), capsule(cup, nodes[p.tip[1] > k.c[1] + 0.008 ? 0 : p.tip[1] < k.c[1] - 0.008 ? 1 : 2], 0.0014));
        void i;
      });
      return union(list, 0.003);
    }, { min: 0.0006, max: 0.0014 });
    tubePart(`uri.ureter.${S}`, `${N} ureter`, 'urinary', U, 'pelvis', 'Muscular tube (25–30 cm) propelling urine from the renal pelvis to the bladder by peristalsis.', () =>
      wallTube([add(k.hilum, [-s * 0.002, -0.014, 0.001]), [s * 0.046, 1.04, -0.036], [s * 0.05, 0.98, -0.032], [s * 0.054, 0.945, -0.02], [s * 0.045, 0.905, 0.0], [s * 0.018, 0.898, 0.022]], {
        r: (t, sl) => 0.0023 + 0.0003 * Math.sin(sl * 330), radial: 10, seg: 0.004, wall: 0.0009, innerMod: (t, sl, th) => 1 - 0.35 * (0.5 + 0.5 * Math.cos(4 * th)),
      }));
  }
  organ('uri.bladder', 'Urinary bladder', 'urinary', U, 'bladder', 'Distensible muscular reservoir (detrusor) holding 400–600 mL of urine; the smooth trigone lies between the ureteric openings and the urethra.', () =>
    foldedWall(
      displace(bladderOuter(), (x, y, z) => 0.0004 * ridged(x, y, z, 260), 0.0004),
      0.0032,
      (x, y, z) => {
        const trig = Math.exp(-(((y - 0.889) / 0.01) ** 2) - ((x / 0.02) ** 2) - (((z - 0.026) / 0.018) ** 2));
        return 0.0013 * Math.pow(ridged(x, y, z, 200), 2) * (1 - trig) + 0.0004 * trig;
      },
    ), { div: 60, min: 0.0009 });
  tubePart('uri.urethra', 'Urethra', 'urinary', U, 'pelvis', 'Tube conveying urine from the bladder neck out of the body; in males it also carries semen.', () =>
    wallTube([[0, 0.876, 0.032], [0, 0.862, 0.034], [0, 0.852, 0.04], [0, 0.85, 0.046]], { r: 0.0026, radial: 10, seg: 0.003, wall: 0.0009, innerMod: (t, s, th) => 1 - 0.3 * (0.5 + 0.5 * Math.cos(3 * th)) }));

  // ---------------------------------------------------------- reproductive
  const RP: SystemId = 'reproductive';
  G('reproductive', 'Reproductive System', undefined, RP, 'Internal male reproductive organs (external genitalia are not modelled).');
  organ('rep.prostate', 'Prostate gland', 'reproductive', RP, 'prostate', 'Walnut-sized gland encircling the urethra below the bladder; produces part of seminal fluid.', () => {
    let p = union([ellipsoid([0, 0.865, 0.031], [0.0185, 0.012, 0.0135]), ellipsoid([0, 0.856, 0.031], [0.012, 0.009, 0.011])], 0.006);
    p = subtract(p, ellipsoid([0, 0.865, 0.0185], [0.0018, 0.011, 0.004]), 0.002); // posterior median furrow
    p = displace(p, (x, y, z) => 0.0007 * noise3(x * 300, y * 300, z * 300), 0.0007);
    return subtract(p, capsule([0, 0.85, 0.033], [0, 0.878, 0.032], 0.003), 0.001);
  }, { min: 0.0006 });
  for (const s of SIDES) {
    organ(`rep.vesicle.${sid(s)}`, `${sideName(s)} seminal vesicle`, 'reproductive', RP, 'prostate', 'Coiled gland behind the bladder secreting fructose-rich fluid forming most of the semen volume.', () =>
      displace(splineTube([[s * 0.007, 0.874, 0.016], [s * 0.014, 0.88, 0.008], [s * 0.022, 0.884, 0.012], [s * 0.028, 0.892, 0.007], [s * 0.034, 0.896, 0.013]], (t) => 0.0048 - 0.0012 * t, 12, 0.003), (x, y, z) => 0.0012 * Math.pow(ridged(x, y, z, 420), 1.5) + 0.0006 * Math.sin(y * 900 + x * 700), 0.0018), { min: 0.0005 });
    tubePart(`rep.vas.${sid(s)}`, `${sideName(s)} ductus deferens`, 'reproductive', RP, 'prostate', 'Muscular duct carrying sperm from the epididymis through the inguinal canal to the ejaculatory duct.', () =>
      wallTube([[s * 0.03, 0.872, 0.062], [s * 0.055, 0.905, 0.062], [s * 0.066, 0.93, 0.058], [s * 0.05, 0.928, 0.035], [s * 0.035, 0.906, 0.01], [s * 0.01, 0.874, 0.018]], { r: 0.0017, radial: 8, seg: 0.004, wall: 0.0011 }));
  }

  // ---------------------------------------------------------- endocrine
  const E: SystemId = 'endocrine';
  G('endocrine', 'Endocrine System', undefined, E, 'Ductless glands secreting hormones into the bloodstream.');
  organ('endo.thyroid', 'Thyroid gland', 'endocrine', E, 'thyroid', 'Butterfly-shaped gland on the trachea secreting thyroxine (T4), T3 and calcitonin; two lobes joined by an isthmus, with an occasional pyramidal lobe.', thyroidShape, { min: 0.0005, max: 0.0012 });
  organ('endo.parathyroid', 'Parathyroid glands', 'endocrine', E, 'adrenal', 'Four rice-grain glands behind the thyroid regulating calcium via parathyroid hormone.', () =>
    union(SIDES.flatMap((s) => [ellipsoid([s * 0.019, 1.506, 0.025], [0.0022, 0.0028, 0.0016]), ellipsoid([s * 0.019, 1.486, 0.026], [0.0022, 0.0028, 0.0016])])), { min: 0.0004 });
  organ('endo.pituitary', 'Pituitary gland', 'endocrine', E, 'gland', 'The "master gland" in the sella turcica, controlling other endocrine glands via its hormones.', () =>
    union([ellipsoid([0, 1.618, 0.008], [0.0055, 0.0038, 0.0045]), capsule([0, 1.62, 0.008], [0, 1.632, 0.006], 0.0012)], 0.002), { min: 0.0003 });
  organ('endo.pineal', 'Pineal gland', 'endocrine', E, 'gland', 'Small pine-cone shaped gland secreting melatonin, regulating circadian rhythm.', () => ellipsoid([0, 1.657, -0.027], [0.0025, 0.0022, 0.0035]), { min: 0.0003 });
  organ('endo.thymus', 'Thymus', 'endocrine', E, 'gland', 'Bilobed lymphoid gland in the anterior mediastinum where T-lymphocytes mature; largest in childhood.', () =>
    lobulate(union([roundCone([0.007, 1.375, 0.064], [0.012, 1.416, 0.062], 0.0085, 0.005), roundCone([-0.007, 1.376, 0.064], [-0.012, 1.414, 0.062], 0.0085, 0.005), ellipsoid([0, 1.372, 0.064], [0.013, 0.006, 0.006])], 0.006), 320, 0.0012), { min: 0.0007 });
  for (const s of SIDES) {
    organ(`endo.adrenal.${sid(s)}`, `${sideName(s)} adrenal gland`, 'endocrine', E, 'adrenal', 'Gland capping the kidney: the cortex secretes cortisol and aldosterone, the medulla adrenaline.', () => adrenalShape(s), { min: 0.0004, max: 0.0011 });
  }
}

export { stomachOuter, liver };
void cylinder; void frameY; void frameAxes; void chain; void shell; void modTube; void mul; void sub; void norm; void torus;
