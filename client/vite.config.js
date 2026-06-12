import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  optimizeDeps: {
    include: ['flowbite-datepicker'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        timeout: 600000,
        proxyTimeout: 600000,
      }
    }
  }
});
