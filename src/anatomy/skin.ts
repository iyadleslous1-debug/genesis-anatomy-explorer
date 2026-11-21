import { V3, add, mul, sub } from '../geo/math';
import {
  Shape, ellipsoid, capsule, roundCone, union, subtract, sphere, frameEuler, frameY, roundBox, chain,
  intersect, plane, shell, region, mirrorX, offset, PlaneFn, frameAxes, displace,
} from '../geo/sdf';
import { Bump, applyBumps, findSurface } from '../geo/a_bumps';
import { faceForms, FACE_SPECS } from '../geo/a5_face';
import { fbm } from '../geo/noise';
import { meshShape } from '../geo/mesher';
import { G, P } from './registry';
import {
  HEAD, shoulderJ, elbowJ, wristJ, armPt, armDir, foreDir, forePt, handFrame, handPt, FINGERS, fingerJoints,
  thumbJoints, kneeJ, ankleJ, footFrame, footPt, toeJoints, TOES, Side, metacarpalBase,
} from './rig';

const s: Side = 1; // build left half, mirror

function headShape(): Shape {
  const eye = HEAD.eye(s);
  const cr = ellipsoid([0, 1.668, -0.008], [0.077, 0.091, 0.1]);
  const occ = ellipsoid([0, 1.65, -0.05], [0.07, 0.07, 0.065]);
  const forehead = ellipsoid([0, 1.678, 0.04], [0.066, 0.068, 0.056]);
  const face = ellipsoid([0, 1.618, 0.026], [0.059, 0.082, 0.078]);
  const jaw = union(
    [
      capsule(HEAD.jawAngle(s), [s * 0.02, 1.549, 0.064], 0.0128),
      capsule(HEAD.jawAngle(s), add(HEAD.condyle(s), [0, -0.01, 0.006]), 0.0145),
      ellipsoid([0, 1.549, 0.071], [0.022, 0.017, 0.018]),
    ],
    0.012,
  );
  const cheek = ellipsoid([s * 0.044, 1.626, 0.058], [0.018, 0.015, 0.02]);
  const brow = capsule([0.0, 1.668, 0.083], [s * 0.036, 1.668, 0.079], 0.0085);
  const neck = union(
    [
      roundCone([0, 1.452, -0.01], [0, 1.585, -0.018], 0.054, 0.046),
      ellipsoid([0, 1.495, 0.022], [0.034, 0.04, 0.03]),
      capsule(HEAD.mastoid(s), [s * 0.02, 1.45, 0.05], 0.0105),
      sphere([0, 1.518, 0.044], 0.0095),
    ],
    0.02,
  );
  const base = union([cr, occ, forehead, face, jaw, cheek, brow], 0.014);
  const head = faceForms(base);
  return union([union([head, neck], 0.02), earShape()], 0.004);
}

/** Auricle: helix rim, antihelix, concha, tragus, antitragus, lobule. */
function earShape(): Shape {
  const E0 = HEAD.ear(s);
  const E: V3 = [E0[0], E0[1] + 0.007, E0[2]];
  const arc = (a: number, b: number, u0: number, u1: number, xo: (u: number) => number, n: number): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const u = u0 + ((u1 - u0) * i) / n;
      out.push([E[0] + s * xo(u), E[1] + 0.003 + a * Math.sin(u), E[2] - 0.004 * Math.sin(u) + b * Math.cos(u)]);
    }
    return out;
  };
  const hp = arc(0.029, 0.0145, 0.25, 4.35, (u) => 0.0075 + 0.0055 * Math.max(0, -Math.cos(u)) + 0.0014 * Math.sin(u), 56);
  const helix = chain(hp, hp.map((_, i) => 0.0033 - 0.0014 * (i / (hp.length - 1))), 0.0012);
  const ap = arc(0.0185, 0.0085, 0.9, 3.9, () => 0.0085, 30);
  const anti = chain(ap, ap.map(() => 0.0027), 0.001);
  const yA = chain([add(E, [s * 0.0085, 0.0005, -0.004]), add(E, [s * 0.0085, 0.0125, -0.006]), add(E, [s * 0.0085, 0.021, 0.0])], [0.0024, 0.0024, 0.002], 0.001);
  const yB = chain([add(E, [s * 0.0085, 0.0125, -0.006]), add(E, [s * 0.0085, 0.02, -0.012])], [0.0022, 0.0019], 0.001);
  const plate = ellipsoid(add(E, [s * -0.0022, 0.002, -0.002]), [0.0036, 0.0265, 0.0145], frameEuler(-0.15, 0, 0));
  const concha = ellipsoid(add(E, [s * 0.0075, -0.004, 0.0015]), [0.0042, 0.0115, 0.0072], frameEuler(-0.15, 0, 0));
  const body = subtract(union([plate, helix, anti, yA, yB], 0.0025), concha, 0.002);
  return union(
    [
      body,
      sphere(add(E, [s * 0.0045, -0.004, 0.0165]), 0.0052),
      sphere(add(E, [s * 0.0055, -0.0185, 0.0085]), 0.0036),
      ellipsoid(add(E, [s * 0.003, -0.0295, -0.0035]), [0.0036, 0.0098, 0.0078]),
    ],
    0.002,
  );
}

