import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, events as r3fEvents } from '@react-three/fiber';
import { CameraControls, Environment, Lightformer, Html, PerformanceMonitor } from '@react-three/drei';
import { EffectComposer, N8AO, Bloom, SMAA, Vignette, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode, BlendFunction } from 'postprocessing';
import { AnatomyModel } from './AnatomyModel';
import { useStore, partsUnder, NODES, partVisible } from '../state/store';
import { RT, boxOf, centerOf } from './runtime';
import { SYSTEMS } from '../anatomy/registry';

const HOME_POS = new THREE.Vector3(0.0, 1.05, 3.7);
const HOME_TGT = new THREE.Vector3(0, 0.9, 0);

function CameraRig() {
  const ref = useRef<CameraControls>(null);
  const cam = useStore((s) => s.cam);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    if (cam.kind === 'reset') {
      c.setLookAt(HOME_POS.x, HOME_POS.y, HOME_POS.z, HOME_TGT.x, HOME_TGT.y, HOME_TGT.z, cam.nonce > 0);
    } else if (cam.kind === 'fit' && cam.id) {
      // wait a moment so exploded positions settle before fitting
      const run = () => {
        const box = boxOf(partsUnder(cam.id!));
        if (box.isEmpty()) return;
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        sphere.radius = Math.max(0.025, sphere.radius * 1.05);
        c.fitToSphere(sphere, true);
      };
      run();
      const t = setTimeout(run, 1100);
      return () => clearTimeout(t);
    } else if (cam.kind === 'fitAll') {
      c.fitToSphere(new THREE.Sphere(new THREE.Vector3(0, 1.0 + (cam.radius ?? 1) * 0.08, 0), cam.radius ?? 1.1), true);
    } else if (cam.kind === 'view' && cam.view) {
      const az = { front: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2, top: 0 }[cam.view];
      const polar = cam.view === 'top' ? 0.02 : Math.PI / 2 - 0.08;
      c.rotateTo(az, polar, true);
    }
  }, [cam]);
  useFrame((_, dt) => {
    const c = ref.current;
    if (c && useStore.getState().autoRotate) c.azimuthAngle += dt * 0.25;
  });
  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={0.04}
      maxDistance={14}
      smoothTime={0.35}
      draggingSmoothTime={0.06}
      dollyToCursor
      infinityDolly={false}
    />
  );
}

function Ground() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color('#5ee7d8') } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: `varying vec2 vUv; uniform vec3 uColor;
          void main(){ vec2 p = (vUv-0.5)*12.0; float r = length(p);
            float ring = smoothstep(0.03,0.0,abs(fract(r*1.0)-0.5)-0.47) * 0.35;
            float grid = (smoothstep(0.015,0.0,abs(fract(p.x*2.0)-0.5)-0.485) + smoothstep(0.015,0.0,abs(fract(p.y*2.0)-0.5)-0.485))*0.12;
            float fade = smoothstep(6.0, 0.5, r);
            float glow = smoothstep(1.2,0.0,r)*0.25;
            gl_FragColor = vec4(uColor, (ring+grid)*fade*0.55 + glow*0.35*fade); }`,
      }),
    [],
  );
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.001} material={mat} renderOrder={-1}>
        <planeGeometry args={[12, 12]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.0005} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <shadowMaterial transparent opacity={0.42} />
      </mesh>
    </group>
  );
}

const _o = new THREE.Vector3();
const _c = new THREE.Vector3();

