import { V3, add, mul, sub, norm, cross, lerp, dist, dot, ortho, spline, rng, perp, pathLength } from '../geo/math';
import { noise3 } from '../geo/noise';
import { arbor, tuck, Inside } from '../geo/e_net';
import {
  Shape, ellipsoid, union, subtract, sphere, hollow, torus, frameY, frameAxes, intersect, plane, offset, Frame, displace, roundCone,
} from '../geo/sdf';
import { meshShape, Geo } from '../geo/mesher';
import { tube, merge } from '../geo/tube';
import { twigs, branchTree } from '../geo/branch';
import { G, P, Tissue, AnimKind } from './registry';
import { conform, skinShape } from './skin';
import { brainSpace } from './skeleton';

export const underSkin = (extra?: () => Shape) => (p: V3) => {
  const d = skinShape().d(p[0], p[1], p[2]) + 0.005;
  return extra ? Math.max(d, extra().d(p[0], p[1], p[2])) : d;
};
import { lungTree, KIDNEY, HILUM } from './organs';
import { ribPaths } from './skeleton';
import {
  HEART, armPt, forePt, handPt, handFrame, FINGERS, fingerJoints, thumbJoints, footPt, VERTEBRAE, Side, SIDES, sideName, sid, thighPt, kneeJ, TOES, toeJoints,
} from './rig';
import { lc } from './util';

const SYS = 'cardiovascular' as const;

// ------------------------------------------------------------------ heart frame
const A = norm([0.62, -0.5, 0.6]);
const Fh = ortho(A, [0, 0.3, 1]);
const R2 = norm(cross(Fh, A));
const HF: Frame = [R2, A, Fh];
const C = HEART.c;
export const hp = (a: number, r: number, f: number): V3 => add(add(add(C, mul(A, a)), mul(R2, r)), mul(Fh, f));

const LVo = () => ellipsoid(hp(0.012, 0.01, -0.006), [0.029, 0.052, 0.028], HF);
const RVraw = () => ellipsoid(hp(0.0, -0.012, 0.019), [0.031, 0.044, 0.021], HF);
const LAo = () => union([ellipsoid(hp(-0.046, 0.012, -0.02), [0.026, 0.018, 0.02], HF), ellipsoid(hp(-0.036, 0.034, 0.008), [0.009, 0.007, 0.012], HF)], 0.006);
const RAo = () => union([ellipsoid(hp(-0.036, -0.03, 0.0), [0.022, 0.027, 0.023], HF), ellipsoid(hp(-0.044, -0.02, 0.024), [0.01, 0.008, 0.012], HF)], 0.006);
const RVo = () => subtract(RVraw(), offset(LVo(), 0.0012), 0.004);
let heartCache: Shape | null = null;
export const heartOuter = () => (heartCache ??= union([LVo(), RVraw(), LAo(), RAo()], 0.008));

// valve annulus centres: procedural-space points that the landmark warp maps onto the real BP3D heart's atrioventricular / outflow junctions (fitted v6)
const AV: V3 = [0.0136, 1.3422, 0.0152];
const PV: V3 = [0.0236, 1.3603, 0.0515];
const MV: V3 = [0.0278, 1.3438, 0.0007];
const TV: V3 = [-0.0142, 1.303, 0.0371];

export const AORTA_ARCH: V3[] = [AV, [0.0106, 1.3722, 0.0002], [-0.004, 1.368, 0.02], [0.006, 1.39, 0.002], [0.02, 1.386, -0.022], [0.026, 1.36, -0.04]];
const PULM_TRUNK: V3[] = [PV, [0.0336, 1.3853, 0.0395], [0.018, 1.36, 0.012]];

// ------------------------------------------------------------------ valves (annulus + hinged leaflets/cusps)
interface VLeaf { key: string; name: string; th: number }
interface VSpec { id: string; name: string; desc: string; center: V3; dn: V3; R: number; sl: boolean; u: V3; v: V3; leaves: VLeaf[]; span: number; rf: number }
const wrapA = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const hAV = (s: number, _q: number) => 0.0042 * Math.pow(Math.max(0, s), 1.4);
const tAV = (s: number, _q: number) => 0.0006 + 0.0003 * Math.min(1, Math.max(0, s));
const hSL = (s: number, q: number) => {
  const sc = Math.min(1.02, Math.max(0, s)), qq = Math.min(1.2, Math.max(-1.2, q)), q2 = qq * qq;
  return (1 - sc) * 0.0045 * q2 + sc * 0.002 - 0.0045 * Math.sin(Math.PI * Math.min(1, sc)) * (1 - Math.min(1, q2));
};
const tSL = (s: number, q: number) => { const sc = Math.min(1, Math.max(0, s)); return 0.0006 + 0.00007 * sc + 0.00023 * Math.exp(-10 * q * q) * Math.pow(sc, 4); };

function vspec(id: string, name: string, desc: string, center: V3, dn: V3, R: number, sl: boolean, names: [string, string][], first: V3, second: V3): VSpec {
  const fr = frameY(dn);
  const u = norm(sub(fr[0], mul(dn, dot(fr[0], dn))));
  const v = cross(dn, u);
  const ang = (d: V3) => Math.atan2(dot(d, v), dot(d, u));
  const rad = (t: number): V3 => add(mul(u, Math.cos(t)), mul(v, Math.sin(t)));
  const n = names.length, t0 = ang(first);
  let ths: number[];
  if (n === 2) ths = [t0, t0 + Math.PI];
  else {
    let c1 = t0 + (2 * Math.PI) / 3, c2 = t0 - (2 * Math.PI) / 3;
    if (dot(rad(c1), second) < dot(rad(c2), second)) [c1, c2] = [c2, c1];
    ths = [t0, c1, c2];
  }
  return {
    id, name, desc, center, dn, R, sl, u, v, span: ((2 * Math.PI) / n) * (n === 2 ? 0.95 : 0.97), rf: R * (sl ? 0.08 : 0.12),
    leaves: names.map(([key, nm], i) => ({ key, name: nm, th: ths[i] })),
  };
}
const radOf = (S: VSpec, t: number): V3 => add(mul(S.u, Math.cos(t)), mul(S.v, Math.sin(t)));

/** world point on a leaflet: q in [-1,1] across the sector, s in [0,1] from annulus (0) to free edge (1) */
function leafPt(S: VSpec, th: number, q: number, s: number): V3 {
  const rho = S.R - (S.R - S.rf) * s;
  const h = (S.sl ? hSL : hAV)(s, q);
  return add(add(S.center, mul(radOf(S, th + (q * S.span) / 2), rho)), mul(S.dn, h));
}

/** thin double-sided leaflet surface built directly as a grid (cheap, ~1.5k tris) */
function leafMesh(S: VSpec, th: number): Geo {
  const NS = 16, NQ = 28, tf = S.sl ? tSL : tAV;
  const P0: V3[] = [], N0: V3[] = [], T0: number[] = [];
  const pt = (s: number, q: number) => leafPt(S, th, q, s);
  for (let i = 0; i <= NS; i++) for (let j = 0; j <= NQ; j++) {
    const s = i / NS, q = (j / NQ) * 2 - 1, e = 0.01;
    const a = pt(Math.min(1, s + e), q), b = pt(Math.max(0, s - e), q), c = pt(s, Math.min(1, q + e)), d = pt(s, Math.max(-1, q - e));
    P0.push(pt(s, q)); N0.push(norm(cross(sub(a, b), sub(c, d)))); T0.push(tf(s, q));
  }
  const nv = P0.length;
  const pos = new Float32Array(nv * 6), nor = new Float32Array(nv * 6), idx: number[] = [];
  for (let k = 0; k < nv; k++) {
    const top = add(P0[k], mul(N0[k], T0[k] / 2)), bot = sub(P0[k], mul(N0[k], T0[k] / 2));
    pos.set(top, k * 3); pos.set(bot, (nv + k) * 3);
    nor.set(N0[k], k * 3); nor.set(mul(N0[k], -1), (nv + k) * 3);
  }
  const id = (i: number, j: number) => i * (NQ + 1) + j;
  for (let i = 0; i < NS; i++) for (let j = 0; j < NQ; j++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
    idx.push(a, b, c, b, d, c);
    idx.push(nv + a, nv + c, nv + b, nv + b, nv + c, nv + d);
  }
  let cen: V3 = [0, 0, 0];
  for (const p of P0) cen = add(cen, p);
  cen = mul(cen, 1 / nv);
  const rim = (a: number, b: number) => {
    const A0 = P0[a], B0 = P0[b];
    const m = mul(add(A0, B0), 0.5);
    const out = sub(m, cen);
    const nq = cross(sub(B0, A0), N0[a]);
    if (dot(nq, out) >= 0) idx.push(a, b, nv + b, a, nv + b, nv + a);
    else idx.push(a, nv + b, b, a, nv + a, nv + b);
  };
  for (let j = 0; j < NQ; j++) { rim(id(0, j), id(0, j + 1)); rim(id(NS, j), id(NS, j + 1)); }
  for (let i = 0; i < NS; i++) { rim(id(i, 0), id(i + 1, 0)); rim(id(i, NQ), id(i + 1, NQ)); }
  return { pos, nor, idx: new Uint32Array(idx) };
}

const VALVES: VSpec[] = [
  vspec('heart.valve.mitral', 'Mitral valve', 'Bicuspid valve between the left atrium and left ventricle, tethered by chordae tendineae; the anterior leaflet lies against the aortic root.', MV, A, 0.0115, false,
    [['anterior', 'Anterior mitral leaflet'], ['posterior', 'Posterior mitral leaflet']], sub(AV, MV), Fh),
  vspec('heart.valve.tricuspid', 'Tricuspid valve', 'Three-leaflet valve between the right atrium and right ventricle.', TV, A, 0.012, false,
    [['septal', 'Septal tricuspid leaflet'], ['anterior', 'Anterior tricuspid leaflet'], ['posterior', 'Posterior tricuspid leaflet']], sub(MV, TV), Fh),
  vspec('heart.valve.aortic', 'Aortic valve', 'Semilunar valve with three cusps guarding the outflow of the left ventricle into the aorta.', AV, norm(sub(AORTA_ARCH[1], AV)), 0.0105, true,
    [['left', 'Left aortic cusp'], ['right', 'Right aortic cusp'], ['posterior', 'Posterior (non-coronary) aortic cusp']], R2, Fh),
  vspec('heart.valve.pulmonary', 'Pulmonary valve', 'Semilunar valve between the right ventricle and the pulmonary trunk.', PV, norm(sub(PULM_TRUNK[1], PV)), 0.0105, true,
    [['anterior', 'Anterior pulmonary cusp'], ['left', 'Left pulmonary cusp'], ['right', 'Right pulmonary cusp']], Fh, R2),
];

function conformTo(s: Shape, p: V3, out: number): V3 {
  let q = p;
  const e = 0.001;
  for (let i = 0; i < 6; i++) {
    const d = s.d(q[0], q[1], q[2]);
    const g = norm([s.d(q[0] + e, q[1], q[2]) - s.d(q[0] - e, q[1], q[2]), s.d(q[0], q[1] + e, q[2]) - s.d(q[0], q[1] - e, q[2]), s.d(q[0], q[1], q[2] + e) - s.d(q[0], q[1], q[2] - e)]);
    q = sub(q, mul(g, d - out));
  }
  return q;
}

const HEARTC: V3 = HEART.c;
const flowAt = (p: V3) => dist(p, HEARTC) * 1.25;

const skinD: Inside = (p) => skinShape().d(p[0], p[1], p[2]);

/** Paired venae comitantes flanking an artery path, tucked under the skin, with small cross-links. */
function comit(pts: V3[], r0: number, r1: number, off: number, flow0: number): Geo[] {
  const dense = spline(pts, Math.max(12, Math.ceil(pathLength(pts) / 0.008)));
  const a: V3[] = [], b: V3[] = [];
  for (let i = 0; i < dense.length; i++) {
    const T = norm(sub(dense[Math.min(i + 1, dense.length - 1)], dense[Math.max(i - 1, 0)]));
    let n = cross(T, [0, 0, 1]);
    if (Math.hypot(n[0], n[1], n[2]) < 0.3) n = cross(T, [1, 0, 0]);
    n = norm(n);
    a.push(tuck(add(dense[i], mul(n, off)), skinD, 0.004 + r0));
    b.push(tuck(add(dense[i], mul(n, -off)), skinD, 0.004 + r0));
  }
  const rf = (t: number) => r0 + (r1 - r0) * t;
  const geos: Geo[] = [tube(a, { r: rf, radial: 8, flow0 }), tube(b, { r: (t) => rf(t) * 0.9, radial: 8, flow0 })];
  for (let i = 3; i < dense.length - 2; i += 5) geos.push(tube([a[i], lerp(a[i], b[i], 0.5), b[i]], { r: 0.0004, radial: 5, flow0 }));
  return geos;
}

