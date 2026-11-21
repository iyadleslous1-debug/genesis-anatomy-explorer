import { memo, useEffect, useRef, useState } from 'react';
import { ChevronRight, Eye, EyeOff, Layers, ListTree, Crosshair } from 'lucide-react';
import { useStore, NODES, ROOTS, partsUnder, ancestors } from '../state/store';
import { SYSTEMS, SystemId } from '../anatomy/registry';

const sysColor = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.color]));
const ORGANS: SystemId[] = ['respiratory', 'digestive', 'urinary', 'reproductive', 'endocrine'];

const PRESETS: { name: string; on: SystemId[]; faint?: SystemId[] }[] = [
  { name: 'Full body', on: SYSTEMS.map((s) => s.id) },
  { name: 'No skin', on: SYSTEMS.map((s) => s.id).filter((s) => s !== 'integumentary') },
  { name: 'Muscles', on: ['muscular', 'skeletal'] },
  { name: 'Skeleton', on: ['skeletal'] },
  { name: 'Organs', on: [...ORGANS, 'cardiovascular', 'skeletal'], faint: ['skeletal', 'cardiovascular'] },
  { name: 'Circulation', on: ['cardiovascular', 'skeletal'], faint: ['skeletal'] },
  { name: 'Nerves', on: ['nervous', 'skeletal'], faint: ['skeletal'] },
];

function applyPreset(p: (typeof PRESETS)[number]) {
  const s = useStore.getState();
  s.soloLayers(p.on);
  for (const sys of SYSTEMS) s.setLayer(sys.id, { opacity: p.faint?.includes(sys.id) ? 0.28 : 1 });
  useStore.setState({ hidden: { 'fat.subcutaneous': true }, isolated: null });
}

function LayersSection() {
  const layers = useStore((s) => s.layers);
  const counts = useState(() => Object.fromEntries(SYSTEMS.map((s) => [s.id, NODES[s.id] ? partsUnder(s.id).length : 0])))[0];
  return (
    <div className="section">
      <div className="chips">
        {PRESETS.map((p) => (
          <button key={p.name} className="chip" onClick={() => applyPreset(p)}>{p.name}</button>
        ))}
      </div>
      <div className="layers">
        {SYSTEMS.map((sys) => {
          const L = layers[sys.id];
          return (
            <div key={sys.id} className={`layer ${L.visible ? '' : 'off'}`}>
              <button className="icon-btn" onClick={() => useStore.getState().setLayer(sys.id, { visible: !L.visible })} title={L.visible ? 'Hide layer' : 'Show layer'}>
                {L.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <span className="dot" style={{ background: sys.color }} />
              <button className="layer-name" onClick={() => { const s = useStore.getState(); s.select(sys.id); }} title={sys.desc}>
                {sys.name}
                <span className="count">{counts[sys.id]}</span>
              </button>
              <input
                className="mini-range"
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={L.opacity}
                onChange={(e) => useStore.getState().setLayer(sys.id, { opacity: parseFloat(e.target.value), visible: true })}
                title="Layer opacity"
                style={{ ['--c' as string]: sys.color }}
              />
              <button className="icon-btn solo" onClick={() => useStore.getState().soloLayers([sys.id])} title="Show only this layer">
                <Crosshair size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TreeRow = memo(function TreeRow({ id }: { id: string }) {
  const n = NODES[id];
  const expanded = useStore((s) => !!s.expanded[id]);
  const selected = useStore((s) => s.selected === id);
  const inPath = useStore((s) => !!s.selected && s.selected !== id && ancestors(s.selected).includes(id));
  const hidden = useStore((s) => ancestors(id).some((a) => s.hidden[a]));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  const hasKids = n.children.length > 0;
  return (
    <>
      <div
        ref={ref}
        className={`tree-row ${selected ? 'sel' : ''} ${inPath ? 'path' : ''} ${hidden ? 'hidden' : ''}`}
        style={{ paddingLeft: 6 + n.depth * 13 }}
        onClick={() => useStore.getState().select(id)}
        onDoubleClick={() => { const s = useStore.getState(); s.reveal(id); s.select(id, true); }}
      >
        <button
          className={`caret ${expanded ? 'open' : ''} ${hasKids ? '' : 'leaf'}`}
          onClick={(e) => { e.stopPropagation(); if (hasKids) useStore.getState().toggleExpanded(id); }}
        >
          {hasKids ? <ChevronRight size={13} /> : <span className="leaf-dot" style={{ background: sysColor[n.system] }} />}
        </button>
        <span className="tree-name">{n.name}</span>
        {hasKids && <span className="count">{partsUnder(id).length}</span>}
        <button className="icon-btn eye" onClick={(e) => { e.stopPropagation(); useStore.getState().toggleHidden(id); }} title={hidden ? 'Show' : 'Hide'}>
          {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
      {expanded && n.children.map((c) => <TreeRow key={c} id={c} />)}
    </>
  );
});

export function LeftPanel() {
  const [tab, setTab] = useState<'layers' | 'tree'>('layers');
  const selected = useStore((s) => s.selected);
  useEffect(() => {
    if (selected) setTab('tree');
  }, [selected]);
  return (
    <aside className="left glass">
      <div className="tabs">
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}><Layers size={15} /> Layers</button>
        <button className={tab === 'tree' ? 'on' : ''} onClick={() => setTab('tree')}><ListTree size={15} /> Anatomy</button>
      </div>
      {tab === 'layers' ? (
        <LayersSection />
      ) : (
        <div className="tree">
          {ROOTS.map((r) => <TreeRow key={r} id={r} />)}
        </div>
      )}
    </aside>
  );
}
