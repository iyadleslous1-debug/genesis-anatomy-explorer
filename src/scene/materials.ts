import * as THREE from 'three';
import type { Tissue } from '../anatomy/registry';

/**
 * materials.ts (Piece G). No new geometry attributes are required. Optional existing ones: `fdir` (vec3, fibres), `flow` (float).
 * Shader features: derivative-based 3D-noise micro normals (clearcoat keeps the smooth normal -> wet look), skin SSS (wrap + red rim),
 * world-position skin tint masks, fibre striation, pearly tendon, bone porosity, brain sulcal cavity, and analytic cut faces:
 * with a global clip plane active, back faces reconstruct the plane hit point per pixel and shade a solid cross-section (cortex/marrow, muscle, fat).
 */

interface TissueDef {
  color: string;
  inner?: string;
  rough?: number;
  clearcoat?: number;
  sheen?: number;
  sheenColor?: string;
  fiber?: boolean;
  flow?: 1 | -1;
  noise?: number;
  noiseAmt?: number;
  alpha?: number;
  emissive?: string;
  /** normal-bump slope 0..1 of micro relief */
  bump?: number;
  /** subsurface wrap/rim strength 0..1 */
  sss?: number;
  /** cut-face style: 0 generic, 1 bone, 2 muscle/fibre, 3 skin/fat */
  cap?: number;
}

