import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Installable PWA: Workbox service worker precaches the app shell so it loads
// offline and can be added to the home screen. The app's own data layer is
// already offline-first (IndexedDB + Supabase sync); the SW covers the shell.
const BUILD_ID = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/apple-touch-icon-180.png', 'icons/favicon-64.png'],
      manifest: {
        name: 'OrthoStock — Ortho Supply Manager',
        short_name: 'OrthoStock',
        description: 'Inventory, sales, expenses, reports and investments for orthodontic supplies.',
        lang: 'ar',
        dir: 'rtl',
        theme_color: '#0D3B6E',
        background_color: '#F3F6FB',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

    }),
  ],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Split big third-party libs into their own long-cached chunks so a code
        // change to the app doesn't force users to re-download React/Supabase/etc.
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
});
