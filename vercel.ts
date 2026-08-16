import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  buildCommand: 'pnpm --filter @spatial-lingo/xr build',
  outputDirectory: 'apps/xr/dist',
  framework: 'vite',
};
