import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The React app lives in client/. The production build goes to client-dist/,
// which Express serves as static files (and Electron loads through Express).
export default defineConfig({
  root: 'client',
  base: '/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../client-dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200, // served from local disk, so bundle size is not a concern
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5000',
    },
  },
});
