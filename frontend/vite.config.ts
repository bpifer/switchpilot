import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-server API/WS proxy target. Defaults to a local backend; override with
// VITE_PROXY_TARGET to point the dev UI at a remote deployment (e.g. the LXC)
// without touching source.
const target = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/ws': { target, ws: true },
    }
  }
});
