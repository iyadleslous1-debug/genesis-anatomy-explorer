import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { NODES, partsUnder, ancestors, State } from '../state/store';
import type { SystemId } from '../anatomy/registry';
import type { TissueMaterial } from './materials';
import { BONE_DEFS } from '../anatomy/bones3d';

(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;

export interface PartRT {
  id: string;
  mesh: THREE.SkinnedMesh<THREE.BufferGeometry, TissueMaterial>;
  center: THREE.Vector3;
  radius: number;
  system: SystemId;
  global: THREE.Vector3;
  organ: THREE.Vector3;
  pickable: boolean;
}

function makeRig() {
  const root = new THREE.Group();
  const bones: Record<string, THREE.Bone> = {};
  const heads: Record<string, [number, number, number]> = {};
  const list: THREE.Bone[] = [];
  for (const d of BONE_DEFS) {
    const b = new THREE.Bone();
    b.name = d.name;
    const ph = d.parent ? heads[d.parent] : [0, 0, 0];
    b.position.set(d.head[0] - ph[0], d.head[1] - ph[1], d.head[2] - ph[2]);
    heads[d.name] = d.head;
    if (d.parent) bones[d.parent].add(b); else root.add(b);
    bones[d.name] = b;
    list.push(b);
  }
  root.updateMatrixWorld(true);
  return { root, bones, skeleton: new THREE.Skeleton(list) };
}
const rig = makeRig();

export const RT = {
  parts: new Map<string, PartRT>(),
  root: rig.root,
  bones: rig.bones,
  skeleton: rig.skeleton,
  explodeCur: 0,
  organCur: 0,
  organId: null as string | null,
  clipPlane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
  clipOn: false,
  layoutDirty: true,
};

const COLUMNS: Record<SystemId, number> = {
  integumentary: -2.5,
  muscular: -1.5,
  skeletal: -0.5,
  respiratory: 0.5,
  digestive: 0.5,
  urinary: 0.5,
  reproductive: 0.5,
  endocrine: 0.5,
  cardiovascular: 1.5,
  nervous: 2.5,
  lymphatic: 1.5,
};
const COL_SPACING = 1.08;
const FAN: Record<string, [number, number]> = {
  integumentary: [0.3, 0.3], lymphatic: [0.34, 0.6], muscular: [0.42, 0.75], skeletal: [0.5, 0.9], organs: [1.05, 0.85], cardiovascular: [0.32, 0.55], nervous: [0.34, 0.6],
};
const BODY_C = new THREE.Vector3(0, 0.95, 0);
const ORGAN_SYS: SystemId[] = ['respiratory', 'digestive', 'urinary', 'reproductive', 'endocrine'];

export function centerOf(ids: string[], current = false, out = new THREE.Vector3()): THREE.Vector3 {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let any = false;
  for (const id of ids) {
    const p = RT.parts.get(id);
    if (!p) continue;
    const g = p.mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    tmp.copy(g.boundingBox!).translate(current ? p.mesh.position : p.center);
    if (current && p.mesh.scale.x !== 1) tmp.expandByScalar(0);
    box.union(tmp);
    any = true;
  }
  if (!any) return out.set(0, 0.9, 0);
  return box.getCenter(out);
}
export function boxOf(ids: string[], current = true): THREE.Box3 {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const id of ids) {
    const p = RT.parts.get(id);
    if (!p || !p.mesh.visible) continue;
    const g = p.mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    tmp.copy(g.boundingBox!).translate(current ? p.mesh.position : p.center);
    box.union(tmp);
  }
  if (box.isEmpty()) for (const id of ids) {
    const p = RT.parts.get(id);
    if (!p) continue;
    tmp.copy(p.mesh.geometry.boundingBox!).translate(p.mesh.position);
    box.union(tmp);
  }
  return box;
}