type VOpts = {
  insideShape?: () => Shape; twigs?: number; twigLen?: [number, number]; seed?: number; conformDepth?: number; conformRange?: [number, number]; raw?: boolean; anim?: AnimKind; extra?: () => Geo[];
  twigDepth?: number; twigR?: number; twigRange?: [number, number]; inside?: Inside; twigMargin?: number;
};
function vessel(id: string, name: string, parent: string, tissue: Tissue, pts: V3[] | (() => V3[]), r0: number, r1: number, desc: string, o: VOpts = {}) {
  P({
    id, name, parent, system: SYS, tissue, desc, anim: o.anim,
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
      } else if (!o.insideShape && !o.inside) p = p.map((q) => tuck(q, skinD, 0.004 + r0));
      const f0 = p.length ? flowAt(p[0]) : 0.5;
      const geos: Geo[] = p.length >= 2 ? [tube(p, { r: (t) => r0 + (r1 - r0) * t, radial: r0 > 0.006 ? 18 : r0 > 0.003 ? 12 : 8, flow0: f0 })] : [];
      if (o.twigs && p.length >= 2) {
        const brain = o.insideShape;
        const inside: Inside | undefined = o.conformDepth !== undefined ? undefined : o.inside ?? (brain ? underSkin(brain) : skinD);
        geos.push(...arbor(p, {
          seed: o.seed ?? id.length * 31, count: o.twigs, r: o.twigR ?? Math.max(0.0007, r1 * 0.6), len: o.twigLen ?? [0.02, 0.05],
          depth: o.twigDepth ?? 2, flow0: f0, rp: [r0, r1], range: o.twigRange, inside,
          margin: o.twigMargin ?? (brain ? 0.0015 : 0.005),
          map: o.conformDepth !== undefined ? (q) => conform(q, o.conformDepth! + 0.001) : undefined,
        }));
      }
      if (o.extra) geos.push(...o.extra());
      return merge(geos);
    },
  });
}
const X = (s: Side, p: V3): V3 => [p[0] * s, p[1], p[2]];
const XS = (s: Side, pts: V3[]) => pts.map((p) => X(s, p));