export const TISSUES: Record<Tissue, TissueDef> = {
  skin: { color: '#d8a990', inner: '#a8432f', rough: 0.62, sheen: 0.15, sheenColor: '#ffd9cc', clearcoat: 0.02, noise: 60, noiseAmt: 0.04, bump: 0.04, sss: 0.55, cap: 3 },
  fat: { color: '#eac25c', inner: '#c58f35', rough: 0.45, clearcoat: 0.2, noise: 220, noiseAmt: 0.25, bump: 0.3, sss: 0.5, cap: 3 },
  muscle: { color: '#a52d2a', inner: '#5c1513', rough: 0.42, clearcoat: 0.28, fiber: true, noise: 90, noiseAmt: 0.2, bump: 0.55, sss: 0.35, cap: 2 },
  tendon: { color: '#e8e0cd', inner: '#b9ab8c', rough: 0.32, sheen: 0.6, sheenColor: '#ffffff', fiber: true, noise: 120, noiseAmt: 0.1, bump: 0.3, sss: 0.15 },
  bone: { color: '#e6d9be', inner: '#b08060', rough: 0.6, clearcoat: 0.08, noise: 140, noiseAmt: 0.16, bump: 0.5, cap: 1 },
  tooth: { color: '#f4efe0', inner: '#d8c090', rough: 0.22, clearcoat: 0.7, noise: 200, noiseAmt: 0.05, bump: 0.1, sss: 0.3, cap: 1 },
  cartilage: { color: '#b9d3da', inner: '#88a8b0', rough: 0.28, clearcoat: 0.6, noise: 150, noiseAmt: 0.08, bump: 0.25, sss: 0.2 },
  disc: { color: '#c6dcdd', inner: '#e8e0b0', rough: 0.3, clearcoat: 0.5, noise: 150, noiseAmt: 0.08, bump: 0.25, sss: 0.2 },
  ligament: { color: '#d9cfab', inner: '#a89a70', rough: 0.35, sheen: 0.5, sheenColor: '#ffffff', noise: 200, noiseAmt: 0.1, bump: 0.25, sss: 0.2 },
  artery: { color: '#c3202a', inner: '#6a0f14', rough: 0.32, clearcoat: 0.55, flow: 1, noise: 120, noiseAmt: 0.08, bump: 0.25, sss: 0.2 },
  coronary: { color: '#d12a2e', inner: '#6a0f14', rough: 0.3, clearcoat: 0.6, flow: 1, noise: 120, noiseAmt: 0.08, bump: 0.25, sss: 0.2 },
  vein: { color: '#2e4ea6', inner: '#14234f', rough: 0.32, clearcoat: 0.55, flow: -1, noise: 120, noiseAmt: 0.08, bump: 0.25, sss: 0.2 },
  nerve: { color: '#f0cc58', inner: '#b89428', rough: 0.4, sheen: 0.5, sheenColor: '#fff4c0', noise: 180, noiseAmt: 0.12, bump: 0.25, sss: 0.2 },
  cord: { color: '#efd9a4', inner: '#c0a070', rough: 0.45, sheen: 0.4, noise: 160, noiseAmt: 0.1, bump: 0.25, sss: 0.2 },
  brain: { color: '#e4b0a6', inner: '#c4877e', rough: 0.55, clearcoat: 0.25, noise: 140, noiseAmt: 0.14, bump: 0.4, sss: 0.3 },
  cerebellum: { color: '#d7948b', inner: '#a86860', rough: 0.55, clearcoat: 0.2, noise: 200, noiseAmt: 0.12, bump: 0.4, sss: 0.3 },
  brainstem: { color: '#e2baa2', inner: '#b88a70', rough: 0.5, clearcoat: 0.2, noise: 160, noiseAmt: 0.1, bump: 0.3, sss: 0.25 },
  myocardium: { color: '#9c2526', inner: '#58100f', rough: 0.38, clearcoat: 0.45, noise: 110, noiseAmt: 0.18, bump: 0.4, sss: 0.3, cap: 2 },
  atrium: { color: '#b33c3a', inner: '#5c1414', rough: 0.4, clearcoat: 0.4, noise: 110, noiseAmt: 0.15, bump: 0.4, sss: 0.3, cap: 2 },
  valve: { color: '#f0d3c3', inner: '#c8a090', rough: 0.4, sheen: 0.5, noise: 200, noiseAmt: 0.06, bump: 0.25, sss: 0.2 },
  lung: { color: '#e49b9b', inner: '#b25858', rough: 0.72, clearcoat: 0.1, noise: 260, noiseAmt: 0.22, bump: 0.35, sss: 0.3 },
  airway: { color: '#e8c4b8', inner: '#b87f70', rough: 0.4, clearcoat: 0.3, noise: 200, noiseAmt: 0.08, bump: 0.35, sss: 0.3 },
  diaphragm: { color: '#a5372f', inner: '#5c1513', rough: 0.45, clearcoat: 0.25, fiber: false, noise: 120, noiseAmt: 0.18, bump: 0.4, sss: 0.3, cap: 2 },
  liver: { color: '#7a281e', inner: '#4a140e', rough: 0.35, clearcoat: 0.55, noise: 160, noiseAmt: 0.15, bump: 0.35, sss: 0.3 },
  gallbladder: { color: '#4f7a38', inner: '#2a4a1c', rough: 0.3, clearcoat: 0.7, noise: 120, noiseAmt: 0.1, bump: 0.35, sss: 0.3 },
  stomach: { color: '#d4877a', inner: '#9a4a40', rough: 0.4, clearcoat: 0.4, noise: 130, noiseAmt: 0.14, bump: 0.35, sss: 0.3 },
  intestine: { color: '#e09e88', inner: '#a05a48', rough: 0.4, clearcoat: 0.45, noise: 140, noiseAmt: 0.12, bump: 0.35, sss: 0.3 },
  colon: { color: '#c6876a', inner: '#8a4a34', rough: 0.42, clearcoat: 0.4, noise: 140, noiseAmt: 0.12, bump: 0.35, sss: 0.3 },
  pancreas: { color: '#e5bd78', inner: '#b88a40', rough: 0.5, clearcoat: 0.3, noise: 300, noiseAmt: 0.2, bump: 0.35, sss: 0.3 },
  spleen: { color: '#6b2136', inner: '#3e0e1e', rough: 0.38, clearcoat: 0.5, noise: 140, noiseAmt: 0.12, bump: 0.35, sss: 0.3 },
  esophagus: { color: '#c7796a', inner: '#8a3e34', rough: 0.4, clearcoat: 0.35, noise: 140, noiseAmt: 0.1, bump: 0.4, sss: 0.3, cap: 2 },
  tongue: { color: '#c75c60', inner: '#8a2e34', rough: 0.55, clearcoat: 0.3, noise: 400, noiseAmt: 0.2, bump: 0.4, sss: 0.3, cap: 2 },
  salivary: { color: '#d9a080', inner: '#a86a50', rough: 0.55, noise: 300, noiseAmt: 0.25, bump: 0.35, sss: 0.3 },
  kidney: { color: '#8a3028', inner: '#b8604a', rough: 0.35, clearcoat: 0.5, noise: 140, noiseAmt: 0.1, bump: 0.35, sss: 0.3 },
  medulla: { color: '#6a1e1e', inner: '#3a0c0c', rough: 0.5, noise: 200, noiseAmt: 0.15, bump: 0.35, sss: 0.3 },
  pelvis: { color: '#e6cdb0', inner: '#b89878', rough: 0.4, clearcoat: 0.4, noise: 160, noiseAmt: 0.08, bump: 0.25, sss: 0.2 },
  bladder: { color: '#d6998a', inner: '#9c5a4a', rough: 0.45, clearcoat: 0.35, noise: 140, noiseAmt: 0.1, bump: 0.35, sss: 0.3 },
  prostate: { color: '#c47e80', inner: '#8a4a50', rough: 0.5, clearcoat: 0.3, noise: 220, noiseAmt: 0.15, bump: 0.35, sss: 0.3 },
  gland: { color: '#b8718a', inner: '#7a3a50', rough: 0.5, clearcoat: 0.3, noise: 220, noiseAmt: 0.15, bump: 0.35, sss: 0.3 },
  thyroid: { color: '#a3443c', inner: '#6a2420', rough: 0.45, clearcoat: 0.35, noise: 220, noiseAmt: 0.15, bump: 0.35, sss: 0.3 },
  adrenal: { color: '#d8a048', inner: '#a06a20', rough: 0.5, clearcoat: 0.3, noise: 260, noiseAmt: 0.15, bump: 0.35, sss: 0.3 },
  eye: { color: '#f3efe7', inner: '#2a0d0d', rough: 0.15, clearcoat: 0.9, noise: 300, noiseAmt: 0.04 },
  iris: { color: '#4b7099', inner: '#101418', rough: 0.4, clearcoat: 0.5, noise: 900, noiseAmt: 0.45 },
  lymph: { color: '#cfe8b8', inner: '#8aa870', rough: 0.35, clearcoat: 0.5, noise: 160, noiseAmt: 0.1 },
  node: { color: '#a9c98a', inner: '#6a8a4a', rough: 0.45, clearcoat: 0.4, noise: 300, noiseAmt: 0.2 },
  ear: { color: '#efe2c6', inner: '#c8b088', rough: 0.4, clearcoat: 0.3, noise: 200, noiseAmt: 0.1 },
  mucosa: { color: '#d98a86', inner: '#9a4a48', rough: 0.35, clearcoat: 0.6, noise: 220, noiseAmt: 0.14 },
  lens: { color: '#d6ecf8', inner: '#a0c0d0', rough: 0.05, clearcoat: 1, alpha: 0.22, noise: 100, noiseAmt: 0 },
};

