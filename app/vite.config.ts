import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 见 docs/ARCHITECTURE.md 3.1：vendor/foliate-js 直接 import
      'foliate-js': path.resolve(here, '../vendor/foliate-js'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [path.resolve(here, '..')] },
  },
  preview: { port: 4173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  test: {
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
