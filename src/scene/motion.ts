import * as THREE from 'three';
import type { PartRT } from './runtime';
import type { State } from '../state/store';
import { PART_DEFS } from '../state/store';
import { shared } from './materials';
import { MUSCLE_DRIVERS } from '../anatomy/muscles';
import { BONE_DEFS } from '../anatomy/bones3d';
import { warpPoint } from '../geo/warp';

const UPFLEX = new Set(['shin', 'foot', 'neck', 'head', 'jaw', 'spine_T12', 'spine_T7', 'spine_L3']);

export type MotionMode = 'anatomical' | 'idle' | 'walk' | 'reach' | 'flex' | 'squat' | 'look';
export interface MotionCtx { t: number; dt: number; bones: Record<string, THREE.Bone>; parts: Map<string, PartRT>; state: State }

/*
 * Conventions (y up, subject faces +z, +x = subject's left, right-handed):
 *  - a limb hanging down flexes FORWARD with a NEGATIVE rotation about +x (elbow, hip, shoulder); knees flex with POSITIVE x.
 *  - a segment pointing up (trunk, neck) flexes forward with POSITIVE x.
 *  - left abduction = +z, right abduction = -z.
 * (SPEC §2 says "positive about +x flexes forward"; that is only true for upward-pointing segments, so limbs use the sign above.)
 */

const MODES: MotionMode[] = ['anatomical', 'idle', 'walk', 'reach', 'flex', 'squat', 'look'];
const SIDES = ['L', 'R'] as const;
const TAU = Math.PI * 2;
const HR_PERIOD = 60 / 68;
const BREATH_PERIOD = 60 / 13;

const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (x: number) => x * x * (3 - 2 * x);

const RIBDEF: Record<string, { head: number[]; tail: number[] }> = {};
for (const d of BONE_DEFS) if (d.name.startsWith('rib')) RIBDEF[d.name] = d;

// ------------------------------------------------------------------ module state
const S = {
  w: Object.fromEntries(MODES.map((m) => [m, m === 'idle' ? 1 : 0])) as Record<MotionMode, number>,
  walk: 0, flex: 0, look: 0, squat: 0, hr: 0.8, breath: 0,
  hAmp: 1, bAmp: 1,
  blinkNext: 2.5, blinkStart: -10, seed: 12345,
  sacNext: 0.8, sacTx: 0, sacTy: 0, sacX: 0, sacY: 0,
  jerk: { L: -10, R: -10 } as Record<string, number>,
  contract: new Map<string, number>(),
  lastN: -1,
};
const rnd = () => { let a = (S.seed += 0x6d2b79f5); a = Math.imul(a ^ (a >>> 15), a | 1); a ^= a + Math.imul(a ^ (a >>> 7), a | 61); return ((a ^ (a >>> 14)) >>> 0) / 4294967296; };

const acc = new Map<string, [number, number, number]>();
const posAcc = new Map<string, [number, number, number]>();
const restPos = new Map<string, THREE.Vector3>();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const rot = (n: string, x: number, y = 0, z = 0) => {
  let a = acc.get(n);
  if (!a) acc.set(n, (a = [0, 0, 0]));
  a[0] += x; a[1] += y; a[2] += z;
};
const move = (n: string, x: number, y: number, z: number) => {
  let a = posAcc.get(n);
  if (!a) posAcc.set(n, (a = [0, 0, 0]));
  a[0] += x; a[1] += y; a[2] += z;
};

// ------------------------------------------------------------------ part offset helper (cooperates with applyTransforms)
const offs = new Map<string, { last: THREE.Vector3; off: THREE.Vector3 }>();
const _b = new THREE.Vector3();
function setOff(p: PartRT, off: THREE.Vector3) {
  let e = offs.get(p.id);
  const pos = p.mesh.position;
  if (!e) offs.set(p.id, (e = { last: pos.clone(), off: new THREE.Vector3() }));
  if (pos.distanceToSquared(e.last) < 1e-16) _b.copy(e.last).sub(e.off);
  else _b.copy(pos);
  pos.copy(_b).add(off);
  e.last.copy(pos);
  e.off.copy(off);
}

