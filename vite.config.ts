import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./src/client', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { strict: true, allow: [fileURLToPath(new URL('./src', import.meta.url))] },
  },
});
