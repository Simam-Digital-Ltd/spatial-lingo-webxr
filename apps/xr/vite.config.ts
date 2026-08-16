import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vitest/config';

// The dev-only emulator plugin spins up HTTPS certs, Playwright, and an MCP
// bridge on `configureServer` — none of which vitest's own Vite server
// should trigger. Skip it entirely under `vitest run` (which sets VITEST=true).
const emulatorPlugins = process.env.VITEST
  ? []
  : [
      iwsdkDev({
        emulator: { device: 'metaQuest3', environment: 'living_room' },
      }),
    ];

export default defineConfig({
  server: { host: true },
  build: { target: 'es2022', outDir: 'dist' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
  plugins: emulatorPlugins,
});