// ------------------------------------------------------------------ part classification cache
interface Lists {
  vent: PartRT[]; atr: PartRT[]; aux: PartRT[]; lung: PartRT[]; bronchi: PartRT[]; diaph: PartRT[];
  av: { p: PartRT; pivot: THREE.Vector3; axis: THREE.Vector3 }[];
  sl: { p: PartRT; pivot: THREE.Vector3; axis: THREE.Vector3 }[];
  abd: PartRT[];
  mus: { key: string; side: string; parts: PartRT[]; d: { bone: string; sign: 1 | -1; gain?: number } }[];
  quad: PartRT[];
  cV: THREE.Vector3 | null; dir: THREE.Vector3;
}
const L: Lists = { vent: [], atr: [], aux: [], lung: [], bronchi: [], diaph: [], av: [], sl: [], abd: [], mus: [], quad: [], cV: null, dir: new THREE.Vector3(0, 1, 0) };
const ABD_SYS = new Set(['digestive', 'urinary', 'reproductive', 'endocrine']);

function classify(parts: Map<string, PartRT>) {
  for (const k of Object.keys(L) as (keyof Lists)[]) { const v = L[k]; if (Array.isArray(v)) v.length = 0; }
  const cV = new THREE.Vector3(), cA = new THREE.Vector3();
  let nV = 0, nA = 0, diaphY = -Infinity;
  for (const p of parts.values()) {
    const d = PART_DEFS[p.id];
    if (!d) continue;
    switch (d.anim) {
      case 'ventricle': L.vent.push(p); cV.add(p.center); nV++; break;
      case 'atrium': L.atr.push(p); cA.add(p.center); nA++; break;
      case 'heartAux': L.aux.push(p); break;
      case 'lung': L.lung.push(p); break;
      case 'bronchi': L.bronchi.push(p); break;
      case 'diaphragm': L.diaph.push(p); diaphY = p.center.y; break;
      case 'leafletAV': case 'leafletSL':
        if (d.pivot && d.axis) {
          const wp = warpPoint(d.pivot), wq = warpPoint([d.pivot[0] + d.axis[0] * 0.02, d.pivot[1] + d.axis[1] * 0.02, d.pivot[2] + d.axis[2] * 0.02]);
          const ax = new THREE.Vector3(wq[0] - wp[0], wq[1] - wp[1], wq[2] - wp[2]);
          if (ax.lengthSq() < 1e-12) ax.set(...d.axis);
          (d.anim === 'leafletAV' ? L.av : L.sl).push({ p, pivot: new THREE.Vector3(...wp), axis: ax.normalize() });
        }
        break;
    }
  }
  if (nV) { cV.multiplyScalar(1 / nV); L.cV = cV; if (nA) { cA.multiplyScalar(1 / nA); const dd = cA.sub(cV); if (dd.lengthSq() > 1e-8) L.dir.copy(dd.normalize()); } }
  if (diaphY > -Infinity) {
    for (const p of parts.values()) {
      const d = PART_DEFS[p.id];
      if (d && !d.anim && ABD_SYS.has(p.system) && p.center.y < diaphY - 0.03) L.abd.push(p);
    }
  }
  for (const key of Object.keys(MUSCLE_DRIVERS)) for (const sd of SIDES) {
    if (PART_DEFS[`${key}.${sd}`]?.external) continue;
    const ps: PartRT[] = [];
    const p = parts.get(`${key}.${sd}`);
    if (p) ps.push(p);
    if (ps.length) L.mus.push({ key, side: sd, parts: ps, d: MUSCLE_DRIVERS[key] });
  }
  for (const [id, p] of parts) {
    const d = PART_DEFS[id];
    if (!d || !d.driver) continue;
    const sd = id.endsWith('.R') ? 'R' : 'L';
    L.mus.push({ key: id, side: sd, parts: [p], d: d.driver });
  }
  for (const [id, p] of parts) if (/^mus\.(rectus_fem|vastus|quadriceps)|^bp\.(rectus_femoris|vastus|quadriceps)/.test(id)) L.quad.push(p);
}

// ------------------------------------------------------------------ physiology
const q = new THREE.Quaternion();
const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();
const off = new THREE.Vector3();

function breathCurve(u: number) {
  return u < 0.4 ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.4) : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.4)) / 0.6);
}

