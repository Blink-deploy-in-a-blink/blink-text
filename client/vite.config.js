import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      // Map the relative import in cryptoService.js to the actual browser provider
      '../../crypto/provider/browser.js': path.resolve(__dirname, '../crypto/provider/browser.js'),
    },
  },
});
