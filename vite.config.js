import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Simple, stable Vite setup. PWA (manifest + service worker) is added in a
// later phase; the app runs as a normal responsive site until then.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
