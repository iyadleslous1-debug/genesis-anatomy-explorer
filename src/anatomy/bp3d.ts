import manifestJson from '../data/bp3d_manifest.json';
import { G, P, groups as regGroups, type GroupDef, type SystemId, type Tissue, type AnimKind, type PartDef } from './registry';

export interface AttrDef { off: number; type: string; size: number; stride?: number }
export interface ManifestPart {
  id: string; name: string; parent: string; system: SystemId; tissue: Tissue; desc?: string; anim?: AnimKind;
  driver?: { bone: string; sign: 1 | -1; gain?: number };
  chunk: string; center: [number, number, number]; vertexCount: number;
  index: { off: number; type: 'u16' | 'u32'; count: number };
  attrs: { position: AttrDef; normal: AttrDef; skinIndex: AttrDef; skinWeight: AttrDef; fdir?: AttrDef; flow?: AttrDef; along?: AttrDef };
}
export interface Manifest {
  version: number; credit: string; groups: GroupDef[]; parts: ManifestPart[];
  chunks: Record<string, { file: string; bytes: number }>;
}
export const MANIFEST = manifestJson as unknown as Manifest;
export const HAS_BP3D = MANIFEST.parts.length > 0;
export const BP3D_CREDIT = MANIFEST.credit || 'BodyParts3D, © The Database Center for Life Science, CC BY 4.0';
export const BP3D_PARTS = new Map(MANIFEST.parts.map((p) => [p.id, p]));

const KEEP = [
  'resp.lung.', 'dig.liver.', 'nerv.spinalcord', 'nerv.spinal_roots', 'nerv.intercostal', 'nerv.sympathetic',
  'nerv.brachial_plexus', 'nerv.median', 'nerv.ulnar', 'nerv.radial', 'nerv.musculocutaneous', 'nerv.axillary', 'nerv.femoral',
  'nerv.obturator', 'nerv.sciatic', 'nerv.tibial', 'nerv.fibular', 'nerv.sural',
  'lym.', 'ten.', 'lig.', 'cart.menisci', 'heart.valve.', 'heart.chordae', 'heart.papillary',
];
const names = MANIFEST.parts.map((p) => p.name.toLowerCase()).join('|');
const bpHas = (re: RegExp) => re.test(names);
const HEADNECK: [string, RegExp][] = [
  ['nasal.', /nasal|concha|septum of nose/], ['pharynx.', /pharyn|soft palate/], ['sinus.', /sinus/],
  ['ear.', /cochlea|tympan|malleus|incus|stapes|auditory|vestibul/], ['larynx.', /larynx|vocal|arytenoid/],
];

/** Procedural part ids that remain when BodyParts3D is present. */
export function KEEP_PROCEDURAL(id: string): boolean {
  if (!HAS_BP3D) return true;
  if (KEEP.some((k) => id.startsWith(k))) return true;
  for (const [pre, re] of HEADNECK) if (id.startsWith(pre)) return !bpHas(re);
  return false;
}

export function defineBp3d() {
  for (const g of MANIFEST.groups) G(g.id, g.name, g.parent, g.system, g.desc);
  for (const p of MANIFEST.parts) {
    const def: PartDef = {
      id: p.id, name: p.name, parent: p.parent, system: p.system, tissue: p.tissue, desc: p.desc, anim: p.anim, driver: p.driver,
      external: true, build: () => ({ pos: new Float32Array(0), nor: new Float32Array(0), idx: new Uint32Array(0) }),
    };
    P(def);
  }
  void regGroups;
}
