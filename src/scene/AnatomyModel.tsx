import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { useStore, PART_IDS, PART_DEFS, partVisible, partOpacity, ancestors, State, OUTER, NODES } from '../state/store';
import { RT, type PartRT, computeLayout, computeOrganLayout, applyTransforms, pickRaycast, setPickable } from './runtime';
import { createMaterial, shared } from './materials';
import type { PartMsg } from '../worker/build.worker';
import { stepMotion, poke } from './motion';
import { MANIFEST, BP3D_PARTS, type ManifestPart, type AttrDef } from '../anatomy/bp3d';

const COST: Record<string, number> = { 'skin.trunk': 40, 'skin.head': 26, 'fat.subcutaneous': 20, 'skin.arm.L': 8, 'skin.arm.R': 8, 'skin.hand.L': 12, 'skin.hand.R': 12, 'skin.foot.L': 10, 'skin.foot.R': 10 };
const costOf = (id: string) => {
  if (COST[id]) return COST[id];
  const d = PART_DEFS[id];
  if (d.system === 'muscular' && d.tissue === 'muscle') return 5;
  if (d.tissue === 'brain') return 8;
  if (id.startsWith('dig.liver') || id === 'dig.stomach' || id.startsWith('bone.hip')) return 6;
  if (d.tissue === 'bone') return 2;
  return 1.2;
};