function torsoShape(): Shape {
  return union(
    [
      ellipsoid([0, 1.3, -0.003], [0.162, 0.168, 0.128]),
      ellipsoid([0, 1.39, -0.01], [0.17, 0.08, 0.112]),
      ellipsoid([s * 0.1, 1.42, -0.06], [0.08, 0.052, 0.048]),
      ellipsoid([0, 1.47, -0.06], [0.05, 0.045, 0.032]),
      roundCone([s * 0.015, 1.448, 0.052], [s * 0.17, 1.455, -0.002], 0.03, 0.03),
      ellipsoid([0, 1.12, -0.035], [0.118, 0.13, 0.097]),
      ellipsoid([s * 0.07, 1.12, -0.045], [0.06, 0.11, 0.07]),
      ellipsoid([s * 0.125, 1.03, -0.0], [0.042, 0.05, 0.07]),
      ellipsoid([s * 0.068, 1.334, 0.066], [0.068, 0.05, 0.041], frameEuler(0, 0, s * 0.25)),
      ellipsoid([0, 1.13, 0.01], [0.137, 0.13, 0.102]),
      ellipsoid([0, 1.06, 0.04], [0.108, 0.075, 0.066]),
      ellipsoid([0, 0.965, -0.006], [0.168, 0.097, 0.112]),
      ellipsoid([s * 0.072, 0.905, -0.058], [0.08, 0.088, 0.07]),
      ellipsoid([s * 0.085, 1.34, -0.074], [0.07, 0.085, 0.042]),
      roundCone([s * 0.03, 1.53, -0.035], [s * 0.165, 1.452, -0.016], 0.034, 0.028),
      ellipsoid([s * 0.196, 1.4, -0.008], [0.054, 0.072, 0.058]),
      ellipsoid([0, 0.866, 0.026], [0.05, 0.04, 0.046]),
      ellipsoid([s * 0.128, 1.3, -0.03], [0.042, 0.09, 0.07]),
    ],
    0.034,
  );
}

function armShape(): Shape {
  const ad = armDir(s), fd = foreDir(s);
  const { D, L, N } = handFrame(s);
  return union(
    [
      roundCone(add(shoulderJ(s), [s * 0.006, -0.025, 0]), elbowJ(s), 0.049, 0.037),
      ellipsoid(armPt(s, 0.52, 0, 0.013), [0.034, 0.08, 0.034], frameY(ad)),
      ellipsoid(armPt(s, 0.42, 0, -0.016), [0.036, 0.092, 0.034], frameY(ad)),
      sphere(elbowJ(s), 0.036),
      roundCone(elbowJ(s), wristJ(s), 0.038, 0.023),
      ellipsoid(forePt(s, 0.26, 0.004, 0.002), [0.045, 0.08, 0.037], frameY(fd)),
      ellipsoid(wristJ(s), [0.026, 0.013, 0.0165], frameAxes(L, D)),
    ],
    0.024,
  );
  void N;
}