/** Shared animated uniforms. */
export const shared = {
  uTime: { value: 0 },
  uFlowOn: { value: 1 },
  /** poke reaction (set by motion.ts): world point, start time (uTime clock), amplitude in metres */
  uPokePos: { value: new THREE.Vector3() },
  uPokeTime: { value: -100 },
  uPokeAmp: { value: 0 },
  /** breathing phase 0..1 (set by motion.ts) */
  uBreath: { value: 0 },
};

const NOISE_GLSL = /* glsl */ `
float hash31(vec3 p){ p = fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i+vec3(0,0,0)),hash31(i+vec3(1,0,0)),f.x),mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y),f.z); }
float ridge(vec3 x){ return 1.0 - abs(vnoise(x)*2.0 - 1.0); }
float blob(vec3 p, vec3 c, vec3 r){ vec3 d=(p-c)/r; return exp(-dot(d,d)); }
// derivative-based bump (same maths as three's perturbNormalArb); h is a height, amt its world scale
vec3 bumpN(vec3 n, float h, float amt){
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * n - amt * grad);
}
`;

export interface TissueMaterial extends THREE.MeshPhysicalMaterial {
  userData: {
    tissue: Tissue;
    uXray: { value: number };
    uSel: { value: number };
    uSelColor: { value: THREE.Color };
    baseOpacity: number;
    /** 0..1 muscle contraction (set per material by motion.ts) */
    uContract: { value: number };
    uInset: { value: number };
  };
}

