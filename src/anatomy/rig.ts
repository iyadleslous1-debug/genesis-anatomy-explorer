/**
 * Body rig: a single source of truth for anatomical landmarks (meters, y up, subject faces +z,
 * +x = subject's LEFT). Every system (skin, bones, muscles, vessels, nerves) derives from these.
 */
import { V3, add, mul, norm, cross, sub, lerp, dot, spline, dist } from '../geo/math';

export type Side = 1 | -1;
export const SIDES: Side[] = [1, -1];
export const sideName = (s: Side) => (s === 1 ? 'Left' : 'Right');
export const sid = (s: Side) => (s === 1 ? 'L' : 'R');
export const X = (s: Side, p: V3): V3 => [p[0] * s, p[1], p[2]];

const Z: V3 = [0, 0, 1];
const Y: V3 = [0, 1, 0];

// ---------------------------------------------------------------- head
export const HEAD = {
  cranium: [0, 1.668, -0.008] as V3,
  craniumR: [0.074, 0.088, 0.097] as V3,
  eye: (s: Side): V3 => [s * 0.0315, 1.651, 0.081],
  eyeR: 0.0122,
  chin: [0, 1.543, 0.072] as V3,
  jawAngle: (s: Side): V3 => [s * 0.051, 1.572, 0.0],
  condyle: (s: Side): V3 => [s * 0.053, 1.612, -0.012],
  mastoid: (s: Side): V3 => [s * 0.058, 1.6, -0.03],
  ear: (s: Side): V3 => [s * 0.077, 1.638, -0.008],
  nasion: [0, 1.662, 0.092] as V3,
  mouth: [0, 1.58, 0.093] as V3,
};

// ---------------------------------------------------------------- spine
const SPINE_CTRL: V3[] = [
  [0, 1.598, -0.014],
  [0, 1.55, -0.004],
  [0, 1.5, -0.012],
  [0, 1.455, -0.032],
  [0, 1.39, -0.056],
  [0, 1.3, -0.066],
  [0, 1.21, -0.055],
  [0, 1.13, -0.032],
  [0, 1.07, -0.024],
  [0, 1.03, -0.034],
];
const SPINE_DENSE = spline(SPINE_CTRL, 400);
const SPINE_CUM = (() => {
  const c = [0];
  for (let i = 1; i < SPINE_DENSE.length; i++) c.push(c[i - 1] + dist(SPINE_DENSE[i], SPINE_DENSE[i - 1]));
  return c;
})();
const SPINE_LEN = SPINE_CUM[SPINE_CUM.length - 1];

function spineAtArc(a: number): { p: V3; t: V3 } {
  let j = 0;
  while (j < SPINE_CUM.length - 2 && SPINE_CUM[j + 1] < a) j++;
  const f = (a - SPINE_CUM[j]) / (SPINE_CUM[j + 1] - SPINE_CUM[j] || 1);
  const p = lerp(SPINE_DENSE[j], SPINE_DENSE[j + 1], Math.max(0, Math.min(1, f)));
  const t = norm(sub(SPINE_DENSE[Math.max(0, j - 2)], SPINE_DENSE[Math.min(SPINE_DENSE.length - 1, j + 3)]));
  return { p, t };
}

export type Region = 'C' | 'T' | 'L';
export interface VInfo {
  name: string;
  region: Region;
  n: number;
  c: V3;
  up: V3;
  fwd: V3;
  lat: V3;
  bodyR: number;
  bodyH: number;
  canalR: number;
  index: number;
}

export const VERTEBRAE: VInfo[] = (() => {
  const list: { region: Region; n: number; w: number; r: number; h: number; canal: number }[] = [];
  for (let i = 1; i <= 7; i++) list.push({ region: 'C', n: i, w: i === 1 ? 0.012 : 0.0148, r: 0.0085 + i * 0.0003, h: 0.0052, canal: 0.0075 });
  for (let i = 1; i <= 12; i++) list.push({ region: 'T', n: i, w: 0.0205 + i * 0.0004, r: 0.0105 + i * 0.0006, h: 0.0072 + i * 0.0003, canal: 0.0062 });
  for (let i = 1; i <= 5; i++) list.push({ region: 'L', n: i, w: 0.031, r: 0.0185 + i * 0.0005, h: 0.0115, canal: 0.0072 });
  const W = list.reduce((s, v) => s + v.w, 0);
  const scale = SPINE_LEN / W;
  let acc = 0;
  return list.map((v, index) => {
    const a = (acc + v.w / 2) * scale;
    acc += v.w;
    const { p, t } = spineAtArc(a);
    const fwd = norm(sub(Z, mul(t, dot(t, Z))));
    const lat = norm(cross(t, fwd));
    return {
      name: `${v.region}${v.n}`,
      region: v.region,
      n: v.n,
      c: p,
      up: t,
      fwd,
      lat,
      bodyR: v.r,
      bodyH: v.h * Math.min(1.08, scale),
      canalR: v.canal,
      index,
    };
  });
})();

export const vert = (name: string) => VERTEBRAE.find((v) => v.name === name)!;