function startWorkers(onPart: (m: PartMsg) => void, onError: (id: string, msg: string) => void) {
  const n = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  const buckets: string[][] = Array.from({ length: n }, () => []);
  const load = new Array(n).fill(0);
  // Visible-first ordering: skin builds first so the body appears immediately.
  const order = PART_IDS.filter((id) => !PART_DEFS[id].external).sort((a, b) => costOf(b) - costOf(a));
  for (const id of order) {
    let k = 0;
    for (let i = 1; i < n; i++) if (load[i] < load[k]) k = i;
    buckets[k].push(id);
    load[k] += costOf(id);
  }
  const workers = buckets.map((ids) => {
    const w = new Worker(new URL('../worker/build.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      if (e.data.type === 'part') onPart(e.data);
      else if (e.data.type === 'error') onError(e.data.id, e.data.message);
    };
    w.postMessage({ ids });
    return w;
  });
  return () => workers.forEach((w) => w.terminate());
}

const RENDER_ORDER: Record<string, number> = { integumentary: 30, muscular: 20 };

function applyState(s: State, prev?: State) {
  const selChanged = !prev || prev.selected !== s.selected || prev.hovered !== s.hovered;
  const visChanged = !prev || prev.hidden !== s.hidden || prev.isolated !== s.isolated || prev.layers !== s.layers || prev.ghosted !== s.ghosted || prev.xray !== s.xray || prev.focusFade !== s.focusFade || prev.clip.enabled !== s.clip.enabled || (prev.explode > 0.001) !== (s.explode > 0.001) || prev.organExplode.id !== s.organExplode.id || prev.selected !== s.selected;
  if (visChanged || selChanged) {
    const covered = skinCovers(s);
    for (const p of RT.parts.values()) applyPart(s, p.id, covered);
    setPickable(s);
  }
  if (!prev || prev.organExplode.id !== s.organExplode.id) computeOrganLayout(s.organExplode.id);
  shared.uFlowOn.value = s.anim.flow ? 1 : 0;
}

const _n = new THREE.Vector3();
const _nx = new THREE.Vector3(-1, 0, 0), _ny = new THREE.Vector3(0, -1, 0), _nz = new THREE.Vector3(0, 0, -1);
const NO_CAST = new Set(['artery', 'vein', 'nerve', 'tendon', 'ligament', 'coronary', 'valve', 'lymph', 'node', 'cord', 'tooth']);
/** Only skin, fat, bones and large organs/muscles cast shadows (vessels, nerves and small parts do not). */
function casts(p: PartRT, tissue: string) {
  if (tissue === 'skin' || tissue === 'fat') return true;
  if (NO_CAST.has(tissue)) return false;
  return p.radius > (tissue === 'bone' ? 0.04 : 0.08);
}

const INSET_T = new Set(['muscle', 'tendon', 'artery', 'vein', 'nerve', 'fat', 'lymph', 'node', 'ligament']);
const SKIN_IDS = PART_IDS.filter((id) => PART_DEFS[id].tissue === 'skin');
/** tissues that can poke through / be seen through openings of an opaque skin shell */
const SEE_THROUGH = new Set(['eye', 'iris', 'lens', 'tooth', 'tongue', 'ear', 'mucosa', 'salivary', 'skin', 'fat']);
/** True when an opaque, unclipped, unexploded skin shell fully hides the interior: interior meshes are then not drawn at all. */
function skinCovers(s: State) {
  if (s.clip.enabled || s.explode > 0.001 || s.organExplode.id || s.isolated || s.xray) return false;
  if (!s.layers.integumentary.visible) return false;
  for (const id of SKIN_IDS) {
    if (!partVisible(s, id) || partOpacity(s, id).opacity < 0.999) return false;
  }
  return SKIN_IDS.length > 0;
}

function applyPart(s: State, id: string, covered = skinCovers(s)) {
  const p = RT.parts.get(id);
  if (!p) return;
  const m = p.mesh.material;
  let vis = partVisible(s, id);
  if (vis && covered && p.system !== 'integumentary' && !SEE_THROUGH.has(PART_DEFS[id].tissue ?? '') && !(s.selected && ancestors(id).includes(s.selected))) vis = false;
  p.mesh.visible = vis;
  if (!vis) return;
  const { opacity, xray } = partOpacity(s, id);
  const o = Math.min(opacity, m.userData.baseOpacity);
  const transparent = o < 0.999;
  if (m.transparent !== transparent) {
    m.transparent = transparent;
    m.needsUpdate = true;
  }
  m.opacity = o;
  m.depthWrite = !transparent || (o > 0.75 && xray < 0.5);
  m.userData.uXray.value = xray;
  m.userData.uInset.value = INSET_T.has(m.userData.tissue) && !s.xray && !s.clip.enabled && s.layers.integumentary.visible && SKIN_IDS.length > 0 && SKIN_IDS.every((k) => partVisible(s, k) && partOpacity(s, k).opacity >= 0.9) ? 0.0015 : 0;
  p.mesh.castShadow = o > 0.9 && casts(p, m.userData.tissue);
  p.mesh.renderOrder = transparent ? RENDER_ORDER[p.system] ?? 10 : 0;
  const anc = ancestors(id);
  const sel = s.selected && anc.includes(s.selected) ? 1 : 0;
  const hov = !sel && s.hovered && anc.includes(s.hovered) ? 0.45 : 0;
  m.userData.uSel.value = sel || hov;
  m.userData.uSelColor.value.set(sel ? '#4fe3d2' : '#9fd8ff');
}

function readAttr(buf: ArrayBuffer, a: AttrDef, n: number, size: number): THREE.BufferAttribute {
  const norm = a.type === 'i8n' || a.type === 'u8n';
  if (a.type === 'f32') return new THREE.BufferAttribute(new Float32Array(buf, a.off, n * size), size);
  const stride = a.stride ?? size;
  if (a.type === 'u8' || a.type === 'u8n') {
    if (stride === size) return new THREE.BufferAttribute(new Uint8Array(buf, a.off, n * size), size, norm);
    const src = new Uint8Array(buf, a.off, n * stride), out = new Uint8Array(n * size);
    for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) out[i * size + k] = src[i * stride + k];
    return new THREE.BufferAttribute(out, size, norm);
  }
  const src = new Int8Array(buf, a.off, n * stride), out = new Int8Array(n * size);
  for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) out[i * size + k] = src[i * stride + k];
  return new THREE.BufferAttribute(out, size, true);
}
function externalGeo(buf: ArrayBuffer, p: ManifestPart): THREE.BufferGeometry {
  const n = p.vertexCount, a = p.attrs;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', readAttr(buf, a.position, n, 3));
  geo.setAttribute('normal', readAttr(buf, a.normal, n, 3));
  geo.setAttribute('skinIndex', readAttr(buf, a.skinIndex, n, 4));
  geo.setAttribute('skinWeight', readAttr(buf, a.skinWeight, n, 4));
  if (a.fdir) geo.setAttribute('fdir', readAttr(buf, a.fdir, n, 3));
  if (a.flow) geo.setAttribute('flow', readAttr(buf, a.flow, n, 1));
  if (a.along) geo.setAttribute('along', readAttr(buf, a.along, n, 1));
  const ix = p.index;
  geo.setIndex(new THREE.BufferAttribute(ix.type === 'u16' ? new Uint16Array(buf, ix.off, ix.count) : new Uint32Array(buf, ix.off, ix.count), 1));
  return geo;
}