const KIND: Partial<Record<Tissue, string>> = {
  skin: 'SKIN', bone: 'BONE', tooth: 'BONE', brain: 'BRAIN', cerebellum: 'BRAIN', brainstem: 'BRAIN', tendon: 'TENDON', ligament: 'TENDON',
};
const SSS_TINT: Partial<Record<Tissue, string>> = {
  skin: '#e0583c', fat: '#ffb040', muscle: '#d02a22', brain: '#ff8a80', cerebellum: '#ff7a70', lung: '#ff6a6a', tooth: '#ffd0a0',
};

const HARD = new Set<Tissue>(['bone', 'tooth', 'cartilage', 'disc', 'ligament', 'tendon', 'eye', 'iris', 'lens', 'ear']);
const BREATH = new Set<Tissue>(['skin', 'fat', 'muscle']);
const PERI_LEN: Partial<Record<Tissue, number>> = { intestine: 6, colon: 2.5, esophagus: 1.1 };

const VERT_PARS = /* glsl */ `
uniform float uTime; uniform vec3 uPokePos; uniform float uPokeTime; uniform float uPokeAmp; uniform float uBreath;
uniform float uInset; uniform float uContract; uniform float uHalf; uniform float uLen; uniform float uHasAlong;
#ifdef USE_ALONG
attribute float along;
#endif
`;
const VERT_DISP = /* glsl */ `
{
  vec3 wP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec3 nrm = normalize(objectNormal);
  float dsp = 0.0;
  #ifdef SOFT
  { float age = uTime - uPokeTime;
    if (uPokeAmp > 0.0 && age > 0.0 && age < 1.6) {
      vec3 dv = wP - uPokePos; float d2 = dot(dv, dv);
      float env = exp(-d2 / 0.0016);
      float wave = cos(12.566 * age - sqrt(d2) * 70.0);
      dsp += uPokeAmp * env * wave * exp(-3.2 * age) * smoothstep(0.0, 0.04, age);
    } }
  #endif
  #ifdef CONTRACT
  { vec3 fd0 = fdir; float t0;
    if (dot(fd0, fd0) > 0.25) t0 = abs(dot(position, normalize(fd0))) / max(uHalf, 1e-3); else t0 = length(position) / max(uHalf, 1e-3);
    float prof = 1.0 - smoothstep(0.0, 1.0, clamp(t0, 0.0, 1.0));
    dsp += 0.004 * uContract * prof; }
  #endif
  #ifdef PERI
  { float s = uHasAlong > 0.5 ? along * uLen : dot(position, vec3(0.5774)) * 3.0;
    dsp += 0.0008 * sin(6.2832 * (s / 0.03 - uTime * 0.02 / 0.03)) * (0.6 + 0.4 * sin(uTime * 0.3 + s * 4.0)); }
  #endif
  #ifdef BREATHE
  { float mk = smoothstep(0.95, 1.02, wP.y) * (1.0 - smoothstep(1.12, 1.2, wP.y)) * smoothstep(0.0, 0.05, wP.z) * (1.0 - smoothstep(0.2, 0.3, abs(wP.x)));
    dsp += 0.005 * uBreath * mk; }
  #endif
  transformed += nrm * (dsp - uInset);
}
`;