function handShape(): Shape {
  const { D, L } = handFrame(s);
  const Hf = frameAxes(L, D);
  const parts: Shape[] = [
    roundBox(handPt(s, 0.056, 0.0, 0.0), [0.033, 0.034, 0.0068], Hf, 0.0085),
    ellipsoid(handPt(s, 0.046, 0.028, 0.008), [0.017, 0.028, 0.012], Hf),
    ellipsoid(handPt(s, 0.058, -0.027, 0.004), [0.013, 0.03, 0.01], Hf),
    ellipsoid(handPt(s, 0.01, 0, 0), [0.027, 0.018, 0.016], Hf),
  ];
  const fingers: Shape[] = [];
  FINGERS.forEach((f, i) => {
    const j = fingerJoints(s, i);
    fingers.push(chain(j, [0.0098 * f.r, 0.0089 * f.r, 0.008 * f.r, 0.0068 * f.r], 0.002));
  });
  const t = thumbJoints(s);
  fingers.push(chain(t.slice(1), [0.0112, 0.0098, 0.0082], 0.002));
  fingers.push(roundCone(t[0], t[1], 0.0145, 0.0115));
  return union([union(parts, 0.012), ...fingers], 0.0055);
}

function legShape(): Shape {
  const k = kneeJ(s), a = ankleJ(s);
  return union(
    [
      roundCone([s * 0.092, 0.9, 0.0], [s * 0.095, 0.52, 0.0], 0.088, 0.054),
      ellipsoid([s * 0.1, 0.71, 0.028], [0.066, 0.155, 0.06]),
      ellipsoid([s * 0.064, 0.79, 0.0], [0.045, 0.1, 0.06]),
      ellipsoid([s * 0.095, 0.72, -0.03], [0.06, 0.14, 0.055]),
      sphere(k, 0.054),
      ellipsoid([s * 0.096, 0.506, 0.04], [0.026, 0.03, 0.015]),
      roundCone(sub(k, [0, 0.02, 0]), [s * 0.087, 0.1, -0.012], 0.05, 0.031),
      ellipsoid([s * 0.095, 0.375, -0.03], [0.055, 0.1, 0.05]),
      ellipsoid([s * 0.094, 0.3, 0.008], [0.034, 0.14, 0.03]),
      ellipsoid(add(a, [0, 0.01, 0.006]), [0.033, 0.034, 0.04]),
      capsule([s * 0.113, 0.075, -0.022], [s * 0.118, 0.21, -0.02], 0.0125),
      capsule([s * 0.084, 0.1, 0.018], [s * 0.092, 0.25, 0.022], 0.016),
      sphere([s * 0.066, 0.078, -0.008], 0.012),
      sphere([s * 0.112, 0.072, -0.022], 0.012),
    ],
    0.03,
  );
}

function footShape(): Shape {
  const { F, L } = footFrame(s);
  const Ff = frameAxes(L, [0, 1, 0]);
  void F;
  const body = union(
    [
      ellipsoid(footPt(s, -0.04, 0.002, 0.034), [0.031, 0.036, 0.04], Ff),
      ellipsoid(footPt(s, 0.062, -0.017, 0.033), [0.02, 0.027, 0.042], Ff),
      ellipsoid(footPt(s, 0.04, 0.005, 0.03), [0.036, 0.03, 0.07], Ff),
      ellipsoid(footPt(s, 0.113, 0.004, 0.02), [0.046, 0.02, 0.035], Ff),
      roundCone(ankleJ(s), footPt(s, 0.02, 0, 0.042), 0.03, 0.03),
    ],
    0.02,
  );
  const toes = TOES.map((t, i) => {
    const j = toeJoints(s, i);
    const r = 0.0075 * t.r;
    return chain(j, j.map((_, k) => r * (1 - k * 0.08)), 0.002);
  });
  const foot = union([body, ...toes], 0.006);
  return intersect(foot, plane([0, -1, 0], [0, 0.0008, 0]), 0.004);
}

// ---------------------------------------------------------------- surface relief
type Spec = [string, number, number, number, number, number, number, number?];
const axx = (y: number) => 0.183 + (1.415 - y) * 0.2048; // upper-arm centre x at height y
const fxx = (y: number) => 0.243 + (1.122 - y) * 0.2418; // forearm centre x
const DEEP: V3[] = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0], [-1, 0, 0]];

