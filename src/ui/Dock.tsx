import { useEffect, useState } from 'react';
import { Maximize2, FlipHorizontal2 } from 'lucide-react';
import { useStore, NODES, Axis, MotionMode } from '../state/store';

const MOTIONS: { mode: MotionMode; label: string }[] = [
  { mode: 'anatomical', label: 'Still' },
  { mode: 'idle', label: 'Breathe' },
  { mode: 'walk', label: 'Walk' },
  { mode: 'reach', label: 'Reach' },
  { mode: 'flex', label: 'Flex' },
  { mode: 'squat', label: 'Squat' },
  { mode: 'look', label: 'Look' },
];

const RANGES: Record<Axis, [number, number, number]> = { x: [-0.42, 0.42, 0], y: [0.02, 1.78, 1.3], z: [-0.16, 0.16, 0.0] };
const AXIS_NAME: Record<Axis, string> = { x: 'Sagittal', y: 'Transverse', z: 'Coronal' };

export function Dock() {
  const explode = useStore((s) => s.explode);
  const clip = useStore((s) => s.clip);
  const motion = useStore((s) => s.motion);
  const st = useStore.getState;
  const on = explode > 0.001;
  return (
    <div className="dock">
      {clip.enabled && (
        <div className="clipbar glass">
          <span className="clip-title">Cross-section</span>
          <div className="seg">
            {(['x', 'y', 'z'] as Axis[]).map((a) => (
              <button key={a} className={clip.axis === a ? 'on' : ''} onClick={() => st().setClip({ axis: a, pos: RANGES[a][2] })}>{AXIS_NAME[a]}</button>
            ))}
          </div>
          <input type="range" min={RANGES[clip.axis][0]} max={RANGES[clip.axis][1]} step={0.001} value={clip.pos} onChange={(e) => st().setClip({ pos: parseFloat(e.target.value) })} />
          <button className="icon-btn" title="Flip side" onClick={() => st().setClip({ flip: !clip.flip })}><FlipHorizontal2 size={16} /></button>
        </div>
      )}
      <div
        className="glass motion-row"
        title="Motion (M cycles)"
        style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 8px', background: 'rgba(13,17,24,0.85)' }}
      >
        <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginRight: 6, whiteSpace: 'nowrap' }}>Motion</span>
        <div className="seg" style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {MOTIONS.map((m) => (
            <button key={m.mode} className={motion === m.mode ? 'on' : ''} onClick={() => st().setMotion(m.mode)}>{m.label}</button>
          ))}
        </div>
      </div>
      <div className="explodebar glass">
        <button
          className={`explode-btn ${on ? 'on' : ''}`}
          onClick={() => st().setExplode(on ? 0 : 1, true)}
        >
          <span className="explode-glyph"><i /><i /><i /><i /></span>
          {on ? 'ASSEMBLE' : 'EXPLODE'}
        </button>
        <div className="explode-slider">
          <div className="explode-label"><span>Explosion intensity</span><b>{Math.round(explode * 100)}%</b></div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={explode}
            onChange={(e) => st().setExplode(parseFloat(e.target.value))}
            onPointerUp={(e) => st().setExplode(parseFloat((e.target as HTMLInputElement).value), true)}
          />
        </div>
        <div className="views">
          {(['front', 'back', 'left', 'right', 'top'] as const).map((v) => (
            <button key={v} onClick={() => st().view(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
          <button title="Frame everything" onClick={() => { const s = st(); if (s.explode > 0) s.setExplode(s.explode, true); else s.set({ cam: { nonce: Date.now(), kind: 'reset' } }); }}><Maximize2 size={13} /></button>
        </div>
      </div>
    </div>
  );
}

export function Loading() {
  const loaded = useStore((s) => s.loaded);
  const total = useStore((s) => s.total);
  const last = useStore((s) => s.lastLoaded);
  const ready = useStore((s) => s.ready);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (ready) {
      const t = setTimeout(() => setGone(true), 900);
      return () => clearTimeout(t);
    }
  }, [ready]);
  if (gone) return null;
  const pct = Math.round((loaded / total) * 100);
  return (
    <div className={`loading glass ${ready ? 'done' : ''}`}>
      <div className="loading-top">
        <span>{ready ? 'Anatomy assembled' : 'Generating anatomy procedurally'}</span>
        <b>{pct}%</b>
      </div>
      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      <div className="loading-sub">{ready ? `${total} structures ready` : `${loaded} / ${total} · ${last || 'starting workers…'}`}</div>
    </div>
  );
}

export function Tooltip() {
  const hovered = useStore((s) => s.hovered);
  const [pos, setPos] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const m = (e: PointerEvent) => setPos([e.clientX, e.clientY]);
    window.addEventListener('pointermove', m);
    return () => window.removeEventListener('pointermove', m);
  }, []);
  if (!hovered) return null;
  return (
    <div className="tooltip" style={{ left: pos[0] + 14, top: pos[1] + 14 }}>
      {NODES[hovered].name}
    </div>
  );
}

export function Keys() {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' && (document.activeElement as HTMLInputElement).type === 'text') return;
      const s = useStore.getState();
      const sel = s.selected;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); s.undo(); return; }
      switch (e.key.toLowerCase()) {
        case 'escape': if (s.isolated) s.isolate(null); else s.select(null); break;
        case 'f': if (sel) s.focus(sel); else s.focus(); break;
        case 'h': case 'delete': if (sel) s.toggleHidden(sel); break;
        case 'i': if (sel) s.isolate(s.isolated === sel ? null : sel); break;
        case 't': if (sel) s.toggleGhost(sel); break;
        case 'x': s.setXray(!s.xray); break;
        case 'c': s.setClip({ enabled: !s.clip.enabled }); break;
        case 'e': s.setExplode(s.explode > 0 ? 0 : 1, true); break;
        case 'a': s.showAll(); break;
        case 'r': s.set({ autoRotate: !s.autoRotate }); break;
        case 'm': { const i = MOTIONS.findIndex((m) => m.mode === s.motion); s.setMotion(MOTIONS[(i + 1) % MOTIONS.length].mode); break; }
        case 'u': if (sel && NODES[sel].parent) s.select(NODES[sel].parent!); break;
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return null;
}

export function Hints() {
  return (
    <div className="hints">
      <span><kbd>Drag</kbd> rotate</span>
      <span><kbd>Right-drag</kbd> pan</span>
      <span><kbd>Wheel</kbd> zoom</span>
      <span><kbd>Click</kbd> select</span>
      <span><kbd>Dbl-click</kbd> focus / parent</span>
      <span><kbd>H</kbd> hide <kbd>I</kbd> isolate <kbd>T</kbd> transparent <kbd>E</kbd> explode <kbd>X</kbd> x-ray <kbd>C</kbd> section <kbd>Ctrl+Z</kbd> undo</span>
    </div>
  );
}
