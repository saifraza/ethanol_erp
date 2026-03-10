import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: { outDir: '../backend/public', emptyOutDir: true },
  server: { port: 3000, proxy: { '/api': 'http://localhost:5000' } },
});
