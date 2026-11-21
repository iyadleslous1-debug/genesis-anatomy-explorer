import { V3, add, mul, sub, norm, lerp, spline, smooth, dot } from '../geo/math';
import { segField, FSeg } from '../geo/c_field';
import { meshShape, Geo } from '../geo/mesher';
import { tube, merge } from '../geo/tube';
import { G, P, Tissue } from './registry';
import { conform, skinShape } from './skin';
import { ribPaths } from './skeleton';
import {
  HEAD, armPt, forePt, handPt, shoulderJ, FINGERS, fingerJoints, thumbJoints, handFrame, footPt, toeJoints, TOES,
  Side, SIDES, sideName, sid, latOf, foreDir, armDir, thighPt, legPt, kneeJ, ankleJ,
} from './rig';
import { autoCell, lc } from './util';
import { warpPoint } from '../geo/warp';

const SYS = 'muscular' as const;

export interface Fiber {
  p: V3[];
  r: [number, number, number];
  b?: number;
  depth?: number;
  g?: number;
  noConform?: boolean;
  /** custom radius profile over t in 0..1 (overrides r/b) */
  rf?: (t: number) => number;
  n?: number;
}

function prof(t: number, r: [number, number, number], b: number) {
  return t < b ? r[0] + (r[1] - r[0]) * smooth(t / b) : r[1] + (r[2] - r[1]) * smooth((t - b) / (1 - b));
}

type Opt = { conform?: number; k?: number; kg?: number; div?: number; cell?: number; tissue?: Tissue };

export function buildMuscle(fibers: Fiber[], o: Opt): Geo {
  const segs: [V3, V3][] = [];
  const fs: FSeg[] = [];
  fibers.forEach((f, fi) => {
    const n = f.n ?? Math.max(7, f.p.length * 3);
    const pts = spline(f.p, n);
    const b = f.b ?? 0.5;
    const rr = pts.map((_, i) => (f.rf ? f.rf(i / (n - 1)) : prof(i / (n - 1), f.r, b)));
    const depth0 = f.depth ?? o.conform;
    const depth = depth0 !== undefined ? depth0 + 0.0012 : undefined;
    let Q = depth !== undefined && !f.noConform ? pts.map((p, i) => conform(p, depth + rr[i])) : pts;
    if (depth !== undefined && !f.noConform) {
      Q = Q.map((p, i) => (i === 0 || i === Q.length - 1 ? p : lerp(p, lerp(Q[i - 1], Q[i + 1], 0.5), 0.5)));
      Q = Q.map((p, i) => conform(p, depth + rr[i]));
    }
    const g = f.g ?? 0;
    for (let i = 0; i < Q.length - 1; i++) {
      segs.push([Q[i], Q[i + 1]]);
      fs.push({ a: Q[i], b: Q[i + 1], ra: rr[i], rb: rr[i + 1], f: fi, g });
    }
  });
  fs.sort((x, y) => x.g - y.g || x.f - y.f);
  const shape = segField(fs, 0.0015, o.k ?? 0.008, o.kg ?? 0.0015);
  const geo = meshShape(shape, o.cell ?? autoCell(shape, o.div ?? 36, 0.0025, 0.005));
  const nv = geo.pos.length / 3;
  const fd = new Float32Array(nv * 3);
  const dirs = segs.map(([a, b]) => norm(sub(b, a)));
  for (let i = 0; i < nv; i++) {
    const p: V3 = [geo.pos[i * 3], geo.pos[i * 3 + 1], geo.pos[i * 3 + 2]];
    let best = 1e9, bi = 0;
    for (let s = 0; s < segs.length; s++) {
      const [a, b] = segs[s];
      const ab = sub(b, a), ap = sub(p, a);
      const t = Math.max(0, Math.min(1, dot(ap, ab) / (dot(ab, ab) || 1)));
      const q = add(a, mul(ab, t));
      const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
      if (d2 < best) { best = d2; bi = s; }
    }
    fd[i * 3] = dirs[bi][0]; fd[i * 3 + 1] = dirs[bi][1]; fd[i * 3 + 2] = dirs[bi][2];
  }
  geo.attrs = { ...(geo.attrs ?? {}), fdir: { data: fd, size: 3 } };
  return geo;
}

function M(id: string, name: string, parent: string, desc: string, fibers: () => Fiber[], o: Opt = {}) {
  P({ id, name, parent, system: SYS, tissue: o.tissue ?? 'muscle', desc, build: () => buildMuscle(fibers(), o) });
}

const X = (s: Side, p: V3): V3 => [p[0] * s, p[1], p[2]];
/** procedural-space point that the landmark warp maps onto the real-body point t (fixed-point inverse; the warp is smooth and near-identity locally) */
const unwarp = (t: V3): V3 => {
  let x: V3 = [t[0], t[1], t[2]];
  for (let i = 0; i < 40; i++) { const w = warpPoint(x); x = [x[0] + t[0] - w[0], x[1] + t[1] - w[1], x[2] + t[2] - w[2]]; }
  return x;
};
const path = (s: Side, pts: V3[], r: [number, number, number], extra: Partial<Fiber> = {}): Fiber => ({ p: pts.map((p) => X(s, p)), r, ...extra });
type R3 = [number, number, number];

/** ray-march the skin along z to find the surface at (x, y) */
function surfZ(x: number, y: number, dir: 1 | -1): number {
  const S = skinShape();
  let z = dir * 0.22;
  for (let i = 0; i < 80; i++) {
    if (S.d(x, y, z) < 0) {
      let a = z + dir * 0.004, b = z;
      for (let k = 0; k < 7; k++) { const m = (a + b) / 2; if (S.d(x, y, m) < 0) b = m; else a = m; }
      return b;
    }
    z -= dir * 0.004;
  }
  return 0;
}

type C2 = [number, number] | V3;
function samp(c: C2[], u: number): [number, number, number | undefined] {
  const L: number[] = [0];
  for (let i = 1; i < c.length; i++) L.push(L[i - 1] + Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
  const d = u * L[L.length - 1];
  let i = 1;
  while (i < c.length - 1 && L[i] < d) i++;
  const f = (d - L[i - 1]) / (L[i] - L[i - 1] || 1);
  const a = c[i - 1], b = c[i];
  const za = a[2], zb = b[2];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, za !== undefined && zb !== undefined ? za + (zb - za) * f : za !== undefined && f < 0.5 ? za : zb !== undefined && f >= 0.5 ? zb : undefined];
}

/** Sheet of fibres running from origin curve O to insertion curve I (left-side coordinates). Face: 1 front, -1 back. */
function sheet(s: Side, face: 1 | -1, O: C2[], I: C2[], nf: number, r: R3, extra: Partial<Fiber> = {}, via = 5): Fiber[] {
  const out: Fiber[] = [];
  for (let j = 0; j < nf; j++) {
    const u = nf === 1 ? 0.5 : j / (nf - 1);
    const a = samp(O, u), b = samp(I, u);
    const za = a[2] ?? surfZ(a[0], a[1], face), zb = b[2] ?? surfZ(b[0], b[1], face);
    const p: V3[] = [];
    for (let q = 0; q < via; q++) {
      const t = q / (via - 1);
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const z = a[2] === undefined && b[2] === undefined ? surfZ(x, y, face) : za + (zb - za) * t;
      p.push([x * s, y, z]);
    }
    out.push({ p, r, ...extra });
  }
  return out;
}

/** Ribbon of parallel fibres around an axis, spread along `hint` (side-final coordinates). */
function rib(axis: V3[], hint: V3, w: R3, r: R3, extra: Partial<Fiber> = {}): Fiber[] {
  const m = 12;
  const pts = spline(axis, m);
  const w1 = Math.max(w[0], w[1], w[2]);
  const nf = Math.max(1, Math.round((2 * w1) / (Math.max(r[1], 0.002) * 0.95)) + 1);
  const b = extra.b ?? 0.5;
  const out: Fiber[] = [];
  for (let j = 0; j < nf; j++) {
    const u = nf === 1 ? 0 : (j / (nf - 1)) * 2 - 1;
    const p = pts.map((q, i) => add(q, mul(hint, u * prof(i / (m - 1), w, b))));
    out.push({ p, r: r.map((v) => v * (1 - 0.3 * u * u)) as R3, ...extra });
  }
  return out;
}
const ribL = (s: Side, axis: V3[], hint: V3, w: R3, r: R3, extra: Partial<Fiber> = {}) => rib(axis.map((p) => X(s, p)), X(s, hint), w, r, extra);

/** tendon tube hugging the skin at a depth */
function tt(pts: V3[], r: number, depth?: number, ell: [number, number] = [1, 0.55], taper = 0): Geo {
  const sp = spline(pts, Math.max(8, pts.length * 5));
  const Q = depth === undefined ? sp : sp.map((p) => conform(p, depth + r * ell[1]));
  return tube(Q, { r: (t) => r * (1 - taper * t), ellipse: ell, radial: 10, raw: true });
}
function T(id: string, name: string, desc: string, geo: () => Geo, tissue: Tissue = 'tendon') {
  P({ id, name, parent: 'mus.tendons', system: SYS, tissue, desc, build: geo });
}

