import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point to the TypeScript source so Vite compiles it directly
      '@blink-text/crypto': path.resolve(__dirname, '../../packages/crypto/src/index.ts'),
      '@blink-text/crypto/provider/browser': path.resolve(__dirname, '../../packages/crypto/src/provider/browser.ts'),
      '@blink-text/shared': path.resolve(__dirname, '../../packages/shared/src/index.js'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
