import type { Geo } from '../geo/mesher';

export type SystemId =
  | 'integumentary'
  | 'muscular'
  | 'skeletal'
  | 'cardiovascular'
  | 'nervous'
  | 'respiratory'
  | 'digestive'
  | 'urinary'
  | 'reproductive'
  | 'endocrine'
  | 'lymphatic';

export type Tissue =
  | 'skin' | 'fat' | 'muscle' | 'tendon' | 'bone' | 'tooth' | 'cartilage' | 'ligament' | 'disc'
  | 'artery' | 'vein' | 'nerve' | 'brain' | 'brainstem' | 'cerebellum' | 'cord'
  | 'myocardium' | 'atrium' | 'valve' | 'coronary'
  | 'lung' | 'airway' | 'diaphragm'
  | 'liver' | 'gallbladder' | 'stomach' | 'intestine' | 'colon' | 'pancreas' | 'spleen' | 'esophagus' | 'tongue' | 'salivary'
  | 'kidney' | 'medulla' | 'pelvis' | 'bladder' | 'prostate' | 'gland' | 'thyroid' | 'adrenal'
  | 'eye' | 'iris' | 'lens'
  | 'lymph' | 'node' | 'ear' | 'mucosa';

export type AnimKind = 'ventricle' | 'atrium' | 'lung' | 'diaphragm' | 'bronchi' | 'heartAux' | 'leafletAV' | 'leafletSL' | 'rib';

export interface GroupDef {
  id: string;
  name: string;
  parent?: string;
  system: SystemId;
  desc?: string;
}

export interface PartDef {
  id: string;
  name: string;
  parent: string;
  system: SystemId;
  tissue: Tissue;
  desc?: string;
  build: () => Geo;
  /** BodyParts3D part loaded from public/bp3d chunks (build unused) */
  external?: true;
  driver?: { bone: string; sign: 1 | -1; gain?: number };
  anim?: AnimKind;
  /** world-space hinge point for rotational anims (valve leaflets, ribs) */
  pivot?: [number, number, number];
  /** unit rotation axis for rotational anims */
  axis?: [number, number, number];
  /** pin to a specific worker (0) e.g. for parts sharing cached heavy geometry */
  pin0?: boolean;
  cost?: number;
}

export const groups: GroupDef[] = [];
export const parts: PartDef[] = [];
const groupIds = new Set<string>();

export function G(id: string, name: string, parent: string | undefined, system: SystemId, desc?: string) {
  if (groupIds.has(id)) return id;
  groupIds.add(id);
  groups.push({ id, name, parent, system, desc });
  return id;
}

export function P(def: PartDef) {
  parts.push(def);
  return def.id;
}

export const SYSTEMS: { id: SystemId; name: string; color: string; desc: string }[] = [
  { id: 'integumentary', name: 'Skin & Fat', color: '#e0a988', desc: 'Skin and subcutaneous adipose tissue.' },
  { id: 'muscular', name: 'Muscles', color: '#c0443b', desc: 'Skeletal muscles and tendons.' },
  { id: 'skeletal', name: 'Skeleton', color: '#e8dcc0', desc: 'Bones, cartilage and ligaments.' },
  { id: 'cardiovascular', name: 'Cardiovascular', color: '#d6303a', desc: 'Heart, arteries and veins.' },
  { id: 'nervous', name: 'Nervous', color: '#f0cf62', desc: 'Brain, spinal cord, nerves and eyes.' },
  { id: 'respiratory', name: 'Respiratory', color: '#ec9aa0', desc: 'Airways, lungs and diaphragm.' },
  { id: 'digestive', name: 'Digestive', color: '#d98a6a', desc: 'Alimentary canal and accessory organs.' },
  { id: 'urinary', name: 'Urinary', color: '#b5544a', desc: 'Kidneys, ureters, bladder and urethra.' },
  { id: 'reproductive', name: 'Reproductive', color: '#c98aa8', desc: 'Internal male reproductive organs.' },
  { id: 'endocrine', name: 'Endocrine', color: '#a78bfa', desc: 'Hormone-secreting glands.' },
  { id: 'lymphatic', name: 'Lymphatic', color: '#7ee0a0', desc: 'Lymph nodes, lymphatic vessels, thoracic duct and tonsils.' },
];
