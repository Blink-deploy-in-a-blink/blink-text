import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Vite compiles TypeScript natively, so we alias the workspace package
      // to its source files directly. This avoids needing a pre-build step for
      // development and lets Vite's tree-shaker remove the NodeProvider (which
      // uses node:crypto and is not usable in the browser).
      '@blink-text/crypto': path.resolve(__dirname, '../../packages/crypto/src/index.ts'),
      '@blink-text/crypto/provider/browser': path.resolve(__dirname, '../../packages/crypto/src/provider/browser.ts'),
      '@blink-text/shared': path.resolve(__dirname, '../../packages/shared/src/index.js'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0', // allow access from other devices on the LAN
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
