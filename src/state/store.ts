import { create } from 'zustand';
import { defineAll } from '../anatomy';
import { SYSTEMS, SystemId, Tissue } from '../anatomy/registry';

export interface TreeNode {
  id: string;
  name: string;
  parent?: string;
  children: string[];
  system: SystemId;
  isPart: boolean;
  desc?: string;
  tissue?: Tissue;
  depth: number;
}

// ------------------------------------------------------------------ static tree
const { groups, parts } = defineAll();
export const NODES: Record<string, TreeNode> = {};
for (const g of groups) NODES[g.id] = { id: g.id, name: g.name, parent: g.parent, children: [], system: g.system, isPart: false, desc: g.desc, depth: 0 };
for (const p of parts) NODES[p.id] = { id: p.id, name: p.name, parent: p.parent, children: [], system: p.system, isPart: true, desc: p.desc, tissue: p.tissue, depth: 0 };
for (const n of Object.values(NODES)) if (n.parent && NODES[n.parent]) NODES[n.parent].children.push(n.id);
export const ROOTS = SYSTEMS.map((s) => s.id).filter((id) => NODES[id]);
const setDepth = (id: string, d: number) => {
  NODES[id].depth = d;
  NODES[id].children.forEach((c) => setDepth(c, d + 1));
};
ROOTS.forEach((r) => setDepth(r, 0));
export const PART_IDS = parts.map((p) => p.id);
export const PART_DEFS = Object.fromEntries(parts.map((p) => [p.id, p]));

export function ancestors(id: string): string[] {
  const out: string[] = [];
  let n = NODES[id];
  while (n) {
    out.push(n.id);
    n = n.parent ? NODES[n.parent] : (undefined as unknown as TreeNode);
  }
  return out;
}
const leafCache = new Map<string, string[]>();
export function partsUnder(id: string): string[] {
  if (leafCache.has(id)) return leafCache.get(id)!;
  const n = NODES[id];
  if (!n) return [];
  const out = n.isPart ? [id] : n.children.flatMap(partsUnder);
  leafCache.set(id, out);
  return out;
}
export const isUnder = (id: string, ancestorId: string) => ancestors(id).includes(ancestorId);

// ------------------------------------------------------------------ search
const ALIASES: Record<string, string> = {
  'bone.patella': 'kneecap', 'bone.clavicle': 'collarbone', 'bone.scapula': 'shoulder blade', 'bone.femur': 'thigh bone thighbone',
  'bone.tibia': 'shin bone shinbone', 'bone.sternum': 'breastbone', 'bone.mandible': 'jaw jawbone', 'bone.coccyx': 'tailbone',
  'resp.trachea': 'windpipe', 'resp.larynx': 'voice box adams apple', 'ten.calcaneal': 'achilles heel cord', 'mus.rectus_abd': 'abs six pack abdominals',
  'cv.heart': 'cardiac', 'nerv.brain': 'cerebrum encephalon', 'bone.calcaneus': 'heel bone', 'bone.hip': 'pelvis ilium ischium pubis innominate',
  'bone.humerus': 'upper arm bone', 'skel.skull': 'cranium head', 'dig.stomach': 'gastric', 'uri.kidney': 'renal', 'mus.glut_max': 'buttock glutes',
  'mus.deltoid': 'shoulder delts', 'mus.biceps': 'bicep', 'mus.triceps': 'tricep', 'mus.pec_major': 'pecs chest', 'mus.gastroc': 'calf',
  'mus.quadriceps': 'quads', 'mus.latissimus': 'lats', 'mus.trapezius': 'traps', 'skel.spine': 'spine backbone vertebrae',
  'nerv.spinalcord': 'spinal cord', 'heart.lv': 'lv', 'heart.rv': 'rv', 'heart.la': 'la', 'heart.ra': 'ra', 'nerv.eye': 'eyeball vision',
  'dig.colon': 'large bowel', 'dig.small': 'small bowel gut', 'skin': 'epidermis dermis integument',
};
const searchText: Record<string, string> = {};
for (const n of Object.values(NODES)) {
  const base = n.id.replace(/\.(L|R)$/, '');
  let alias = ALIASES[n.id] ?? ALIASES[base] ?? '';
  for (const [k, v] of Object.entries(ALIASES)) if (n.id.startsWith(k + '.') && !alias.includes(v)) alias += ' ' + v;
  searchText[n.id] = `${n.name} ${alias}`.toLowerCase();
}
export function search(q: string, limit = 40): string[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const toks = s.split(/\s+/);
  const scored: [string, number][] = [];
  for (const [id, text] of Object.entries(searchText)) {
    if (!toks.every((t) => text.includes(t))) continue;
    const name = NODES[id].name.toLowerCase();
    let score = 0;
    if (name === s) score += 100;
    if (name.startsWith(s)) score += 40;
    if (new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)) score += 25;
    if (!NODES[id].isPart) score += 8;
    score -= name.length * 0.15 + NODES[id].depth * 0.5;
    scored.push([id, score]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, limit).map((x) => x[0]);
}