/** Point in the vertebral canal behind vertebra */
export const canalPoint = (v: VInfo): V3 => add(v.c, mul(v.fwd, -(v.bodyR + v.canalR + 0.001)));

export const SACRUM = {
  top: [0, 1.012, -0.044] as V3,
  bottom: [0, 0.93, -0.088] as V3,
  coccyx: [0, 0.905, -0.082] as V3,
};

// ---------------------------------------------------------------- thorax
export const STERNUM = {
  top: [0, 1.443, 0.072] as V3,
  angle: [0, 1.398, 0.083] as V3,
  bottom: [0, 1.24, 0.104] as V3,
  xiphoid: [0, 1.205, 0.098] as V3,
};
export const sternumAt = (y: number): V3 => {
  const t = (STERNUM.top[1] - y) / (STERNUM.top[1] - STERNUM.bottom[1]);
  return lerp(STERNUM.top, STERNUM.bottom, Math.max(0, Math.min(1, t)));
};

// ---------------------------------------------------------------- upper limb
export const shoulderJ = (s: Side): V3 => [s * 0.183, 1.415, -0.012];
export const elbowJ = (s: Side): V3 => [s * 0.243, 1.122, -0.03];
export const wristJ = (s: Side): V3 => [s * 0.302, 0.878, 0.002];
export const armDir = (s: Side) => norm(sub(elbowJ(s), shoulderJ(s)));
export const foreDir = (s: Side) => norm(sub(wristJ(s), elbowJ(s)));
export const latOf = (s: Side, dir: V3) => mul(norm(cross(Z, dir)), s);
/** point along upper arm: t from shoulder (0) to elbow (1), lateral/forward offsets */
export const armPt = (s: Side, t: number, l = 0, f = 0): V3 => {
  const d = armDir(s);
  const L = latOf(s, d);
  const F = norm(cross(L, d)).map((x) => x * s) as V3;
  return add(add(lerp(shoulderJ(s), elbowJ(s), t), mul(L, l)), mul(fixFwd(F), f));
};
export const forePt = (s: Side, t: number, l = 0, f = 0): V3 => {
  const d = foreDir(s);
  const L = latOf(s, d);
  const F = norm(cross(L, d)).map((x) => x * s) as V3;
  return add(add(lerp(elbowJ(s), wristJ(s), t), mul(L, l)), mul(fixFwd(F), f));
};
function fixFwd(F: V3): V3 {
  return F[2] < 0 ? mul(F, -1) : F;
}

export const CLAVICLE = (s: Side): V3[] => [
  [s * 0.022, 1.446, 0.062],
  [s * 0.07, 1.452, 0.058],
  [s * 0.125, 1.458, 0.03],
  [s * 0.168, 1.458, 0.0],
];

export const SCAPULA = (s: Side) => ({
  superior: [s * 0.066, 1.432, -0.084] as V3,
  inferior: [s * 0.088, 1.258, -0.098] as V3,
  glenoid: [s * 0.158, 1.41, -0.022] as V3,
  neck: [s * 0.142, 1.405, -0.038] as V3,
  acromion: [s * 0.18, 1.452, -0.018] as V3,
  spineRoot: [s * 0.072, 1.385, -0.103] as V3,
  coracoidBase: [s * 0.135, 1.425, -0.03] as V3,
  coracoidTip: [s * 0.14, 1.418, 0.025] as V3,
});

// Hand frame
export function handFrame(s: Side) {
  const D = norm([s * 0.16, -1, 0.03]);
  const L = mul(norm(cross(Z, D)), s);
  const N = norm(sub(sub(Z, mul(D, dot(D, Z))), mul(L, dot(L, Z))));
  return { W: wristJ(s), D, L, N };
}
export const handPt = (s: Side, h: number, l: number, n: number): V3 => {
  const { W, D, L, N } = handFrame(s);
  return [W[0] + D[0] * h + L[0] * l + N[0] * n, W[1] + D[1] * h + L[1] * l + N[1] * n, W[2] + D[2] * h + L[2] * l + N[2] * n];
};

export const FINGERS = [
  { name: 'Index', key: 'index', l: 0.021, base: 0.014, h: 0.092, spread: 0.07, len: [0.043, 0.025, 0.019], r: 1.0 },
  { name: 'Middle', key: 'middle', l: 0.004, base: 0.003, h: 0.096, spread: 0.0, len: [0.048, 0.029, 0.021], r: 1.04 },
  { name: 'Ring', key: 'ring', l: -0.0125, base: -0.008, h: 0.092, spread: -0.06, len: [0.045, 0.027, 0.02], r: 0.97 },
  { name: 'Little', key: 'little', l: -0.0275, base: -0.018, h: 0.084, spread: -0.13, len: [0.035, 0.02, 0.018], r: 0.85 },
];

