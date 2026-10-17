import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { sourceConditions } from './scripts/vite-source-conditions.mjs';

// One root config (Taproot's convention) with a project per kind of test.
// Tests run in Node by default; a file that needs a DOM opts in with a
// `// @vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [...(sourceConditions().plugins ?? []), react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        // Round-trip tests over the real-world corpus and the synthetic fixtures.
        extends: true,
        test: {
          name: 'corpus',
          environment: 'node',
          include: ['packages/core/test/**/*.test.ts'],
        },
      },
      {
        // Real Astro sites: config loading through Vite, astro sync, the CLI.
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['packages/astro/test/**/*.test.ts'],
          pool: 'forks',
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