export function defineMuscles() {
  G('muscular', 'Muscular System', undefined, SYS, 'Over 600 skeletal muscles that move the skeleton, maintain posture and generate heat.');
  G('mus.head', 'Muscles of head & neck', 'muscular', SYS, 'Muscles of mastication, facial expression and the neck.');
  G('mus.trunk', 'Muscles of the trunk', 'muscular', SYS, 'Thoracic, abdominal and back muscles.');
  G('mus.tendons', 'Tendons & aponeuroses', 'muscular', SYS, 'Dense collagenous cords transmitting muscle force to bone.');

  M('mus.orbicularis_oris', 'Orbicularis oris', 'mus.head', 'Sphincter muscle encircling the mouth; closes and protrudes the lips.', () => {
    const pts: V3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push([Math.cos(a) * 0.026, 1.58 + Math.sin(a) * 0.0145, 0.092]);
    }
    return [{ p: pts, r: [0.0028, 0.0028, 0.0028], depth: 0.0018 }];
  }, { cell: 0.0018 });
  M('mus.procerus', 'Procerus', 'mus.head', 'Small pyramidal muscle over the nasal bridge; draws the brows down.', () => [path(1, [[0, 1.662, 0.098], [0, 1.676, 0.098], [0, 1.69, 0.094]], [0.0022, 0.0028, 0.0022], { depth: 0.0012 })], { cell: 0.0013 });

  for (const s of SIDES) {
    const S = sid(s), N = sideName(s), ln = lc(N);
    const Xs = (ps: V3[]) => ps.map((p) => X(s, p));
    // ------------------------------------------------ head & neck
    M(`mus.temporalis.${S}`, `${N} temporalis`, 'mus.head', 'Fan-shaped muscle of mastication over the temple; elevates and retracts the mandible.', () =>
      sheet(s, 1, [[0.064, 1.705, 0.035], [0.072, 1.713, 0.008], [0.073, 1.706, -0.02], [0.068, 1.69, -0.045]], [[0.058, 1.626, 0.034], [0.062, 1.625, 0.016], [0.066, 1.625, 0.004], [0.066, 1.625, -0.002]], 13, [0.0025, 0.0045, 0.003]), { conform: 0.0035, k: 0.004 });
    M(`mus.masseter.${S}`, `${N} masseter`, 'mus.head', 'Powerful quadrangular chewing muscle from the zygomatic arch to the mandibular ramus — one of the strongest muscles by weight.', () =>
      sheet(s, 1, [[0.054, 1.624, 0.05], [0.058, 1.622, 0.036], [0.062, 1.621, 0.022]], [[0.045, 1.566, 0.03], [0.05, 1.565, 0.015], [0.053, 1.57, 0.002]], 9, [0.004, 0.0055, 0.0045]), { conform: 0.003, k: 0.004 });
    M(`mus.frontalis.${S}`, `${N} frontalis`, 'mus.head', 'Frontal belly of occipitofrontalis: raises the eyebrows and wrinkles the forehead.', () =>
      sheet(s, 1, [[0.003, 1.742, 0.062], [0.018, 1.743, 0.06], [0.03, 1.74, 0.055], [0.044, 1.733, 0.048]], [[0.003, 1.678, 0.09], [0.018, 1.678, 0.089], [0.03, 1.678, 0.086], [0.044, 1.676, 0.08]], 9, [0.0022, 0.0028, 0.0022]), { conform: 0.0022, k: 0.004, cell: 0.0016 });
    M(`mus.occipitalis.${S}`, `${N} occipitalis`, 'mus.head', 'Occipital belly of occipitofrontalis: draws the scalp backwards.', () =>
      sheet(s, -1, [[0.003, 1.632], [0.035, 1.634], [0.062, 1.626]], [[0.003, 1.688], [0.035, 1.684], [0.062, 1.668]], 8, [0.002, 0.0027, 0.002]), { conform: 0.0022, k: 0.004, cell: 0.0016 });
    M(`mus.orbicularis_oculi.${S}`, `${N} orbicularis oculi`, 'mus.head', 'Sphincter of the eyelids responsible for blinking and squinting.', () => {
      const e = HEAD.eye(s);
      const pts: V3[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        pts.push([e[0] + Math.cos(a) * 0.0185, e[1] + Math.sin(a) * 0.015, e[2] + 0.012]);
      }
      return [{ p: pts, r: [0.0022, 0.0022, 0.0022], depth: 0.003 }];
    }, { cell: 0.0015 });
    M(`mus.zygomaticus.${S}`, `${N} zygomaticus major`, 'mus.head', 'Draws the angle of the mouth upward and outward — the smiling muscle.', () => [path(s, [[0.053, 1.628, 0.056], [0.04, 1.6, 0.075], [0.026, 1.579, 0.088]], [0.002, 0.0032, 0.002], { depth: 0.0024 })], { cell: 0.0014 });
    M(`mus.zygomaticus_minor.${S}`, `${N} zygomaticus minor`, 'mus.head', 'Raises the upper lip.', () => [path(s, [[0.044, 1.632, 0.066], [0.034, 1.61, 0.082], [0.02, 1.594, 0.093]], [0.0015, 0.0022, 0.0015], { depth: 0.0018 })], { cell: 0.0012 });
    M(`mus.levator_labii.${S}`, `${N} levator labii superioris`, 'mus.head', 'Elevates the upper lip from the infra-orbital margin.', () => [path(s, [[0.026, 1.632, 0.086], [0.022, 1.612, 0.094], [0.015, 1.594, 0.098]], [0.0015, 0.0025, 0.0016], { depth: 0.0018 })], { cell: 0.0012 });
    M(`mus.nasalis.${S}`, `${N} nasalis`, 'mus.head', 'Compresses and flares the nostril.', () => [path(s, [[0.02, 1.618, 0.088], [0.014, 1.632, 0.102], [0.006, 1.64, 0.104]], [0.0015, 0.0022, 0.0015], { depth: 0.0012 })], { cell: 0.0012 });
    M(`mus.corrugator.${S}`, `${N} corrugator supercilii`, 'mus.head', 'Draws the eyebrows together and downward.', () => [path(s, [[0.01, 1.678, 0.094], [0.022, 1.686, 0.09], [0.036, 1.688, 0.084]], [0.0015, 0.0022, 0.0015], { depth: 0.0012 })], { cell: 0.0012 });
    M(`mus.depressor_anguli.${S}`, `${N} depressor anguli oris`, 'mus.head', 'Pulls the corner of the mouth down.', () => [path(s, [[0.034, 1.54, 0.068], [0.03, 1.56, 0.082], [0.026, 1.578, 0.09]], [0.002, 0.0032, 0.0018], { depth: 0.0018 })], { cell: 0.0013 });
    M(`mus.depressor_labii.${S}`, `${N} depressor labii inferioris`, 'mus.head', 'Pulls the lower lip down.', () => [path(s, [[0.022, 1.545, 0.076], [0.016, 1.558, 0.09], [0.01, 1.57, 0.096]], [0.0018, 0.0028, 0.0018], { depth: 0.0018 })], { cell: 0.0013 });
    M(`mus.mentalis.${S}`, `${N} mentalis`, 'mus.head', 'Raises and protrudes the lower lip, wrinkling the chin.', () => [path(s, [[0.008, 1.556, 0.092], [0.006, 1.546, 0.1], [0.004, 1.542, 0.098]], [0.002, 0.003, 0.0022], { depth: 0.0016 })], { cell: 0.0013 });
    M(`mus.buccinator.${S}`, `${N} buccinator`, 'mus.head', 'Cheek muscle that compresses the cheek against the teeth.', () =>
      rib(Xs([[0.052, 1.585, 0.034], [0.04, 1.585, 0.062], [0.028, 1.58, 0.084]]), [0, 1, 0], [0.004, 0.008, 0.004], [0.003, 0.0045, 0.003], { depth: 0.007 }), { cell: 0.0016 });
    M(`mus.scm.${S}`, `${N} sternocleidomastoid`, 'mus.head', 'Two-headed neck muscle from sternum and clavicle to the mastoid process; rotates and flexes the head.', () => [
      path(s, [[0.018, 1.45, 0.068], [0.03, 1.5, 0.045], [0.04, 1.54, 0.025], [0.058, 1.598, -0.024]], [0.0045, 0.0085, 0.005], { depth: 0.0048, b: 0.5 }),
      path(s, [[0.045, 1.454, 0.06], [0.045, 1.52, 0.03], [0.058, 1.596, -0.026]], [0.0035, 0.007, 0.004], { depth: 0.0052 }),
    ], { k: 0.006 });
    M(`mus.platysma.${S}`, `${N} platysma`, 'mus.head', 'Thin subcutaneous sheet of the neck from the chest fascia to the mandible and lower face; tenses the skin of the neck.', () =>
      sheet(s, 1, [[0.1, 1.43], [0.07, 1.448], [0.04, 1.455], [0.015, 1.46]], [[0.06, 1.555], [0.048, 1.56], [0.03, 1.558], [0.008, 1.55]], 15, [0.0011, 0.0013, 0.0011], {}, 4), { conform: 0.0012, k: 0.002, cell: 0.0014 });
    M(`mus.sternohyoid.${S}`, `${N} sternohyoid`, 'mus.head', 'Infrahyoid strap muscle that depresses the hyoid bone.', () => [path(s, [[0.008, 1.452, 0.066], [0.01, 1.49, 0.05], [0.007, 1.526, 0.042]], [0.0028, 0.0042, 0.0028], { depth: 0.003 })], { cell: 0.0014 });
    M(`mus.omohyoid.${S}`, `${N} omohyoid`, 'mus.head', 'Slender two-bellied strap muscle from the scapula to the hyoid bone.', () => [path(s, [[0.066, 1.436, -0.084], [0.07, 1.46, -0.02], [0.05, 1.485, 0.03], [0.026, 1.505, 0.044], [0.012, 1.525, 0.042]], [0.0022, 0.0036, 0.0022], { depth: 0.004 })], { cell: 0.0015 });
    M(`mus.scalenes.${S}`, `${N} scalene muscles`, 'mus.head', 'Anterior, middle and posterior scalenes from the cervical spine to the first two ribs; elevate the ribs and flex the neck.', () => [
      path(s, [[0.022, 1.52, 0.002], [0.034, 1.48, 0.024], [0.045, 1.446, 0.036]], [0.0035, 0.0055, 0.0035], { depth: 0.014 }),
      path(s, [[0.026, 1.52, -0.012], [0.04, 1.48, 0.0], [0.052, 1.447, 0.008]], [0.0035, 0.006, 0.0035], { depth: 0.014 }),
    ], { k: 0.005 });
    M(`mus.levator_scap.${S}`, `${N} levator scapulae`, 'mus.head', 'Elevates the scapula; runs from the upper cervical vertebrae to the superior angle of the scapula.', () =>
      rib(Xs([[0.032, 1.56, -0.04], [0.05, 1.5, -0.07], [0.066, 1.436, -0.085]]), X(s, [1, 0, 0]), [0.003, 0.004, 0.003], [0.0035, 0.0055, 0.0035], { depth: 0.012 }), { k: 0.005 });
    M(`mus.splenius.${S}`, `${N} splenius capitis`, 'mus.head', 'Deep neck extensor passing from the nuchal ligament to the mastoid process.', () =>
      rib(Xs([[0.012, 1.44, -0.09], [0.035, 1.52, -0.075], [0.056, 1.595, -0.04]]), X(s, [1, 0, 0]), [0.008, 0.01, 0.004], [0.0035, 0.0055, 0.003], { depth: 0.012 }), { k: 0.005 });
    M(`mus.extraocular.${S}`, `${N} extraocular muscles`, 'mus.head', 'Four rectus and two oblique muscles that move the eyeball, converging on a common tendinous ring at the orbital apex.', () => {
      const e = HEAD.eye(s);
      const apex = add(e, [-s * 0.008, -0.002, -0.032]);
      const r = HEAD.eyeR;
      const tgt: V3[] = [[0, r * 0.9, 0.004], [0, -r * 0.9, 0.004], [r * 0.9, 0, 0.004], [-r * 0.9, 0, 0.004]];
      return tgt.map((t) => ({ p: [apex, lerp(apex, add(e, t), 0.6), add(e, t)], r: [0.0012, 0.0022, 0.0012] as R3, noConform: true }));
    }, { k: 0.002 });

    // ------------------------------------------------ trunk anterior
    M(`mus.pec_major.${S}`, `${N} pectoralis major`, 'mus.trunk', 'Thick fan-shaped chest muscle; adducts, flexes and medially rotates the humerus.', () =>
      sheet(s, 1, [[0.045, 1.447], [0.016, 1.428], [0.012, 1.39], [0.012, 1.34], [0.016, 1.29], [0.04, 1.252], [0.07, 1.24]], [[0.17, 1.39, 0.03], [0.172, 1.376, 0.028], [0.172, 1.362, 0.026]], 24, [0.0035, 0.0085, 0.0045], { depth: 0.0045 }, 6), { k: 0.01 });
    M(`mus.pec_minor.${S}`, `${N} pectoralis minor`, 'mus.trunk', 'Deep triangular muscle beneath pectoralis major; stabilises the scapula against the thorax.', () =>
      sheet(s, 1, [[0.075, 1.36], [0.088, 1.33], [0.1, 1.3]], [[0.14, 1.418, 0.022], [0.142, 1.42, 0.024]], 4, [0.004, 0.006, 0.003], { depth: 0.02 }), { k: 0.008 });
    M(`mus.serratus.${S}`, `${N} serratus anterior`, 'mus.trunk', 'Saw-toothed muscle from the upper eight ribs to the scapula; protracts the scapula ("boxer\'s muscle").', () =>
      [1.385, 1.355, 1.325, 1.295, 1.265, 1.235, 1.205, 1.18].map((y, i) => path(s, [[0.104 + i * 0.006, y - 0.004, 0.066 - i * 0.003], [0.14 + i * 0.002, y + 0.008, 0.015], [0.15, y + 0.028, -0.03], [0.1, y + 0.05, -0.085]], [0.0035, 0.0058, 0.0035], { depth: 0.0045 })), { k: 0.003 });
    M(`mus.rectus_abd.${S}`, `${N} rectus abdominis`, 'mus.trunk', 'The "six-pack": a long strap muscle segmented by tendinous intersections; flexes the trunk.', () => {
      const ys = [0.885, 0.94, 0.99, 1.03, 1.075, 1.115, 1.155, 1.2, 1.255];
      const ints = [0.99, 1.075, 1.155];
      const f: Fiber[] = [];
      for (let j = 0; j < 5; j++) {
        const u = j / 4;
        const pts: V3[] = ys.map((y) => {
          const t = (y - 0.885) / (1.255 - 0.885);
          const lo = 0.006 + 0.002 * t, hi = 0.03 + 0.032 * t;
          const x = lo + (hi - lo) * u;
          return [x * s, y, surfZ(x, y, 1)];
        });
        const wid = (y: number) => 0.0062 + 0.0022 * ((y - 0.885) / 0.37);
        f.push({
          p: pts, r: [0.006, 0.0075, 0.006], n: 40, depth: 0.0048,
          rf: (t) => {
            const y = 0.885 + t * 0.37;
            let dip = 0;
            for (const iy of ints) dip = Math.max(dip, Math.exp(-(((y - iy) / 0.0045) ** 2)));
            const bulge = 1 + 0.12 * Math.sin(((y - 0.885) / 0.37) * Math.PI * 4 - 0.4);
            const end = Math.min(1, t * 9, (1 - t) * 9);
            return wid(y) * (1 - 0.34 * dip) * bulge * (0.55 + 0.45 * smooth(end)) * (1 - 0.2 * Math.abs(u - 0.5) * 2);
          },
        });
      }
      return f;
    }, { k: 0.006 });
    M(`mus.ext_oblique.${S}`, `${N} external oblique`, 'mus.trunk', 'Broad superficial abdominal muscle whose fibres run inferomedially; compresses the abdomen and rotates the trunk.', () =>
      sheet(s, 1, [[0.118, 1.3], [0.134, 1.25], [0.143, 1.19], [0.147, 1.13], [0.143, 1.075], [0.134, 1.045]], [[0.06, 1.215], [0.062, 1.14], [0.07, 1.06], [0.09, 1.0], [0.112, 0.995], [0.128, 1.028]], 22, [0.003, 0.0055, 0.004], { depth: 0.0048 }, 6), { k: 0.008 });
    P({
      id: `mus.intercostal.${S}`, name: `${N} intercostal muscles`, parent: 'mus.trunk', system: SYS, tissue: 'muscle',
      desc: 'Thin layers of muscle filling the spaces between adjacent ribs; elevate and depress the ribs during respiration.',
      build: () => {
        const list = [];
        for (let i = 1; i <= 10; i++) {
          const a = spline(ribPaths(s, i)[0].slice(2), 16);
          const b = spline(ribPaths(s, i + 1)[0].slice(2), 16);
          const mid = a.map((p, k) => lerp(p, b[k], 0.5));
          const gap = Math.max(0.004, Math.abs(a[8][1] - b[8][1]) * 0.42);
          list.push(tube(mid, { r: gap, ellipse: [1, 0.12], up: [0, 1, 0], radial: 10, seg: 0.005 }));
        }
        return merge(list);
      },
    });
    M(`mus.int_oblique.${S}`, `${N} internal oblique`, 'mus.trunk', 'Middle layer of the abdominal wall; its fibres run superomedially, perpendicular to the external oblique.', () =>
      sheet(s, 1, [[0.146, 1.05], [0.132, 1.03], [0.112, 1.006], [0.092, 0.996]], [[0.142, 1.2], [0.112, 1.178], [0.078, 1.1], [0.062, 1.03]], 12, [0.0035, 0.0055, 0.004], { depth: 0.017 }), { k: 0.008 });
    M(`mus.quad_lumb.${S}`, `${N} quadratus lumborum`, 'mus.trunk', 'Deep posterior abdominal wall muscle between the iliac crest and the twelfth rib.', () =>
      rib(Xs([[0.07, 1.045, -0.075], [0.062, 1.12, -0.08], [0.052, 1.2, -0.085]]), X(s, [1, 0, 0]), [0.004, 0.006, 0.004], [0.005, 0.007, 0.005], { depth: 0.032 }), { k: 0.005 });

    // ------------------------------------------------ back
    M(`mus.trapezius.${S}`, `${N} trapezius`, 'mus.trunk', 'Large diamond-shaped back muscle that elevates, retracts and rotates the scapula.', () =>
      sheet(s, -1, [[0.004, 1.6], [0.004, 1.55], [0.004, 1.48], [0.004, 1.4], [0.004, 1.3], [0.004, 1.2]], [[0.14, 1.462, 0.012], [0.166, 1.462, -0.002], [0.176, 1.458, -0.024], [0.166, 1.448, -0.05], [0.14, 1.438, -0.072], [0.1, 1.412, -0.095], [0.078, 1.386, -0.106]], 26, [0.0028, 0.0052, 0.003], { depth: 0.0048 }), { k: 0.01 });
    M(`mus.latissimus.${S}`, `${N} latissimus dorsi`, 'mus.trunk', 'The broadest back muscle, from the lower spine and iliac crest to the humerus; extends, adducts and medially rotates the arm.', () =>
      sheet(s, -1, [[0.01, 1.285], [0.008, 1.24], [0.008, 1.18], [0.01, 1.12], [0.02, 1.07], [0.05, 1.045], [0.09, 1.042], [0.125, 1.05]], [[0.158, 1.355, -0.034], [0.162, 1.352, -0.036], [0.165, 1.348, -0.04]], 22, [0.003, 0.0058, 0.005], { depth: 0.0046 }), { k: 0.01 });
    M(`mus.infraspinatus.${S}`, `${N} infraspinatus`, 'mus.trunk', 'Rotator cuff muscle in the infraspinous fossa; laterally rotates the arm.', () =>
      sheet(s, -1, [[0.078, 1.382], [0.08, 1.345], [0.086, 1.305], [0.1, 1.285]], [[0.172, 1.408, -0.036], [0.184, 1.404, -0.03], [0.188, 1.396, -0.03]], 11, [0.004, 0.0075, 0.0045], { depth: 0.0085 }), { k: 0.01 });
    M(`mus.supraspinatus.${S}`, `${N} supraspinatus`, 'mus.trunk', 'Rotator cuff muscle in the supraspinous fossa that initiates arm abduction.', () =>
      rib(Xs([[0.08, 1.425, -0.092], [0.12, 1.44, -0.07], [0.172, 1.44, -0.03]]), [0, 1, 0], [0.006, 0.008, 0.004], [0.0035, 0.0055, 0.003], { depth: 0.014 }), { k: 0.006 });
    M(`mus.teres_minor.${S}`, `${N} teres minor`, 'mus.trunk', 'Rotator cuff muscle on the lateral border of the scapula; laterally rotates the arm.', () => [
      path(s, [[0.1, 1.3, -0.1], [0.14, 1.352, -0.078], [0.182, 1.398, -0.034]], [0.0035, 0.0048, 0.0035], { depth: 0.0075 })], { k: 0.005 });
    M(`mus.teres_major.${S}`, `${N} teres major`, 'mus.trunk', 'Thick muscle from the inferior angle of the scapula to the humerus; adducts and medially rotates the arm.', () => [
      path(s, [[0.094, 1.272, -0.102], [0.135, 1.32, -0.07], [0.165, 1.36, -0.03]], [0.006, 0.0085, 0.005], { depth: 0.0048 }),
      path(s, [[0.1, 1.28, -0.102], [0.14, 1.328, -0.07], [0.168, 1.365, -0.03]], [0.005, 0.0075, 0.004], { depth: 0.0048 })], { k: 0.006 });
    M(`mus.subscapularis.${S}`, `${N} subscapularis`, 'mus.trunk', 'Large rotator cuff muscle filling the subscapular fossa; medially rotates the arm.', () =>
      sheet(s, 1, [[0.09, 1.32, -0.062], [0.1, 1.37, -0.065], [0.11, 1.4, -0.06]], [[0.162, 1.395, -0.005], [0.162, 1.39, -0.0], [0.16, 1.385, 0.0]], 6, [0.004, 0.006, 0.004], { noConform: true }), { k: 0.008 });
    M(`mus.rhomboid.${S}`, `${N} rhomboids`, 'mus.trunk', 'Rhomboid major and minor: retract and elevate the scapula (deep to trapezius).', () =>
      sheet(s, -1, [[0.004, 1.47], [0.004, 1.42], [0.004, 1.37], [0.004, 1.34]], [[0.066, 1.425], [0.072, 1.385], [0.078, 1.335], [0.086, 1.285]], 10, [0.0028, 0.0045, 0.003], { depth: 0.012 }), { k: 0.006 });
    M(`mus.erector.${S}`, `${N} erector spinae`, 'mus.trunk', 'Iliocostalis, longissimus and spinalis columns running along the spine; extend and laterally flex the vertebral column.', () =>
      [0.014, 0.028, 0.042, 0.056].map((x) => {
        const ys = [0.975, 1.08, 1.2, 1.32, 1.43, 1.52];
        const xs = [x, x, x, x * 0.92, x * 0.75, x * 0.45];
        return { p: ys.map((y, k) => [xs[k] * s, y, surfZ(xs[k], y, -1)] as V3), r: [0.004, 0.0085, 0.0035] as R3, depth: 0.0105, b: 0.35 };
      }), { k: 0.008 });
    T(`ten.thoracolumbar.${S}`, `${N} thoracolumbar fascia`, 'Broad tendinous sheet covering the erector spinae of the lower back; anchors the latissimus dorsi to the spine and pelvis.', () =>
      buildMuscle(sheet(s, -1, [[0.003, 1.2], [0.003, 1.15], [0.003, 1.1], [0.003, 1.05], [0.012, 1.0]], [[0.052, 1.24], [0.062, 1.15], [0.07, 1.08], [0.075, 1.03], [0.06, 0.99]], 13, [0.0012, 0.0014, 0.0012], { depth: 0.0032 }), { k: 0.002, cell: 0.0018 }));
    T(`ten.rectus_insc.${S}`, `${N} tendinous intersections`, 'Transverse fibrous bands that divide the rectus abdominis into its segments.', () =>
      merge([0.99, 1.075, 1.155].map((y) => tt([0.006, 0.03, 0.06].map((x) => [x * s, y, surfZ(x, y, 1)] as V3), 0.0016, 0.0042, [1, 0.5]))));

    // ------------------------------------------------ upper limb
    const up = G(`mus.upper.${S}`, `Muscles of ${ln} upper limb`, 'muscular', SYS, `Shoulder, arm, forearm and hand muscles of the ${ln} side.`);
    const AP = (t: number, l = 0, f = 0) => armPt(s, t, l, f);
    const FP = (t: number, l = 0, f = 0) => forePt(s, t, l, f);
    const hA = latOf(s, armDir(s)), hF = latOf(s, foreDir(s));
    M(`mus.deltoid.${S}`, `${N} deltoid`, up, 'Triangular muscle capping the shoulder; the principal abductor of the arm.', () => {
      const sj = shoulderJ(s);
      const ins = AP(0.42, 0.012, 0.0);
      const O: C2[] = [[0.126, 1.46, 0.04], [0.152, 1.466, 0.026], [0.178, 1.466, 0.004], [0.19, 1.46, -0.018], [0.17, 1.45, -0.05], [0.142, 1.44, -0.07]];
      const out: Fiber[] = [];
      for (let j = 0; j < 15; j++) {
        const q = samp(O, j / 14);
        const o = X(s, [q[0], q[1], q[2] as number]);
        const mid = add(sj, mul(norm(sub(lerp(o, ins, 0.35), sj)), 0.06));
        out.push({ p: [o, mid, ins], r: [0.0055, 0.0088, 0.0045], depth: 0.0062 });
      }
      return out;
    }, { k: 0.01 });
    M(`mus.biceps.${S}`, `${N} biceps brachii`, up, 'Two-headed arm flexor; flexes the elbow and supinates the forearm.', () =>
      rib([AP(0.12, 0.004, 0.022), AP(0.5, 0.006, 0.03), AP(0.92, 0.002, 0.022), FP(0.07, 0.008, 0.014)], hA, [0.004, 0.011, 0.003], [0.0035, 0.0072, 0.003], { depth: 0.0046, b: 0.45 }), { k: 0.006 });
    M(`mus.brachialis.${S}`, `${N} brachialis`, up, 'Deep to biceps; the primary flexor of the elbow.', () =>
      rib([AP(0.5, 0.0, 0.012), AP(0.8, 0.0, 0.018), FP(0.08, 0.0, 0.01)], hA, [0.014, 0.017, 0.008], [0.005, 0.0075, 0.004], { depth: 0.011 }));
    M(`mus.coracobrachialis.${S}`, `${N} coracobrachialis`, up, 'Flexes and adducts the arm; runs from the coracoid process to the medial humerus.', () => [
      { p: [X(s, [0.14, 1.418, 0.024]), AP(0.2, -0.016, 0.008), AP(0.55, -0.02, 0.004)], r: [0.003, 0.0055, 0.003], depth: 0.009 }]);
    M(`mus.triceps.${S}`, `${N} triceps brachii`, up, 'Three-headed muscle on the back of the arm; extends the elbow.', () => [
      ...rib([AP(0.1, -0.005, -0.025), AP(0.5, -0.01, -0.032), AP(1.0, 0.0, -0.03)], hA, [0.006, 0.011, 0.006], [0.005, 0.0075, 0.005], { depth: 0.0046, b: 0.45, g: 0 }),
      ...rib([AP(0.25, 0.022, -0.016), AP(0.6, 0.018, -0.026), AP(1.0, 0.004, -0.03)], hA, [0.003, 0.006, 0.003], [0.004, 0.0065, 0.004], { depth: 0.0046, g: 1 }),
      ...rib([AP(0.5, -0.02, -0.012), AP(0.8, -0.014, -0.022), AP(1.0, -0.004, -0.03)], hA, [0.003, 0.005, 0.003], [0.004, 0.0065, 0.004], { depth: 0.0075, g: 2 }),
    ], { k: 0.008, kg: 0.004 });
    M(`mus.anconeus.${S}`, `${N} anconeus`, up, 'Small triangular muscle behind the elbow; assists triceps in extension.', () =>
      rib([AP(1.0, 0.03, -0.01), FP(0.08, 0.016, -0.026), FP(0.2, -0.006, -0.03)], hF, [0.003, 0.005, 0.002], [0.003, 0.0045, 0.0025], { depth: 0.0046 }));
    M(`mus.brachioradialis.${S}`, `${N} brachioradialis`, up, 'Superficial lateral forearm muscle; flexes the elbow in mid-pronation.', () =>
      rib([AP(0.7, 0.03, 0.0), FP(0.06, 0.03, 0.01), FP(0.35, 0.027, 0.012), FP(0.6, 0.022, 0.006)], hF, [0.002, 0.004, 0.001], [0.004, 0.0085, 0.0022], { depth: 0.0042, b: 0.3 }));
    M(`mus.pron_teres.${S}`, `${N} pronator teres`, up, 'Oblique muscle crossing the proximal forearm; pronates the forearm.', () =>
      rib([FP(0.0, -0.032, 0.014), FP(0.15, -0.004, 0.026), FP(0.4, 0.022, 0.014)], hF, [0.003, 0.006, 0.002], [0.004, 0.0065, 0.003], { depth: 0.0046, b: 0.4 }));
    type FM = [string, string, string, V3[], R3, R3, number, number];
    const flexR: FM[] = [
      ['fcr', 'flexor carpi radialis', 'Flexes and abducts the wrist.', [FP(0.0, -0.025, 0.016), FP(0.2, -0.005, 0.026), FP(0.5, 0.008, 0.022), FP(0.62, 0.011, 0.018)], [0.002, 0.004, 0.001], [0.003, 0.0058, 0.0013], 0.0046, 0.35],
      ['pl', 'palmaris longus', 'Slender wrist flexor tensing the palmar aponeurosis; absent in ~14% of people.', [FP(0.0, -0.03, 0.016), FP(0.25, -0.012, 0.028), FP(0.45, -0.002, 0.022)], [0.001, 0.002, 0.001], [0.0025, 0.0042, 0.001], 0.0046, 0.3],
      ['fds', 'flexor digitorum superficialis', 'Flexes the middle phalanges of the four fingers.', [FP(0.0, -0.025, 0.01), FP(0.25, -0.012, 0.02), FP(0.55, -0.004, 0.018), FP(0.68, -0.004, 0.014)], [0.005, 0.009, 0.003], [0.004, 0.0065, 0.0015], 0.009, 0.35],
      ['fcu', 'flexor carpi ulnaris', 'Flexes and adducts the wrist.', [FP(0.0, -0.03, 0.004), FP(0.2, -0.028, 0.008), FP(0.55, -0.02, 0.01), FP(0.7, -0.016, 0.008)], [0.002, 0.004, 0.001], [0.0035, 0.006, 0.0013], 0.0046, 0.3],
      ['fdp', 'flexor digitorum profundus', 'Deep finger flexor acting on the distal phalanges.', [FP(0.0, -0.028, 0.0), FP(0.3, -0.008, 0.01), FP(0.72, -0.004, 0.008)], [0.005, 0.008, 0.003], [0.004, 0.0065, 0.0015], 0.02, 0.35],
      ['fpl', 'flexor pollicis longus', 'Flexes the distal phalanx of the thumb.', [FP(0.1, 0.012, 0.006), FP(0.5, 0.012, 0.008), FP(0.8, 0.01, 0.01)], [0.001, 0.002, 0.001], [0.0028, 0.0042, 0.0015], 0.02, 0.4],
    ];
    for (const m of flexR) M(`mus.${m[0]}.${S}`, `${N} ${m[1]}`, up, m[2], () => rib(m[3], hF, m[4], m[5], { depth: m[6], b: m[7] }));
    const extR: FM[] = [
      ['ecrl', 'extensor carpi radialis longus', 'Extends and abducts the wrist.', [AP(0.9, 0.03, -0.005), FP(0.04, 0.028, -0.012), FP(0.3, 0.022, -0.012), FP(0.55, 0.014, -0.012)], [0.002, 0.004, 0.001], [0.0035, 0.006, 0.0013], 0.0046, 0.3],
      ['ecrb', 'extensor carpi radialis brevis', 'Extends the wrist; lies beneath the longus.', [FP(0.0, 0.02, -0.016), FP(0.3, 0.016, -0.02), FP(0.58, 0.01, -0.016)], [0.001, 0.002, 0.001], [0.003, 0.0055, 0.0013], 0.0075, 0.3],
      ['ed', 'extensor digitorum', 'Extends the four medial fingers.', [FP(0.0, 0.006, -0.026), FP(0.3, 0.002, -0.028), FP(0.6, 0.0, -0.02)], [0.006, 0.009, 0.004], [0.004, 0.006, 0.0015], 0.0046, 0.35],
      ['edm', 'extensor digiti minimi', 'Extends the little finger.', [FP(0.0, -0.008, -0.026), FP(0.3, -0.012, -0.026), FP(0.6, -0.014, -0.02)], [0.001, 0.002, 0.001], [0.003, 0.0045, 0.001], 0.0046, 0.3],
      ['ecu', 'extensor carpi ulnaris', 'Extends and adducts the wrist.', [FP(0.0, -0.014, -0.024), FP(0.3, -0.02, -0.02), FP(0.6, -0.02, -0.014)], [0.002, 0.003, 0.001], [0.003, 0.0055, 0.0013], 0.0046, 0.3],
      ['apl', 'abductor pollicis longus', 'Abducts and extends the thumb.', [FP(0.2, 0.004, -0.022), FP(0.45, 0.018, -0.012), FP(0.7, 0.026, -0.002)], [0.002, 0.003, 0.001], [0.003, 0.005, 0.0015], 0.0046, 0.4],
      ['epb', 'extensor pollicis brevis', 'Extends the proximal phalanx of the thumb.', [FP(0.38, 0.01, -0.02), FP(0.6, 0.024, -0.008), FP(0.82, 0.027, 0.0)], [0.001, 0.001, 0.001], [0.0022, 0.0035, 0.0012], 0.0046, 0.4],
      ['epl', 'extensor pollicis longus', 'Extends the distal phalanx of the thumb.', [FP(0.3, -0.004, -0.02), FP(0.6, 0.006, -0.018), FP(0.9, 0.014, -0.01)], [0.001, 0.001, 0.001], [0.0025, 0.004, 0.0012], 0.012, 0.4],
      ['supinator', 'supinator', 'Deep muscle wrapping the proximal radius; supinates the forearm.', [FP(0.0, 0.015, 0.002), FP(0.15, 0.03, 0.0), FP(0.24, 0.026, -0.012)], [0.002, 0.004, 0.002], [0.004, 0.005, 0.003], 0.018, 0.5],
    ];
    for (const m of extR) M(`mus.${m[0]}.${S}`, `${N} ${m[1]}`, up, m[2], () => rib(m[3], hF, m[4], m[5], { depth: m[6], b: m[7] }));
    M(`mus.thenar.${S}`, `${N} thenar muscles`, up, 'Abductor, flexor and opponens pollicis — the muscle mass at the base of the thumb.', () => [
      { p: [handPt(s, 0.025, 0.018, 0.009), handPt(s, 0.042, 0.03, 0.014), handPt(s, 0.058, 0.044, 0.018)], r: [0.004, 0.0075, 0.003], depth: 0.0028 },
      { p: [handPt(s, 0.028, 0.008, 0.008), handPt(s, 0.045, 0.024, 0.012), handPt(s, 0.06, 0.04, 0.016)], r: [0.004, 0.007, 0.003], depth: 0.003 },
      { p: [handPt(s, 0.024, 0.026, 0.006), handPt(s, 0.04, 0.036, 0.011), handPt(s, 0.056, 0.046, 0.016)], r: [0.003, 0.0055, 0.003], depth: 0.0028 },
    ], { cell: 0.0014 });
    M(`mus.hypothenar.${S}`, `${N} hypothenar muscles`, up, 'Abductor, flexor and opponens digiti minimi on the ulnar border of the palm.', () => [
      { p: [handPt(s, 0.022, -0.02, 0.006), handPt(s, 0.05, -0.03, 0.006), handPt(s, 0.08, -0.03, 0.004)], r: [0.004, 0.0065, 0.003], depth: 0.003 },
      { p: [handPt(s, 0.024, -0.014, 0.006), handPt(s, 0.05, -0.022, 0.006), handPt(s, 0.075, -0.026, 0.005)], r: [0.003, 0.005, 0.003], depth: 0.003 },
    ], { cell: 0.0014 });
    M(`mus.add_pollicis.${S}`, `${N} adductor pollicis`, up, 'Fan-shaped muscle of the thumb web that adducts the thumb.', () => [
      { p: [handPt(s, 0.04, -0.004, 0.006), handPt(s, 0.05, 0.026, 0.012), handPt(s, 0.058, 0.046, 0.016)], r: [0.003, 0.005, 0.003], depth: 0.0026 },
      { p: [handPt(s, 0.056, -0.004, 0.004), handPt(s, 0.058, 0.026, 0.01), handPt(s, 0.06, 0.044, 0.014)], r: [0.003, 0.0048, 0.003], depth: 0.0026 },
    ], { cell: 0.0014 });
    M(`mus.interossei.${S}`, `${N} dorsal interossei`, up, 'Four bipennate muscles between the metacarpals that abduct the fingers.', () => {
      const out: Fiber[] = [];
      const L = FINGERS.map((f) => f.base + 0.004);
      const tgt = [FINGERS[0].l - 0.004, FINGERS[1].l + 0.004, FINGERS[2].l + 0.004, FINGERS[3].l - 0.003];
      for (let i = 0; i < 4; i++)
        out.push({ p: [handPt(s, 0.03, L[i] - 0.007, -0.008), handPt(s, 0.056, (L[i] + tgt[i]) / 2 - 0.006, -0.0075), handPt(s, 0.084, tgt[i], -0.0065)], r: [0.0018, 0.0034, 0.0016], depth: 0.0016 });
      out.push({ p: [handPt(s, 0.026, 0.026, -0.004), handPt(s, 0.044, 0.036, 0.0), handPt(s, 0.058, 0.045, 0.012)], r: [0.002, 0.0035, 0.0018], depth: 0.0018 });
      return out;
    }, { cell: 0.0012 });
    M(`mus.lumbricals.${S}`, `${N} lumbricals`, up, 'Four small hand muscles arising from the flexor digitorum profundus tendons; flex the metacarpophalangeal joints.', () =>
      FINGERS.map((f, i) => ({ p: [handPt(s, 0.056, f.base * 0.8 + 0.002, 0.0), handPt(s, 0.074, f.l + 0.002, 0.0035), fingerJoints(s, i)[0]], r: [0.0014, 0.0025, 0.0014] as R3, noConform: true })), { cell: 0.0012 });
    T(`ten.biceps_distal.${S}`, `${N} distal biceps tendon`, 'Strong tendon anchoring biceps brachii to the radial tuberosity.', () => tt([AP(0.92, 0.002, 0.022), FP(0.07, 0.008, 0.014), FP(0.13, 0.012, 0.008)], 0.0032, 0.0035, [1, 0.5], 0.5));
    T(`ten.bicipital_apo.${S}`, `${N} bicipital aponeurosis`, 'Fibrous sheet that spreads from the biceps tendon over the flexor muscles of the forearm.', () =>
      buildMuscle(Array.from({ length: 6 }, (_, j) => ({ p: [FP(0.075, 0.006, 0.014), FP(0.12 + j * 0.005, -0.006 - j * 0.004, 0.02), FP(0.17 + j * 0.01, -0.016 - j * 0.005, 0.02)], r: [0.0012, 0.0016, 0.0008] as R3, depth: 0.0032 })), { k: 0.002, cell: 0.0014 }));
    T(`ten.triceps.${S}`, `${N} triceps tendon`, 'Common tendon of the three heads of triceps inserting on the olecranon.', () => tt([AP(0.86, 0.0, -0.032), AP(1.0, 0.0, -0.032), FP(0.03, -0.002, -0.03)], 0.0038, 0.0035, [1, 0.4]));
    T(`ten.forearm_flexors.${S}`, `${N} flexor tendons of the wrist`, 'Long tendons of the forearm flexors running toward the wrist and carpal tunnel.', () =>
      merge([
        tt([FP(0.6, 0.011, 0.018), FP(0.8, 0.013, 0.015), FP(1.0, 0.014, 0.012)], 0.0022, 0.0028),
        tt([FP(0.44, -0.002, 0.022), FP(0.75, 0.0, 0.019), FP(1.0, 0.002, 0.016)], 0.0016, 0.0028),
        tt([FP(0.68, -0.018, 0.008), FP(0.85, -0.02, 0.007), FP(1.0, -0.019, 0.005)], 0.0022, 0.0028),
        ...[0, 1, 2, 3].map((i) => tt([FP(0.66, -0.012 + i * 0.006, 0.013), FP(0.84, -0.012 + i * 0.006, 0.012), FP(1.0, -0.012 + i * 0.007, 0.011)], 0.0016, 0.0038)),
      ]));
    T(`ten.forearm_extensors.${S}`, `${N} extensor tendons of the wrist`, 'Tendons of the forearm extensors, held at the wrist by the extensor retinaculum.', () =>
      merge([
        tt([FP(0.54, 0.014, -0.012), FP(0.8, 0.018, -0.011), FP(1.0, 0.02, -0.01)], 0.0022, 0.0028),
        tt([FP(0.58, 0.01, -0.016), FP(0.8, 0.012, -0.013), FP(1.0, 0.012, -0.012)], 0.0022, 0.0028),
        tt([FP(0.6, -0.02, -0.014), FP(0.8, -0.02, -0.011), FP(1.0, -0.02, -0.008)], 0.0022, 0.0028),
        tt([FP(0.6, -0.014, -0.02), FP(0.8, -0.012, -0.015), FP(1.0, -0.012, -0.012)], 0.0014, 0.0028),
        ...[0, 1, 2, 3].map((i) => tt([FP(0.58, 0.004 - i * 0.004, -0.021), FP(0.8, 0.003 - i * 0.004, -0.016), FP(1.0, 0.0 - i * 0.004, -0.012)], 0.0016, 0.0028)),
        tt([FP(0.7, 0.026, -0.002), FP(0.9, 0.025, 0.004), FP(1.0, 0.026, 0.004)], 0.0018, 0.0028),
        tt([FP(0.9, 0.014, -0.01), FP(1.0, 0.012, -0.012)], 0.0012, 0.0028),
        tt([FP(0.6, 0.022, 0.006), FP(0.8, 0.022, 0.004), FP(1.0, 0.021, 0.0)], 0.002, 0.0028),
      ]));
    T(`ten.palmar_apo.${S}`, `${N} palmar aponeurosis`, 'Triangular fibrous sheet of the palm continuing from palmaris longus; its slips fan out to the fingers.', () =>
      merge(FINGERS.map((f) => tt([handPt(s, 0.0, 0.002, 0.009), handPt(s, 0.04, f.base * 0.7, 0.0085), handPt(s, 0.075, f.l, 0.0065)], 0.0015, 0.0022, [1, 0.4]))));

    // ------------------------------------------------ lower limb
    const low = G(`mus.lower.${S}`, `Muscles of ${ln} lower limb`, 'muscular', SYS, `Hip, thigh, leg and foot muscles of the ${ln} side.`);
    const hX: V3 = X(s, [1, 0, 0]);
    M(`mus.glut_max.${S}`, `${N} gluteus maximus`, low, 'The largest muscle in the body; extends and laterally rotates the hip.', () =>
      sheet(s, -1, [[0.09, 1.035], [0.065, 1.027], [0.042, 1.0], [0.028, 0.96], [0.022, 0.92]], [[0.139, 0.88, -0.03], [0.137, 0.862, -0.036], [0.134, 0.845, -0.042], [0.129, 0.835, -0.05], [0.125, 0.83, -0.055]], 22, [0.005, 0.014, 0.007], { depth: 0.0066 }, 6), { k: 0.012 });
    M(`mus.glut_med.${S}`, `${N} gluteus medius`, low, 'Fan-shaped hip abductor beneath the iliac crest; stabilises the pelvis when walking.', () =>
      sheet(s, -1, [[0.1, 1.047], [0.118, 1.05], [0.132, 1.04], [0.138, 1.02], [0.14, 1.0]], [[0.15, 0.935, -0.014], [0.15, 0.93, -0.012], [0.15, 0.925, -0.01]], 12, [0.0045, 0.0085, 0.005], { depth: 0.0048 }), { k: 0.01 });
    M(`mus.glut_min.${S}`, `${N} gluteus minimus`, low, 'Smallest gluteal muscle, deep to gluteus medius; abducts and medially rotates the hip.', () =>
      rib(Xs([[0.115, 1.0, -0.03], [0.135, 0.955, -0.012], [0.148, 0.925, 0.0]]), [0, 0, 1], [0.012, 0.014, 0.003], [0.004, 0.0065, 0.003], { depth: 0.022 }), { k: 0.006 });
    M(`mus.piriformis.${S}`, `${N} piriformis`, low, 'Deep lateral rotator running from the sacrum to the greater trochanter.', () => [
      path(s, [[0.03, 0.972, -0.09], [0.08, 0.95, -0.065], [0.142, 0.925, -0.03]], [0.0035, 0.007, 0.003], { depth: 0.032 })], { k: 0.005 });
    M(`mus.quad_fem.${S}`, `${N} quadratus femoris`, low, 'Deep lateral rotator of the hip between the ischial tuberosity and the femur.', () =>
      rib(Xs([[0.062, 0.875, -0.07], [0.1, 0.872, -0.055], [0.134, 0.868, -0.045]]), [0, 1, 0], [0.004, 0.006, 0.004], [0.003, 0.005, 0.003], { depth: 0.034 }), { k: 0.005 });
    M(`mus.tfl.${S}`, `${N} tensor fasciae latae`, low, 'Tenses the iliotibial tract; assists hip flexion and abduction.', () =>
      rib(Xs([[0.12, 0.985, 0.056], [0.135, 0.93, 0.042], [0.148, 0.86, 0.022]]), [0, 0, 1], [0.005, 0.009, 0.003], [0.0045, 0.0075, 0.004], { depth: 0.0046 }));
    M(`mus.sartorius.${S}`, `${N} sartorius`, low, 'The longest muscle in the body: a strap crossing the thigh from the ASIS to the medial tibia.', () =>
      rib(Xs([[0.118, 0.985, 0.064], [0.1, 0.86, 0.076], [0.072, 0.7, 0.055], [0.058, 0.565, 0.01], [0.07, 0.48, -0.002]]), hX, [0.002, 0.004, 0.002], [0.003, 0.0055, 0.0025], { depth: 0.0046 }), { k: 0.006 });
    M(`mus.rectus_fem.${S}`, `${N} rectus femoris`, low, 'Central quadriceps muscle crossing both hip and knee; extends the knee and flexes the hip.', () =>
      rib(Xs([[0.102, 0.95, 0.05], [0.106, 0.78, 0.072], [0.1, 0.62, 0.064], [0.097, 0.56, 0.054]]), hX, [0.004, 0.016, 0.004], [0.0035, 0.0065, 0.003], { depth: 0.0046, b: 0.45 }), { k: 0.008 });
    M(`mus.vastus_lat.${S}`, `${N} vastus lateralis`, low, 'The largest quadriceps component on the lateral thigh; extends the knee.', () =>
      rib(Xs([[0.135, 0.88, 0.0], [0.142, 0.72, 0.02], [0.125, 0.57, 0.03]]), [0, 0, 1], [0.012, 0.028, 0.012], [0.005, 0.0075, 0.0045], { depth: 0.0046, b: 0.45 }), { k: 0.01 });
    M(`mus.vastus_med.${S}`, `${N} vastus medialis`, low, 'Teardrop-shaped quadriceps muscle above the medial knee; stabilises the patella.', () =>
      rib(Xs([[0.075, 0.78, 0.035], [0.064, 0.64, 0.04], [0.08, 0.545, 0.044]]), hX, [0.003, 0.012, 0.008], [0.004, 0.0065, 0.004], { depth: 0.0046, b: 0.7 }), { k: 0.01 });
    M(`mus.add_longus.${S}`, `${N} adductor longus`, low, 'Fan-shaped muscle of the medial thigh; adducts the hip.', () =>
      rib(Xs([[0.025, 0.875, 0.056], [0.055, 0.78, 0.045], [0.08, 0.68, 0.015]]), [0, 0, 1], [0.003, 0.008, 0.004], [0.004, 0.006, 0.004], { depth: 0.0046 }));
    M(`mus.pectineus.${S}`, `${N} pectineus`, low, 'Flat muscle of the femoral triangle; flexes and adducts the hip.', () =>
      rib(Xs([[0.04, 0.9, 0.058], [0.055, 0.86, 0.04], [0.07, 0.82, 0.012]]), hX, [0.005, 0.006, 0.003], [0.003, 0.005, 0.003], { depth: 0.0046 }));
    M(`mus.add_brevis.${S}`, `${N} adductor brevis`, low, 'Short adductor beneath pectineus and adductor longus.', () =>
      rib(Xs([[0.025, 0.88, 0.05], [0.05, 0.81, 0.022], [0.07, 0.74, 0.0]]), [0, 0, 1], [0.004, 0.006, 0.003], [0.004, 0.006, 0.004], { depth: 0.014 }));
    M(`mus.gracilis.${S}`, `${N} gracilis`, low, 'Long thin strap of the medial thigh; adducts the hip and flexes the knee.', () =>
      rib(Xs([[0.02, 0.866, 0.04], [0.045, 0.7, 0.01], [0.06, 0.55, -0.02], [0.07, 0.48, -0.02]]), [0, 0, 1], [0.002, 0.004, 0.002], [0.0035, 0.0055, 0.002], { depth: 0.0046 }));
    M(`mus.add_magnus.${S}`, `${N} adductor magnus`, low, 'Massive adductor of the thigh with adductor and hamstring parts.', () =>
      rib(Xs([[0.045, 0.865, -0.02], [0.06, 0.75, -0.022], [0.075, 0.6, -0.015]]), [0, 0, 1], [0.012, 0.024, 0.01], [0.005, 0.007, 0.005], { depth: 0.009 }), { k: 0.01 });
    M(`mus.biceps_fem.${S}`, `${N} biceps femoris`, low, 'Lateral hamstring; flexes the knee and extends the hip.', () => [
      ...rib(Xs([[0.06, 0.862, -0.06], [0.1, 0.7, -0.062], [0.125, 0.54, -0.04]]), hX, [0.004, 0.011, 0.003], [0.0035, 0.0075, 0.003], { depth: 0.0046, g: 0 }),
      ...rib(Xs([[0.12, 0.68, -0.045], [0.126, 0.58, -0.04]]), hX, [0.004, 0.005, 0.003], [0.003, 0.005, 0.003], { depth: 0.012, g: 1 }),
    ], { k: 0.008, kg: 0.004 });
    M(`mus.semitend.${S}`, `${N} semitendinosus`, low, 'Medial hamstring with a long cord-like distal tendon.', () =>
      rib(Xs([[0.055, 0.862, -0.066], [0.075, 0.7, -0.066], [0.075, 0.56, -0.05]]), hX, [0.003, 0.005, 0.002], [0.0035, 0.0065, 0.002], { depth: 0.0046, b: 0.45 }));
    M(`mus.semimem.${S}`, `${N} semimembranosus`, low, 'Deep medial hamstring, broad and flat.', () =>
      rib(Xs([[0.06, 0.86, -0.055], [0.07, 0.68, -0.056], [0.075, 0.54, -0.04]]), hX, [0.005, 0.011, 0.005], [0.004, 0.0075, 0.003], { b: 0.65, depth: 0.009 }), { k: 0.008 });
    M(`mus.gastroc.${S}`, `${N} gastrocnemius`, low, 'Two-headed superficial calf muscle; plantarflexes the foot and flexes the knee.', () => [
      ...rib(Xs([[0.078, 0.52, -0.028], [0.079, 0.4, -0.062], [0.088, 0.275, -0.056]]), hX, [0.004, 0.011, 0.003], [0.005, 0.0075, 0.003], { b: 0.38, depth: 0.0046, g: 0 }),
      ...rib(Xs([[0.115, 0.52, -0.028], [0.112, 0.4, -0.058], [0.091, 0.275, -0.056]]), hX, [0.004, 0.01, 0.003], [0.005, 0.0072, 0.003], { b: 0.36, depth: 0.0046, g: 1 }),
    ], { k: 0.008, kg: 0.003 });
    M(`mus.soleus.${S}`, `${N} soleus`, low, 'Broad flat calf muscle deep to gastrocnemius; essential for standing and walking.', () =>
      rib(Xs([[0.1, 0.45, -0.035], [0.095, 0.3, -0.055], [0.088, 0.19, -0.05]]), hX, [0.012, 0.024, 0.008], [0.005, 0.0075, 0.004], { depth: 0.013, b: 0.4 }), { k: 0.012 });
    M(`mus.plantaris.${S}`, `${N} plantaris`, low, 'Tiny vestigial muscle with a very long slender tendon between gastrocnemius and soleus.', () => [
      path(s, [[0.115, 0.5, -0.025], [0.1, 0.42, -0.04], [0.092, 0.34, -0.05]], [0.0025, 0.0042, 0.0012], { depth: 0.014 })]);
    M(`mus.popliteus.${S}`, `${N} popliteus`, low, 'Small muscle behind the knee that unlocks the extended knee.', () =>
      rib(Xs([[0.122, 0.505, -0.012], [0.102, 0.468, -0.032], [0.085, 0.41, -0.025]]), [0, 1, 0], [0.004, 0.006, 0.004], [0.004, 0.006, 0.004], { depth: 0.02 }), { k: 0.005 });
    M(`mus.tib_ant.${S}`, `${N} tibialis anterior`, low, 'Shin muscle that dorsiflexes and inverts the foot.', () =>
      rib(Xs([[0.11, 0.46, 0.02], [0.108, 0.34, 0.03], [0.096, 0.21, 0.032]]), [0, 0, 1], [0.003, 0.006, 0.002], [0.004, 0.0085, 0.0022], { depth: 0.0046, b: 0.35 }));
    M(`mus.ehl.${S}`, `${N} extensor hallucis longus`, low, 'Extends the great toe; lies between tibialis anterior and extensor digitorum longus.', () => [
      path(s, [[0.105, 0.4, 0.022], [0.1, 0.28, 0.028], [0.094, 0.18, 0.03]], [0.002, 0.0035, 0.0012], { depth: 0.014 })]);
    M(`mus.edl.${S}`, `${N} extensor digitorum longus`, low, 'Extends the lateral four toes and dorsiflexes the foot.', () =>
      rib(Xs([[0.12, 0.45, 0.01], [0.121, 0.32, 0.022], [0.105, 0.2, 0.028]]), [0, 0, 1], [0.002, 0.004, 0.001], [0.003, 0.0055, 0.0018], { depth: 0.0046 }));
    M(`mus.fib_longus.${S}`, `${N} fibularis longus`, low, 'Lateral leg muscle that everts and plantarflexes the foot.', () =>
      rib(Xs([[0.13, 0.46, -0.01], [0.131, 0.33, -0.012], [0.124, 0.2, -0.022]]), [0, 0, 1], [0.003, 0.004, 0.001], [0.004, 0.0065, 0.002], { depth: 0.0046 }));
    M(`mus.fib_brevis.${S}`, `${N} fibularis brevis`, low, 'Everts the foot; lies beneath fibularis longus on the lateral leg.', () => [
      path(s, [[0.128, 0.32, -0.02], [0.122, 0.2, -0.028], [0.117, 0.12, -0.034]], [0.0028, 0.0045, 0.0014], { depth: 0.0075 })]);
    M(`mus.tib_post.${S}`, `${N} tibialis posterior`, low, 'Deepest calf muscle; inverts the foot and supports the medial arch.', () => [
      path(s, [[0.098, 0.45, -0.02], [0.092, 0.3, -0.02], [0.088, 0.16, -0.025]], [0.003, 0.0055, 0.0015], { depth: 0.03 })]);
    M(`mus.fdl.${S}`, `${N} flexor digitorum longus`, low, 'Deep calf muscle that flexes the lateral four toes.', () => [
      path(s, [[0.085, 0.42, -0.015], [0.082, 0.3, -0.022], [0.084, 0.15, -0.026]], [0.003, 0.005, 0.0014], { depth: 0.026 })]);
    M(`mus.fhl.${S}`, `${N} flexor hallucis longus`, low, 'Deep calf muscle that flexes the great toe.', () => [
      path(s, [[0.108, 0.4, -0.025], [0.098, 0.25, -0.03], [0.09, 0.14, -0.03]], [0.003, 0.0055, 0.0016], { depth: 0.026 })]);
    M(`mus.iliopsoas.${S}`, `${N} iliopsoas`, low, 'Psoas major and iliacus: the most powerful hip flexor, running from the lumbar spine and iliac fossa to the lesser trochanter.', () => [
      path(s, [[0.03, 1.17, -0.03], [0.046, 1.06, -0.024], [0.072, 0.95, 0.022], [0.09, 0.9, 0.03], [0.1, 0.862, -0.006]], [0.007, 0.015, 0.006], { noConform: true, b: 0.4 }),
      path(s, [[0.092, 1.02, -0.02], [0.088, 0.96, 0.02], [0.096, 0.885, 0.025]], [0.006, 0.012, 0.005], { noConform: true }),
    ], { k: 0.01 });
    // foot intrinsics
    M(`mus.abd_hallucis.${S}`, `${N} abductor hallucis`, low, 'Muscle along the medial border of the sole; abducts and flexes the great toe.', () =>
      rib([footPt(s, -0.05, -0.012, 0.03), footPt(s, 0.0, -0.026, 0.02), footPt(s, 0.05, -0.028, 0.018)], hX, [0.002, 0.003, 0.002], [0.003, 0.0055, 0.003], { depth: 0.003 }), { cell: 0.0015 });
    M(`mus.fdb.${S}`, `${N} flexor digitorum brevis`, low, 'Central muscle of the sole that flexes the lateral four toes.', () =>
      rib([footPt(s, -0.052, 0.0, 0.014), footPt(s, 0.0, 0.0, 0.01), footPt(s, 0.045, 0.0, 0.01)], hX, [0.006, 0.009, 0.007], [0.003, 0.0045, 0.003], { depth: 0.003 }), { cell: 0.0015 });
    M(`mus.abd_dig_min.${S}`, `${N} abductor digiti minimi (foot)`, low, 'Muscle along the lateral border of the sole; abducts the little toe.', () =>
      rib([footPt(s, -0.052, 0.018, 0.024), footPt(s, 0.01, 0.034, 0.016), footPt(s, 0.058, 0.037, 0.015)], hX, [0.0015, 0.002, 0.0015], [0.0028, 0.0045, 0.0026], { depth: 0.003 }), { cell: 0.0015 });
    M(`mus.edb.${S}`, `${N} extensor digitorum brevis`, low, 'Small muscle on the dorsum of the foot that extends the toes.', () =>
      rib([footPt(s, 0.0, 0.022, 0.056), footPt(s, 0.03, 0.014, 0.052), footPt(s, 0.06, 0.0, 0.046)], hX, [0.003, 0.005, 0.003], [0.0025, 0.004, 0.002], { depth: 0.0022 }), { cell: 0.0014 });

    // ------------------------------------------------ tendons (lower limb)
    T(`ten.calcaneal.${S}`, `${N} calcaneal (Achilles) tendon`, 'The thickest and strongest tendon in the body, joining gastrocnemius and soleus to the calcaneus.', () =>
      tube([conform(X(s, [0.088, 0.275, -0.056]), 0.008), conform(X(s, [0.087, 0.17, -0.06]), 0.007), conform(X(s, [0.086, 0.09, -0.07]), 0.0065), footPt(s, -0.064, 0.004, 0.03)], { r: (t) => 0.0042 + 0.0012 * t, ellipse: [0.55, 1], radial: 12 }));
    T(`ten.patellar.${S}`, `${N} patellar ligament`, 'Continuation of the quadriceps tendon from the patella to the tibial tuberosity.', () =>
      // real-body targets (BP3D app space): patellar apex -> tibial tuberosity, centreline just in front of the tibia
      tube([[0.0815, 0.4425, 0.1185], [0.0845, 0.425, 0.1185], [0.0875, 0.408, 0.1175]].map((q) => unwarp([q[0] * s, q[1], q[2]])), { r: 0.0045, ellipse: [1, 0.45], radial: 12 }));
    T(`ten.quadriceps.${S}`, `${N} quadriceps tendon`, 'Common tendon of the four quadriceps muscles inserting on the patella.', () =>
      tube([X(s, [0.098, 0.565, 0.053]), X(s, [0.097, 0.537, 0.052])], { r: 0.0055, ellipse: [1, 0.45], radial: 12 }));
    T(`ten.itb.${S}`, `${N} iliotibial tract`, 'Thick band of fascia along the lateral thigh from the iliac crest to the lateral tibia (Gerdy\'s tubercle).', () => {
      const raw: V3[] = [[0.148, 0.86, 0.0], [0.15, 0.75, 0.0], [0.142, 0.62, 0.005], [0.125, 0.49, 0.0]];
      return tube(spline(raw.map((p) => X(s, p)), 16).map((p) => conform(p, 0.0068)), { r: 0.0042, ellipse: [1, 0.3], radial: 12, raw: true });
    });
    T(`ten.tib_ant.${S}`, `${N} tibialis anterior tendon`, 'Crosses the front of the ankle to insert on the medial cuneiform and first metatarsal.', () =>
      tube([conform(X(s, [0.096, 0.21, 0.032]), 0.005), conform(X(s, [0.092, 0.15, 0.03]), 0.005), conform(X(s, [0.082, 0.09, 0.03]), 0.004), conform(footPt(s, 0.04, -0.02, 0.055), 0.004), footPt(s, 0.064, -0.024, 0.032)], { r: 0.0024, radial: 8 }));
    T(`ten.hamstrings.${S}`, `${N} hamstring tendons`, 'Distal tendons of biceps femoris (to the fibular head) and semimembranosus/semitendinosus (to the medial tibia).', () =>
      merge([
        tt(Xs([[0.125, 0.54, -0.04], [0.127, 0.5, -0.03], [0.122, 0.468, -0.012]]), 0.0034, 0.0035, [1, 0.5], 0.4),
        tt(Xs([[0.075, 0.56, -0.05], [0.07, 0.5, -0.035], [0.066, 0.45, 0.0]]), 0.0026, 0.0035, [1, 0.5], 0.2),
        tt(Xs([[0.075, 0.54, -0.04], [0.066, 0.49, -0.03], [0.07, 0.455, -0.012]]), 0.0034, 0.0035, [1, 0.45], 0.2),
      ]));
    T(`ten.pes_anserinus.${S}`, `${N} pes anserinus`, 'Conjoined tendons of sartorius, gracilis and semitendinosus fanning onto the medial tibia.', () =>
      merge([
        tt(Xs([[0.058, 0.565, 0.01], [0.062, 0.51, 0.006], [0.074, 0.462, 0.014]]), 0.0022, 0.0035, [1, 0.4]),
        tt(Xs([[0.07, 0.5, -0.02], [0.07, 0.47, -0.004], [0.075, 0.455, 0.012]]), 0.002, 0.0035, [1, 0.4]),
      ]));
    T(`ten.plantaris.${S}`, `${N} plantaris tendon`, 'Very long, slender tendon running along the calf to the calcaneus.', () =>
      tt([...Xs([[0.092, 0.34, -0.05], [0.09, 0.24, -0.056], [0.09, 0.14, -0.064]]), footPt(s, -0.058, -0.002, 0.04)], 0.0012, 0.003));
    T(`ten.fibular.${S}`, `${N} fibular tendons`, 'Fibularis longus and brevis tendons curving behind the lateral malleolus to the foot.', () =>
      merge([
        tt([...Xs([[0.124, 0.2, -0.022], [0.119, 0.12, -0.03]]), footPt(s, 0.0, 0.034, 0.045), footPt(s, 0.045, 0.036, 0.03)], 0.0022, 0.0035),
        tt([...Xs([[0.117, 0.12, -0.034]]), footPt(s, 0.005, 0.032, 0.048), footPt(s, 0.06, 0.04, 0.036)], 0.002, 0.0035),
      ]));
    T(`ten.tib_post.${S}`, `${N} tibialis posterior & toe flexor tendons`, 'Tendons of the deep posterior calf muscles passing behind the medial malleolus into the sole.', () =>
      merge([
        tt([...Xs([[0.088, 0.16, -0.025], [0.08, 0.1, -0.02]]), footPt(s, 0.0, -0.034, 0.045), footPt(s, 0.04, -0.03, 0.035)], 0.0022, 0.0035),
        tt([...Xs([[0.084, 0.15, -0.026], [0.079, 0.095, -0.024]]), footPt(s, -0.005, -0.03, 0.035), footPt(s, 0.06, -0.02, 0.012)], 0.0018, 0.003),
      ]));
    T(`ten.plantar_apo.${S}`, `${N} plantar aponeurosis`, 'Thick fibrous sheet of the sole from the calcaneus to the toes; supports the longitudinal arch.', () =>
      buildMuscle(rib([footPt(s, -0.055, -0.002, 0.014), footPt(s, 0.0, 0.0, 0.011), footPt(s, 0.058, 0.0, 0.011)], hX, [0.006, 0.014, 0.022], [0.0016, 0.0018, 0.0016], { depth: 0.0018 }), { k: 0.002, cell: 0.0016 }));
    T(`ten.hand_flexor.${S}`, `${N} flexor tendons of hand`, 'Flexor digitorum superficialis/profundus and flexor pollicis longus tendons passing through the carpal tunnel to the fingers.', () => {
      const { N: Nh } = handFrame(s);
      const list = FINGERS.map((f, i) => {
        const j = fingerJoints(s, i);
        return tube([handPt(s, -0.01, f.base * 0.4, 0.009), handPt(s, 0.05, f.base, 0.0075), add(j[0], mul(Nh, 0.0055)), add(j[1], mul(Nh, 0.0045)), add(j[2], mul(Nh, 0.0035))], { r: 0.0013, radial: 6, seg: 0.004 });
      });
      const t = thumbJoints(s);
      list.push(tube([handPt(s, -0.01, 0.01, 0.009), add(t[1], mul(Nh, 0.006)), add(t[2], mul(Nh, 0.0045))], { r: 0.0014, radial: 6 }));
      return merge(list);
    });
    T(`ten.hand_extensor.${S}`, `${N} extensor tendons of hand`, 'Extensor digitorum tendons fanning across the back of the hand into the extensor expansions of the fingers.', () => {
      const { N: Nh } = handFrame(s);
      const list = FINGERS.map((f, i) => {
        const j = fingerJoints(s, i);
        return tube([handPt(s, -0.012, f.base * 0.3, -0.012), handPt(s, 0.05, f.base, -0.0095), add(j[0], mul(Nh, -0.0075)), add(j[1], mul(Nh, -0.0062)), add(j[2], mul(Nh, -0.0048))], { r: 0.0012, ellipse: [0.5, 1], radial: 6, seg: 0.004 });
      });
      const t = thumbJoints(s);
      list.push(tube([handPt(s, -0.005, 0.02, -0.008), add(t[1], mul(Nh, -0.007)), add(t[2], mul(Nh, -0.005))], { r: 0.0013, radial: 6 }));
      return merge(list);
    });
    T(`ten.foot_extensor.${S}`, `${N} extensor tendons of foot`, 'Extensor digitorum longus and extensor hallucis longus tendons over the dorsum of the foot.', () =>
      merge(TOES.map((t, i) => {
        const j = toeJoints(s, i);
        return tube([footPt(s, 0.0, 0.004, 0.076), footPt(s, 0.05, t.baseL, 0.046), add(j[0], [0, 0.0075 * t.r, 0]), add(j[1], [0, 0.0062 * t.r, 0])], { r: 0.0012 * (i === 0 ? 1.4 : 1), radial: 6 });
      })));
  }
  T('ten.linea_alba', 'Linea alba', 'Midline fibrous raphe of the abdominal wall between the two rectus abdominis muscles.', () =>
    tt([1.215, 1.15, 1.08, 1.01, 0.95, 0.89].map((y) => [0, y, surfZ(0, y, 1)] as V3), 0.0022, 0.004, [1, 0.45]));
}