/** Finger joints [MCP, PIP, DIP, TIP] */
export function fingerJoints(s: Side, i: number): V3[] {
  const f = FINGERS[i];
  const { D, L, N } = handFrame(s);
  const base = norm(add(D, mul(L, f.spread)));
  const curl = [0.12, 0.28, 0.42];
  const pts: V3[] = [handPt(s, f.h, f.l, -0.001)];
  let p = pts[0];
  for (let k = 0; k < 3; k++) {
    const a = curl[k];
    const dir = norm(add(mul(base, Math.cos(a)), mul(N, Math.sin(a))));
    p = add(p, mul(dir, f.len[k]));
    pts.push(p);
  }
  return pts;
}
export const metacarpalBase = (s: Side, i: number): V3 => handPt(s, 0.03, FINGERS[i].base, -0.002);

/** Thumb [CMC, MCP, IP, TIP] */
export function thumbJoints(s: Side): V3[] {
  return [handPt(s, 0.021, 0.022, 0.004), handPt(s, 0.058, 0.046, 0.017), handPt(s, 0.087, 0.059, 0.026), handPt(s, 0.109, 0.066, 0.029)];
}

// ---------------------------------------------------------------- pelvis & lower limb
export const PELVIS = (s: Side) => ({
  hip: [s * 0.088, 0.925, 0.0] as V3,
  asis: [s * 0.118, 0.988, 0.062] as V3,
  aiis: [s * 0.102, 0.952, 0.05] as V3,
  crest: [s * 0.13, 1.048, -0.012] as V3,
  crestBack: [s * 0.09, 1.04, -0.062] as V3,
  psis: [s * 0.045, 1.0, -0.085] as V3,
  si: [s * 0.04, 0.99, -0.06] as V3,
  pubicTubercle: [s * 0.022, 0.885, 0.065] as V3,
  symphysis: [s * 0.005, 0.876, 0.062] as V3,
  ischialTub: [s * 0.058, 0.866, -0.032] as V3,
  ischialSpine: [s * 0.045, 0.912, -0.05] as V3,
});
export const hipJ = (s: Side): V3 => [s * 0.088, 0.925, 0.0];
export const kneeJ = (s: Side): V3 => [s * 0.094, 0.495, 0.0];
export const ankleJ = (s: Side): V3 => [s * 0.086, 0.082, -0.012];
export const thighPt = (s: Side, t: number, l = 0, f = 0): V3 => add(lerp([s * 0.118, 0.9, 0.0], [s * 0.096, 0.53, -0.004], t), [s * l, 0, f]);
export const legPt = (s: Side, t: number, l = 0, f = 0): V3 => add(lerp([s * 0.094, 0.47, 0.0], [s * 0.085, 0.1, -0.008], t), [s * l, 0, f]);

export function footFrame(s: Side) {
  const F = norm([s * 0.13, 0, 1]);
  const L = mul(norm(cross(Y, F)), s);
  return { A: ankleJ(s), F, L };
}
/** foot point: f forward from ankle, l lateral (+ = little-toe side), absolute height y */
export const footPt = (s: Side, f: number, l: number, y: number): V3 => {
  const { A, F, L } = footFrame(s);
  return [A[0] + F[0] * f + L[0] * l, y, A[2] + F[2] * f + L[2] * l];
};

export const TOES = [
  { name: 'Great toe', key: 'hallux', baseF: 0.055, baseL: -0.019, f: 0.135, l: -0.026, len: [0.03, 0.025], r: 1.35 },
  { name: 'Second toe', key: 'second', baseF: 0.05, baseL: -0.006, f: 0.143, l: -0.006, len: [0.022, 0.013, 0.011], r: 0.95 },
  { name: 'Third toe', key: 'third', baseF: 0.048, baseL: 0.005, f: 0.135, l: 0.008, len: [0.02, 0.012, 0.01], r: 0.9 },
  { name: 'Fourth toe', key: 'fourth', baseF: 0.045, baseL: 0.015, f: 0.124, l: 0.021, len: [0.018, 0.011, 0.009], r: 0.85 },
  { name: 'Little toe', key: 'fifth', baseF: 0.04, baseL: 0.026, f: 0.109, l: 0.033, len: [0.015, 0.009, 0.008], r: 0.8 },
];

/** Toe joints from MTP to tip */
export function toeJoints(s: Side, i: number): V3[] {
  const t = TOES[i];
  const { F, L } = footFrame(s);
  const spreadDir = norm(add(F, mul(L, (t.l + 0.005) * 1.4)));
  const pts: V3[] = [footPt(s, t.f, t.l, 0.017)];
  let p = pts[0];
  const drops = [0.002, 0.004, 0.003];
  for (let k = 0; k < t.len.length; k++) {
    p = add(p, mul(spreadDir, t.len[k]));
    p = [p[0], Math.max(0.0075, p[1] - drops[k] - 0.0005 * k), p[2]];
    pts.push(p);
  }
  return pts;
}
export const metatarsalBase = (s: Side, i: number): V3 => footPt(s, TOES[i].baseF, TOES[i].baseL, 0.033 - i * 0.002);

// ---------------------------------------------------------------- organs anchor points
export const HEART = {
  c: [0.012, 1.278, 0.036] as V3,
};