export function AnatomyModel() {
  const gl = useThree((s) => s.gl);
  const down = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    RT.root.name = 'anatomy';
    let loaded = 0;
    let cancelled = false;
    const addPart = (id: string, geo: THREE.BufferGeometry, centerArr: [number, number, number]) => {
      const def = PART_DEFS[id];
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const restRadius = geo.boundingSphere!.radius;
      const mat = createMaterial(def.tissue);
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.frustumCulled = true;
      mesh.userData.id = id;
      mesh.position.set(...centerArr);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.raycast = pickRaycast;
      const center = new THREE.Vector3(...centerArr);
      mesh.bindMode = 'detached';
      mesh.bind(RT.skeleton, new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
      const old = RT.parts.get(id);
      if (old) RT.root.remove(old.mesh);
      RT.parts.set(id, {
        id, mesh: mesh as unknown as PartRT['mesh'], center, radius: restRadius,
        system: def.system, global: new THREE.Vector3(), organ: new THREE.Vector3(), pickable: true,
      });
      geo.boundingSphere!.radius = restRadius * 1.1 + 0.2;
      RT.root.add(mesh);
      applyPart(useStore.getState(), id);
      setPickable(useStore.getState());
      loaded++;
      RT.layoutDirty = true;
      useStore.setState({ loaded, lastLoaded: def.name, ready: loaded >= PART_IDS.length });
      if (useStore.getState().organExplode.id) computeOrganLayout(useStore.getState().organExplode.id);
    };
    const loadExternal = async () => {
      const byChunk = new Map<string, ManifestPart[]>();
      for (const p of MANIFEST.parts) { if (!PART_DEFS[p.id]) continue; if (!byChunk.has(p.chunk)) byChunk.set(p.chunk, []); byChunk.get(p.chunk)!.push(p); }
      const order = [...byChunk.keys()].sort((a, b) => (a === 'skin' ? -1 : b === 'skin' ? 1 : 0));
      const fetches = new Map(order.map((c) => [c, fetch(import.meta.env.BASE_URL + MANIFEST.chunks[c].file).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.arrayBuffer(); })]));
      for (const c of order) {
        let buf: ArrayBuffer | null = null;
        try { buf = await fetches.get(c)!; } catch (err) { console.error('Failed to load chunk', c, err); }
        let k = 0;
        for (const p of byChunk.get(c)!) {
          if (cancelled) return;
          try {
            if (!buf) throw new Error('chunk unavailable');
            addPart(p.id, externalGeo(buf, p), p.center);
          } catch (err) {
            console.error('Failed to build', p.id, err);
            loaded++;
            useStore.setState({ loaded, ready: loaded >= PART_IDS.length });
          }
          if (++k % 16 === 0) await new Promise((r) => setTimeout(r, 0));
        }
      }
    };
    void BP3D_PARTS;
    const stop = startWorkers(
      (m) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
        geo.setIndex(new THREE.BufferAttribute(m.idx, 1));
        if (m.attrs.fdir) geo.setAttribute('fdir', new THREE.BufferAttribute(m.attrs.fdir.data, 3));
        if (m.attrs.flow) geo.setAttribute('flow', new THREE.BufferAttribute(m.attrs.flow.data, 1));
        if (m.attrs.along) geo.setAttribute('along', new THREE.BufferAttribute(m.attrs.along.data, 1));
        geo.setAttribute('skinIndex', new THREE.BufferAttribute(m.skinIndex, 4));
        geo.setAttribute('skinWeight', new THREE.BufferAttribute(m.skinWeight, 4));
        addPart(m.id, geo, m.center);
      },
      (id, msg) => {
        console.error('Failed to build', id, msg);
        loaded++;
        useStore.setState({ loaded, ready: loaded >= PART_IDS.length });
      },
    );
    void loadExternal();
    applyState(useStore.getState());
    const unsub = useStore.subscribe((s, prev) => applyState(s, prev));
    return () => {
      cancelled = true;
      stop();
      unsub();
    };
  }, []);

  useFrame((state, dt) => {
    const s = useStore.getState();
    const d = Math.min(dt, 0.05);
    shared.uTime.value += d;
    // clipping
    RT.clipOn = s.clip.enabled;
    if (s.clip.enabled) {
      const n = _n.copy(s.clip.axis === 'x' ? _nx : s.clip.axis === 'y' ? _ny : _nz);
      if (s.clip.flip) n.negate();
      RT.clipPlane.normal.copy(n);
      RT.clipPlane.constant = s.clip.flip ? -s.clip.pos : s.clip.pos;
      if (gl.clippingPlanes.length !== 1) gl.clippingPlanes = [RT.clipPlane];
    } else if (gl.clippingPlanes.length) gl.clippingPlanes = [];
    // explode smoothing
    const k = 1 - Math.exp(-d * 4.5);
    const eT = s.explode;
    const oT = s.organExplode.id ? s.organExplode.amount : 0;
    if (Math.abs(RT.explodeCur - eT) > 1e-4 || Math.abs(RT.organCur - oT) > 1e-4 || RT.layoutDirty) {
      if (RT.layoutDirty && (eT > 0 || RT.explodeCur > 0)) computeLayout();
      RT.explodeCur += (eT - RT.explodeCur) * k;
      RT.organCur += (oT - RT.organCur) * k;
      if (Math.abs(RT.explodeCur - eT) < 1e-4) RT.explodeCur = eT;
      if (Math.abs(RT.organCur - oT) < 1e-4) RT.organCur = oT;
      applyTransforms();
    }
    stepMotion({ t: state.clock.elapsedTime, dt: d, bones: RT.bones, parts: RT.parts, state: s });
  });

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = e.object.userData.id as string | undefined;
    useStore.getState().hover(id ?? null);
  };
  const onOut = () => useStore.getState().hover(null);
  const onDown = (e: ThreeEvent<PointerEvent>) => { down.current = [e.clientX, e.clientY]; };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const [x, y] = down.current;
    if (Math.hypot(e.clientX - x, e.clientY - y) > 5) return;
    const id = e.object.userData.id as string | undefined;
    if (!id) return;
    const s = useStore.getState();
    // clicking inside the current selection group drills down to the part; otherwise select the part
    s.select(id);
    poke(id, e.point);
  };
  const onDbl = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const id = e.object.userData.id as string | undefined;
    if (!id) return;
    const s = useStore.getState();
    // double-click: select the parent structure (organ) and focus it
    const parent = NODES[id].parent;
    const target = s.selected === id && parent ? parent : id;
    s.select(target, true);
  };
  void OUTER;
  return <primitive object={RT.root} onPointerMove={onMove} onPointerOut={onOut} onPointerDown={onDown} onClick={onClick} onDoubleClick={onDbl} />;
}