function specBumps(base: Shape, specs: Spec[]): Bump[] {
  const out: Bump[] = [];
  const kinds = 'fblmL';
  for (const [k, u1, v1, u2, v2, w, amp, pw] of specs) {
    const ki = kinds.indexOf(k);
    const dir = DEEP[ki];
    const start = (u: number, v: number): V3 =>
      ki === 0 ? [u, v, 0.45] : ki === 1 ? [u, v, -0.45] : ki === 2 ? [0.5, v, u] : ki === 3 ? [0.0, v, u] : [0.21, v, u];
    const A = findSurface(base, start(u1, v1), dir);
    const B = u1 === u2 && v1 === v2 ? A : findSurface(base, start(u2, v2), dir);
    if (A && B) out.push({ A, B, w: k === 'f' && u1 < 0.2 && v1 > 1.5 && v1 < 1.69 ? w : w * 1.3, amp: amp / 1000, pw: Math.min(pw ?? 1, 1.5) });
  }
  return out;
}

const TORSO: Spec[] = [
  // collarbones, neck, trapezius slope
  ['f', 0.024, 1.466, 0.07, 1.47, 0.0085, 2.4], ['f', 0.07, 1.47, 0.125, 1.474, 0.0085, 2.4], ['f', 0.125, 1.474, 0.166, 1.466, 0.0085, 2.2],
  ['f', 0.052, 1.598, 0.032, 1.505, 0.0105, 3.2], ['f', 0.03, 1.5, 0.02, 1.468, 0.0105, 3],
  ['f', 0.07, 1.487, 0.15, 1.47, 0.022, 3], ['f', 0, 1.513, 0, 1.513, 0.009, 1.6],
  ['b', 0.045, 1.5, 0.12, 1.46, 0.028, 4], ['b', 0.045, 1.44, 0.01, 1.35, 0.034, 3.5],
  // extra skin clearance (>= 2 mm) over platysma / SCM at the neck base, pec edge, glute / TFL
  ['f', 0.02, 1.532, 0.05, 1.545, 0.02, 3], ['f', 0.03, 1.5, 0.06, 1.48, 0.026, 3], ['f', 0.04, 1.47, 0.085, 1.465, 0.022, 2.8],
  ['f', 0.12, 1.31, 0.15, 1.29, 0.03, 2.5],
  // pectorals, nipples
  ['f', 0.07, 1.352, 0.098, 1.34, 0.044, 8, 1.5], ['f', 0.03, 1.345, 0.05, 1.35, 0.03, 4.5, 1.5], ['f', 0.12, 1.325, 0.14, 1.335, 0.024, 2.6],
  ['f', 0.088, 1.318, 0.088, 1.318, 0.0075, 2.2], ['f', 0.088, 1.318, 0.088, 1.318, 0.019, 0.7, 2],
  // serratus slips, obliques
  ['f', 0.126, 1.268, 0.152, 1.283, 0.006, 1.3], ['f', 0.13, 1.232, 0.153, 1.246, 0.006, 1.3], ['f', 0.136, 1.196, 0.153, 1.206, 0.006, 1.3],
  ['f', 0.112, 1.165, 0.126, 1.1, 0.02, 2.4], ['f', 0.106, 1.07, 0.13, 1.03, 0.017, 2.2],
  // rectus abdominis blocks, navel, inguinal line
  ['f', 0.036, 1.245, 0.036, 1.03, 0.026, 1.6, 2],
  ['f', 0.02, 1.236, 0.05, 1.236, 0.0105, 1.7, 1.5], ['f', 0.02, 1.185, 0.05, 1.185, 0.0105, 1.7, 1.5],
  ['f', 0.02, 1.135, 0.05, 1.135, 0.0105, 1.7, 1.5], ['f', 0.02, 1.085, 0.05, 1.085, 0.0105, 1.7, 1.5],
  ['f', 0.024, 1.0, 0.046, 1.0, 0.01, 1.5, 1.5], ['f', 0.0, 1.04, 0.0, 1.04, 0.0055, -3, 1], ['f', 0.0, 1.04, 0.0, 1.04, 0.011, 1.3],
  ['f', 0.05, 0.985, 0.116, 1.014, 0.006, -0.9],
  // back
  ['b', 0.03, 1.38, 0.03, 1.1, 0.018, 3.6, 1.5], ['b', 0.05, 1.404, 0.15, 1.43, 0.0105, 2.4], ['b', 0.07, 1.33, 0.1, 1.37, 0.034, 3.6],
  ['b', 0.062, 1.34, 0.09, 1.27, 0.009, 1.8], ['b', 0.12, 1.2, 0.14, 1.28, 0.042, 3.4],
  ['b', 0.085, 0.96, 0.09, 0.9, 0.062, 8.5, 1.3], ['b', 0.0, 1.03, 0.0, 1.03, 0.02, 1.5],
  // deltoid, arm, forearm
  ['l', -0.012, 1.405, -0.012, 1.33, 0.028, 5.5], ['f', 0.205, 1.38, 0.2, 1.34, 0.022, 4], ['b', 0.2, 1.4, 0.2, 1.35, 0.024, 4],
  ['f', axx(1.31) + 0.005, 1.31, axx(1.22), 1.22, 0.021, 4.4], ['b', axx(1.36), 1.36, axx(1.22), 1.22, 0.026, 4.2], ['l', -0.03, 1.31, -0.03, 1.24, 0.016, 3],
  ['b', 0.246, 1.122, 0.246, 1.122, 0.013, 2.4],
  ['f', fxx(1.11) + 0.012, 1.105, fxx(1.02) + 0.014, 1.02, 0.017, 4.2], ['f', fxx(1.1) - 0.01, 1.1, fxx(1.0) - 0.008, 1.0, 0.016, 3],
  ['b', fxx(1.1) + 0.005, 1.1, fxx(0.98), 0.98, 0.022, 3.6],
  // legs
  ['f', 0.098, 0.84, 0.095, 0.6, 0.027, 4.6], ['f', 0.13, 0.8, 0.124, 0.6, 0.028, 4.6], ['f', 0.085, 0.62, 0.083, 0.57, 0.022, 5.6],
  ['m', 0.0, 0.85, 0.0, 0.68, 0.03, 3.6], ['b', 0.1, 0.85, 0.1, 0.6, 0.034, 4.2],
  ['f', 0.095, 0.5, 0.095, 0.5, 0.019, 3, 1.5], ['f', 0.092, 0.455, 0.092, 0.455, 0.01, 1.6],
  ['b', 0.082, 0.42, 0.085, 0.33, 0.03, 7.5, 1.3], ['b', 0.108, 0.4, 0.108, 0.34, 0.027, 5.5, 1.3], ['b', 0.1, 0.3, 0.098, 0.24, 0.025, 3],
  ['f', 0.105, 0.4, 0.098, 0.2, 0.016, 2.8], ['f', 0.088, 0.45, 0.087, 0.15, 0.0055, 1.3], ['L', 0.0, 0.4, 0.0, 0.3, 0.02, 3],
  ['b', 0.079, 0.035, 0.079, 0.035, 0.026, 4, 1.3], ['b', 0.0865, 0.26, 0.0865, 0.1, 0.0085, 2.2], ['m', -0.012, 0.082, -0.012, 0.082, 0.011, 3, 1.5], ['L', -0.014, 0.072, -0.014, 0.072, 0.011, 3, 1.5],
];

