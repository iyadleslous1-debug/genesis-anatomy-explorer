import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ScanEye, Scissors, HeartPulse, Wind, Activity, Tag, RotateCw, Undo2, RefreshCcw, X } from 'lucide-react';
import { useStore, search, NODES, ancestors } from '../state/store';
import { SYSTEMS } from '../anatomy/registry';

const sysColor = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.color]));

function SearchBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => search(q, 30), [q]);
  const pick = (id: string) => {
    const s = useStore.getState();
    s.reveal(id);
    s.select(id, true);
    setOpen(false);
    setQ(NODES[id].name);
    inputRef.current?.blur();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="search">
      <Search size={16} className="search-icon" />
      <input
        ref={inputRef}
        value={q}
        placeholder="Search anatomy — heart, femur, left ventricle…"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setHi((h) => Math.min(results.length - 1, h + 1)); e.preventDefault(); }
          if (e.key === 'ArrowUp') { setHi((h) => Math.max(0, h - 1)); e.preventDefault(); }
          if (e.key === 'Enter' && results[hi]) pick(results[hi]);
          if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
          e.stopPropagation();
        }}
      />
      {q && <button className="search-clear" onMouseDown={(e) => { e.preventDefault(); setQ(''); inputRef.current?.focus(); }}><X size={14} /></button>}
      <kbd className="search-kbd">/</kbd>
      {open && q && (
        <div className="search-results glass">
          {results.length === 0 && <div className="search-empty">No structures match “{q}”</div>}
          {results.map((id, i) => {
            const n = NODES[id];
            const path = ancestors(id).slice(1, 3).reverse().map((a) => NODES[a].name).join(' › ');
            return (
              <button key={id} className={`search-item ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(id); }}>
                <span className="dot" style={{ background: sysColor[n.system] }} />
                <span className="search-name">{n.name}</span>
                <span className="search-path">{n.isPart ? path : `${path ? path + ' › ' : ''}group`}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tool({ on, onClick, icon, label, title }: { on?: boolean; onClick: () => void; icon: JSX.Element; label?: string; title: string }) {
  return (
    <button className={`tool ${on ? 'on' : ''}`} onClick={onClick} title={title}>
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

export function TopBar() {
  const xray = useStore((s) => s.xray);
  const clip = useStore((s) => s.clip.enabled);
  const anim = useStore((s) => s.anim);
  const labels = useStore((s) => s.labels);
  const autoRotate = useStore((s) => s.autoRotate);
  const canUndo = useStore((s) => s.history.length > 0);
  const st = useStore.getState;
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"><span /></div>
        <div>
          <div className="brand-name">GENESIS</div>
          <div className="brand-sub">3D Human Anatomy Explorer</div>
        </div>
      </div>
      <SearchBox />
      <div className="tools glass">
        <Tool on={xray} onClick={() => st().setXray(!xray)} icon={<ScanEye size={16} />} label="X-ray" title="X-ray: make skin and muscles translucent (X)" />
        <Tool on={clip} onClick={() => st().setClip({ enabled: !clip })} icon={<Scissors size={16} />} label="Section" title="Cross-section clipping plane (C)" />
        <span className="sep" />
        <Tool on={anim.heart} onClick={() => st().setAnim({ heart: !anim.heart })} icon={<HeartPulse size={16} />} title="Beating heart" />
        <Tool on={anim.lungs} onClick={() => st().setAnim({ lungs: !anim.lungs })} icon={<Wind size={16} />} title="Breathing" />
        <Tool on={anim.flow} onClick={() => st().setAnim({ flow: !anim.flow })} icon={<Activity size={16} />} title="Illustrative blood-flow pulses" />
        <span className="sep" />
        <Tool on={labels} onClick={() => st().set({ labels: !labels })} icon={<Tag size={16} />} title="Smart labels" />
        <Tool on={autoRotate} onClick={() => st().set({ autoRotate: !autoRotate })} icon={<RotateCw size={16} />} title="Auto-rotate" />
        <span className="sep" />
        <button className="tool" disabled={!canUndo} onClick={() => st().undo()} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
        <button className="tool" onClick={() => st().resetAll()} title="Reset everything"><RefreshCcw size={16} /><span>Reset</span></button>
      </div>
    </header>
  );
}