function ClipHelper() {
  const clip = useStore((s) => s.clip);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    m.visible = clip.enabled;
    const n = RT.clipPlane.normal;
    const o = _o.copy(n).multiplyScalar(-RT.clipPlane.constant + 0.0015);
    if (clip.axis === 'x') { m.position.set(o.x, 0.95, 0); m.rotation.set(0, Math.PI / 2, 0); m.scale.set(1.0, 1.95, 1); }
    if (clip.axis === 'y') { m.position.set(0, o.y, 0); m.rotation.set(-Math.PI / 2, 0, 0); m.scale.set(1.2, 0.8, 1); }
    if (clip.axis === 'z') { m.position.set(0, 0.95, o.z); m.rotation.set(0, 0, 0); m.scale.set(1.2, 1.95, 1); }
    if (RT.explodeCur > 0.05) m.scale.x *= 1 + RT.explodeCur * 5;
  });
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        clipping: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: `varying vec2 vUv; void main(){ vec2 d = min(vUv, 1.0-vUv); float e = smoothstep(0.012,0.0,min(d.x,d.y));
          float g = (smoothstep(0.004,0.0,abs(fract(vUv.x*20.0)-0.5)-0.496)+smoothstep(0.004,0.0,abs(fract(vUv.y*20.0)-0.5)-0.496))*0.05;
          gl_FragColor = vec4(0.37,0.9,0.85, 0.05 + e*0.6 + g); }`,
      }),
    [],
  );
  return (
    <mesh ref={ref} material={mat} renderOrder={50} raycast={() => null}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

const sysColor = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.color]));
const firstSentence = (s?: string) => (s ? (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim() : '');

function Labels() {
  const selected = useStore((s) => s.selected);
  const labels = useStore((s) => s.labels);
  const organ = useStore((s) => s.organExplode);
  const ready = useStore((s) => s.loaded);
  const anchor = useRef<THREE.Group>(null);
  const childRefs = useRef<(THREE.Group | null)[]>([]);
  const node = selected ? NODES[selected] : null;
  const children = useMemo(() => {
    if (!node || node.isPart) return [];
    const kids = node.children.filter((c) => partsUnder(c).some((p) => RT.parts.has(p)));
    return kids.length <= 18 ? kids : [];
  }, [node, ready]);
  const showKids = labels && children.length > 1 && (organ.id === selected && organ.amount > 0.15);
  useFrame(() => {
    if (!node) return;
    const st = useStore.getState();
    if (anchor.current) {
      const ids = partsUnder(node.id).filter((p) => partVisible(st, p));
      const box = boxOf(ids.length ? ids : partsUnder(node.id));
      if (!box.isEmpty()) {
        const c = box.getCenter(_c);
        c.y = box.max.y * 0.35 + c.y * 0.65;
        anchor.current.position.copy(c);
      }
    }
    if (showKids)
      children.forEach((cid, i) => {
        const g = childRefs.current[i];
        if (!g) return;
        g.position.copy(centerOf(partsUnder(cid), true));
      });
  });
  if (!node || !labels) return null;
  return (
    <>
      <group ref={anchor}>
        <Html zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="label3d">
            <div className="label3d-dot" style={{ background: sysColor[node.system] }} />
            <div className="label3d-line" />
            <div className="label3d-card">
              <div className="label3d-sys" style={{ color: sysColor[node.system] }}>{SYSTEMS.find((s) => s.id === node.system)?.name}</div>
              <div className="label3d-name">{node.name}</div>
              <div className="label3d-desc">{firstSentence(node.desc)}</div>
            </div>
          </div>
        </Html>
      </group>
      {showKids &&
        children.map((cid, i) => (
          <group key={cid} ref={(g) => (childRefs.current[i] = g)}>
            <Html center zIndexRange={[19, 0]} style={{ pointerEvents: 'none' }}>
              <div className="label3d-mini">{NODES[cid].name}</div>
            </Html>
          </group>
        ))}
    </>
  );
}

function Lights() {
  return (
    <>
      <hemisphereLight args={['#e2eaff', '#2a1a12', 0.35]} />
      {/* key: warm, soft shadow */}
      <directionalLight
        position={[2.2, 4.2, 3.2]}
        intensity={2.6}
        color="#ffe9d6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-2.6}
        shadow-camera-right={2.6}
        shadow-camera-top={2.6}
        shadow-camera-bottom={-1.2}
        shadow-camera-near={0.5}
        shadow-camera-far={12}
        shadow-bias={-0.0006}
        shadow-normalBias={0.035}
        shadow-radius={4}
      />
      {/* cool rim from behind */}
      <directionalLight position={[-3, 2.4, -3]} intensity={1.6} color="#9cc6ff" />
      <directionalLight position={[3, 1.8, -2.5]} intensity={0.8} color="#ffd2b0" />
      {/* warm fill from front-left */}
      <directionalLight position={[-2.6, 1.0, 2.4]} intensity={0.6} color="#ffd9c2" />
      <Environment resolution={512} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#fff6ec" position={[0, 4.5, 2]} rotation-x={Math.PI / 2.5} scale={[7, 3.5, 1]} />
        <Lightformer form="rect" intensity={1.3} color="#a9d4ff" position={[-4, 1.5, -1]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#ffd6bd" position={[4, 1.2, 1]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={2.4} color="#ffffff" position={[-2.2, 1.4, 3]} rotation-y={Math.PI / 6} scale={[0.5, 4, 1]} />
        <Lightformer form="rect" intensity={1.8} color="#fff0e0" position={[2.4, 1.0, 2.6]} rotation-y={-Math.PI / 6} scale={[0.4, 3.5, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#2a2f3a" position={[0, -3, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} />
        <Lightformer form="ring" intensity={0.6} color="#5ee7d8" position={[0, 0.5, -4]} scale={3} />
      </Environment>
    </>
  );
}

function PostFX({ level }: { level: number }) {
  const ao = useRef<{ configuration: Record<string, unknown> } | null>(null);
  useEffect(() => {
    const c = ao.current?.configuration;
    if (!c) return;
    c.gammaCorrection = false;
    c.transparencyAware = true;
    c.autoDetectTransparency = false;
  }, [level]);
  return (
    <EffectComposer key={level} multisampling={0} enableNormalPass={false}>
      {level >= 1 ? (
        <N8AO
          ref={ao as never}
          aoRadius={0.05}
          distanceFalloff={0.6}
          intensity={2.6}
          color="#1a0a08"
          quality={level >= 2 ? 'low' : 'performance'}
          halfRes
          depthAwareUpsampling
        />
      ) : (
        <></>
      )}
      {level >= 2 ? <Bloom mipmapBlur luminanceThreshold={1.5} luminanceSmoothing={0.2} intensity={0.55} radius={0.6} /> : <></>}
      <Vignette eskil={false} offset={0.28} darkness={0.55} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} blendFunction={BlendFunction.NORMAL} />
      <SMAA />
    </EffectComposer>
  );
}

/** Shadow map is rendered manually: every few frames while moving, rarely when static. */
function ShadowTick({ level }: { level: number }) {
  const gl = useThree((s) => s.gl);
  const n = useRef(0);
  const last = useRef<unknown[]>([]);
  useEffect(() => {
    (window as unknown as { __gl?: unknown; __rt?: unknown }).__gl = gl; (window as unknown as { __rt?: unknown }).__rt = RT;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
  }, [gl]);
  useFrame(() => {
    const s = useStore.getState();
    const sig = [s.hidden, s.isolated, s.layers, s.ghosted, s.xray, s.explode, s.clip.enabled, s.loaded, s.organExplode.amount];
    const changed = sig.some((x, k) => x !== last.current[k]);
    const moving = s.motion !== 'anatomical' || Math.abs(RT.explodeCur - s.explode) > 1e-3;
    (window as unknown as { __lvl?: number }).__lvl = level;
    const every = moving ? (level >= 2 ? 2 : 4) : 20;
    n.current++;
    if (changed || n.current >= every) {
      last.current = sig;
      n.current = 0;
      gl.shadowMap.needsUpdate = true;
    }
  });
  return null;
}

function Missed() {
  const { gl } = useThree();
  useEffect(() => {
    let sx = 0, sy = 0;
    const d = (e: PointerEvent) => { sx = e.clientX; sy = e.clientY; };
    gl.domElement.addEventListener('pointerdown', d);
    (gl.domElement as HTMLCanvasElement & { __down?: () => [number, number] }).__down = () => [sx, sy];
    return () => gl.domElement.removeEventListener('pointerdown', d);
  }, [gl]);
  return null;
}

/** Pointer mapping from clientX/clientY (robust against offsetX scaling under browser zoom / DPR emulation). */
const robustEvents: typeof r3fEvents = (store) => {
  const ev = r3fEvents(store);
  return {
    ...ev,
    compute(event, state) {
      const rect = state.gl.domElement.getBoundingClientRect();
      const e = event as PointerEvent;
      state.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      state.raycaster.setFromCamera(state.pointer, state.camera);
    },
  };
};

export function Viewer() {
  // 2 = full (AO+bloom, dpr 1.5), 1 = cheap AO, 0 = no AO/bloom. PerformanceMonitor steps this down on slow GPUs.
  const [level, setLevel] = useState(2);
  const dprMax = level >= 2 ? 1.5 : level === 1 ? 1.25 : 1;
  return (
    <Canvas
      className="viewport"
      shadows="soft"
      events={robustEvents}
      dpr={[1, dprMax]}
      camera={{ position: HOME_POS.toArray(), fov: 34, near: 0.01, far: 60 }}
      gl={{ antialias: false, alpha: true, stencil: false, toneMapping: THREE.NoToneMapping, powerPreference: 'high-performance' }}
      onPointerMissed={(e) => {
        const el = e.target as HTMLCanvasElement & { __down?: () => [number, number] };
        const dn = el.__down?.();
        if (dn && Math.hypot(e.clientX - dn[0], e.clientY - dn[1]) > 5) return;
        if (e.type === 'click') useStore.getState().select(null);
      }}
    >
      <PerformanceMonitor
        bounds={() => [30, 52]}
        flipflops={3}
        ms={300}
        iterations={6}
        onDecline={() => setLevel((l) => Math.max(0, l - 1))}
        onIncline={() => setLevel((l) => Math.min(2, l + 1))}
      />
      <Missed />
      <Lights />
      <Ground />
      <AnatomyModel />
      <ClipHelper />
      <Labels />
      <CameraRig />
      <ShadowTick level={level} />
      <PostFX level={level} />
    </Canvas>
  );
}
