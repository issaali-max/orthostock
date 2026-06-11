import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './app/AppProvider.jsx';
import App from './App.jsx';

// Every deploy renames the hashed lazy chunks (e.g. exceljs.min-XXXX.js). A tab
// that was open BEFORE the deploy still references the old names, so its first
// lazy import after the deploy fails with "Failed to fetch dynamically imported
// module". Vite emits 'vite:preloadError' for exactly this case — refresh once
// to pick up the new version. Time-guarded to avoid reload loops.
window.addEventListener('vite:preloadError', (e) => {
  const last = Number(sessionStorage.getItem('chunkReloadAt') || 0);
  if (Date.now() - last < 30000) return;
  sessionStorage.setItem('chunkReloadAt', String(Date.now()));
  e.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
);
