import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './state/store';
import './styles.css';

if (import.meta.env.DEV || location.search.includes("debug")) (window as unknown as { __store: typeof useStore }).__store = useStore;

createRoot(document.getElementById('root')!).render(<App />);
