import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: true },
  build: { target: 'es2022', outDir: 'dist' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