export function createMaterial(tissue: Tissue): TissueMaterial {
  const t = TISSUES[tissue];
  const wet = t.clearcoat ?? 0;
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(t.color),
    roughness: t.rough ?? 0.5,
    metalness: 0,
    clearcoat: wet,
    clearcoatRoughness: 0.34 - 0.24 * Math.min(1, wet / 0.6),
    sheen: t.sheen ?? 0,
    sheenColor: new THREE.Color(t.sheenColor ?? '#ffffff'),
    sheenRoughness: 0.45,
    side: THREE.DoubleSide,
    transparent: (t.alpha ?? 1) < 1,
    opacity: t.alpha ?? 1,
    depthWrite: (t.alpha ?? 1) >= 1,
    envMapIntensity: 1.0,
  }) as TissueMaterial;
  if (tissue === 'skin') m.shadowSide = THREE.BackSide;
  const uXray = { value: 0 };
  const uSel = { value: 0 };
  const uSelColor = { value: new THREE.Color('#5ee7d8') };
  m.userData = { tissue, uXray, uSel, uSelColor, baseOpacity: t.alpha ?? 1, uContract: { value: 0 }, uInset: { value: 0 } };
  const uHalf = { value: 0.1 };
  const uLen = { value: 1 };
  const uHasAlong = { value: 0 };
  let sized = false;
  m.onBeforeRender = (_r, _s, _c, geo) => {
    if (sized) return;
    sized = true;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    if (!geo.boundingBox) geo.computeBoundingBox();
    uHalf.value = geo.boundingSphere?.radius ?? 0.1;
    const diag = geo.boundingBox ? geo.boundingBox.getSize(new THREE.Vector3()).length() : 0.2;
    uLen.value = diag * (PERI_LEN[tissue] ?? 1);
    uHasAlong.value = geo.getAttribute('along') ? 1 : 0;
  };
  const inner = new THREE.Color(t.inner ?? t.color);
  const fiber = !!t.fiber;
  const flow = t.flow ?? 0;
  const kind = KIND[tissue] ?? 'WET';
  const soft = !HARD.has(tissue);
  const breathe = BREATH.has(tissue);
  const peri = tissue in PERI_LEN;
  const contract = tissue === 'muscle';
  const vdefs = `${soft ? '#define SOFT\n' : ''}${breathe ? '#define BREATHE\n' : ''}${peri ? '#define PERI\n#define USE_ALONG\n' : ''}${contract ? '#define CONTRACT\n' : ''}`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uFlowOn = shared.uFlowOn;
    shader.uniforms.uXray = uXray;
    shader.uniforms.uPokePos = shared.uPokePos;
    shader.uniforms.uPokeTime = shared.uPokeTime;
    shader.uniforms.uPokeAmp = shared.uPokeAmp;
    shader.uniforms.uBreath = shared.uBreath;
    shader.uniforms.uContract = m.userData.uContract;
    shader.uniforms.uInset = m.userData.uInset;
    shader.uniforms.uHalf = uHalf;
    shader.uniforms.uLen = uLen;
    shader.uniforms.uHasAlong = uHasAlong;
    shader.uniforms.uSel = uSel;
    shader.uniforms.uSelColor = uSelColor;
    shader.uniforms.uInner = { value: inner };
    shader.uniforms.uNoise = { value: t.noise ?? 120 };
    shader.uniforms.uNoiseAmt = { value: t.noiseAmt ?? 0.12 };
    shader.uniforms.uBump = { value: t.bump ?? 0.3 };
    shader.uniforms.uSss = { value: t.sss ?? 0 };
    shader.uniforms.uSssTint = { value: new THREE.Color(SSS_TINT[tissue] ?? '#d84a3a') };
    shader.uniforms.uFine = { value: kind === 'SKIN' ? 900 : kind === 'BONE' ? 700 : 480 };
    shader.uniforms.uFiberAmt = { value: kind === 'TENDON' ? 0.45 : 1 };
    shader.uniforms.uCap = { value: t.cap ?? 0 };
    shader.uniforms.uCapRim = { value: kind === 'BONE' ? 0.022 : 0.01 };
    const defs = `#define KIND_${kind}\n${fiber ? '#define USE_FIBER\n' : ''}${flow ? `#define USE_FLOW\n#define FLOW_DIR ${flow.toFixed(1)}\n` : ''}`;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${defs}${vdefs}${VERT_PARS}varying vec3 vObj; varying vec3 vSkinP;\n#if defined(USE_FIBER) || defined(CONTRACT)\nattribute vec3 fdir;\n#endif\n#ifdef USE_FIBER\nvarying vec3 vFdir;\n#endif\n#ifdef USE_FLOW\nattribute float flow; varying float vFlow;\n#endif`,
      )
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>\n${VERT_DISP}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvObj = position; vSkinP = position + modelMatrix[3].xyz;\n#ifdef USE_FIBER\nvFdir = fdir;\n#endif\n#ifdef USE_FLOW\nvFlow = flow;\n#endif`,
      );
    const lightsNoShadowOnCap = THREE.ShaderChunk.lights_fragment_begin.replace(/receiveShadow/g, '(receiveShadow && !isCap)');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${defs}varying vec3 vObj; varying vec3 vSkinP;\nuniform float uTime; uniform float uFlowOn; uniform float uXray; uniform float uSel; uniform vec3 uSelColor; uniform vec3 uInner; uniform float uNoise; uniform float uNoiseAmt;
