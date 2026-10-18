import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Only the voice worker imports it, so without this the first mic tap in dev re-optimizes and reloads the page.
  optimizeDeps: { include: ['@huggingface/transformers'] },
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:5000',
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
  },
});
