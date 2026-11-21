import { Viewer } from './scene/Viewer';
import { TopBar } from './ui/TopBar';
import { LeftPanel } from './ui/LeftPanel';
import { InfoPanel } from './ui/InfoPanel';
import { BP3D_CREDIT } from './anatomy/bp3d';
import { Dock, Loading, Tooltip, Keys, Hints } from './ui/Dock';

export default function App() {
  return (
    <div className="app">
      <div className="backdrop" />
      <Viewer />
      <TopBar />
      <LeftPanel />
      <InfoPanel />
      <Dock />
      <Loading />
      <Tooltip />
      <Hints />
      <Keys />
      <div style={{ position: 'fixed', left: 8, bottom: 4, fontSize: 10, opacity: 0.55, pointerEvents: 'none', zIndex: 5, color: '#cfd8e3' }}>{BP3D_CREDIT}</div>
    </div>
  );
}
