/**
 * Articulated skeleton definition (P1). Rest pose = anatomical position, all rest rotations identity.
 * +x = subject's left. Bone local position (three.js) = head - parent.head.
 */
import type { V3 } from '../geo/math';
import { vert, HEAD, CLAVICLE, shoulderJ, elbowJ, wristJ, handPt, fingerJoints, thumbJoints, hipJ, kneeJ, ankleJ, footPt, SIDES, sid, Side } from './rig';
import { ribPaths } from './skeleton';
import { warpPoint } from '../geo/warp';

export interface BoneDef { name: string; parent: string | null; head: [number, number, number]; tail: [number, number, number] }

const sfx = (s: Side) => (s === 1 ? 'L' : 'R');

/** Polyline following the rib (bone + cartilage), used for skin weighting. */
export function ribPoly(s: Side, i: number): V3[] {
  const [b, c] = ribPaths(s, i);
  return c ? [...b, ...c.slice(1)] : b;
}

export const ribParent = (i: number) => (i <= 6 ? 'spine_T1' : i <= 11 ? 'spine_T7' : 'spine_T12');

function build(): BoneDef[] {
  const defs: BoneDef[] = [];
  const add = (name: string, parent: string | null, head: V3, tail: V3) => defs.push({ name, parent, head: warpPoint([...head] as V3), tail: warpPoint([...tail] as V3) });
  const L3 = vert('L3').c, T12 = vert('T12').c, T7 = vert('T7').c, T1 = vert('T1').c, C7 = vert('C7').c, C1 = vert('C1').c;
  add('pelvis', null, [0, 0.95, -0.03], L3);
  add('spine_L3', 'pelvis', L3, T12);
  add('spine_T12', 'spine_L3', T12, T7);
  add('spine_T7', 'spine_T12', T7, T1);
  add('spine_T1', 'spine_T7', T1, C7);
  add('neck', 'spine_T1', C7, C1);
  add('head', 'neck', C1, [0, 1.756, -0.008]);
  add('jaw', 'head', HEAD.condyle(1).map((v, k) => (k === 0 ? 0 : v)) as V3, HEAD.chin);
  add('sternum', 'spine_T7', [0, 1.443, 0.072], [0, 1.205, 0.098]);
  for (const s of SIDES) {
    const S = sfx(s);
    const e = HEAD.eye(s);
    // pivot at the real BP3D globe centre (sclera centroid); the warped HEAD.eye lands at the corneal surface instead
    const ec: V3 = s === 1 ? [0.02915, 1.59607, 0.15114] : [-0.03046, 1.59607, 0.15115];
    void e;
    defs.push({ name: `eye.${S}`, parent: 'head', head: [...ec] as V3, tail: [ec[0], ec[1], ec[2] + 0.012] });
    defs.push({ name: `lidU.${S}`, parent: 'head', head: [...ec] as V3, tail: [ec[0], ec[1] + 0.0122, ec[2]] });
    defs.push({ name: `lidL.${S}`, parent: 'head', head: [...ec] as V3, tail: [ec[0], ec[1] - 0.0122, ec[2]] });
    for (let i = 1; i <= 12; i++) {
      const p = ribPoly(s, i);
      add(`rib${i}.${S}`, ribParent(i), p[0], p[p.length - 1]);
    }
    const cl = CLAVICLE(s);
    add(`clavicle.${S}`, 'spine_T1', cl[0], cl[3]);
    add(`scapula.${S}`, `clavicle.${S}`, [s * 0.072, 1.385, -0.103], [s * 0.158, 1.41, -0.022]);
    add(`upperarm.${S}`, `clavicle.${S}`, shoulderJ(s), elbowJ(s));
    add(`forearm.${S}`, `upperarm.${S}`, elbowJ(s), wristJ(s));
    add(`hand.${S}`, `forearm.${S}`, wristJ(s), handPt(s, 0.09, 0, 0));
    const tj = thumbJoints(s);
    for (let k = 0; k < 3; k++) add(`f1_${k + 1}.${S}`, k === 0 ? `hand.${S}` : `f1_${k}.${S}`, tj[k], tj[k + 1]);
    for (let f = 0; f < 4; f++) {
      const j = fingerJoints(s, f);
      for (let k = 0; k < 3; k++) add(`f${f + 2}_${k + 1}.${S}`, k === 0 ? `hand.${S}` : `f${f + 2}_${k}.${S}`, j[k], j[k + 1]);
    }
    add(`thigh.${S}`, 'pelvis', hipJ(s), kneeJ(s));
    add(`shin.${S}`, `thigh.${S}`, kneeJ(s), ankleJ(s));
    const mtp = footPt(s, 0.125, 0, 0.017);
    add(`foot.${S}`, `shin.${S}`, ankleJ(s), mtp);
    add(`toes.${S}`, `foot.${S}`, mtp, footPt(s, 0.165, 0, 0.012));
  }
  void sid;
  return defs;
}

export const BONE_DEFS: BoneDef[] = build();
export const BONE_INDEX: Record<string, number> = Object.fromEntries(BONE_DEFS.map((b, i) => [b.name, i]));