export function defineCardio() {
  G('cardiovascular', 'Cardiovascular System', undefined, SYS, 'The heart pumps ~5 L of blood per minute through ~100,000 km of vessels.');
  const H = G('cv.heart', 'Heart', 'cardiovascular', SYS, 'Four-chambered muscular pump the size of a fist, beating ~100,000 times a day.');
  const chamber = (id: string, name: string, tissue: Tissue, anim: AnimKind, desc: string, sh: () => Shape) =>
    P({ id, name, parent: H, system: SYS, tissue, anim, desc, build: () => meshShape(sh(), 0.0013) });
  chamber('heart.lv', 'Left ventricle', 'myocardium', 'ventricle', 'Thick-walled (~1 cm) chamber pumping oxygenated blood into the aorta at systemic pressure; forms the apex.', () => hollow(subtract(LVo(), LAo(), 0.004), 0.0092));
  chamber('heart.rv', 'Right ventricle', 'myocardium', 'ventricle', 'Crescent-shaped chamber pumping deoxygenated blood into the pulmonary trunk; forms most of the anterior surface.', () => hollow(subtract(RVo(), RAo(), 0.004), 0.0042));
  chamber('heart.la', 'Left atrium', 'atrium', 'atrium', 'Receives oxygenated blood from the four pulmonary veins; the most posterior chamber.', () => hollow(LAo(), 0.0025));
  chamber('heart.ra', 'Right atrium', 'atrium', 'atrium', 'Receives deoxygenated blood from the venae cavae and coronary sinus; contains the sinoatrial node, the heart\'s pacemaker.', () => hollow(RAo(), 0.0025));
  for (const S of VALVES) {
    G(S.id, S.name, H, SYS, S.desc);
    P({ id: `${S.id}.annulus`, name: `${S.name} annulus`, parent: S.id, system: SYS, tissue: 'valve', anim: 'heartAux', desc: `Fibrous ring anchoring the ${lc(S.name)} leaflets to the heart skeleton.`, build: () => meshShape(torus(S.center, S.R, 0.0013, frameY(S.dn)), 0.0005) });
    for (const L of S.leaves) {
      const rad = radOf(S, L.th);
      const pivot = add(S.center, mul(rad, S.R));
      const axis = norm(cross(mul(rad, -1), S.dn));
      P({
        id: `${S.id}.${L.key}`, name: L.name, parent: S.id, system: SYS, tissue: 'valve', anim: S.sl ? 'leafletSL' : 'leafletAV', pivot, axis,
        desc: S.sl ? 'Thin pocket-shaped semilunar cusp with a thickened nodule at its free edge; fills and closes under back-pressure, opens during ventricular ejection.'
          : 'Thin fibrous curtain hinged on the annulus; opens into the ventricle in diastole and is held closed in systole by chordae tendineae.',
        build: () => leafMesh(S, L.th),
      });
    }
  }
  const hv = (id: string, name: string, tissue: Tissue, pts: V3[], r0: number, r1: number, desc: string) =>
    P({ id, name, parent: H, system: SYS, tissue, anim: 'heartAux', desc, build: () => tube(pts, { r: (t) => r0 + (r1 - r0) * t, radial: 20, flow0: flowAt(pts[0]) }) });
  hv('heart.aorta', 'Ascending aorta & aortic arch', 'artery', AORTA_ARCH, 0.0135, 0.0122, 'The aorta rises from the left ventricle and arches over the left pulmonary artery, giving off the brachiocephalic, left common carotid and left subclavian arteries.');
  P({
    id: 'heart.pulmonary', name: 'Pulmonary trunk & arteries', parent: H, system: SYS, tissue: 'vein', anim: 'heartAux',
    desc: 'Carries deoxygenated blood from the right ventricle to the lungs — the only arteries carrying deoxygenated blood (shown blue).',
    build: () => merge([
      tube(PULM_TRUNK, { r: 0.0125, radial: 18, flow0: 0 }),
      tube([PULM_TRUNK[2], [0.045, 1.356, 0.0], [0.065, 1.334, -0.012]], { r: (t) => 0.0095 - 0.002 * t, radial: 16, flow0: 0.05 }),
      tube([PULM_TRUNK[2], [0.0, 1.352, -0.006], [-0.03, 1.345, -0.013], [-0.06, 1.33, -0.016]], { r: (t) => 0.0095 - 0.002 * t, radial: 16, flow0: 0.05 }),
    ]),
  });
  hv('heart.svc', 'Superior vena cava', 'vein', [[-0.028, 1.418, 0.012], [-0.03, 1.35, 0.014], [-0.031, 1.305, 0.016]], 0.0095, 0.0098, 'Returns blood from the head, neck and upper limbs to the right atrium.');
  hv('heart.ivc', 'Inferior vena cava (terminal)', 'vein', [[-0.028, 1.215, -0.002], [-0.031, 1.255, 0.01]], 0.0108, 0.0108, 'The largest vein, returning blood from the lower body to the right atrium.');
  P({
    id: 'heart.pulmveins', name: 'Pulmonary veins', parent: H, system: SYS, tissue: 'artery', anim: 'heartAux',
    desc: 'Four veins returning oxygenated blood from the lungs to the left atrium (shown red).',
    build: () => {
      const la = hp(-0.046, 0.012, -0.02);
      return merge([[0.062, 1.322, -0.02], [0.062, 1.287, -0.026], [-0.055, 1.316, -0.02], [-0.055, 1.28, -0.026]].map((e) =>
        tube([e as V3, lerp(e as V3, la, 0.5), add(la, mul(norm(sub(e as V3, la)), 0.012))], { r: 0.0052, radial: 12, flow0: 0.3 })));
    },
  });
  // ---- epicardial surface helpers
  const surf = (out: number) => { const h = heartOuter(); return (q: V3) => conformTo(h, q, out); };
  const hug = (pts: V3[], out: number) => { const h = heartOuter(); return spline(pts, Math.max(24, pts.length * 8)).map((q) => conformTo(h, q, out)); };
  const LADp = (): V3[] => [add(AV, mul(R2, 0.012)), hp(-0.015, 0.002, 0.036), hp(0.01, 0.006, 0.032), hp(0.035, 0.008, 0.024), hp(0.06, 0.008, 0.002)];
  const CXp = (): V3[] => [hp(-0.028, 0.03, 0.0), hp(-0.026, 0.038, -0.014), hp(-0.022, 0.034, -0.03), hp(-0.014, 0.022, -0.04), hp(-0.008, 0.01, -0.04)];
  const RCAp = (): V3[] => [add(AV, mul(R2, -0.012)), hp(-0.028, -0.024, 0.026), hp(-0.024, -0.04, 0.012), hp(-0.022, -0.046, -0.01), hp(-0.02, -0.03, -0.034), hp(-0.016, -0.006, -0.038)];
  const PDAp = (): V3[] => [hp(-0.016, -0.006, -0.038), hp(0.012, -0.002, -0.034), hp(0.034, 0.0, -0.027), hp(0.054, 0.002, -0.012)];
  const GCVp = (): V3[] => [hp(0.05, 0.012, 0.012), hp(0.02, 0.012, 0.03), hp(-0.012, 0.012, 0.034), hp(-0.026, 0.034, 0.002), hp(-0.03, 0.026, -0.026), hp(-0.03, -0.01, -0.034), hp(-0.03, -0.03, -0.02)];
  const MCVp = (): V3[] => [hp(0.052, -0.004, -0.024), hp(0.02, -0.006, -0.033), hp(-0.01, -0.01, -0.038), hp(-0.03, -0.016, -0.03)];
  const TAP = (r0: number, r1: number) => (t: number) => r0 + (r1 - r0) * Math.pow(t, 0.8);
  P({
    id: 'heart.coronary', name: 'Coronary arteries', parent: H, system: SYS, tissue: 'coronary', anim: 'heartAux',
    desc: 'Left (LAD and circumflex) and right coronary arteries supplying the myocardium; their blockage causes heart attacks.',
    build: () => {
      const m = surf(0.0011);
      const lad = hug(LADp(), 0.0012), cx = hug(CXp(), 0.0012), rca = hug(RCAp(), 0.0012), pda = hug(PDAp(), 0.001);
      const geos: Geo[] = [
        tube(lad, { r: TAP(0.0021, 0.0008), radial: 10, seg: 0.003, flow0: 0.1 }),
        tube(cx, { r: TAP(0.0019, 0.0009), radial: 10, seg: 0.003, flow0: 0.1 }),
        tube(rca, { r: TAP(0.0022, 0.001), radial: 10, seg: 0.003, flow0: 0.1 }),
        tube(pda, { r: TAP(0.0013, 0.0006), radial: 8, seg: 0.003, flow0: 0.15 }),
        tube([add(AV, mul(R2, 0.009)), conformTo(heartOuter(), add(AV, mul(R2, 0.012)), 0.0012)], { r: 0.0023, radial: 10, flow0: 0.05 }),
        tube(hug([hp(-0.028, -0.024, 0.026), hp(-0.034, -0.01, 0.034), hp(-0.04, 0.004, 0.034), hp(-0.046, 0.0, 0.016)], 0.001), { r: TAP(0.0009, 0.0005), radial: 6, seg: 0.003, flow0: 0.1 }),
      ];
      const o = { depth: 2, map: m, flow0: 0.1, len: [0.014, 0.03] as [number, number], margin: 0 };
      geos.push(...arbor(lad, { ...o, seed: 3, count: 8, r: 0.0011, only: R2, bias: A, biasW: 0.35, rp: [0.0021, 0.0008] }));
      geos.push(...arbor(lad, { ...o, seed: 4, count: 4, r: 0.0007, only: mul(R2, -1), bias: A, biasW: 0.3, len: [0.01, 0.02], rp: [0.0021, 0.0008] }));
      geos.push(...arbor(cx, { ...o, seed: 5, count: 6, r: 0.0011, only: R2, bias: A, biasW: 0.45, rp: [0.0019, 0.0009] }));
      geos.push(...arbor(rca, { ...o, seed: 6, count: 8, r: 0.0011, only: mul(R2, -1), bias: A, biasW: 0.35, rp: [0.0022, 0.001] }));
      geos.push(...arbor(pda, { ...o, seed: 7, count: 5, r: 0.0007, bias: A, biasW: 0.2, len: [0.01, 0.022], rp: [0.0013, 0.0006] }));
      return merge(geos);
    },
  });
  P({
    id: 'heart.cardiacveins', name: 'Cardiac veins', parent: H, system: SYS, tissue: 'vein', anim: 'heartAux',
    desc: 'Great, middle and small cardiac veins draining the myocardium into the coronary sinus.',
    build: () => {
      const m = surf(0.0011);
      const g = hug(GCVp(), 0.0011), mc = hug(MCVp(), 0.0011);
      const sm = hug([hp(-0.03, -0.03, -0.02), hp(-0.026, -0.044, 0.0), hp(-0.022, -0.046, 0.016)], 0.001);
      const geos: Geo[] = [
        tube(g, { r: TAP(0.0013, 0.0022), radial: 10, seg: 0.003, flow0: 0.1 }),
        tube(mc, { r: TAP(0.0012, 0.0018), radial: 8, seg: 0.003, flow0: 0.1 }),
        tube(sm, { r: TAP(0.0014, 0.0009), radial: 8, seg: 0.003, flow0: 0.1 }),
      ];
      const o = { depth: 2, map: m, flow0: 0.1, len: [0.012, 0.026] as [number, number], margin: 0 };
      geos.push(...arbor(g, { ...o, seed: 11, count: 8, r: 0.0009, bias: A, biasW: 0.25, rp: [0.0013, 0.0022] }));
      geos.push(...arbor(mc, { ...o, seed: 12, count: 4, r: 0.0008, bias: A, biasW: 0.2, rp: [0.0012, 0.0018] }));
      for (let i = 0; i < 4; i++) {
        const f = 0.012 + i * 0.008;
        geos.push(tube(hug([hp(0.03 - i * 0.004, -0.024, f + 0.01), hp(0.0, -0.032, f + 0.014), hp(-0.03, -0.034, f + 0.004)], 0.001), { r: TAP(0.0006, 0.0009), radial: 6, seg: 0.003, flow0: 0.2 }));
      }
      return merge(geos);
    },
  });
  P({
    id: 'heart.fat', name: 'Epicardial fat in the grooves', parent: H, system: SYS, tissue: 'valve', anim: 'heartAux',
    desc: 'Pale epicardial fat padding the atrioventricular and interventricular grooves, in which the coronary vessels run.',
    build: () => {
      const wob = (k: number) => (t: number) => 0.0021 + 0.0007 * Math.sin(t * 19 + k) + 0.0005 * Math.sin(t * 43 + k * 2);
      const ring: V3[] = [];
      for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2; ring.push(hp(-0.026, 0.037 * Math.cos(a) - 0.002, 0.034 * Math.sin(a))); }
      return merge([
        tube(hug(ring, -0.0004), { r: wob(1), radial: 10, seg: 0.003, flow0: 0.1 }),
        tube(hug(LADp().slice(1), -0.0004), { r: wob(2), radial: 10, seg: 0.003, flow0: 0.1 }),
        tube(hug(PDAp(), -0.0004), { r: wob(3), radial: 10, seg: 0.003, flow0: 0.1 }),
        tube(hug([hp(-0.02, -0.046, 0.0), hp(0.0, -0.043, 0.014), hp(0.03, -0.03, 0.022), hp(0.05, -0.012, 0.012)], -0.0004), { r: (t) => 0.0016 + 0.0006 * Math.sin(t * 15), radial: 8, seg: 0.003, flow0: 0.1 }),
      ]);
    },
  });

  // ---- auricles
  const crenate = (s: Shape) => displace(s, (x, y, z) => 0.00055 * noise3(x * 520, y * 520, z * 520) + 0.0003 * noise3(x * 170 + 9, y * 170, z * 170), 0.001);
  const auricle = (id: string, name: string, desc: string, sh: () => Shape) => P({ id, name, parent: H, system: SYS, tissue: 'atrium', anim: 'atrium', desc, build: () => meshShape(crenate(sh()), 0.0007) });
  auricle('heart.auricle.l', 'Left auricle', 'Ear-shaped muscular pouch of the left atrium curling around the pulmonary trunk; its crenated edge is lined by pectinate muscles.', () =>
    union([ellipsoid(hp(-0.04, 0.038, -0.004), [0.007, 0.01, 0.007], HF), ellipsoid(hp(-0.04, 0.043, 0.012), [0.006, 0.0075, 0.009], HF), ellipsoid(hp(-0.036, 0.04, 0.026), [0.0045, 0.006, 0.008], HF), ellipsoid(hp(-0.032, 0.036, 0.034), [0.0035, 0.004, 0.005], HF)], 0.003));
  auricle('heart.auricle.r', 'Right auricle', 'Broad triangular flap of the right atrium overlapping the root of the aorta; contains pectinate muscles.', () =>
    union([ellipsoid(hp(-0.044, -0.026, 0.016), [0.0065, 0.011, 0.01], HF), ellipsoid(hp(-0.04, -0.014, 0.03), [0.006, 0.011, 0.008], HF), ellipsoid(hp(-0.036, -0.004, 0.038), [0.005, 0.008, 0.005], HF), ellipsoid(hp(-0.034, 0.002, 0.042), [0.0035, 0.004, 0.003], HF)], 0.003));

  // ---- ventricular interior: papillary muscles, chordae, trabeculae
  const LVin = () => offset(LVo(), -0.0088);
  const RVin = () => offset(RVo(), -0.0038);
  const PMS = (): { sh: 'lv' | 'rv'; b: V3; t: V3; r: number }[] => [
    { sh: 'lv', b: hp(0.016, 0.026, 0.012), t: hp(-0.012, 0.015, 0.007), r: 0.0036 },
    { sh: 'lv', b: hp(0.016, 0.006, -0.027), t: hp(-0.012, 0.008, -0.01), r: 0.0038 },
    { sh: 'rv', b: hp(0.012, -0.018, 0.034), t: hp(-0.012, -0.016, 0.017), r: 0.0032 },
    { sh: 'rv', b: hp(0.01, -0.027, -0.004), t: hp(-0.012, -0.022, 0.001), r: 0.0028 },
    { sh: 'rv', b: hp(0.006, -0.004, 0.018), t: hp(-0.01, -0.009, 0.013), r: 0.0018 },
  ];
  P({
    id: 'heart.papillary', name: 'Papillary muscles', parent: H, system: SYS, tissue: 'myocardium', anim: 'ventricle',
    desc: 'Finger-like projections of ventricular wall (two in the left ventricle, three in the right) that anchor the chordae tendineae and stop the valve leaflets prolapsing.',
    build: () => {
      const lv = LVin(), rv = RVin();
      const sh = PMS().map((m) => {
        const B = conformTo(m.sh === 'lv' ? lv : rv, m.b, 0.002);
        const T = m.t, dir = norm(sub(T, B));
        return union([roundCone(B, T, m.r * 1.25, m.r * 0.5), sphere(add(B, mul(dir, 0.003)), m.r * 1.5), sphere(add(T, mul(dir, -0.0015)), m.r * 0.65)], 0.0025);
      });
      return meshShape(displace(union(sh, 0.001), (x, y, z) => 0.00035 * noise3(x * 600, y * 600, z * 600), 0.0005), 0.0007);
    },
  });
  const valveEdges = (S: VSpec): V3[] => S.leaves.flatMap((L) => [-0.75, -0.4, 0, 0.4, 0.75].map((q) => leafPt(S, L.th, q, 0.82)));
  P({
    id: 'heart.chordae', name: 'Chordae tendineae', parent: H, system: SYS, tissue: 'valve', anim: 'heartAux',
    desc: 'Fine fibrous cords running from the papillary muscles to the free edges of the mitral and tricuspid leaflets.',
    build: () => {
      const R = rng(41);
      const pm = PMS();
      const geos: Geo[] = [];
      const fan = (tips: V3[], edges: V3[]) => {
        for (const e of edges) {
          const ord = [...tips].sort((a, b) => dist(a, e) - dist(b, e));
          const tip = ord[0];
          const mid = add(lerp(tip, e, 0.5), mul(perp(sub(e, tip)), 0.0012 * (R() - 0.5)));
          const split = lerp(tip, mid, 0.6);
          geos.push(tube([tip, split, mid, e], { r: (t) => 0.00032 - 0.0001 * t, radial: 5, seg: 0.002, flow0: 0.1 }));
          if (R() < 0.45 && ord[1]) geos.push(tube([ord[1], lerp(ord[1], e, 0.6), e], { r: 0.0002, radial: 5, seg: 0.002, flow0: 0.1 }));
        }
      };
      fan([pm[0].t, pm[1].t], valveEdges(VALVES[0]));
      fan([pm[2].t, pm[3].t, pm[4].t], valveEdges(VALVES[1]));
      return merge(geos);
    },
  });
  P({
    id: 'heart.trabeculae', name: 'Trabeculae carneae', parent: H, system: SYS, tissue: 'myocardium', anim: 'ventricle',
    desc: 'Irregular muscular ridges lining the inner surface of both ventricles, most prominent toward the apex; the moderator band carries the right bundle branch.',
    build: () => {
      const R = rng(77);
      const lv = LVin(), rv = RVin();
      const geos: Geo[] = [];
      const ridges = (s: Shape, n: number, rc: number, fc: number, rs: number, fs: number, a0: number, a1: number, depth: number) => {
        for (let i = 0; i < n; i++) {
          let cur = conformTo(s, hp(a0 + (a1 - a0) * R(), rc + rs * (R() * 2 - 1), fc + fs * (R() * 2 - 1)), depth);
          const pts: V3[] = [cur];
          let d = norm(add(mul(A, 0.6), [R() - 0.5, R() - 0.5, R() - 0.5]));
          const L = 0.004 + R() * 0.0025, steps = 4 + Math.floor(R() * 4);
          for (let k = 0; k < steps; k++) {
            d = norm(add(d, [(R() - 0.5) * 0.7, (R() - 0.5) * 0.7, (R() - 0.5) * 0.7]));
            cur = conformTo(s, add(cur, mul(d, L)), depth);
            pts.push(cur);
          }
          const rr = 0.0008 + R() * 0.0007;
          geos.push(tube(pts, { r: (t) => rr * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, t * 1.05))), radial: 6, seg: 0.0025, flow0: 0 }));
        }
      };
      ridges(lv, 80, 0.01, -0.004, 0.02, 0.024, 0.0, 0.046, -0.0005);
      ridges(rv, 70, -0.014, 0.019, 0.026, 0.016, -0.004, 0.04, -0.0005);
      geos.push(tube([conformTo(rv, hp(0.016, -0.004, 0.014), 0.0008), hp(0.014, -0.012, 0.024), conformTo(rv, hp(0.012, -0.02, 0.034), 0.0008)], { r: (t) => 0.0017 - 0.0004 * Math.sin(t * 3), radial: 8, flow0: 0 }));
      return merge(geos);
    },
  });

  // ------------------------------------------------------------------ arteries
  const ART = G('cv.arteries', 'Arteries', 'cardiovascular', SYS, 'Vessels carrying blood away from the heart under high pressure.');
  const VEN = G('cv.veins', 'Veins', 'cardiovascular', SYS, 'Vessels returning blood to the heart; most contain valves preventing backflow.');
  const aHN = G('cv.art.headneck', 'Arteries of head & neck', ART, SYS, 'Carotid and vertebral systems supplying the brain, face and scalp.');
  vessel('art.basilar', 'Basilar artery', aHN, 'artery', [[0, 1.61, -0.014], [0, 1.62, -0.009], [0, 1.628, -0.004]], 0.0027, 0.0025, 'Formed by the union of the two vertebral arteries at the pontomedullary junction; ascends in front of the pons and divides into the posterior cerebral arteries.', { insideShape: brainSpace });
  vessel('art.acom', 'Anterior communicating artery', aHN, 'artery', [[0.006, 1.643, 0.038], [0, 1.644, 0.039], [-0.006, 1.643, 0.038]], 0.0008, 0.0008, 'Short channel joining the two anterior cerebral arteries, completing the front of the circle of Willis.', { insideShape: brainSpace });
  const aTr = G('cv.art.trunk', 'Arteries of the trunk', ART, SYS, 'The descending aorta and its visceral and parietal branches.');
  const vHN = G('cv.vein.headneck', 'Veins of head & neck', VEN, SYS, 'Jugular veins and dural venous sinuses.');
  const vTr = G('cv.vein.trunk', 'Veins of the trunk', VEN, SYS, 'Venae cavae, azygos and portal systems.');

  vessel('art.desc_aorta', 'Descending aorta', aTr, 'artery', [[0.026, 1.36, -0.04], [0.026, 1.3, -0.05], [0.022, 1.2, -0.046], [0.012, 1.12, -0.022], [0.004, 1.078, -0.01], [0.0, 1.062, -0.008]], 0.0118, 0.0088, 'Thoracic and abdominal aorta descending along the spine to bifurcate at L4 into the common iliac arteries.');
  vessel('art.brachiocephalic', 'Brachiocephalic trunk', aHN, 'artery', [[0.0, 1.392, 0.01], [-0.012, 1.42, 0.016], [-0.022, 1.44, 0.018]], 0.0062, 0.0055, 'First branch of the aortic arch, dividing into the right subclavian and right common carotid arteries.');
  vessel('art.celiac', 'Celiac trunk & branches', aTr, 'artery', [[0.014, 1.155, -0.03], [0.014, 1.16, -0.008]], 0.003, 0.003, 'Supplies the stomach, liver, spleen and pancreas via the left gastric, common hepatic and splenic arteries.', {
    extra: () => [
      tube([[0.014, 1.16, -0.008], [-0.01, 1.145, 0.0], [-0.03, 1.125, 0.015]], { r: 0.0022, radial: 8, flow0: 0.15 }),
      tube([[0.014, 1.16, -0.008], [0.05, 1.135, -0.03], [0.08, 1.125, -0.038], [0.098, 1.128, -0.046]], { r: 0.0022, radial: 8, flow0: 0.15 }),
      tube([[0.014, 1.16, -0.008], [0.03, 1.165, 0.0], [0.042, 1.155, 0.005]], { r: 0.0015, radial: 8, flow0: 0.15 }),
    ],
  });
  vessel('art.sma', 'Superior mesenteric artery', aTr, 'artery', [[0.012, 1.135, -0.025], [0.01, 1.115, 0.002], [0.004, 1.06, 0.03], [-0.025, 0.99, 0.04], [-0.05, 0.95, 0.035]], 0.0034, 0.0018, 'Supplies the small intestine, cecum, ascending and most of the transverse colon through a fan of jejunal and ileal arcades.', { twigs: 30, twigDepth: 3, twigLen: [0.03, 0.06], twigR: 0.0016, seed: 77 });
  vessel('art.ima', 'Inferior mesenteric artery', aTr, 'artery', [[0.008, 1.08, -0.012], [0.03, 1.04, 0.0], [0.06, 0.98, 0.0], [0.05, 0.93, 0.0]], 0.0021, 0.0014, 'Supplies the descending colon, sigmoid colon and upper rectum.', { twigs: 12, twigDepth: 3, twigLen: [0.025, 0.05], seed: 9 });

  // ------------------------------------------------------------------ veins (trunk)
  vessel('vein.ivc', 'Inferior vena cava', vTr, 'vein', [[-0.028, 1.215, -0.002], [-0.022, 1.15, -0.014], [-0.02, 1.1, -0.022], [-0.016, 1.06, -0.016], [-0.008, 1.035, -0.012]], 0.0108, 0.0092, 'Formed by the union of the common iliac veins; ascends to the right of the aorta to the right atrium.');
  vessel('vein.azygos', 'Azygos vein', vTr, 'vein', [[-0.028, 1.39, 0.0], [-0.02, 1.4, -0.04], [-0.014, 1.33, -0.056], [-0.014, 1.2, -0.05], [-0.016, 1.12, -0.04]], 0.0034, 0.0026, 'Drains the posterior thoracic wall into the superior vena cava, arching over the right lung root.');
  vessel('vein.portal', 'Hepatic portal vein', vTr, 'vein', [[-0.025, 1.112, 0.012], [-0.01, 1.092, 0.002], [0.01, 1.078, -0.005]], 0.0062, 0.005, 'Carries nutrient-rich blood from the gut and spleen to the liver.', {
    extra: () => [
      tube([[0.01, 1.078, -0.005], [0.05, 1.095, -0.026], [0.098, 1.124, -0.046]], { r: 0.0035, radial: 10, flow0: 0.2 }),
      tube([[0.01, 1.078, -0.005], [0.005, 1.04, 0.025], [-0.02, 0.99, 0.038]], { r: 0.0038, radial: 10, flow0: 0.2 }),
      ...twigs([[0.005, 1.04, 0.025], [-0.02, 0.99, 0.038]], 8, { len: [0.02, 0.04], r: 0.001, flow0: 0.2, seed: 99, inside: underSkin() }),
    ],
  });
  vessel('vein.hepatic', 'Hepatic veins', vTr, 'vein', [[-0.024, 1.17, -0.01], [-0.05, 1.16, 0.0], [-0.08, 1.15, 0.01]], 0.0042, 0.002, 'Drain the liver into the inferior vena cava just below the diaphragm.', {
    twigs: 6, twigLen: [0.015, 0.03], seed: 31,
    extra: () => [tube([[-0.024, 1.17, -0.01], [0.0, 1.17, 0.01], [0.03, 1.16, 0.025]], { r: (t) => 0.0035 - 0.0018 * t, radial: 10, flow0: 0.1 })],
  });
  vessel('vein.sinuses', 'Dural venous sinuses', vHN, 'vein', [[0, 1.71, 0.072], [0, 1.748, 0.02], [0, 1.735, -0.05], [0, 1.69, -0.09], [0, 1.655, -0.095]], 0.0028, 0.0034, 'Superior sagittal, transverse and sigmoid sinuses draining the brain into the internal jugular veins.', {
    extra: () => SIDES.map((s) => tube([[0, 1.655, -0.095], [s * 0.035, 1.648, -0.085], [s * 0.052, 1.63, -0.05], [s * 0.042, 1.605, -0.015]], { r: 0.003, radial: 10, flow0: 0.6 })),
  });

  // ---- visceral arterial / venous trees (bounded by approximate organ envelopes and the skin)
  let liverC: Shape | null = null;
  const liverIn: Inside = (p) => { liverC ??= ellipsoid([-0.07, 1.14, 0.03], [0.1, 0.058, 0.07]); return Math.max(skinD(p) + 0.002, liverC.d(p[0], p[1], p[2])); };
  vessel('art.hepatic_tree', 'Hepatic arteries (intrahepatic tree)', aTr, 'artery', [[-0.03, 1.125, 0.015], [-0.05, 1.13, 0.03], [-0.075, 1.14, 0.04]], 0.0019, 0.0013, 'Common and proper hepatic arteries dividing into right and left branches that ramify through the liver alongside the portal vein.', { twigs: 12, twigDepth: 3, twigR: 0.0013, twigLen: [0.025, 0.05], twigRange: [0.15, 1], inside: liverIn, twigMargin: 0.004, seed: 201 });
  vessel('art.splenic_tree', 'Splenic artery & hilar branches', aTr, 'artery', [[0.098, 1.128, -0.046], [0.11, 1.136, -0.058], [0.12, 1.15, -0.066]], 0.0018, 0.0012, 'Tortuous artery along the upper border of the pancreas that fans into segmental branches at the splenic hilum.', { twigs: 8, twigDepth: 2, twigR: 0.001, twigLen: [0.02, 0.04], twigRange: [0.2, 1], seed: 211 });
  vessel('art.gastric_arcades', 'Gastric arcades', aTr, 'artery', [[0.042, 1.155, 0.005], [0.06, 1.14, 0.03], [0.07, 1.12, 0.042], [0.05, 1.1, 0.052], [0.02, 1.09, 0.052]], 0.0016, 0.001, 'Left and right gastric and gastro-omental arteries forming arcades along the lesser and greater curvatures of the stomach.', {
    twigs: 12, twigDepth: 2, twigR: 0.0009, twigLen: [0.015, 0.035], seed: 221,
    extra: () => {
      const g: V3[] = [[-0.02, 1.07, 0.052], [0.02, 1.04, 0.056], [0.06, 1.05, 0.052], [0.09, 1.09, 0.032], [0.1, 1.125, 0.0]];
      return [tube(g.map((q) => tuck(q, skinD, 0.006)), { r: (t) => 0.0017 - 0.0007 * t, radial: 8, flow0: 0.3 }), ...arbor(g, { seed: 223, count: 14, r: 0.001, len: [0.015, 0.035], depth: 2, flow0: 0.3, inside: skinD, margin: 0.005, rp: [0.0017, 0.001] })];
    },
  });
  vessel('vein.portal_tree', 'Portal vein (intrahepatic branches)', vTr, 'vein', [[-0.025, 1.112, 0.012], [-0.04, 1.12, 0.026], [-0.07, 1.13, 0.04], [-0.1, 1.14, 0.05]], 0.0046, 0.003, 'Right and left portal branches dividing within the liver down to the sinusoids.', { twigs: 12, twigDepth: 3, twigR: 0.0022, twigLen: [0.025, 0.05], twigRange: [0.2, 1], inside: liverIn, twigMargin: 0.004, seed: 231 });
  vessel('vein.hepatic_tree', 'Hepatic veins (intrahepatic radicles)', vTr, 'vein', [[-0.04, 1.162, 0.0], [-0.07, 1.172, 0.02], [-0.1, 1.18, 0.03]], 0.0036, 0.0022, 'Right, middle and left hepatic veins collecting from the liver lobules.', { twigs: 12, twigDepth: 3, twigR: 0.0018, twigLen: [0.025, 0.05], twigRange: [0.15, 1], inside: liverIn, twigMargin: 0.004, seed: 241 });
  vessel('vein.mesenteric_tree', 'Mesenteric venous arcades', vTr, 'vein', [[0.005, 1.04, 0.025], [-0.02, 0.99, 0.038], [-0.05, 0.95, 0.035]], 0.0034, 0.002, 'Superior mesenteric vein tributaries — jejunal, ileal, ileocolic and right colic veins — draining the small intestine and right colon.', { twigs: 26, twigDepth: 3, twigR: 0.0016, twigLen: [0.03, 0.06], twigRange: [0.05, 1], seed: 251 });
  vessel('vein.splenic', 'Splenic vein', vTr, 'vein', [[0.098, 1.124, -0.046], [0.11, 1.14, -0.06], [0.12, 1.152, -0.068]], 0.0034, 0.002, 'Collects blood from the spleen, pancreas and stomach and joins the superior mesenteric vein to form the portal vein.', { twigs: 6, twigDepth: 2, twigR: 0.0013, twigLen: [0.02, 0.04], seed: 261 });
  vessel('vein.hemiazygos', 'Hemiazygos vein', vTr, 'vein', [[0.016, 1.1, -0.04], [0.02, 1.2, -0.05], [0.02, 1.3, -0.056], [0.006, 1.336, -0.057], [-0.014, 1.33, -0.056]], 0.0024, 0.0028, 'Drains the left posterior thoracic wall and crosses the vertebral column to join the azygos vein.', { twigs: 4, twigLen: [0.015, 0.03], seed: 271 });

  // pulmonary circulation in lungs
  for (const s of SIDES) {
    P({
      id: `cv.pulmtree.${sid(s)}`, name: `${sideName(s)} pulmonary vascular tree`, parent: 'cv.arteries', system: SYS, tissue: 'vein', anim: 'lung',
      desc: 'Pulmonary arterial branches accompanying the bronchi, bringing deoxygenated blood to the alveolar capillaries.',
      build: () => lungTree(s, s > 0 ? 501 : 777, 0.0038, 0.1, [0, 0.004, 0.006]),
    });
  }

  // ------------------------------------------------------------------ per-side
  for (const s of SIDES) {
    const S = sid(s), N = sideName(s), ln = lc(N);
    const aUL = G(`cv.art.upper.${S}`, `Arteries of ${ln} upper limb`, ART, SYS, 'Subclavian–axillary–brachial axis and the forearm and hand arteries.');
    const aLL = G(`cv.art.lower.${S}`, `Arteries of ${ln} lower limb`, ART, SYS, 'Iliac–femoral–popliteal axis and the leg and foot arteries.');
    const vUL = G(`cv.vein.upper.${S}`, `Veins of ${ln} upper limb`, VEN, SYS, 'Deep veins paired with arteries and the superficial cephalic and basilic veins.');
    const vLL = G(`cv.vein.lower.${S}`, `Veins of ${ln} lower limb`, VEN, SYS, 'Deep femoral–popliteal veins and the superficial saphenous system.');
    const carBif = X(s, [0.028, 1.556, 0.015]);
    vessel(`art.carotid.${S}`, `${N} common carotid artery`, aHN, 'artery', s > 0 ? [[0.01, 1.392, -0.004], [0.022, 1.44, 0.012], [0.025, 1.5, 0.018], carBif] : [[-0.022, 1.44, 0.018], [-0.025, 1.5, 0.018], carBif], 0.0044, 0.0042, 'Ascends in the carotid sheath beside the trachea and divides at the level of the thyroid cartilage.');
    vessel(`art.int_carotid.${S}`, `${N} internal carotid artery`, aHN, 'artery', [carBif, X(s, [0.031, 1.58, 0.0]), X(s, [0.025, 1.612, 0.0]), X(s, [0.018, 1.628, 0.008]), X(s, [0.011, 1.634, 0.012])], 0.0029, 0.0024, 'Enters the skull through the carotid canal to supply the brain and eyes.');
    vessel(`art.cerebral.${S}`, `${N} cerebral arteries`, aHN, 'artery', [X(s, [0.011, 1.634, 0.012]), X(s, [0.03, 1.64, 0.012]), X(s, [0.055, 1.652, 0.0]), X(s, [0.062, 1.68, -0.02])], 0.0019, 0.0011, 'Anterior, middle and posterior cerebral arteries arising from the circle of Willis.', {
      twigs: 12, twigLen: [0.02, 0.04], seed: s > 0 ? 3 : 5, insideShape: brainSpace,
      extra: () => [
        tube(XS(s, [[0.011, 1.634, 0.012], [0.005, 1.645, 0.045], [0.004, 1.69, 0.06], [0.004, 1.725, 0.02], [0.004, 1.72, -0.03]]), { r: 0.0013, radial: 8, flow0: 0.5 }),
        tube(XS(s, [[0.004, 1.628, -0.004], [0.022, 1.632, -0.03], [0.03, 1.645, -0.065]]), { r: 0.0014, radial: 8, flow0: 0.5 }),
        ...twigs(XS(s, [[0.004, 1.69, 0.06], [0.004, 1.725, 0.02], [0.004, 1.72, -0.03]]), 5, { len: [0.02, 0.035], r: 0.0007, flow0: 0.5, seed: 12, avoid: [0, 1.67, 0], inside: underSkin(brainSpace) }),
      ],
    });
    vessel(`art.vertebral.${S}`, `${N} vertebral artery`, aHN, 'artery', () => {
      const pts: V3[] = [X(s, [0.04, 1.44, -0.005])];
      for (const v of VERTEBRAE.slice(0, 6).reverse()) pts.push(add(v.c, mul(v.lat, s * 0.019)));
      pts.push(X(s, [0.008, 1.6, -0.022]), [0, 1.61, -0.014]);
      return pts;
    }, 0.0022, 0.0019, 'Ascends through the transverse foramina of the cervical vertebrae and unites with its partner to form the basilar artery.');
    vessel(`art.pcom.${S}`, `${N} posterior communicating artery`, aHN, 'artery', [X(s, [0.011, 1.634, 0.01]), X(s, [0.008, 1.631, 0.003]), X(s, [0.005, 1.629, -0.003])], 0.0007, 0.0007, 'Joins the internal carotid to the posterior cerebral artery, linking the anterior and posterior circulations of the circle of Willis.', { insideShape: brainSpace });
    vessel(`art.ext_carotid.${S}`, `${N} external carotid artery`, aHN, 'artery', [carBif, X(s, [0.036, 1.575, 0.028]), X(s, [0.05, 1.6, -0.002])], 0.0026, 0.002, 'Supplies the face, scalp, tongue and thyroid through facial, lingual, maxillary and superficial temporal branches.');
    const subStart: V3[] = s > 0 ? [[0.02, 1.388, -0.02], [0.035, 1.43, -0.012], [0.07, 1.452, 0.005], [0.12, 1.44, 0.01]] : [[-0.022, 1.44, 0.018], [-0.06, 1.452, 0.008], [-0.12, 1.44, 0.01]];
    vessel(`art.subclavian.${S}`, `${N} subclavian artery`, aUL, 'artery', subStart, 0.0052, 0.0048, 'Arches over the first rib to become the axillary artery; gives off the vertebral and internal thoracic arteries.');
    vessel(`art.int_thoracic.${S}`, `${N} internal thoracic artery`, aTr, 'artery', XS(s, [[0.06, 1.448, 0.03], [0.028, 1.43, 0.08], [0.026, 1.33, 0.09], [0.028, 1.22, 0.095]]), 0.0016, 0.0012, 'Descends behind the costal cartilages supplying the anterior chest wall and breast; often used for coronary bypass.');
    const brachEnd = forePt(s, 0.06, 0.0, 0.016);
    vessel(`art.brachial.${S}`, `${N} axillary & brachial arteries`, aUL, 'artery', [X(s, [0.12, 1.44, 0.01]), X(s, [0.155, 1.4, 0.004]), armPt(s, 0.15, -0.018, 0.01), armPt(s, 0.5, -0.02, 0.008), armPt(s, 0.92, -0.008, 0.016), brachEnd], 0.0042, 0.0031, 'Main artery of the arm running along the medial side of the humerus; its pulse is used to measure blood pressure.', { twigs: 12, twigLen: [0.02, 0.05], seed: 41 });
    vessel(`art.radial.${S}`, `${N} radial artery & deep palmar arch`, aUL, 'artery', [brachEnd, forePt(s, 0.3, 0.015, 0.017), forePt(s, 0.7, 0.018, 0.012), forePt(s, 1.0, 0.017, 0.01), handPt(s, 0.02, 0.025, 0.0), handPt(s, 0.04, 0.02, 0.002), handPt(s, 0.045, 0.0, 0.002), handPt(s, 0.045, -0.02, 0.002)], 0.0023, 0.0015, 'Runs along the thumb side of the forearm — the site where the pulse is usually taken at the wrist.', { twigs: 9, twigLen: [0.015, 0.035], seed: 51 });
    vessel(`art.ulnar.${S}`, `${N} ulnar artery & superficial palmar arch`, aUL, 'artery', [brachEnd, forePt(s, 0.25, -0.015, 0.02), forePt(s, 0.7, -0.018, 0.012), forePt(s, 1.0, -0.016, 0.01), handPt(s, 0.02, -0.02, 0.008), handPt(s, 0.055, -0.02, 0.009), handPt(s, 0.06, 0.0, 0.009), handPt(s, 0.055, 0.02, 0.009)], 0.0024, 0.0015, 'Larger terminal branch of the brachial artery on the little-finger side, forming the superficial palmar arch.', { twigs: 9, twigLen: [0.015, 0.035], seed: 61 });
    vessel(`art.digital.${S}`, `${N} digital arteries of hand`, aUL, 'artery', [], 0.0009, 0.0009, 'Palmar digital arteries running along both sides of each finger.', {
      extra: () => {
        const { N: Nh, L } = handFrame(s);
        const list = FINGERS.flatMap((f, i) => {
          const j = fingerJoints(s, i);
          return [-1, 1].map((side) => tube([handPt(s, 0.06, f.base * 0.8, 0.009), ...j.slice(0, 4).map((p, k) => add(add(p, mul(Nh, 0.004 - k * 0.0006)), mul(L, side * 0.006 * f.r)))], { r: 0.0007, radial: 6, flow0: 1.2 }));
        });
        const t = thumbJoints(s);
        list.push(tube([handPt(s, 0.04, 0.02, 0.006), add(t[1], mul(Nh, 0.006)), add(t[2], mul(Nh, 0.005)), add(t[3], mul(Nh, 0.003))], { r: 0.0008, radial: 6, flow0: 1.2 }));
        return list;
      },
    });
    vessel(`art.renal.${S}`, `${N} renal artery`, aTr, 'artery', [X(s, [0.008, 1.125, -0.03]), lerp(X(s, [0.008, 1.125, -0.03]), KIDNEY(s).hilum, 0.5), KIDNEY(s).hilum], 0.0029, 0.0025, 'Carries about 20% of cardiac output to the kidney.', {
      extra: () => [branchTree(KIDNEY(s).hilum, [s * 0.9, 0, -0.2], { len: 0.012, r: 0.0018, depth: 4, seed: 8, spread: 0.7, flow0: 0.4 })],
    });
    vessel(`art.intercostal.${S}`, `${N} posterior intercostal arteries`, aTr, 'artery', [], 0.001, 0.001, 'Branches of the thoracic aorta running in the costal grooves beneath each rib.', {
      extra: () => {
        const list: Geo[] = [];
        for (let i = 3; i <= 11; i++) {
          const b = ribPaths(s, i)[0].slice(1);
          const pts = b.filter((_, k) => k % 2 === 0).map((p) => add(p, [0, -0.0055, 0.0]));
          list.push(tube([X(s, [0.02, b[0][1] - 0.01, -0.045]), ...pts], { r: (t) => 0.0012 - 0.0005 * t, radial: 6, flow0: 0.4 }));
        }
        return list;
      },
    });
    vessel(`art.common_iliac.${S}`, `${N} common iliac artery`, aLL, 'artery', XS(s, [[0.0, 1.062, -0.008], [0.03, 1.022, -0.004], [0.045, 0.99, 0.0]]), 0.0058, 0.0052, 'Terminal branch of the aorta dividing into internal and external iliac arteries at the sacroiliac joint.');
    vessel(`art.int_iliac.${S}`, `${N} internal iliac artery`, aLL, 'artery', XS(s, [[0.045, 0.99, 0.0], [0.05, 0.96, -0.03], [0.042, 0.92, -0.05]]), 0.0032, 0.0022, 'Supplies the pelvic organs, perineum and gluteal region.', { twigs: 12, twigDepth: 3, twigLen: [0.025, 0.05], seed: 71 });
    const pop: V3 = X(s, [0.095, 0.46, -0.03]);
    vessel(`art.femoral.${S}`, `${N} external iliac, femoral & popliteal arteries`, aLL, 'artery', XS(s, [[0.045, 0.99, 0.0], [0.07, 0.94, 0.04], [0.081, 0.905, 0.064], [0.086, 0.85, 0.056], [0.086, 0.72, 0.036], [0.081, 0.6, 0.0], [0.086, 0.56, -0.026], [0.095, 0.5, -0.036], [0.095, 0.46, -0.03]]), 0.0048, 0.0036, 'The main arterial trunk of the lower limb, passing through the femoral triangle and adductor canal to the back of the knee.', { twigs: 22, twigLen: [0.03, 0.07], seed: 81 });
    vessel(`art.profunda.${S}`, `${N} deep femoral artery`, aLL, 'artery', XS(s, [[0.086, 0.84, 0.052], [0.106, 0.78, 0.02], [0.11, 0.65, -0.012]]), 0.0029, 0.0018, 'Largest branch of the femoral artery supplying the thigh muscles via perforating arteries.', { twigs: 12, twigLen: [0.03, 0.06], seed: 91 });
    vessel(`art.ant_tibial.${S}`, `${N} anterior tibial & dorsalis pedis arteries`, aLL, 'artery', [pop, X(s, [0.108, 0.445, -0.005]), X(s, [0.1, 0.3, 0.01]), X(s, [0.09, 0.12, 0.02]), footPt(s, 0.02, 0.0, 0.065), footPt(s, 0.08, -0.012, 0.042), footPt(s, 0.12, -0.02, 0.026)], 0.0025, 0.0015, 'Descends along the interosseous membrane and continues onto the dorsum of the foot, where the dorsalis pedis pulse is felt.', { twigs: 9, twigLen: [0.02, 0.045], seed: 101 });
    vessel(`art.post_tibial.${S}`, `${N} posterior tibial & plantar arteries`, aLL, 'artery', [pop, X(s, [0.09, 0.35, -0.035]), X(s, [0.08, 0.15, -0.03]), X(s, [0.07, 0.07, -0.02]), footPt(s, 0.0, -0.01, 0.015), footPt(s, 0.1, -0.008, 0.012), footPt(s, 0.12, 0.02, 0.012)], 0.0025, 0.0014, 'Passes behind the medial malleolus to supply the sole through the medial and lateral plantar arteries.', { twigs: 9, twigLen: [0.02, 0.045], seed: 111 });
    vessel(`art.fibular.${S}`, `${N} fibular artery`, aLL, 'artery', XS(s, [[0.093, 0.43, -0.033], [0.115, 0.3, -0.03], [0.112, 0.12, -0.03]]), 0.0018, 0.0012, 'Branch of the posterior tibial artery supplying the lateral compartment of the leg.');

    // ---- veins
    const jj = X(s, [0.05, 1.45, 0.02]);
    vessel(`vein.brachioceph.${S}`, `${N} brachiocephalic vein`, vTr, 'vein', s > 0 ? [[-0.028, 1.418, 0.012], [0.0, 1.43, 0.034], [0.03, 1.445, 0.03], jj] : [[-0.028, 1.418, 0.012], [-0.04, 1.44, 0.016], jj], 0.0068, 0.0062, 'Formed by the union of the internal jugular and subclavian veins; the two join to form the superior vena cava.');
    vessel(`vein.int_jugular.${S}`, `${N} internal jugular vein`, vHN, 'vein', [jj, X(s, [0.035, 1.5, 0.022]), X(s, [0.037, 1.56, 0.008]), X(s, [0.042, 1.605, -0.015])], 0.0058, 0.0048, 'Drains the brain, face and neck; runs in the carotid sheath lateral to the carotid artery.');
    vessel(`vein.ext_jugular.${S}`, `${N} external jugular vein`, vHN, 'vein', XS(s, [[0.055, 1.452, 0.02], [0.056, 1.52, 0.022], [0.056, 1.58, 0.006], [0.06, 1.62, -0.004]]), 0.0022, 0.0018, 'Superficial vein crossing the sternocleidomastoid — visible when straining.', { conformDepth: 0.003, conformRange: [0.2, 1] });
    vessel(`vein.subclavian.${S}`, `${N} subclavian, axillary & brachial veins`, vUL, 'vein', [jj, X(s, [0.1, 1.442, 0.022]), X(s, [0.15, 1.41, 0.012]), armPt(s, 0.15, -0.024, 0.016), armPt(s, 0.5, -0.025, 0.012), armPt(s, 0.9, -0.012, 0.02), forePt(s, 0.06, -0.004, 0.018)], 0.0052, 0.0028, 'Deep veins of the upper limb accompanying the arteries back to the brachiocephalic vein.');
    vessel(`vein.cephalic.${S}`, `${N} cephalic vein`, vUL, 'vein', [X(s, [0.13, 1.442, 0.022]), X(s, [0.15, 1.43, 0.03]), armPt(s, 0.2, 0.02, 0.035), armPt(s, 0.6, 0.022, 0.02), forePt(s, 0.05, 0.03, 0.015), forePt(s, 0.5, 0.03, 0.01), forePt(s, 1.0, 0.022, 0.0), handPt(s, 0.04, 0.03, -0.01)], 0.0025, 0.0016, 'Superficial vein along the lateral arm, draining into the axillary vein through the deltopectoral groove.', { conformDepth: 0.0055, conformRange: [0.12, 1], twigs: 5, seed: 121 });
    vessel(`vein.basilic.${S}`, `${N} basilic vein`, vUL, 'vein', [armPt(s, 0.5, -0.022, 0.0), armPt(s, 0.7, -0.026, 0.0), forePt(s, 0.05, -0.03, 0.01), forePt(s, 0.5, -0.03, 0.008), forePt(s, 1.0, -0.02, 0.0), handPt(s, 0.04, -0.03, -0.01)], 0.0024, 0.0016, 'Superficial vein of the medial forearm and arm, piercing the deep fascia to join the brachial veins.', { conformDepth: 0.0055, conformRange: [0.15, 1], twigs: 4, seed: 131 });
    vessel(`vein.median_cubital.${S}`, `${N} median cubital vein`, vUL, 'vein', [forePt(s, 0.12, 0.028, 0.015), forePt(s, 0.07, 0.0, 0.02), forePt(s, 0.02, -0.025, 0.012)], 0.0019, 0.0019, 'Links the cephalic and basilic veins in front of the elbow — the usual site for drawing blood.', { conformDepth: 0.002 });
    vessel(`vein.dorsal_hand.${S}`, `${N} dorsal venous network of hand`, vUL, 'vein', [handPt(s, 0.04, -0.03, -0.01), handPt(s, 0.05, -0.012, -0.012), handPt(s, 0.05, 0.012, -0.012), handPt(s, 0.04, 0.03, -0.01)], 0.0014, 0.0014, 'Superficial veins on the back of the hand draining into the cephalic and basilic veins.', { conformDepth: 0.0016, twigs: 6, twigLen: [0.015, 0.03], seed: 141 });
    vessel(`vein.renal.${S}`, `${N} renal vein`, vTr, 'vein', [X(s, [-0.018 * s + (s > 0 ? 0.0 : 0.0), 1.12, -0.022]), KIDNEY(s).hilum], 0.0036, 0.0032, 'Drains the kidney into the inferior vena cava; the left renal vein crosses in front of the aorta.');
    vessel(`vein.common_iliac.${S}`, `${N} common iliac vein`, vLL, 'vein', [[-0.008, 1.035, -0.012], X(s, [0.035, 1.008, -0.01]), X(s, [0.05, 0.985, 0.0])], 0.0062, 0.0058, 'Unites with its partner at L5 to form the inferior vena cava.');
    vessel(`vein.femoral.${S}`, `${N} external iliac, femoral & popliteal veins`, vLL, 'vein', XS(s, [[0.05, 0.985, 0.0], [0.065, 0.94, 0.04], [0.071, 0.905, 0.064], [0.075, 0.85, 0.054], [0.077, 0.72, 0.032], [0.074, 0.6, -0.002], [0.084, 0.555, -0.03], [0.091, 0.5, -0.042], [0.09, 0.46, -0.036]]), 0.0052, 0.0038, 'Deep venous trunk of the lower limb, a common site of deep vein thrombosis.', {
      extra: () => [
        tube([X(s, [0.09, 0.46, -0.036]), X(s, [0.098, 0.35, -0.04]), X(s, [0.086, 0.15, -0.034]), X(s, [0.074, 0.07, -0.024])], { r: 0.0021, radial: 8, flow0: 1.6 }),
        tube([X(s, [0.09, 0.46, -0.036]), X(s, [0.112, 0.445, -0.01]), X(s, [0.104, 0.3, 0.006]), X(s, [0.094, 0.12, 0.016])], { r: 0.0019, radial: 8, flow0: 1.6 }),
      ],
    });
    vessel(`vein.great_saphenous.${S}`, `${N} great saphenous vein`, vLL, 'vein', [X(s, [0.072, 0.86, 0.058]), X(s, [0.056, 0.8, 0.05]), X(s, [0.05, 0.7, 0.02]), X(s, [0.062, 0.5, -0.022]), X(s, [0.066, 0.35, -0.012]), X(s, [0.07, 0.16, 0.008]), X(s, [0.072, 0.085, 0.016]), footPt(s, 0.07, -0.026, 0.045)], 0.0028, 0.0018, 'The longest vein in the body, running superficially from the medial foot to the groin; used for bypass grafts.', { conformDepth: 0.0045, conformRange: [0.1, 1], twigs: 14, twigLen: [0.02, 0.05], seed: 151 });
    vessel(`vein.small_saphenous.${S}`, `${N} small saphenous vein`, vLL, 'vein', [X(s, [0.093, 0.5, -0.045]), X(s, [0.093, 0.42, -0.07]), X(s, [0.094, 0.22, -0.062]), X(s, [0.114, 0.085, -0.04]), footPt(s, 0.05, 0.032, 0.025)], 0.002, 0.0015, 'Superficial vein of the back of the calf draining into the popliteal vein.', { conformDepth: 0.0045, conformRange: [0.2, 1], twigs: 4, seed: 161 });
    vessel(`vein.dorsal_foot.${S}`, `${N} dorsal venous arch of foot`, vLL, 'vein', [footPt(s, 0.07, -0.026, 0.045), footPt(s, 0.095, -0.005, 0.045), footPt(s, 0.09, 0.02, 0.038), footPt(s, 0.05, 0.032, 0.025)], 0.0015, 0.0015, 'Superficial arch on the dorsum of the foot from which both saphenous veins arise.', { conformDepth: 0.0016, twigs: 5, twigLen: [0.012, 0.025], seed: 171 });

    // ================================================================ additional named branches (angiogram density)
    const xs = (...pts: number[][]) => pts.map((p) => X(s, p as V3));
    const av = (key: string, name: string, par: string, pts: V3[] | (() => V3[]), r0: number, r1: number, desc: string, o: VOpts = {}) => vessel(`art.${key}.${S}`, `${N} ${name}`, par, 'artery', pts, r0, r1, desc, o);
    const vv = (key: string, name: string, par: string, pts: V3[] | (() => V3[]), r0: number, r1: number, desc: string, o: VOpts = {}) => vessel(`vein.${key}.${S}`, `${N} ${name}`, par, 'vein', pts, r0, r1, desc, o);
    const cj = (d: number): VOpts => ({ conformDepth: d });

    // head & neck
    av('sup_thyroid', 'superior thyroid artery', aHN, xs([0.03, 1.55, 0.022], [0.026, 1.53, 0.032], [0.018, 1.51, 0.034], [0.012, 1.49, 0.03]), 0.0014, 0.0008, 'First branch of the external carotid, descending to the upper pole of the thyroid gland.', { twigs: 3, seed: 301 + s });
    av('lingual', 'lingual artery', aHN, xs([0.034, 1.564, 0.022], [0.03, 1.57, 0.042], [0.02, 1.578, 0.062], [0.01, 1.586, 0.072]), 0.0015, 0.0009, 'Loops above the hyoid bone to supply the tongue and floor of the mouth.', { twigs: 4, twigLen: [0.01, 0.025], seed: 311 + s });
    av('facial', 'facial artery', aHN, [X(s, [0.036, 1.575, 0.028]), conform(X(s, [0.045, 1.56, 0.052]), 0.006), conform(X(s, [0.04, 1.575, 0.075]), 0.006), conform(X(s, [0.028, 1.6, 0.088]), 0.006), conform(X(s, [0.02, 1.632, 0.09]), 0.005), conform(X(s, [0.014, 1.655, 0.09]), 0.005)], 0.0016, 0.0008, 'Winds over the lower border of the mandible and runs obliquely across the face to the corner of the eye.', { twigs: 6, twigLen: [0.012, 0.03], seed: 321 + s, conformDepth: 0.005, conformRange: [0.25, 1] });
    av('sup_temporal', 'superficial temporal artery', aHN, [conform(X(s, [0.066, 1.64, 0.004]), 0.005), conform(X(s, [0.07, 1.7, 0.012]), 0.005), conform(X(s, [0.045, 1.745, 0.03]), 0.005), conform(X(s, [0.02, 1.76, 0.05]), 0.005)], 0.0016, 0.0008, 'Terminal branch of the external carotid ascending in front of the ear; its pulse is felt at the temple.', { twigs: 7, twigLen: [0.02, 0.04], seed: 331 + s, conformDepth: 0.005 });
    av('occipital', 'occipital artery', aHN, [X(s, [0.05, 1.6, -0.002]), conform(X(s, [0.05, 1.62, -0.05]), 0.007), conform(X(s, [0.035, 1.675, -0.095]), 0.006), conform(X(s, [0.02, 1.72, -0.085]), 0.005)], 0.0014, 0.0008, 'Runs backward along the base of the skull to supply the posterior scalp.', { twigs: 5, twigLen: [0.02, 0.04], seed: 341 + s, conformDepth: 0.006, conformRange: [0.25, 1] });
    av('post_auricular', 'posterior auricular artery', aHN, [X(s, [0.05, 1.6, -0.002]), conform(X(s, [0.066, 1.625, -0.02]), 0.006), conform(X(s, [0.075, 1.655, -0.025]), 0.005)], 0.0009, 0.0006, 'Supplies the scalp behind the ear and the auricle.', { twigs: 2, twigLen: [0.012, 0.025], seed: 351 + s, conformDepth: 0.005, conformRange: [0.3, 1] });
    av('maxillary', 'maxillary artery', aHN, xs([0.05, 1.6, -0.002], [0.058, 1.598, 0.02], [0.05, 1.6, 0.045], [0.036, 1.6, 0.062], [0.022, 1.618, 0.074]), 0.0018, 0.0009, 'Larger terminal branch of the external carotid, supplying the deep face, jaws, teeth, nose and meninges.', { twigs: 8, twigLen: [0.015, 0.035], seed: 361 + s });
    av('thyrocervical', 'thyrocervical trunk & inferior thyroid artery', aUL, xs([0.04, 1.436, -0.008], [0.04, 1.46, -0.004], [0.03, 1.485, 0.01], [0.02, 1.505, 0.025]), 0.0024, 0.0012, 'Arises from the subclavian artery; the inferior thyroid branch ascends behind the carotid sheath to the thyroid gland.', { twigs: 3, seed: 371 + s });
    av('suprascapular', 'suprascapular artery', aUL, xs([0.05, 1.442, -0.004], [0.085, 1.466, -0.03], [0.12, 1.462, -0.065], [0.14, 1.43, -0.092]), 0.0018, 0.001, 'Crosses the scapular notch to supply the supraspinatus and infraspinatus.', { twigs: 4, twigLen: [0.015, 0.035], seed: 381 + s });
    av('transverse_cervical', 'transverse cervical artery', aUL, xs([0.05, 1.445, -0.004], [0.07, 1.48, -0.03], [0.075, 1.46, -0.075], [0.066, 1.4, -0.088], [0.05, 1.34, -0.09]), 0.0018, 0.001, 'Crosses the posterior triangle of the neck, giving a deep branch along the medial border of the scapula.', { twigs: 5, twigLen: [0.015, 0.035], seed: 391 + s });
    av('costocervical', 'costocervical trunk', aUL, xs([0.04, 1.43, -0.018], [0.03, 1.445, -0.045], [0.03, 1.47, -0.06], [0.032, 1.5, -0.05]), 0.0016, 0.0009, 'Supplies the first two intercostal spaces and the deep muscles of the neck.', { twigs: 3, seed: 401 + s });
    av('inf_phrenic', 'inferior phrenic artery', aTr, xs([0.012, 1.165, -0.03], [0.04, 1.19, -0.032], [0.07, 1.22, -0.01], [0.082, 1.225, 0.03]), 0.0014, 0.0008, 'Supplies the underside of the diaphragm and gives small branches to the adrenal gland.', { twigs: 4, twigLen: [0.015, 0.03], seed: 411 + s });
    av('suprarenal', 'suprarenal arteries', aTr, xs([0.012, 1.135, -0.03], [0.03, 1.15, -0.045], [0.042, 1.168, -0.05]), 0.0011, 0.0007, 'Several small arteries to the adrenal gland from the aorta, inferior phrenic and renal arteries.', { twigs: 3, twigLen: [0.01, 0.02], seed: 421 + s });
    av('gonadal', 'gonadal artery', aTr, xs([0.012, 1.085, -0.02], [0.03, 1.03, -0.005], [0.05, 0.97, 0.03], [0.052, 0.95, 0.07]), 0.0012, 0.0009, 'Testicular artery descending on the psoas muscle to the deep inguinal ring and through the inguinal canal.', { seed: 431 + s });
    av('bronchial', 'bronchial artery', aTr, [[0.026, 1.322, -0.048], X(s, [0.04, 1.326, -0.04]), HILUM(s)], 0.0013, 0.0009, 'Systemic blood supply to the airway walls, arising from the descending aorta.', { twigs: 4, twigLen: [0.015, 0.03], seed: 441 + s });
    av('sup_epigastric', 'superior epigastric artery', aTr, xs([0.028, 1.225, 0.095], [0.03, 1.17, 0.103], [0.03, 1.12, 0.105]), 0.0012, 0.0008, 'Terminal branch of the internal thoracic artery entering the rectus sheath.', { twigs: 3, seed: 451 + s });
    av('inf_epigastric', 'inferior epigastric artery', aLL, xs([0.07, 0.95, 0.04], [0.05, 0.99, 0.08], [0.036, 1.05, 0.098], [0.03, 1.12, 0.104]), 0.0018, 0.001, 'Rises from the external iliac artery along the rectus abdominis and anastomoses with the superior epigastric artery.', { twigs: 4, seed: 461 + s });
    av('deep_circ_iliac', 'deep circumflex iliac artery', aLL, xs([0.07, 0.95, 0.04], [0.1, 0.96, 0.034], [0.14, 0.975, 0.0], [0.15, 0.99, -0.03]), 0.0014, 0.0009, 'Runs along the iliac crest supplying the abdominal wall muscles.', { twigs: 3, seed: 471 + s });
    for (let i = 0; i < 4; i++) {
      const y = 1.098 - i * 0.027;
      av(`lumbar${i + 1}`, `lumbar artery ${i + 1}`, aTr, xs([0.006, y, -0.016 - 0.002 * i], [0.03, y - 0.002, -0.04], [0.052, y - 0.004, -0.058], [0.072, y - 0.006, -0.07]), 0.0013, 0.0008, 'Paired posterior branch of the abdominal aorta passing around the vertebral body to the posterior abdominal wall.', { twigs: 2, twigLen: [0.015, 0.03], seed: 481 + i * 7 + s });
    }

    // upper limb
    av('thoracoacromial', 'thoracoacromial artery', aUL, xs([0.14, 1.408, 0.014], [0.13, 1.42, 0.045], [0.105, 1.405, 0.075]), 0.0015, 0.0008, 'Pierces the clavipectoral fascia and fans out to the pectoral muscles, deltoid and acromion.', { twigs: 5, twigLen: [0.015, 0.035], seed: 501 + s });
    av('lat_thoracic', 'lateral thoracic artery', aUL, xs([0.158, 1.396, 0.004], [0.15, 1.35, 0.05], [0.14, 1.29, 0.076], [0.13, 1.23, 0.082]), 0.0015, 0.0008, 'Descends along the lateral border of pectoralis minor to the serratus anterior and breast.', { twigs: 6, twigLen: [0.02, 0.045], seed: 511 + s });
    av('subscapular', 'subscapular & thoracodorsal arteries', aUL, xs([0.158, 1.392, -0.004], [0.15, 1.36, -0.045], [0.14, 1.3, -0.072], [0.13, 1.24, -0.08]), 0.0024, 0.0012, 'Largest branch of the axillary artery, running along the lateral border of the scapula to latissimus dorsi.', { twigs: 7, twigLen: [0.02, 0.045], seed: 521 + s });
    av('circ_scapular', 'circumflex scapular artery', aUL, xs([0.152, 1.385, -0.03], [0.165, 1.38, -0.06], [0.15, 1.4, -0.088]), 0.0015, 0.0008, 'Winds around the lateral border of the scapula into the infraspinous fossa.', { twigs: 3, seed: 531 + s });
    av('post_circ_humeral', 'posterior circumflex humeral artery', aUL, xs([0.165, 1.395, -0.005], [0.19, 1.392, -0.03], [0.2, 1.418, -0.032], [0.205, 1.432, 0.0]), 0.0018, 0.0011, 'Passes through the quadrangular space around the surgical neck of the humerus to the deltoid.', { twigs: 4, seed: 541 + s });
    av('ant_circ_humeral', 'anterior circumflex humeral artery', aUL, xs([0.165, 1.395, 0.01], [0.19, 1.4, 0.03], [0.198, 1.422, 0.026]), 0.0011, 0.0007, 'Passes in front of the surgical neck of the humerus and anastomoses with the posterior circumflex artery.', { twigs: 2, seed: 551 + s });
    av('profunda_brachii', 'deep brachial artery', aUL, [armPt(s, 0.15, -0.012, -0.004), armPt(s, 0.33, 0.0, -0.028), armPt(s, 0.55, 0.022, -0.02), armPt(s, 0.74, 0.028, -0.004), armPt(s, 0.95, 0.026, 0.01)], 0.0025, 0.0011, 'Spirals behind the humerus in the radial groove supplying the triceps and anastomosing around the elbow.', { twigs: 6, twigLen: [0.02, 0.04], seed: 561 + s });
    av('sup_ulnar_collateral', 'ulnar collateral arteries', aUL, [armPt(s, 0.45, -0.022, 0.006), armPt(s, 0.75, -0.027, -0.006), armPt(s, 0.98, -0.028, -0.014)], 0.0013, 0.0009, 'Descend medially to the elbow anastomosis.', { twigs: 2, seed: 571 + s });
    av('radial_recurrent', 'radial recurrent artery', aUL, [forePt(s, 0.04, 0.012, 0.017), forePt(s, 0.0, 0.026, 0.02), armPt(s, 0.92, 0.027, 0.018)], 0.0012, 0.0008, 'Ascends between brachioradialis and brachialis to the elbow anastomosis.', { twigs: 2, seed: 581 + s });
    av('ulnar_recurrent', 'ulnar recurrent arteries', aUL, [forePt(s, 0.06, -0.01, 0.018), forePt(s, 0.0, -0.024, 0.01), armPt(s, 0.95, -0.027, 0.004)], 0.0012, 0.0008, 'Anterior and posterior recurrent branches ascending to the medial epicondyle.', { twigs: 2, seed: 591 + s });
    av('ant_interosseous', 'common & anterior interosseous arteries', aUL, [forePt(s, 0.06, -0.006, 0.016), forePt(s, 0.15, 0.0, 0.006), forePt(s, 0.55, 0.0, 0.0), forePt(s, 0.95, 0.0, 0.002)], 0.0018, 0.0009, 'Runs on the front of the interosseous membrane between the forearm bones, supplying the deep flexors.', { twigs: 5, twigLen: [0.015, 0.03], seed: 601 + s });
    av('post_interosseous', 'posterior interosseous artery', aUL, [forePt(s, 0.1, 0.0, 0.004), forePt(s, 0.18, 0.004, -0.012), forePt(s, 0.5, 0.007, -0.02), forePt(s, 0.92, 0.004, -0.014)], 0.0014, 0.0007, 'Passes through the interosseous membrane to supply the extensor muscles of the forearm.', { twigs: 5, twigLen: [0.015, 0.03], seed: 611 + s });
    av('dorsal_carpal', 'dorsal carpal arch & metacarpal arteries', aUL, [handPt(s, 0.018, 0.026, -0.011), handPt(s, 0.02, 0.01, -0.013), handPt(s, 0.02, -0.01, -0.013), handPt(s, 0.018, -0.026, -0.011)], 0.0009, 0.0009, 'Network on the back of the wrist giving dorsal metacarpal arteries to the fingers.', {
      extra: () => FINGERS.map((f) => tube([handPt(s, 0.02, f.l * 0.9, -0.013), handPt(s, f.h * 0.55, f.l, -0.0125), handPt(s, f.h - 0.004, f.l, -0.009)], { r: (t) => 0.0007 - 0.0003 * t, radial: 6, flow0: 1.1 })),
    });
    av('palmar_metacarpal', 'palmar metacarpal & common digital arteries', aUL, [], 0.0008, 0.0008, 'Branches of the palmar arches that divide into the proper palmar digital arteries.', {
      extra: () => FINGERS.map((f) => tube([handPt(s, 0.06, f.base * 0.8, 0.009), handPt(s, f.h * 0.7, (f.base * 0.8 + f.l) / 2, 0.008), handPt(s, f.h - 0.004, f.l, 0.007)], { r: (t) => 0.0009 - 0.0003 * t, radial: 6, flow0: 1.1 })),
    });

    // lower limb
    av('sup_gluteal', 'superior gluteal artery', aLL, xs([0.042, 0.92, -0.05], [0.07, 0.935, -0.078], [0.1, 0.965, -0.075], [0.125, 0.96, -0.05]), 0.0028, 0.0013, 'Largest branch of the internal iliac artery, leaving the pelvis above piriformis to supply gluteus maximus, medius and minimus.', { twigs: 9, twigLen: [0.02, 0.05], seed: 701 + s });
    av('inf_gluteal', 'inferior gluteal artery', aLL, xs([0.042, 0.92, -0.05], [0.06, 0.885, -0.082], [0.082, 0.84, -0.075], [0.09, 0.8, -0.05]), 0.0024, 0.0012, 'Leaves the pelvis below piriformis to supply gluteus maximus and the upper hamstrings.', { twigs: 7, twigLen: [0.02, 0.05], seed: 711 + s });
    av('obturator', 'obturator artery', aLL, xs([0.05, 0.945, -0.025], [0.07, 0.93, 0.0], [0.082, 0.9, 0.022], [0.085, 0.86, 0.03]), 0.0018, 0.001, 'Passes through the obturator canal to supply the adductor muscles and the head of the femur.', { twigs: 4, seed: 721 + s });
    av('int_pudendal', 'internal pudendal artery', aLL, xs([0.042, 0.92, -0.05], [0.032, 0.9, -0.042], [0.022, 0.88, -0.012], [0.016, 0.87, 0.03]), 0.0018, 0.001, 'Supplies the perineum and external genitalia.', { twigs: 3, seed: 731 + s });
    av('circ_femoral_lat', 'lateral circumflex femoral artery', aLL, xs([0.086, 0.84, 0.052], [0.11, 0.83, 0.05], [0.126, 0.78, 0.036], [0.122, 0.72, 0.02]), 0.0024, 0.0012, 'Ascending, transverse and descending branches supplying the quadriceps and hip.', { twigs: 6, twigLen: [0.02, 0.05], seed: 741 + s });
    av('circ_femoral_med', 'medial circumflex femoral artery', aLL, xs([0.086, 0.84, 0.05], [0.096, 0.85, 0.0], [0.1, 0.862, -0.03], [0.095, 0.88, -0.055]), 0.0022, 0.0011, 'Winds around the femoral neck, the main blood supply to the femoral head.', { twigs: 4, seed: 751 + s });
    av('perforating', 'perforating arteries', aLL, [], 0.0014, 0.0009, 'Branches of the deep femoral artery piercing adductor magnus to supply the hamstrings.', {
      extra: () => [[0.102, 0.8, 0.03], [0.108, 0.74, 0.012], [0.11, 0.68, 0.0], [0.108, 0.62, -0.01]].map((q, i) => tube(xs(q, [q[0] + 0.01, q[1], q[2] - 0.02], [q[0] + 0.006, q[1] - 0.004, q[2] - 0.05]).map((p) => tuck(p, skinD, 0.006)), { r: (t) => 0.0016 - 0.0006 * t - i * 0.0001, radial: 7, flow0: 1.0 })),
    });
    av('desc_genicular', 'descending genicular & saphenous arteries', aLL, xs([0.081, 0.6, 0.0], [0.072, 0.58, 0.018], [0.064, 0.53, 0.034], [0.066, 0.5, 0.04]), 0.0013, 0.0008, 'Arise in the adductor canal and run to the medial side of the knee.', { twigs: 3, seed: 761 + s });
    av('genicular', 'genicular anastomosis', aLL, [], 0.0013, 0.0009, 'Superior and inferior, medial and lateral genicular arteries encircling the knee and forming a rich collateral anastomosis.', {
      extra: () => {
        const kc = kneeJ(s);
        const ring = (y: number, rx: number, rz: number, ph: number) => {
          const pts: V3[] = [];
          for (let i = 0; i <= 18; i++) { const a = ph + (i / 18) * Math.PI * 1.75; pts.push([kc[0] + Math.cos(a) * rx, y, kc[2] + Math.sin(a) * rz]); }
          return pts.map((p) => tuck(p, skinD, 0.005));
        };
        const r1 = ring(kc[1] + 0.035, 0.036, 0.04, 0.3), r2 = ring(kc[1] - 0.035, 0.034, 0.038, 0.9);
        const geos = [r1, r2].map((r) => tube(r, { r: (t) => 0.0012 - 0.0004 * t, radial: 7, flow0: 1.1 }));
        for (let i = 0; i < 6; i++) { const k = 2 + i * 3; geos.push(tube([r1[Math.min(k, r1.length - 1)], lerp(r1[Math.min(k, r1.length - 1)], r2[Math.min(k, r2.length - 1)], 0.5), r2[Math.min(k, r2.length - 1)]], { r: 0.0006, radial: 5, flow0: 1.2 })); }
        return geos;
      },
    });
    av('sural', 'sural arteries', aLL, [], 0.0014, 0.0008, 'Muscular branches of the popliteal artery to the two heads of gastrocnemius.', {
      extra: () => [[0.085, 0.45, -0.034], [0.104, 0.45, -0.034]].map((q, i) => tube(xs([q[0] * s, q[1], q[2]].map((v, k) => (k === 0 ? Math.abs(v) : v)), [q[0] - 0.004 + i * 0.01, 0.41, -0.058], [q[0] - 0.002 + i * 0.012, 0.35, -0.066], [q[0] + i * 0.008, 0.3, -0.062]).map((p) => tuck(p, skinD, 0.006)), { r: (t) => 0.0014 - 0.0006 * t, radial: 7, flow0: 1.3 })),
      twigs: 6, twigLen: [0.02, 0.045], seed: 771 + s,
    });
    av('ant_tibial_muscular', 'anterior tibial muscular branches', aLL, xs([0.108, 0.445, -0.005], [0.108, 0.4, 0.004], [0.103, 0.34, 0.012]), 0.0016, 0.001, 'Muscular branches to the anterior compartment.', { twigs: 9, twigLen: [0.02, 0.045], seed: 781 + s });
    av('fibular_branches', 'fibular muscular branches', aLL, xs([0.115, 0.3, -0.03], [0.114, 0.22, -0.03], [0.112, 0.15, -0.03]), 0.0012, 0.0008, 'Muscular and perforating branches to the lateral and posterior compartments.', { twigs: 7, twigLen: [0.02, 0.04], seed: 791 + s });
    av('arcuate', 'arcuate & dorsal metatarsal arteries', aLL, [footPt(s, 0.085, -0.014, 0.04), footPt(s, 0.093, 0.0, 0.037), footPt(s, 0.1, 0.014, 0.034), footPt(s, 0.108, 0.028, 0.03)], 0.0011, 0.0009, 'Arch across the foot dorsum giving dorsal metatarsal and dorsal digital arteries.', {
      extra: () => TOES.map((t, i) => tube([footPt(s, 0.093 + i * 0.003, t.baseL, 0.037 - i * 0.001), footPt(s, t.baseF + 0.03, t.baseL * 1.05, 0.03), toeJoints(s, i)[0]], { r: (u) => 0.0008 - 0.0003 * u, radial: 6, flow0: 2.1 })),
    });
    av('plantar_arch', 'plantar arch & plantar digital arteries', aLL, [footPt(s, 0.055, -0.024, 0.012), footPt(s, 0.062, -0.008, 0.0125), footPt(s, 0.066, 0.01, 0.0125), footPt(s, 0.06, 0.028, 0.012)], 0.0013, 0.001, 'Deep arch of the sole formed by the lateral plantar artery, giving plantar metatarsal and digital branches.', {
      extra: () => TOES.flatMap((t, i) => {
        const j = toeJoints(s, i);
        return [tube([footPt(s, 0.062, t.baseL, 0.0125), footPt(s, t.baseF + 0.015, t.baseL, 0.011), [j[0][0], 0.0105, j[0][2]], ...j.slice(1).map((p): V3 => [p[0], p[1] - 0.0045, p[2]])], { r: (u) => 0.0009 - 0.0004 * u, radial: 6, flow0: 2.1 })];
      }),
    });

    // ---- deep veins: paired venae comitantes, perforators, superficial network
    const comitPart = (key: string, name: string, par: string, pts: V3[], r0: number, r1: number, desc: string) =>
      vv(key, name, par, [], r0, r1, desc, { extra: () => comit(pts, r0, r1, 0.0036, flowAt(pts[0])) });
    comitPart('brachial_vc', 'brachial venae comitantes', vUL, [X(s, [0.155, 1.4, 0.004]), armPt(s, 0.15, -0.018, 0.01), armPt(s, 0.5, -0.02, 0.008), armPt(s, 0.92, -0.008, 0.016), brachEnd], 0.0021, 0.0013, 'Paired deep veins wrapping the brachial artery and communicating by small cross-links.');
    comitPart('radial_vc', 'radial venae comitantes', vUL, [brachEnd, forePt(s, 0.3, 0.015, 0.017), forePt(s, 0.7, 0.018, 0.012), forePt(s, 1.0, 0.017, 0.01)], 0.0013, 0.0009, 'Paired veins accompanying the radial artery.');
    comitPart('ulnar_vc', 'ulnar venae comitantes', vUL, [brachEnd, forePt(s, 0.25, -0.015, 0.02), forePt(s, 0.7, -0.018, 0.012), forePt(s, 1.0, -0.016, 0.01)], 0.0013, 0.0009, 'Paired veins accompanying the ulnar artery.');
    comitPart('ant_tibial_vc', 'anterior tibial venae comitantes', vLL, [pop, X(s, [0.108, 0.445, -0.005]), X(s, [0.1, 0.3, 0.01]), X(s, [0.09, 0.12, 0.02]), footPt(s, 0.02, 0.0, 0.065)], 0.0015, 0.001, 'Paired veins accompanying the anterior tibial artery.');
    comitPart('post_tibial_vc', 'posterior tibial venae comitantes', vLL, [pop, X(s, [0.09, 0.35, -0.035]), X(s, [0.08, 0.15, -0.03]), X(s, [0.07, 0.07, -0.02])], 0.0016, 0.001, 'Paired veins accompanying the posterior tibial artery.');
    comitPart('fibular_vc', 'fibular venae comitantes', vLL, [X(s, [0.093, 0.43, -0.033]), X(s, [0.115, 0.3, -0.03]), X(s, [0.112, 0.12, -0.03])], 0.0012, 0.0008, 'Paired veins accompanying the fibular artery.');
    vv('deep_femoral', 'deep femoral vein', vLL, xs([0.072, 0.84, 0.05], [0.096, 0.78, 0.02], [0.1, 0.65, -0.012]), 0.0032, 0.002, 'Drains the thigh muscles through perforating veins and joins the femoral vein.', { twigs: 8, twigLen: [0.02, 0.045], seed: 801 + s });
    vv('perforators', 'perforating veins', vLL, [], 0.0011, 0.0011, 'Valved veins crossing the deep fascia and carrying blood from the superficial to the deep system.', {
      extra: () => [[[0.056, 0.8, 0.05], [0.075, 0.85, 0.054]], [[0.05, 0.7, 0.02], [0.077, 0.72, 0.032]], [[0.062, 0.5, -0.022], [0.091, 0.5, -0.042]], [[0.066, 0.35, -0.012], [0.09, 0.35, -0.035]], [[0.07, 0.16, 0.008], [0.08, 0.15, -0.03]]].map(([a, b], i) => {
        const A0 = X(s, a as V3), B0 = X(s, b as V3);
        return tube([A0, add(lerp(A0, B0, 0.5), [0, 0.006 * (i % 2 ? 1 : -1), 0.004]), B0], { r: 0.0011, radial: 7, flow0: 1.5 });
      }),
    });
    vv('gonadal', 'gonadal vein', vTr, s > 0 ? xs([0.03, 1.115, -0.034], [0.03, 1.06, -0.012], [0.05, 0.99, 0.02], [0.052, 0.95, 0.07]) : xs([0.02, 1.1, -0.022], [0.03, 1.05, -0.01], [0.05, 0.99, 0.02], [0.052, 0.95, 0.07]), 0.0018, 0.0012, 'Testicular vein draining the pampiniform plexus; the left drains into the renal vein, the right into the inferior vena cava.', { twigs: 6, twigRange: [0.7, 1], twigLen: [0.012, 0.03], seed: 811 + s });
    for (let i = 0; i < 4; i++) {
      const y = 1.088 - i * 0.027;
      vv(`lumbar${i + 1}`, `lumbar vein ${i + 1}`, vTr, xs([0.0, y, -0.02], [0.03, y - 0.002, -0.044], [0.052, y - 0.004, -0.062], [0.072, y - 0.006, -0.072]).map((p, k) => (k === 0 ? [s * 0.01 - (s > 0 ? 0.022 : -0.0), p[1], p[2]] as V3 : p)), 0.0014, 0.0009, 'Segmental veins of the posterior abdominal wall draining to the inferior vena cava and ascending lumbar vein.', { twigs: 1, twigLen: [0.012, 0.025], seed: 821 + i + s });
    }
    vv('intercostal', 'posterior intercostal veins', vTr, [], 0.001, 0.001, 'Veins in the costal grooves above the arteries draining into the azygos system.', {
      extra: () => {
        const list: Geo[] = [];
        for (let i = 3; i <= 11; i++) {
          const b = ribPaths(s, i)[0].slice(1);
          const pts = b.filter((_, k) => k % 2 === 0).map((p) => add(p, [0, -0.0025, 0.0]));
          list.push(tube([s > 0 ? [0.02, b[0][1] - 0.008, -0.05] : [-0.014, b[0][1] - 0.008, -0.05], ...pts], { r: (t) => 0.0012 - 0.0004 * t, radial: 6, flow0: 0.4 }));
        }
        return list;
      },
    });
    vv('int_thoracic', 'internal thoracic veins', vTr, xs([0.064, 1.44, 0.028], [0.034, 1.428, 0.082], [0.032, 1.33, 0.092], [0.034, 1.22, 0.097]), 0.0016, 0.0012, 'Accompany the internal thoracic artery and drain the anterior chest wall.', { twigs: 6, twigLen: [0.02, 0.04], seed: 831 + s });
    vv('vertebral', 'vertebral vein', vHN, () => {
      const pts: V3[] = [X(s, [0.034, 1.44, -0.01])];
      for (const v of VERTEBRAE.slice(0, 6).reverse()) pts.push(add(add(v.c, mul(v.lat, s * 0.022)), [0, 0.003, 0]));
      pts.push(X(s, [0.01, 1.6, -0.025]));
      return pts;
    }, 0.0015, 0.0012, 'Venous plexus around the vertebral artery draining the cervical spinal cord and posterior skull.');
    vv('facial', 'facial vein', vHN, [conform(X(s, [0.014, 1.655, 0.09]), 0.0045), conform(X(s, [0.022, 1.632, 0.09]), 0.0045), conform(X(s, [0.03, 1.6, 0.088]), 0.0045), conform(X(s, [0.04, 1.575, 0.074]), 0.0045), X(s, [0.04, 1.56, 0.04]), X(s, [0.036, 1.553, 0.02])], 0.0016, 0.0022, 'Runs obliquely across the face behind the facial artery and drains into the internal jugular vein.', { twigs: 4, twigLen: [0.012, 0.03], seed: 841 + s, conformDepth: 0.0045, conformRange: [0, 0.6] });
    vv('sup_temporal', 'superficial temporal vein', vHN, [conform(X(s, [0.02, 1.76, 0.05]), 0.0045), conform(X(s, [0.045, 1.745, 0.03]), 0.0045), conform(X(s, [0.07, 1.7, 0.014]), 0.0045), conform(X(s, [0.068, 1.64, 0.006]), 0.0045), X(s, [0.054, 1.61, 0.0]), X(s, [0.044, 1.6, -0.014])], 0.0012, 0.0018, 'Collects blood from the scalp and joins the retromandibular vein.', { twigs: 6, twigLen: [0.02, 0.04], seed: 851 + s, conformDepth: 0.0045, conformRange: [0, 0.7] });
    vv('lat_thoracic', 'lateral thoracic & thoracoepigastric veins', vTr, [X(s, [0.15, 1.402, 0.03]), X(s, [0.14, 1.34, 0.09]), X(s, [0.125, 1.25, 0.1]), X(s, [0.1, 1.17, 0.095]), X(s, [0.085, 1.1, 0.09])], 0.0016, 0.0014, 'Superficial longitudinal vein of the lateral chest and abdominal wall linking the axillary and femoral venous systems.', { conformDepth: 0.0045, twigs: 5, twigLen: [0.02, 0.04], seed: 861 + s });
    vv('median_antebrachial', 'median antebrachial vein', vUL, [forePt(s, 0.98, 0.0, -0.005), forePt(s, 0.7, 0.0, 0.012), forePt(s, 0.4, 0.002, 0.018), forePt(s, 0.12, 0.004, 0.02)], 0.0013, 0.0018, 'Drains the palmar venous plexus up the front of the forearm to the cubital region.', { conformDepth: 0.0035, twigs: 4, twigLen: [0.015, 0.03], seed: 871 + s });
    vv('acc_saphenous', 'accessory saphenous vein', vLL, [thighPt(s, 0.12, 0.022, 0.066), thighPt(s, 0.4, 0.04, 0.06), thighPt(s, 0.75, 0.032, 0.05), X(s, [0.078, 0.54, 0.052])], 0.0016, 0.0014, 'Superficial vein of the anterolateral thigh joining the great saphenous vein near the saphenofemoral junction.', { conformDepth: 0.0045, conformRange: [0.1, 1], twigs: 4, twigLen: [0.02, 0.04], seed: 881 + s });
    vv('sural', 'sural veins', vLL, xs([0.09, 0.46, -0.04], [0.087, 0.41, -0.06], [0.09, 0.34, -0.066], [0.094, 0.28, -0.062]), 0.0018, 0.0012, 'Veins of the gastrocnemius and soleus muscles, a common site of calf thrombosis.', { twigs: 6, twigLen: [0.02, 0.04], seed: 891 + s });
  }
}
void Fh; void dot;