const FACE: Spec[] = FACE_SPECS;

function handBumps(base: Shape): Bump[] {
  const out: Bump[] = [];
  const { N } = handFrame(s);
  const nrm = (a: V3, b: V3): V3 => {
    const d = sub(b, a), l = Math.hypot(d[0], d[1], d[2]);
    const dn: V3 = [d[0] / l, d[1] / l, d[2] / l];
    const k = N[0] * dn[0] + N[1] * dn[1] + N[2] * dn[2];
    const o: V3 = [N[0] - dn[0] * k, N[1] - dn[1] * k, N[2] - dn[2] * k];
    const ol = Math.hypot(o[0], o[1], o[2]);
    return [o[0] / ol, o[1] / ol, o[2] / ol];
  };
  const lerp3 = (a: V3, b: V3, t: number): V3 => add(mul(a, 1 - t), mul(b, t));
  const push = (A: V3 | null, B: V3 | null, w: number, amp: number, pw = 1) => A && B && out.push({ A, B, w, amp: amp / 1000, pw });
  const surf = (c: V3, dir: V3) => findSurface(base, add(c, mul(dir, 0.03)), mul(dir, -1), 0.08);
  const chainFeat = (j: V3[], r: number, nailW: number, nailAmp: number) => {
    const n = j.length;
    for (let k = 0; k < n - 1; k++) {
      const dors = mul(nrm(j[k], j[k + 1]), -1);
      const pal = mul(dors, -1);
      if (k === 2 || (n === 3 && k === 1)) {
        push(surf(lerp3(j[k], j[k + 1], 0.22), dors), surf(lerp3(j[k], j[k + 1], 0.8), dors), nailW, nailAmp, 3);
        push(surf(lerp3(j[k], j[k + 1], 0.55), pal), surf(lerp3(j[k], j[k + 1], 0.55), pal), r * 0.75, 0.9);
      }
      if (k === 0 || k === 1) push(surf(j[k], dors), surf(j[k], dors), r * 0.6, 0.7);
      if (k <= 1) push(surf(lerp3(j[k], j[k + 1], 0.5), pal), surf(lerp3(j[k], j[k + 1], 0.5), pal), r * 0.6, 0.5);
    }
  };
  FINGERS.forEach((f, i) => {
    const j = fingerJoints(s, i);
    chainFeat(j, 0.0098 * f.r, 0.0042 * f.r, 0.65);
    const d = mul(nrm(metacarpalBase(s, i), j[0]), -1);
    push(surf(metacarpalBase(s, i), d), surf(j[0], d), 0.004, 0.5); // extensor tendon hint
  });
  chainFeat(thumbJoints(s).slice(1), 0.0112, 0.0058, 0.7);
  const pf = (h: number, l: number) => surf(handPt(s, h, l, 0), N);
  const pp = (h: number, l: number) => surf(handPt(s, h, l, 0), mul(N, -1));
  push(pf(0.045, 0.03), pf(0.045, 0.03), 0.014, 1.5); // thenar
  push(pf(0.055, -0.028), pf(0.055, -0.028), 0.012, 1.2); // hypothenar
  push(pf(0.075, 0.034), pf(0.055, 0.016), 0.0017, -0.35); push(pf(0.055, 0.016), pf(0.03, 0.007), 0.0017, -0.35);
  push(pf(0.078, -0.03), pf(0.07, 0.0), 0.0017, -0.35); push(pf(0.072, 0.03), pf(0.068, 0.0), 0.0017, -0.3);
  push(pf(0.01, 0.007), pf(0.04, 0.009), 0.004, 0.8); push(pf(0.01, -0.008), pf(0.04, -0.01), 0.004, 0.8); // wrist tendons
  push(pp(0.03, 0.0), pp(0.075, 0.0), 0.014, 0.6); // dorsal hand
  return out;
}

