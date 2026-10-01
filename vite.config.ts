import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode !== 'standalone' ? [cloudflare()] : [])],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': { target: 'http://127.0.0.1:8767', changeOrigin: true } },
  },
}));