/** Compute global explode offsets: systems separate into columns, then structures fan out radially. */
export function computeLayout() {
  const groupCenters = new Map<string, THREE.Vector3>();
  const sysCenters = new Map<string, THREE.Vector3>();
  for (const p of RT.parts.values()) {
    const node = NODES[p.id];
    const gid = node.parent!;
    if (!groupCenters.has(gid)) groupCenters.set(gid, centerOf(partsUnder(gid)));
    const sysKey = ORGAN_SYS.includes(p.system) ? 'organs' : p.system;
    if (!sysCenters.has(sysKey)) {
      const ids = [...RT.parts.values()].filter((q) => (ORGAN_SYS.includes(q.system) ? 'organs' : q.system) === sysKey).map((q) => q.id);
      sysCenters.set(sysKey, centerOf(ids));
    }
  }
  for (const p of RT.parts.values()) {
    const node = NODES[p.id];
    const gc = groupCenters.get(node.parent!)!;
    const isOrgan = ORGAN_SYS.includes(p.system);
    const sc = sysCenters.get(isOrgan ? 'organs' : p.system) ?? BODY_C;
    const col = new THREE.Vector3(COLUMNS[p.system] * COL_SPACING, 0.45, 0);
    // radial fan: group from system centre, then part from group centre
    const [f1, f2] = FAN[isOrgan ? 'organs' : p.system];
    const g1 = gc.clone().sub(sc).multiplyScalar(f1);
    const g2 = p.center.clone().sub(gc).multiplyScalar(f2);
    // keep exploded figure standing above the floor
    const radial = g1.add(g2);
    radial.z *= 1.4;
    p.global.copy(col).addScaledVector(radial, 1);
    (p.global as THREE.Vector3 & { radial?: THREE.Vector3 }).radial = radial;
    (p.global as THREE.Vector3 & { col?: THREE.Vector3 }).col = col;
  }
  RT.layoutDirty = false;
}

export function computeOrganLayout(id: string | null) {
  for (const p of RT.parts.values()) p.organ.set(0, 0, 0);
  RT.organId = id;
  if (!id) return;
  const ids = partsUnder(id).filter((x) => RT.parts.has(x));
  if (ids.length < 2) return;
  const c = centerOf(ids);
  const box = boxOf(ids, false);
  const size = box.getSize(new THREE.Vector3()).length();
  // group by immediate children of the organ so sub-assemblies stay together
  const node = NODES[id];
  for (const child of node.children) {
    const sub = partsUnder(child).filter((x) => RT.parts.has(x));
    if (!sub.length) continue;
    const cc = centerOf(sub);
    const dir = cc.clone().sub(c);
    if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
    const childOff = dir.clone().multiplyScalar(1.1).addScaledVector(dir.clone().normalize(), size * 0.18);
    for (const pid of sub) {
      const p = RT.parts.get(pid)!;
      const inner = sub.length > 1 ? p.center.clone().sub(cc).multiplyScalar(0.9) : new THREE.Vector3();
      p.organ.copy(childOff).add(inner);
    }
  }
}

const phase = (e: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (e - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const tmpV = new THREE.Vector3();
export function applyTransforms() {
  const e = RT.explodeCur;
  const colP = phase(e, 0, 0.6);
  const radP = phase(e, 0.25, 1);
  for (const p of RT.parts.values()) {
    const g = p.global as THREE.Vector3 & { radial?: THREE.Vector3; col?: THREE.Vector3 };
    tmpV.copy(p.center);
    if (e > 0 && g.col && g.radial) tmpV.addScaledVector(g.col, colP).addScaledVector(g.radial, radP);
    if (RT.organCur > 0) tmpV.addScaledVector(p.organ, RT.organCur);
    p.mesh.position.copy(tmpV);
  }
}

// ------------------------------------------------------------------ picking
const _sphere = new THREE.Sphere();
const _hits: THREE.Intersection[] = [];
export function pickRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
  const rt = RT.parts.get(this.userData.id as string);
  if (!this.visible || !rt || !rt.pickable) return;
  const g = this.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  _sphere.copy(g.boundingSphere!).applyMatrix4(this.matrixWorld);
  if (!raycaster.ray.intersectsSphere(_sphere)) return;
  const gb = g as THREE.BufferGeometry & { boundsTree?: unknown; computeBoundsTree: () => void };
  if (!gb.boundsTree) gb.computeBoundsTree();
  _hits.length = 0;
  acceleratedRaycast.call(this, raycaster, _hits);
  for (const h of _hits) {
    if (RT.clipOn && RT.clipPlane.distanceToPoint(h.point) < 0) continue;
    intersects.push(h);
  }
}

export function setPickable(s: State) {
  for (const p of RT.parts.values()) {
    const m = p.mesh.material;
    p.pickable = p.mesh.visible && m.opacity > 0.3 && !(m.userData.uXray.value > 0.5 && m.opacity < 0.75);
  }
  void s;
  void ancestors;
}