function footBumps(base: Shape): Bump[] {
  const out: Bump[] = [];
  const up: V3 = [0, 1, 0];
  const top = (p: V3) => findSurface(base, [p[0], 0.25, p[2]], [0, -1, 0], 0.3);
  TOES.forEach((t, i) => {
    const j = toeJoints(s, i);
    const n = j.length;
    const a = add(mul(j[n - 2], 0.75), mul(j[n - 1], 0.25)), b = add(mul(j[n - 2], 0.12), mul(j[n - 1], 0.88));
    const A = top(a), B = top(b);
    if (A && B) out.push({ A, B, w: (i === 0 ? 0.0064 : 0.0036), amp: 0.0007, pw: 3 });
    if (i < 4) {
      const A2 = top(footPt(s, 0.03, t.baseL, 0)), B2 = top(j[0]);
      if (A2 && B2) out.push({ A: A2, B: B2, w: 0.0035, amp: 0.0006, pw: 1 });
    }
  });
  void up;
  return out;
}

function buildBumps(base: Shape): Bump[] {
  // submental clearance under the chin (platysma / digastric), explicit points off the front projection
  const sub: Bump[] = [{ A: [0.004, 1.532, 0.055], B: [0.032, 1.534, 0.038], w: 0.02, amp: 0.003, pw: 1 }];
  const all = [...sub, ...specBumps(base, TORSO), ...specBumps(base, FACE), ...handBumps(base), ...footBumps(base)];
  // features reaching the midline get a mirrored twin so the |x| fold stays smooth (no crease at x = 0)
  const twins: Bump[] = [];
  for (const b of all) {
    const r = Math.sqrt(Math.pow(4.6, 1 / b.pw)) * b.w;
    if (Math.abs(b.A[0]) + Math.abs(b.B[0]) > 1e-6 && Math.min(b.A[0], b.B[0]) < r)
      twins.push({ ...b, A: [-b.A[0], b.A[1], b.A[2]], B: [-b.B[0], b.B[1], b.B[2]] });
  }
  return [...all, ...twins];
}

