import { createRoot } from 'react-dom/client';

import { App } from './app/App';
// Noto Sans, bundled with the app (Fontsource, SIL Open Font License).
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans';
import './index.css';

// With the window's own translucent material behind it, the page leaves the
// sidebar's background clear so the material shows (see index.css). A plain
// browser has no bridge and keeps the painted wash.
if (window.app?.vibrancy) document.documentElement.classList.add('vibrant');

createRoot(document.getElementById('root')!).render(<App />);