// ------------------------------------------------------------------ store
import type { MotionMode } from '../scene/motion';
export type { MotionMode };
export type Axis = 'x' | 'y' | 'z';
export interface LayerState { visible: boolean; opacity: number }
type Layers = Record<SystemId, LayerState>;
export interface CamRequest { nonce: number; kind: 'fit' | 'reset' | 'view' | 'fitAll'; id?: string; view?: 'front' | 'back' | 'left' | 'right' | 'top'; radius?: number }

interface Snapshot {
  hidden: Record<string, true>;
  ghosted: Record<string, true>;
  isolated: string | null;
  layers: Layers;
  explode: number;
  organExplode: { id: string | null; amount: number };
  xray: boolean;
}

export interface State extends Snapshot {
  loaded: number;
  total: number;
  ready: boolean;
  lastLoaded: string;
  selected: string | null;
  hovered: string | null;
  focusFade: boolean;
  clip: { enabled: boolean; axis: Axis; pos: number; flip: boolean };
  anim: { heart: boolean; lungs: boolean; flow: boolean };
  labels: boolean;
  autoRotate: boolean;
  motion: MotionMode;
  history: Snapshot[];
  cam: CamRequest;
  expanded: Record<string, true>;
  // actions
  select: (id: string | null, focus?: boolean) => void;
  hover: (id: string | null) => void;
  focus: (id?: string) => void;
  toggleHidden: (id: string) => void;
  hideOnly: (id: string) => void;
  showAll: () => void;
  isolate: (id: string | null) => void;
  toggleGhost: (id: string) => void;
  setLayer: (s: SystemId, patch: Partial<LayerState>) => void;
  soloLayers: (ids: SystemId[]) => void;
  setExplode: (v: number, camera?: boolean) => void;
  setOrganExplode: (id: string | null, amount: number) => void;
  setXray: (v: boolean) => void;
  setClip: (patch: Partial<State['clip']>) => void;
  setAnim: (patch: Partial<State['anim']>) => void;
  set: (patch: Partial<State>) => void;
  setMotion: (m: MotionMode) => void;
  view: (v: NonNullable<CamRequest['view']>) => void;
  reveal: (id: string) => void;
  undo: () => void;
  resetAll: () => void;
  toggleExpanded: (id: string, force?: boolean) => void;
}

const defaultLayers = (): Layers => Object.fromEntries(SYSTEMS.map((s) => [s.id, { visible: true, opacity: 1 }])) as Layers;
const initialHidden = (): Record<string, true> => ({ 'fat.subcutaneous': true, 'bp.subcutaneous_fat': true });

let nonce = 1;
const snap = (s: State): Snapshot => ({
  hidden: { ...s.hidden }, ghosted: { ...s.ghosted }, isolated: s.isolated, layers: JSON.parse(JSON.stringify(s.layers)),
  explode: s.explode, organExplode: { ...s.organExplode }, xray: s.xray,
});