/** Contraction drivers (P6 fills): key = muscle id without side suffix; bone = bones3d name without side suffix; sign = +1 if muscle shortens when that bone's flexion angle increases. */
export const MUSCLE_DRIVERS: Record<string, { bone: string; sign: 1 | -1; gain?: number }> = (() => {
  const D: Record<string, { bone: string; sign: 1 | -1; gain?: number }> = {};
  const set = (bone: string, sign: 1 | -1, ids: string, gain = 1) => { for (const k of ids.split(' ')) D['mus.' + k] = { bone, sign, gain }; };
  // elbow (forearm flexion +)
  set('forearm', 1, 'biceps brachialis brachioradialis pron_teres', 1.1);
  set('forearm', -1, 'triceps anconeus', 1);
  // shoulder (upperarm flexion +)
  set('upperarm', 1, 'deltoid pec_major coracobrachialis', 0.8);
  set('upperarm', -1, 'latissimus teres_major infraspinatus teres_minor', 0.8);
  // wrist (hand flexion +)
  set('hand', 1, 'fcr pl fcu thenar hypothenar', 1.2);
  set('hand', -1, 'ecrl ecrb ecu', 1.2);
  // fingers / thumb (MCP flexion +)
  set('f2_1', 1, 'fds fdp lumbricals interossei', 1);
  set('f2_1', -1, 'ed edm', 1);
  set('f1_1', 1, 'fpl add_pollicis', 1);
  set('f1_1', -1, 'apl epb epl', 1);
  // hip (thigh flexion +)
  set('thigh', 1, 'iliopsoas rectus_fem sartorius tfl pectineus add_longus add_brevis', 0.9);
  set('thigh', -1, 'glut_max add_magnus', 0.9);
  // knee (shin flexion +); hamstrings/gastroc cross the knee
  set('shin', 1, 'biceps_fem semitend semimem gracilis popliteus gastroc plantaris', 0.9);
  set('shin', -1, 'vastus_lat vastus_med', 0.9);
  // ankle (foot plantarflexion +)
  set('foot', 1, 'soleus tib_post fdl fhl fib_longus fib_brevis fdb', 1.2);
  set('foot', -1, 'tib_ant ehl edl edb', 1.2);
  // neck / head
  set('neck', 1, 'scm scalenes sternohyoid omohyoid', 1);
  set('neck', -1, 'splenius levator_scap trapezius', 1);
  // jaw closers
  set('jaw', -1, 'masseter temporalis', 1);
  // trunk
  set('spine_T12', 1, 'rectus_abd ext_oblique int_oblique', 1);
  set('spine_T12', -1, 'erector quad_lumb', 1);
  return D;
})();
