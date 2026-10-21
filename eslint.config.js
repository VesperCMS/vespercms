import { builtinModules } from 'node:module';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Package boundaries (spec §5, §12). Exported so the boundary test can assert
// the exact rules that ship here.
const nodeBuiltins = builtinModules.filter((name) => !name.startsWith('_'));

export const coreBoundaryRules = {
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      paths: nodeBuiltins.map((name) => ({
        name,
        message:
          'core runs in browsers and Workers too (spec §12). Use a platform API, or move this code to @vesper/astro.',
      })),
      patterns: [
        {
          regex: '^node:',
          message:
            'core runs in browsers and Workers too (spec §12). Use a platform API, or move this code to @vesper/astro.',
        },
        {
          regex: '^(astro|vite|react|react-dom)(/.*)?$|^astro:|^@astrojs/',
          message: 'core has no framework imports (spec §5).',
        },
        {
          regex: '^zod(/.*)?$',
          message:
            "core reads site schemas structurally and never loads a second Zod (spec §6.3). Use the structural types in core's schema module.",
        },
        {
          regex: '^@vesper/',
          message: 'core is the bottom of the package graph; it imports no other @vesper package.',
        },
      ],
    },
  ],
  'no-restricted-globals': [
    'error',
    ...['process', 'Buffer', '__dirname', '__filename', 'require', 'global', 'setImmediate'].map(
      (name) => ({
        name,
        message: 'Node-only global: core must also run in browsers and Workers (spec §12).',
      }),
    ),
    ...['window', 'document', 'localStorage', 'sessionStorage'].map((name) => ({
      name,
      message: 'Browser-only global: core must also run in Node and Workers (spec §12).',
    })),
  ],
};

export const astroZodRules = {
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          regex: '^zod(/.*)?$',
          message:
            "Import Zod from 'astro/zod' so it is the same copy Astro uses; otherwise .meta() hints silently disappear (spec §6.3, §12).",
        },
      ],
    },
  ],
};

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/.astro/**',
      '**/node_modules/**',
      'coverage/**',
      // Other sessions' git worktrees: separate checkouts, linted there.
      '.claude/**',
      'playwright-report/**',
      'test-results/**',
      // The studio e2e tests' throwaway copy of the playground.
      'e2e/.studio-site/**',
      // The redirects integration test's copy of the playground.
      'e2e/.move-site/**',
      'e2e/.images-site/**',
      'e2e/.a11y-site/**',
      'e2e/.search-site/**',
      'e2e/.github-site/**',
      'e2e/.github-site-repo.git/**',
      // Byte-exact content fixtures: never linted, never formatted.
      'packages/core/test/corpus/**',
      'packages/core/test/fixtures/**',
      'apps/playground/src/content/**',
      'apps/playground/src/data/**',
      'apps/playground/fixtures/**',
      // Fixture Astro sites: their types come from astro:content, which only exists inside Astro.
      'packages/astro/test/fixtures/**',
      'fixtures/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root-level TypeScript files that no package tsconfig covers are
          // checked with tsconfig.tools.json.
          allowDefaultProject: ['*.config.ts', 'vitest.setup.ts', 'scripts/*.d.mts'],
          defaultProject: 'tsconfig.tools.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Destructuring a key out to drop it (`const { generator: _, ...rest }`) is intended.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // Template literals with numbers and booleans read fine; the strict
      // default flags them.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    // Plain JavaScript (repo scripts, Astro and Markdoc configs) is linted
    // without type information.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    // The playground stands in for a customer's site, and vespercms.com is
    // one. Their types come from `astro sync` (.astro/), which lint doesn't
    // run, so `astro check` type-checks them instead.
    files: ['apps/{playground,site}/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // The studio's React packages: accessibility and hooks rules (spec D11).
    files: ['packages/{ui,admin}/**/*.tsx'],
    extends: [jsxA11y.flatConfigs.strict],
  },
  {
    // Hooks live in .ts files too (load.ts, router.ts).
    files: ['packages/{ui,admin}/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['packages/core/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: coreBoundaryRules,
  },
  {
    files: ['packages/astro/src/**/*.{ts,tsx}'],
    rules: astroZodRules,
  },
);