uniform float uContract; uniform float uBump; uniform float uSss; uniform vec3 uSssTint; uniform float uFine; uniform float uFiberAmt; uniform float uCap; uniform float uCapRim;
#ifdef USE_FIBER\nvarying vec3 vFdir;\n#endif\n#ifdef USE_FLOW\nvarying float vFlow;\n#endif\n${NOISE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float fpx = max(length(fwidth(vObj)), 1e-6);
        float fadeA = clamp((1.0 / uNoise) / (fpx * 2.5), 0.0, 1.0);
        float fadeB = clamp((0.33 / uNoise) / (fpx * 2.5), 0.0, 1.0);
        float fadeF = clamp((1.0 / uFine) / (fpx * 2.5), 0.0, 1.0);
        float n1 = mix(0.5, vnoise(vObj * uNoise), fadeA);
        float n2 = mix(0.5, vnoise(vObj * uNoise * 3.1), fadeB);
        float nz = n1 * 0.6 + n2 * 0.4;
        float fineN = mix(0.5, vnoise(vObj * uFine), fadeF);
        diffuseColor.rgb *= 1.0 - uNoiseAmt * 0.5 + uNoiseAmt * nz;
        float hgt = nz;
        float hgtF = fineN;
        float hgtFib = 0.5;
        float lipM = 0.0;
        #ifdef USE_FIBER
          vec3 fd = normalize(vFdir + vec3(1e-5));
          float al = dot(vObj, fd);
          vec3 q = vObj - fd * al;
          float s1 = mix(0.5, vnoise(q * 1100.0), clamp(0.0009 / (fpx * 2.5), 0.0, 1.0));
          float s2 = mix(0.5, vnoise(q * 380.0 + fd * al * 20.0), clamp(0.0026 / (fpx * 2.5), 0.0, 1.0));
          float st = s1 * 0.5 + s2 * 0.5;
          hgtFib = st;
          #ifdef KIND_WET
            diffuseColor.rgb *= 1.0 + uFiberAmt * (1.25 * st - 0.6) * 0.85;
            diffuseColor.rgb *= 1.0 - 0.14 * uContract + uContract * 0.18 * (st - 0.5);
            hgtFib = mix(st, st * st * 1.6, 0.5);
          #else
            diffuseColor.rgb *= 1.0 + uFiberAmt * (0.95 * st - 0.45) * 0.85;
          #endif
          #ifdef KIND_TENDON
            diffuseColor.rgb *= 0.97 + 0.06 * s2;
          #endif
        #endif
        #ifdef KIND_SKIN
        {
          vec3 P = vSkinP; vec3 A = vec3(abs(P.x), P.y, P.z);
          float redm = 0.0;
          redm += 0.9 * blob(A, vec3(0.094, 0.495, 0.05), vec3(0.05, 0.05, 0.05));
          redm += 0.8 * blob(A, vec3(0.243, 1.122, -0.04), vec3(0.04, 0.05, 0.05));
          redm += 0.45 * blob(A, vec3(0.05, 1.625, 0.085), vec3(0.035, 0.03, 0.04));
          redm += 0.5 * blob(A, vec3(0.0, 1.635, 0.11), vec3(0.016, 0.02, 0.02));
          redm += 0.4 * blob(A, vec3(0.078, 1.645, -0.01), vec3(0.014, 0.03, 0.022));
          redm += 0.3 * smoothstep(0.29, 0.35, A.x) * (1.0 - smoothstep(0.8, 0.9, A.y));
          redm += 0.3 * (1.0 - smoothstep(0.03, 0.09, A.y));
          redm += 0.04 * (vnoise(P * 6.0) - 0.5) * 2.0;
          lipM = blob(A, vec3(0.0, 1.5805, 0.099), vec3(0.0225, 0.0085, 0.03));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 0.84, 0.83), clamp(redm, 0.0, 1.0) * 0.55);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.84, 0.76, 0.74), blob(A, vec3(0.088, 1.318, 0.095), vec3(0.0125, 0.0125, 0.06)) * 0.8);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.27, 0.06, 0.065) * (0.94 + 0.12 * nz), clamp(lipM * 1.3, 0.0, 0.95));
          float pore = smoothstep(0.7, 0.92, vnoise(P * 1300.0)) * clamp((0.00045 - fpx) / 0.00015, 0.0, 1.0);
          diffuseColor.rgb *= 1.0 - 0.06 * pore;
          float scalp = smoothstep(1.68, 1.74, P.y) * smoothstep(-0.12, 0.0, P.z + 0.02);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.88, 0.9) * (0.9 + 0.2 * vnoise(P * 40.0)), scalp * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.72, 0.7), blob(A, vec3(0.088, 1.318, 0.095), vec3(0.03, 0.03, 0.05)) * 0.5);
          
        }
        #endif
        #ifdef KIND_BONE
          float pit = smoothstep(0.34, 0.12, fineN) * fadeF;
          diffuseColor.rgb *= 1.0 - 0.28 * pit;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.0, 0.93, 0.84), smoothstep(0.45, 0.8, n1) * 0.6);
        #endif
        #ifdef KIND_BRAIN
        {
          float v = mix(0.5, ridge(vObj * 62.0), clamp(0.016 / (fpx * 2.5), 0.0, 1.0));
          float v2 = mix(0.5, ridge(vObj * 150.0 + 7.0), clamp(0.0066 / (fpx * 2.5), 0.0, 1.0));
          float cav = smoothstep(0.55, 0.97, max(v, v2 * 0.9));
          diffuseColor.rgb *= 1.0 - 0.42 * (1.0 - cav);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.78, 0.8), 1.0 - cav);
          hgt += 0.9 * cav;
        }
        #endif
        // ---- analytic cut face: reconstruct clip-plane hit for visible back faces
        bool isCap = false; vec3 capN = vec3(0.0, 0.0, 1.0);
        #if NUM_CLIPPING_PLANES > 0
        if (!gl_FrontFacing) {
          vec3 Pv = -vViewPosition; float len = length(Pv); vec3 rd = Pv / len;
          vec4 pl = clippingPlanes[0];
          float dn = dot(rd, pl.xyz);
          float tt = -pl.w / (abs(dn) > 1e-6 ? dn : 1e-6);
          if (tt > 0.0 && tt < len) {
            isCap = true;
            float dd = len - tt;
            capN = -pl.xyz;
            vec3 wd = (vec4(rd, 0.0) * viewMatrix).xyz;
            vec3 W = cameraPosition + wd * tt;
            float cf = clamp(0.0016 / (fpx * 2.5), 0.0, 1.0);
            float web = ridge(W * 330.0);
            float webF = mix(0.5, ridge(W * 1700.0 + 3.0), clamp(0.0004 / (fpx * 2.5), 0.0, 1.0));
            float grain = mix(0.5, vnoise(W * 900.0), clamp(0.0011 / (fpx * 2.5), 0.0, 1.0));
            vec3 cc = uInner * 1.25;
            if (uCap > 2.5) {
              float fatN = smoothstep(0.35, 0.65, vnoise(W * 60.0));
              cc = mix(vec3(0.46, 0.14, 0.12), vec3(0.93, 0.74, 0.38), fatN);
              cc = mix(cc, vec3(0.95, 0.88, 0.8), smoothstep(0.8, 0.98, web) * 0.5 * cf);
              cc *= 0.88 + 0.24 * grain;
            } else if (uCap > 1.5) {
              cc = mix(vec3(0.46, 0.08, 0.07), vec3(0.66, 0.15, 0.12), grain);
              cc = mix(cc, vec3(0.92, 0.72, 0.66), smoothstep(0.72, 0.97, web) * 0.55 * cf);
              cc *= 0.85 + 0.3 * webF;
            } else if (uCap > 0.5) {
              float cort = 1.0 - smoothstep(uCapRim * 0.7, uCapRim, dd + (grain - 0.5) * 0.006);
              float trab = smoothstep(0.55, 0.92, max(ridge(W * 900.0), ridge(W * 430.0 + 5.0)));
              vec3 marrow = mix(vec3(0.5, 0.2, 0.13), vec3(0.88, 0.74, 0.55), trab * (0.55 + 0.45 * cf));
              vec3 cortex = vec3(0.93, 0.88, 0.76) * (0.92 + 0.12 * grain);
              cc = mix(marrow, cortex, cort);
            } else {
              cc = uInner * (1.2 + 0.35 * (1.0 - smoothstep(0.0, 0.006, dd)));
              cc = mix(cc, cc * 1.45 + 0.04, smoothstep(0.7, 0.97, web) * 0.4 * cf);
              cc *= 0.86 + 0.28 * grain;
            }
            diffuseColor.rgb = cc;
            hgt = web * 0.8; hgtF = grain; hgtFib = 0.5;
          } else {
            diffuseColor.rgb = mix(diffuseColor.rgb, uInner, 0.7) * 0.62;
          }
        }
        #else
        if (!gl_FrontFacing) { diffuseColor.rgb = mix(diffuseColor.rgb, uInner, 0.7) * 0.62; }
        #endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (0.84 + 0.32 * nz), 0.04, 1.0);
        #ifdef KIND_SKIN
          float breakup = smoothstep(0.45, 0.8, vnoise(vObj * 260.0)) * (0.5 + fineN);
          roughnessFactor = mix(roughnessFactor * (0.85 + 0.3 * fineN) - 0.1 * breakup * fadeF, 0.32, lipM);
        #endif
        #ifdef KIND_BONE
          roughnessFactor = clamp(roughnessFactor + 0.2 * smoothstep(0.34, 0.1, fineN), 0.0, 1.0);
        #endif
        if (isCap) roughnessFactor = 0.5;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (isCap) { normal = capN; nonPerturbedNormal = capN; }
        normal = bumpN(normal, hgt, uBump * 1.4 / (uNoise * 2.0));
        normal = bumpN(normal, hgtF, uBump * 0.5 / uFine);
        #ifdef USE_FIBER
          normal = bumpN(normal, hgtFib, uBump * 0.9 * uFiberAmt / 600.0);
        #endif
        float fres = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
        diffuseColor.a *= mix(1.0, 0.05 + 1.25 * pow(fres, 2.2), uXray);`,
      )
      .replace('#include <lights_fragment_begin>', lightsNoShadowOnCap)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef USE_FLOW
          float ph = fract(vFlow * 7.0 - uTime * 1.1 * FLOW_DIR);
          float pulse = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.06, 0.32, ph));
          totalEmissiveRadiance += diffuseColor.rgb * pulse * 1.6 * uFlowOn;
        #endif
        float fr2 = 1.0 - abs(dot(normal, normalize(vViewPosition)));
        if (!isCap && uSss > 0.0) {
          float band = 0.0;
          #if NUM_DIR_LIGHTS > 0
          for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            float nl = dot(normal, directionalLights[i].direction);
            band += dot(directionalLights[i].color, vec3(0.3333)) * smoothstep(-0.5, 0.0, nl) * (1.0 - smoothstep(0.0, 0.5, nl));
          }
          #endif
          vec3 sc = diffuseColor.rgb * uSssTint;
          float thin = 1.0;
          #ifdef KIND_SKIN
            thin += clamp(length(fwidth(normal)) * 14.0, 0.0, 2.5);
            sc *= vec3(1.25, 0.8, 0.7);
          #endif
          totalEmissiveRadiance += sc * (band * 0.10 + pow(fr2, 3.0) * 0.08) * uSss * thin;
          #if defined(USE_FIBER) && defined(KIND_WET)
            totalEmissiveRadiance += vec3(0.9, 0.78, 0.72) * pow(fr2, 4.0) * 0.05;
          #endif
        }
        #ifdef KIND_TENDON
          totalEmissiveRadiance += (0.5 + 0.5 * cos(6.2832 * (fr2 * 1.3 + vec3(0.0, 0.33, 0.67)))) * pow(fr2, 2.0) * 0.07;
        #endif
        totalEmissiveRadiance += uSelColor * uSel * (0.05 + 0.6 * pow(fr2, 3.0));`,
      );
  };
  m.customProgramCacheKey = () => `anat3-${kind}-${fiber ? 1 : 0}-${flow}-${vdefs.replace(/\W/g, '')}`;
  return m;
}
