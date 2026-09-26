import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// BASE_PATH is set by the GitHub Pages workflow ("/Island-traders/"); local
// and preview builds use relative asset paths so they work from any folder.
export default defineConfig({
  root,
  base: process.env.BASE_PATH ?? './',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  resolve: { alias: { engine: fileURLToPath(new URL('../src/index.ts', import.meta.url)) } },
  server: { host: true, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  preview: { host: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 1500 },
});
