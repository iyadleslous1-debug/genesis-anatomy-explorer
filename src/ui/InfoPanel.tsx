import { Crosshair, Focus, EyeOff, Eye, Ghost, Boxes, X, ChevronRight, CornerLeftUp } from 'lucide-react';
import { useStore, NODES, ancestors, partsUnder } from '../state/store';
import { SYSTEMS } from '../anatomy/registry';
import { RT } from '../scene/runtime';

const sysColor = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.color]));
const sysName = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.name]));

export function InfoPanel() {
  const selected = useStore((s) => s.selected);
  const isolated = useStore((s) => s.isolated);
  const hidden = useStore((s) => (s.selected ? !!s.hidden[s.selected] : false));
  const ghost = useStore((s) => (s.selected ? !!s.ghosted[s.selected] : false));
  const organ = useStore((s) => s.organExplode);
  useStore((s) => s.loaded);
  if (!selected) return null;
  const n = NODES[selected];
  const st = useStore.getState;
  const path = ancestors(selected).slice(1).reverse();
  const leaves = partsUnder(selected);
  const explodable = !n.isPart && n.children.length >= 2;
  const parentExplodable = n.isPart && n.parent && NODES[n.parent].children.length >= 2;
  const organId = explodable ? selected : parentExplodable ? n.parent! : null;
  const exploding = organ.id === organId && organ.amount > 0;
  let tris = 0;
  for (const id of leaves) {
    const p = RT.parts.get(id);
    if (p) tris += (p.mesh.geometry.index?.count ?? 0) / 3;
  }
  return (
    <aside className="right glass">
      <div className="info-head">
        <div className="crumbs">
          {path.map((a) => (
            <button key={a} onClick={() => st().select(a)}>{NODES[a].name}<ChevronRight size={11} /></button>
          ))}
        </div>
        <button className="icon-btn" onClick={() => st().select(null)} title="Close (Esc)"><X size={16} /></button>
      </div>
      <div className="info-sys" style={{ color: sysColor[n.system] }}>
        <span className="dot" style={{ background: sysColor[n.system] }} /> {sysName[n.system]}
      </div>
      <h2 className="info-title">{n.name}</h2>
      <p className="info-desc">{n.desc ?? 'Anatomical structure.'}</p>
      <div className="info-stats">
        <div><b>{leaves.length}</b><span>{leaves.length === 1 ? 'mesh' : 'meshes'}</span></div>
        <div><b>{tris > 999 ? `${(tris / 1000).toFixed(1)}k` : tris}</b><span>triangles</span></div>
        <div><b>{n.children.length || '—'}</b><span>sub-parts</span></div>
      </div>
      <div className="actions">
        <button onClick={() => { st().reveal(selected); st().focus(selected); }}><Focus size={15} />Focus</button>
        <button className={isolated === selected ? 'on' : ''} onClick={() => st().isolate(isolated === selected ? null : selected)}><Crosshair size={15} />{isolated === selected ? 'Exit isolate' : 'Isolate'}</button>
        <button className={hidden ? 'on' : ''} onClick={() => st().toggleHidden(selected)}>{hidden ? <Eye size={15} /> : <EyeOff size={15} />}{hidden ? 'Show' : 'Hide'}</button>
        <button className={ghost ? 'on' : ''} onClick={() => st().toggleGhost(selected)}><Ghost size={15} />{ghost ? 'Opaque' : 'Transparent'}</button>
      </div>
      {organId && (
        <div className="organ-explode">
          <div className="oe-head">
            <Boxes size={15} />
            <span>Explode {NODES[organId].name.toLowerCase()}</span>
            <b>{Math.round((organ.id === organId ? organ.amount : 0) * 100)}%</b>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={organ.id === organId ? organ.amount : 0}
            onChange={(e) => st().setOrganExplode(organId, parseFloat(e.target.value))}
            onPointerUp={() => st().focus(organId)}
          />
          <div className="oe-btns">
            <button className={exploding ? '' : 'primary'} onClick={() => { st().setOrganExplode(organId, exploding ? 0 : 1); setTimeout(() => st().focus(organId), 60); }}>
              {exploding ? 'Reassemble' : `Separate ${NODES[organId].children.length} components`}
            </button>
          </div>
        </div>
      )}
      {!n.isPart && (
        <div className="children">
          <div className="children-title">Components</div>
          {n.children.map((c) => (
            <button key={c} className="child" onClick={() => st().select(c)} onDoubleClick={() => st().select(c, true)}>
              <span className="dot" style={{ background: sysColor[NODES[c].system] }} />
              <span>{NODES[c].name}</span>
              {!NODES[c].isPart && <span className="count">{partsUnder(c).length}</span>}
            </button>
          ))}
        </div>
      )}
      {n.parent && (
        <button className="up" onClick={() => st().select(n.parent!)}><CornerLeftUp size={14} /> Select {NODES[n.parent].name}</button>
      )}
    </aside>
  );
}
