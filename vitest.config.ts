import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // the web app's modules import the engine as 'engine' (as in web/vite.config.ts)
  resolve: { alias: { engine: fileURLToPath(new URL('./src/index.ts', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 120_000,
  },
});