let cached: Shape | null = null;
export function skinShape(): Shape {
  if (cached) return cached;
  const raw = union([torsoShape(), headShape(), armShape(), handShape(), legShape(), footShape()], 0.02);
  // symmetrise the midline (left-biased primitives would otherwise leave a crease at x = 0)
  const base: Shape = {
    d: (x, y, z) => {
      const a = Math.abs(x);
      const m = raw.d(a, y, z);
      if (a >= 0.014) return m;
      const u = a / 0.014, k = u * u * (3 - 2 * u);
      return k * m + (1 - k) * 0.5 * (m + raw.d(-a, y, z));
    },
    lo: raw.lo, hi: raw.hi,
  };
  const relief = applyBumps(base, buildBumps(base));
  cached = mirrorX(relief);
  return cached;
}

/** Project a point onto the skin surface, then push inward by depth (m). */
export function conform(p: V3, depth: number): V3 {
  const S = skinShape();
  let q: V3 = [p[0], p[1], p[2]];
  const e = 0.0015;
  for (let it = 0; it < 6; it++) {
    const d = S.d(q[0], q[1], q[2]);
    const gx = S.d(q[0] + e, q[1], q[2]) - S.d(q[0] - e, q[1], q[2]);
    const gy = S.d(q[0], q[1] + e, q[2]) - S.d(q[0], q[1] - e, q[2]);
    const gz = S.d(q[0], q[1], q[2] + e) - S.d(q[0], q[1], q[2] - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    const step = d + depth;
    q = sub(q, mul([gx / gl, gy / gl, gz / gl], step));
    if (Math.abs(step) < 0.0002) break;
  }
  return q;
}

// ---------------------------------------------------------------- regions
const headFnO = (o: number): PlaneFn => (x, y, z) => 1.552 - o - 0.3 * z - y;
const headFn = headFnO(0);
function handFn(sd: Side, o = 0): PlaneFn {
  const { W, D } = handFrame(sd);
  const c = add(W, mul(D, 0.006 - o));
  return (x, y, z) => Math.max(-((x - c[0]) * D[0] + (y - c[1]) * D[1] + (z - c[2]) * D[2]), 0.2 - sd * x);
}
function footFn(sd: Side, o = 0): PlaneFn {
  return (x, y) => Math.max(y - 0.112 - o, 0.02 - sd * x);
}
const SEAM = 0.006;
/** arm/trunk cut: signed distance (>0 = arm side), a plane through the axilla tilting laterally below it */
const cutK = 0.1, cutN = Math.sqrt(1 + cutK * cutK);
const armCut = (sd: Side): PlaneFn => (x, y) => (sd * x - (0.17 + cutK * (1.25 - y))) / cutN;
const armOnly = (sd: Side): PlaneFn => (x, y, z) => -armCut(sd)(x, y, z) - SEAM;
const not = (f: PlaneFn): PlaneFn => (x, y, z) => -f(x, y, z);

export function defineSkin() {
  const sys = 'integumentary' as const;
  G('integumentary', 'Integumentary System', undefined, sys, 'The skin and subcutaneous tissue: the body\'s largest organ, providing protection, thermoregulation and sensation.');
  G('skin', 'Skin', 'integumentary', sys, 'Epidermis and dermis covering the entire body surface.');
  const skinDesc = 'Epidermis and dermis — a 1–4 mm protective barrier containing sensory receptors, sweat glands and hair follicles.';
  P({
    id: 'skin.head', name: 'Skin of head & neck', parent: 'skin', system: sys, tissue: 'skin', cost: 6,
    desc: 'Facial and scalp skin, including eyelids, lips, nose and auricles. ' + skinDesc,
    build: () => meshShape(region(skinShape(), [headFnO(SEAM)], 0, [-0.1, 1.5, -0.13], [0.1, 1.775, 0.14]), 0.00175),
  });
  P({
    id: 'skin.trunk', name: 'Skin of trunk & legs', parent: 'skin', system: sys, tissue: 'skin', cost: 10,
    desc: 'Skin of the torso and legs. ' + skinDesc,
    build: () =>
      meshShape(
        region(offset(skinShape(), -0.0007), [not(headFn), armCut(1), armCut(-1), not(handFn(1)), not(handFn(-1)), not(footFn(1)), not(footFn(-1))], 0, [-0.37, 0.09, -0.14], [0.37, 1.6, 0.135]),
        0.0048,
      ),
  });
  for (const sd of [1, -1] as Side[]) {
    const nm = sd === 1 ? 'Left' : 'Right';
    const x0 = sd === 1 ? 0.2 : -0.42, x1 = sd === 1 ? 0.42 : -0.2;
    const ax0 = sd === 1 ? 0.12 : -0.42, ax1 = sd === 1 ? 0.42 : -0.12;
    P({
      id: `skin.arm.${sd === 1 ? 'L' : 'R'}`, name: `Skin of ${nm.toLowerCase()} arm`, parent: 'skin', system: sys, tissue: 'skin', cost: 8,
      desc: `Skin of the ${nm.toLowerCase()} shoulder cap, arm and forearm, meshed separately from the trunk so it slides freely at the armpit. ` + skinDesc,
      build: () =>
        meshShape(
          region(offset(skinShape(), -0.0004), [armOnly(sd), not(handFn(sd)), (x: number, y: number) => y - 1.53], 0, [ax0, 0.84, -0.14], [ax1, 1.54, 0.135]),
          0.0048,
        ),
    });
    P({
      id: `skin.hand.${sd === 1 ? 'L' : 'R'}`, name: `Skin of ${nm.toLowerCase()} hand`, parent: 'skin', system: sys, tissue: 'skin', cost: 4,
      desc: `Palmar and dorsal skin of the ${nm.toLowerCase()} hand and fingers, with thick glabrous skin on the palm and fingertips.`,
      build: () => meshShape(region(skinShape(), [handFn(sd, SEAM)], 0, [x0, 0.64, -0.05], [x1, 0.91, 0.08]), 0.0014),
    });
    const fx0 = sd === 1 ? 0.02 : -0.2, fx1 = sd === 1 ? 0.2 : -0.02;
    P({
      id: `skin.foot.${sd === 1 ? 'L' : 'R'}`, name: `Skin of ${nm.toLowerCase()} foot`, parent: 'skin', system: sys, tissue: 'skin', cost: 4,
      desc: `Skin of the ${nm.toLowerCase()} foot, including the thick plantar skin of the sole and heel.`,
      build: () => meshShape(region(skinShape(), [footFn(sd, SEAM)], 0, [fx0, -0.01, -0.1], [fx1, 0.13, 0.25]), 0.0022),
    });
  }
  P({
    id: 'fat.subcutaneous', name: 'Subcutaneous fat (hypodermis)', parent: 'integumentary', system: sys, tissue: 'fat', cost: 8,
    desc: 'The hypodermis: a layer of adipose and loose connective tissue beneath the dermis that insulates, stores energy and cushions underlying structures.',
    build: () => meshShape(offset(skinShape(), -0.0035), 0.0068),
  });
}

/** Eyelid skinning weights for a head-skin vertex (P5 implements; 0 = not eyelid). side: 1 = left, -1 = right */
export function eyelidWeight(side: 1 | -1, x: number, y: number, z: number): { upper: number; lower: number } {
  const dx = Math.abs(x - side * 0.0315), dy = y - 1.651, dz = z - 0.081;
  if (dz < -0.004 || dx > 0.022 || dy > 0.0135 || dy < -0.0135) return { upper: 0, lower: 0 };
  const st = (a: number, b: number, v: number) => {
    const u = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const hx = (1 - st(0.0135, 0.0215, dx)) * st(-0.004, 0.004, dz);
  const up = (1 - st(0.005, 0.0125, dy)) * st(-0.004, 0.003, dy) * hx;
  const lo = (1 - st(0.006, 0.0125, -dy)) * (1 - st(-0.003, 0.004, dy)) * hx;
  const sum = up + lo;
  return sum > 1 ? { upper: up / sum, lower: lo / sum } : { upper: up, lower: lo };
}