function heartStep(c: number, hAmp: number, bones: Record<string, THREE.Bone>) {
  void bones;
  // chamber activity
  const vent = sstep(0.12, 0.3, c) * (1 - sstep(0.42, 0.6, c));
  const atSys = c < 0.12 ? Math.sin((Math.PI * c) / 0.12) : 0;
  const atRes = c > 0.18 && c < 0.52 ? Math.sin((Math.PI * (c - 0.18)) / 0.34) : 0;
  const avOpen = c < 0.12 ? 1 : c < 0.18 ? 1 - sstep(0.12, 0.18, c) : c < 0.52 ? 0 : sstep(0.52, 0.6, c) * (c > 0.9 ? 1 - 0.1 * sstep(0.9, 1, c) : 1);
  const slOpen = c < 0.18 ? 0 : c < 0.45 ? sstep(0.18, 0.22, c) * (1 - sstep(0.39, 0.45, c)) : 0;
  const v = vent * hAmp;
  for (const p of L.vent) {
    p.mesh.scale.setScalar(1 - 0.08 * v);
    off.copy(L.dir).multiplyScalar(0.005 * v);
    if (L.cV) {
      q.setFromAxisAngle(L.dir, 0.05 * v);
      p.mesh.quaternion.copy(q);
      tv.copy(p.center).sub(L.cV);
      tv2.copy(tv).applyQuaternion(q).sub(tv);
      off.add(tv2);
    }
    setOff(p, off);
  }
  for (const p of L.atr) p.mesh.scale.setScalar(1 - (0.075 * atSys - 0.025 * atRes) * hAmp);
  for (const p of L.aux) { p.mesh.scale.setScalar(1 - 0.012 * v); setOff(p, off.copy(L.dir).multiplyScalar(0.003 * v)); }
  const leaf = (list: Lists['av'], open: number, ang: number) => {
    for (const l of list) {
      const m = l.p.mesh;
      q.setFromAxisAngle(l.axis, ang * open);
      m.quaternion.copy(q);
      tv.copy(l.p.center).sub(l.pivot).applyQuaternion(q).add(l.pivot).sub(l.p.center);
      setOff(l.p, tv);
    }
  };
  leaf(L.av, avOpen, 1.222);
  leaf(L.sl, slOpen, 1.047);
}