export const useStore = create<State>((set, get) => {
  const push = () => set((s) => ({ history: [...s.history.slice(-60), snap(s)] }));
  return {
    loaded: 0,
    total: PART_IDS.length,
    ready: false,
    lastLoaded: '',
    selected: null,
    hovered: null,
    hidden: initialHidden(),
    ghosted: {},
    isolated: null,
    layers: defaultLayers(),
    explode: 0,
    organExplode: { id: null, amount: 0 },
    xray: false,
    focusFade: true,
    clip: { enabled: false, axis: 'x', pos: 0, flip: false },
    anim: { heart: true, lungs: true, flow: true },
    labels: true,
    autoRotate: false,
    motion: 'idle',
    history: [],
    cam: { nonce: 0, kind: 'reset' },
    expanded: { skeletal: true },

    select: (id, focus = false) => {
      set({ selected: id });
      if (id) {
        const anc = ancestors(id).slice(1);
        set((s) => ({ expanded: { ...s.expanded, ...Object.fromEntries(anc.map((a) => [a, true])) } }));
        if (focus) get().focus(id);
      }
    },
    hover: (id) => { if (get().hovered !== id) set({ hovered: id }); },
    focus: (id) => {
      const target = id ?? get().selected;
      set({ cam: target ? { nonce: nonce++, kind: 'fit', id: target } : { nonce: nonce++, kind: 'reset' } });
    },
    toggleHidden: (id) => {
      push();
      set((s) => {
        const h = { ...s.hidden };
        if (h[id]) delete h[id];
        else h[id] = true;
        return { hidden: h };
      });
    },
    hideOnly: (id) => { push(); set((s) => ({ hidden: { ...s.hidden, [id]: true } })); },
    showAll: () => { push(); set({ hidden: initialHidden(), isolated: null, ghosted: {}, layers: defaultLayers() }); },
    isolate: (id) => {
      push();
      set({ isolated: id });
      if (id) get().focus(id);
    },
    toggleGhost: (id) => {
      push();
      set((s) => {
        const g = { ...s.ghosted };
        if (g[id]) delete g[id];
        else g[id] = true;
        return { ghosted: g };
      });
    },
    setLayer: (sys, patch) => set((s) => ({ layers: { ...s.layers, [sys]: { ...s.layers[sys], ...patch } } })),
    soloLayers: (ids) => {
      push();
      set((s) => ({
        isolated: null,
        layers: Object.fromEntries(Object.entries(s.layers).map(([k, v]) => [k, { ...v, visible: ids.includes(k as SystemId) }])) as Layers,
      }));
    },
    setExplode: (v, camera = false) => {
      set({ explode: v });
      if (camera) set({ cam: { nonce: nonce++, kind: 'fitAll', radius: 1.0 + v * 2.25 } });
    },
    setOrganExplode: (id, amount) => set({ organExplode: { id, amount } }),
    setXray: (v) => { push(); set({ xray: v }); },
    setClip: (patch) => set((s) => ({ clip: { ...s.clip, ...patch } })),
    setAnim: (patch) => set((s) => ({ anim: { ...s.anim, ...patch } })),
    set: (patch) => set(patch),
    setMotion: (m) => set({ motion: m }),
    view: (v) => set({ cam: { nonce: nonce++, kind: 'view', view: v } }),
    reveal: (id) => {
      const s = get();
      const anc = ancestors(id);
      const hidden = { ...s.hidden };
      let changed = false;
      for (const a of anc) if (hidden[a]) { delete hidden[a]; changed = true; }
      for (const p of partsUnder(id)) if (hidden[p]) { delete hidden[p]; changed = true; }
      const sys = NODES[id].system;
      const needLayer = !s.layers[sys].visible;
      const outsideIso = s.isolated && !isUnder(id, s.isolated);
      if (changed || needLayer || outsideIso) {
        push();
        set({ hidden, layers: needLayer ? { ...s.layers, [sys]: { ...s.layers[sys], visible: true } } : s.layers, isolated: outsideIso ? null : s.isolated });
      }
    },
    undo: () => {
      const h = get().history;
      if (!h.length) return;
      const last = h[h.length - 1];
      set({ ...last, history: h.slice(0, -1) });
    },
    resetAll: () => {
      push();
      set({
        hidden: initialHidden(), ghosted: {}, isolated: null, layers: defaultLayers(), explode: 0, organExplode: { id: null, amount: 0 },
        xray: false, motion: 'idle', selected: null, clip: { enabled: false, axis: 'x', pos: 0, flip: false }, cam: { nonce: nonce++, kind: 'reset' },
      });
    },
    toggleExpanded: (id, force) =>
      set((s) => {
        const e = { ...s.expanded };
        const open = force ?? !e[id];
        if (open) e[id] = true;
        else delete e[id];
        return { expanded: e };
      }),
  };
});

/** Effective visibility of a part */
export function partVisible(s: State, id: string): boolean {
  const anc = ancestors(id);
  for (const a of anc) if (s.hidden[a]) return false;
  if (s.isolated) return anc.includes(s.isolated);
  return s.layers[NODES[id].system].visible;
}
export const OUTER: SystemId[] = ['integumentary', 'muscular'];
export function partOpacity(s: State, id: string): { opacity: number; xray: number } {
  const n = NODES[id];
  const anc = ancestors(id);
  let o = s.isolated ? 1 : s.layers[n.system].opacity;
  let xray = 0;
  if (s.xray && OUTER.includes(n.system) && !(s.selected && anc.includes(s.selected))) {
    xray = 1;
    o *= n.system === 'integumentary' ? 0.55 : 0.7;
  }
  if (anc.some((a) => s.ghosted[a])) o = Math.min(o, 0.16);
  if (s.focusFade && s.selected && !anc.includes(s.selected)) {
    const selSys = NODES[s.selected]?.system;
    if (selSys && !OUTER.includes(selSys) && OUTER.includes(n.system)) { o = Math.min(o, 0.14); xray = Math.max(xray, 0.6); }
  }
  return { opacity: o, xray };
}
