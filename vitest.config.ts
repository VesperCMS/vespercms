import { defineConfig } from 'vitest/config';
import { sourceConditions } from './scripts/vite-source-conditions.mjs';

// One root config (Taproot's convention) with a project per kind of test.
// Tests run in Node by default; a file that needs a DOM opts in with a
// `// @vitest-environment jsdom` docblock. Phase 1 adds `corpus` (serializer
// round-trips) and `integration` (Astro fixture sites) projects.
export default defineConfig({
  ...sourceConditions(),
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
        },
      },
    ],
  },
});