// ------------------------------------------------------------------ main step
export function stepMotion(ctx: MotionCtx): void {
  const { t, bones, parts, state } = ctx;
  const dt = Math.min(Math.max(ctx.dt, 0), 0.05);
  lastT = t;
  if (parts.size !== S.lastN) { S.lastN = parts.size; classify(parts); }
  const mode = ((state as unknown as { motion?: MotionMode }).motion ?? 'idle') as MotionMode;
  const anim = state.anim;

  // blend weights (0.6 s cross-fade)
  const e = {} as Record<MotionMode, number>;
  for (const m of MODES) {
    const tgt = m === mode ? 1 : 0;
    const w = S.w[m];
    S.w[m] = w + clamp(tgt - w, -dt / 0.6, dt / 0.6);
    e[m] = ease(S.w[m]);
  }
  const active = 1 - e.anatomical;
  S.hAmp += clamp((anim.heart ? 1 : 0) - S.hAmp, -dt * 3, dt * 3);
  S.bAmp += clamp((anim.lungs ? 1 : 0) - S.bAmp, -dt * 3, dt * 3);

  // phases
  S.hr = (S.hr + dt / HR_PERIOD) % 1;
  S.breath = (S.breath + dt / BREATH_PERIOD) % 1;
  if (e.walk > 0.001 || mode === 'walk') S.walk = (S.walk + (dt / 1.1) * TAU) % (TAU * 100); else S.walk = 0;
  if (e.flex > 0.001 || mode === 'flex') S.flex += dt / 3; else S.flex = 0;
  if (e.look > 0.001 || mode === 'look') S.look += dt / 8; else S.look = 0;
  if (e.squat > 0.001 || mode === 'squat') S.squat += dt / 5; else S.squat = 0;

  const b = breathCurve(S.breath) * S.bAmp;
  shared.uBreath.value = b * active;
  const bb = b * active;

  // ---- heart
  heartStep(anim.heart ? S.hr : 0.8, S.hAmp, bones);

  // ---- lungs / diaphragm / abdomen
  for (const p of L.lung) p.mesh.scale.set(1 + 0.03 * b, 1 + 0.045 * b, 1 + 0.04 * b);
  for (const p of L.bronchi) p.mesh.scale.setScalar(1 + 0.02 * b);
  for (const p of L.diaph) { p.mesh.scale.set(1 + 0.01 * b, 1 - 0.03 * b, 1 + 0.01 * b); setOff(p, off.set(0, -0.013 * b, 0)); }
  for (const p of L.abd) setOff(p, off.set(0, -0.0065 * b, 0.0015 * b));

  // ---- ribs / sternum / spine breathing (bone driven)
  for (const sd of SIDES) {
    const sg = sd === 'L' ? 1 : -1;
    for (let n = 1; n <= 12; n++) {
      const bone = bones[`rib${n}.${sd}`];
      if (!bone) continue;
      const bucket = ((2 + (2 * (n - 1)) / 11) * Math.PI) / 180 * bb;
      const pump = ((n <= 7 ? 3 - 0.4 * (n - 1) : 1) * Math.PI) / 180 * bb;
      const bd = RIBDEF[`rib${n}.${sd}`];
      if (bd) tv.set(bd.tail[0] - bd.head[0], bd.tail[1] - bd.head[1], bd.tail[2] - bd.head[2]).normalize(); else tv.set(0.55 * sg, -0.2, 0.8).normalize();
      const sign = tv2.set(sg, 0, 0).applyAxisAngle(tv, 0.1).y > 0 ? 1 : -1;
      q.setFromAxisAngle(tv, bucket * sign);
      const q2 = _q2.setFromAxisAngle(_X, -pump);
      bone.quaternion.copy(q).multiply(q2);
      captureRest(bone, `rib${n}.${sd}`);
    }
    rot(`clavicle.${sd}`, 0, 0, sg * 0.0175 * bb);
  }
  move('sternum', 0, 0.004 * bb, 0.005 * bb);
  rot('spine_T7', -0.012 * bb);

  // ---- eyes: saccades, blinks
  if (ctx.t >= S.sacNext) {
    S.sacNext = ctx.t + 0.5 + rnd() * 1.5;
    const amp = (2 + rnd() * 8) * (Math.PI / 180);
    const a = rnd() * TAU;
    S.sacTx = Math.cos(a) * amp; S.sacTy = Math.sin(a) * amp * 0.6;
    if (rnd() < 0.25) { S.sacTx *= 0.2; S.sacTy *= 0.2; }
  }
  const sk = 1 - Math.exp(-dt * 40);
  S.sacX += (S.sacTx - S.sacX) * sk; S.sacY += (S.sacTy - S.sacY) * sk;
  if (t >= S.blinkNext) { S.blinkStart = t; S.blinkNext = t + 3 + rnd() * 3; }
  const bt = t - S.blinkStart;
  const blink = bt < 0 || bt > 0.32 ? 0 : bt < 0.12 ? ease(bt / 0.12) : 1 - ease((bt - 0.12) / 0.2);
  for (const sd of SIDES) {
    rot(`lidU.${sd}`, 0.75 * blink * active);
    rot(`lidL.${sd}`, -0.12 * blink * active);
  }

  // ---- idle sway / micro motion
  const swayK = active * (0.4 + 0.6 * e.idle);
  const sw = Math.sin((TAU * t) / 7);
  rot('pelvis', 0, 0, 0.0087 * sw * swayK);
  move('pelvis', 0.004 * sw * swayK, 0, 0);
  rot('spine_L3', 0, 0, -0.005 * sw * swayK);
  rot('spine_T7', 0.003 * Math.sin((TAU * t) / 4.1) * swayK, 0.006 * Math.sin((TAU * t) / 9) * swayK, -0.004 * sw * swayK);
  rot('head', 0.008 * Math.sin(t * 1.3) * swayK, 0.012 * Math.sin((TAU * t) / 5.3 + 1) * swayK, 0.006 * Math.sin((TAU * t) / 6.1) * swayK);

  // ---- gaze
  let eyeYaw = S.sacX * active;
  const eyePitch = S.sacY * active;

  // ---- relaxed hands
  const relax = active * (1 - e.reach) * (1 - e.flex);
  for (const sd of SIDES) for (let f = 2; f <= 5; f++) {
    rot(`f${f}_1.${sd}`, -0.12 * (1 + 0.15 * f) * relax);
    rot(`f${f}_2.${sd}`, -0.2 * relax);
    rot(`f${f}_3.${sd}`, -0.12 * relax);
  }

  // ---- WALK
  if (e.walk > 0) {
    const w = e.walk;
    for (const sd of SIDES) {
      const ph = S.walk + (sd === 'L' ? 0 : Math.PI);
      const sg = sd === 'L' ? 1 : -1;
      const hipF = 0.44 * Math.sin(ph);
      const kneeF = 0.12 + 0.93 * Math.pow(Math.max(0, Math.cos(ph)), 2);
      rot(`thigh.${sd}`, -hipF * w);
      rot(`shin.${sd}`, kneeF * w);
      rot(`foot.${sd}`, -0.17 * Math.sin(ph) * w);
      rot(`toes.${sd}`, -0.4 * Math.max(0, -Math.sin(ph)) * w);
      const armF = -0.35 * Math.sin(ph);
      rot(`upperarm.${sd}`, -armF * w, 0, sg * 0.05 * w);
      rot(`forearm.${sd}`, -(0.35 + 0.25 * Math.max(0, armF / 0.35)) * w);
    }
    const ph = S.walk;
    rot('pelvis', 0, -0.07 * Math.sin(ph) * w);
    rot('spine_T12', 0, 0.045 * Math.sin(ph) * w);
    rot('spine_T7', 0, 0.045 * Math.sin(ph) * w);
    rot('head', 0, 0.02 * Math.sin(ph) * w);
    move('pelvis', -0.012 * Math.cos(ph) * w, 0.01 * Math.cos(2 * ph) * w, 0);
  }

  // ---- REACH (right arm)
  if (e.reach > 0) {
    const w = e.reach;
    rot('upperarm.R', -2.62 * w, 0, -0.12 * w);
    rot('forearm.R', -0.15 * w);
    rot('clavicle.R', 0, 0, -0.12 * w);
    rot('spine_T7', -0.05 * w);
    for (let f = 2; f <= 5; f++) for (let k = 1; k <= 3; k++) rot(`f${f}_${k}.R`, 0.14 * w);
    rot('f1_1.R', 0.1 * w);
    rot('head', -0.08 * w);
  }

  // ---- FLEX (both elbows curl, fists)
  if (e.flex > 0) {
    const w = e.flex;
    const s = 0.5 - 0.5 * Math.cos(TAU * S.flex);
    for (const sd of SIDES) {
      const sg = sd === 'L' ? 1 : -1;
      rot(`upperarm.${sd}`, -0.15 * w, 0, sg * 0.35 * w);
      rot(`forearm.${sd}`, -2.27 * s * w);
      for (let f = 2; f <= 5; f++) {
        rot(`f${f}_1.${sd}`, -1.3 * s * w);
        rot(`f${f}_2.${sd}`, -1.5 * s * w);
        rot(`f${f}_3.${sd}`, -1.0 * s * w);
      }
      rot(`f1_1.${sd}`, -0.4 * s * w);
      rot(`f1_2.${sd}`, -0.6 * s * w);
    }
  }

  // ---- SQUAT
  if (e.squat > 0) {
    const w = e.squat;
    const u = S.squat % 1;
    const s = ease(clamp(0.5 - 0.5 * Math.cos(TAU * u) * 1.25)) * w; // 0..1 with brief hold at both ends
    const h = 1.75 * s, k = 1.92 * s, a = 0.44 * s;
    const pa = k - a - h; // pelvis x-rotation that keeps the feet flat (negative => anterior tilt via sign below)
    const pel = -pa;
    rot('pelvis', pel);
    rot('spine_L3', 0.1 * s);
    rot('spine_T12', 0.1 * s);
    rot('head', -0.2 * s);
    for (const sd of SIDES) {
      rot(`thigh.${sd}`, -h, 0, 0);
      rot(`shin.${sd}`, k);
      rot(`foot.${sd}`, -a);
      rot(`upperarm.${sd}`, -1.4 * s);
      rot(`forearm.${sd}`, -0.2 * s);
    }
    const tl = bones['shin.L']?.position.length() || 0.43;
    const sl = bones['foot.L']?.position.length() || 0.42;
    const Hf = h - pel; // forward thigh angle = h - pelvis x-rot
    const Sf = Hf - k;
    const drop = tl + sl - (tl * Math.cos(Hf) + sl * Math.cos(Sf));
    const back = -(tl * Math.sin(Hf) + sl * Math.sin(Sf));
    move('pelvis', 0, -drop, back);
  }

  // ---- LOOK
  if (e.look > 0) {
    const w = e.look;
    const yaw = 0.87 * Math.sin(TAU * S.look) * w;
    rot('neck', 0, 0.35 * yaw);
    rot('head', 0.04 * Math.sin(TAU * S.look * 2) * w, 0.65 * yaw);
    eyeYaw += clamp(0.45 * Math.cos(TAU * S.look), -0.3, 0.3) * w;
  }

  // ---- knee jerk
  for (const sd of SIDES) {
    const u = (t - S.jerk[sd]) / 0.35;
    if (u >= 0 && u <= 1) rot(`shin.${sd}`, -0.44 * Math.sin(Math.PI * u));
  }

  for (const sd of SIDES) {
    rot(`eye.${sd}`, eyePitch, eyeYaw);
  }

  // ---- write bones
  for (const [name, a] of acc) {
    const bone = bones[name];
    if (bone) {
      captureRest(bone, name);
      if (active === 0 && !name.startsWith('lid') && !name.startsWith('eye')) bone.quaternion.identity();
      else bone.quaternion.setFromEuler(euler.set(a[0], a[1], a[2], 'YXZ'));
    }
    a[0] = a[1] = a[2] = 0;
  }
  for (const [name, a] of posAcc) {
    const bone = bones[name];
    if (bone) {
      const r = captureRest(bone, name);
      const k = name === 'sternum' ? 1 : active;
      bone.position.set(r.x + a[0] * k, r.y + a[1] * k, r.z + a[2] * k);
    }
    a[0] = a[1] = a[2] = 0;
  }
  // anatomical mode: rest pose exactly
  if (active < 0.001) for (const sd of SIDES) for (let n = 1; n <= 12; n++) bones[`rib${n}.${sd}`]?.quaternion.identity();

  // ---- muscle contraction
  const jerkQuad = (sd: string) => { const u = (t - S.jerk[sd]) / 0.35; return u >= 0 && u <= 1 ? Math.sin(Math.PI * Math.min(1, u / 0.6) * 0.99) : 0; };
  const ck = 1 - Math.exp(-dt * 12);
  const target = new Map<PartRT, number>();
  for (const m of L.mus) {
    const bone = bones[`${m.d.bone}.${m.side}`] ?? bones[m.d.bone];
    let c = 0;
    if (bone) {
      const qq = bone.quaternion;
      let ax = 2 * Math.atan2(qq.x, qq.w);
      if (ax > Math.PI) ax -= TAU; else if (ax < -Math.PI) ax += TAU;
      const flex = UPFLEX.has(m.d.bone) ? ax : -ax;
      c = clamp((m.d.sign * flex) / 1.5 * (m.d.gain ?? 1));
    }
    for (const p of m.parts) target.set(p, c);
  }
  for (const p of L.quad) {
    const sd = p.id.endsWith('.R') ? 'R' : 'L';
    target.set(p, Math.max(target.get(p) ?? 0, jerkQuad(sd)));
  }
  for (const [p, c] of target) {
    const cur = S.contract.get(p.id) ?? 0;
    const nv = cur + (c - cur) * ck;
    if (Math.abs(nv - cur) > 1e-4) { S.contract.set(p.id, nv); p.mesh.material.userData.uContract.value = nv; }
  }
}

let lastT = 0;
const _q2 = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);
function captureRest(bone: THREE.Bone, name: string) {
  let r = restPos.get(name);
  if (!r) restPos.set(name, (r = bone.position.clone()));
  return r;
}

export function poke(partId: string, point: THREE.Vector3): void {
  const d = PART_DEFS[partId];
  const tissue = (d?.tissue ?? '') as string;
  let amp = 0.002;
  if (d) {
    if (d.system === 'integumentary' || tissue === 'skin' || tissue === 'fat') amp = 0.004;
    else if (tissue === 'bone' || tissue === 'tooth') amp = 0.0004;
  }
  shared.uPokePos.value.copy(point);
  shared.uPokeTime.value = shared.uTime.value;
  shared.uPokeAmp.value = amp;
  if (partId.startsWith('ten.patellar')) {
    const sd = partId.endsWith('.R') ? 'R' : 'L';
    S.jerk[sd] = lastT;
  }
}
