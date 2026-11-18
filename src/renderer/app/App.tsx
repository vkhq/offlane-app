import { BrowserRouter } from 'react-router-dom';

import { AppShell } from '../components/AppShell';
import { basename } from './basename';

// The router's location is the page showing; the tabs follow it, each keeping
// the pages it has visited (see `useTabs`).
export function App() {
  return (
    <BrowserRouter basename={basename}>
      <AppShell />
    </BrowserRouter>
  );
}
