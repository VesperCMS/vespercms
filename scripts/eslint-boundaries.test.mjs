// Proves the package-boundary lint rules in eslint.config.js actually fire.
// A misspelled rule name or glob would otherwise fail silently and let
// Node or framework imports into @vesper/core.
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// The probe files don't exist on disk, so type-aware rules can't run on them.
// The boundary rules don't need type information.
const eslint = new ESLint({ overrideConfig: [tseslint.configs.disableTypeChecked] });

async function ruleIdsFor(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((message) => message.ruleId);
}

const CORE_FILE = 'packages/core/src/__boundary-probe.ts';

describe('@vesper/core import boundary', () => {
  it.each([
    ["import { readFile } from 'node:fs/promises';", 'node: builtins'],
    ["import path from 'path';", 'bare Node builtins'],
    ["import { z } from 'zod';", 'zod'],
    ["import { z } from 'astro/zod';", 'astro subpaths'],
    ["import { getCollection } from 'astro:content';", 'astro virtual modules'],
    ["import mdx from '@astrojs/mdx';", '@astrojs packages'],
    ["import { createServer } from 'vite';", 'vite'],
    ["import { useState } from 'react';", 'react'],
    ["import { x } from '@vesper/astro';", 'other @vesper packages'],
  ])('rejects %s (%s)', async (code) => {
    const ruleIds = await ruleIdsFor(`${code}\nexport {};\n`, CORE_FILE);
    expect(ruleIds).toContain('@typescript-eslint/no-restricted-imports');
  });

  it.each(['process.env.X', 'Buffer.from("x")', 'window.location', 'localStorage.getItem("x")'])(
    'rejects the global in %s',
    async (expression) => {
      const ruleIds = await ruleIdsFor(`export const value = ${expression};\n`, CORE_FILE);
      expect(ruleIds).toContain('no-restricted-globals');
    },
  );

  it('allows relative imports and platform APIs', async () => {
    const code = [
      "import { MANIFEST_VERSION } from './index.ts';",
      'export const bytes = new TextEncoder().encode(String(MANIFEST_VERSION));',
      '',
    ].join('\n');
    const ruleIds = await ruleIdsFor(code, CORE_FILE);
    expect(ruleIds).not.toContain('@typescript-eslint/no-restricted-imports');
    expect(ruleIds).not.toContain('no-restricted-globals');
  });

  it('leaves core tests free to read fixtures from disk', async () => {
    const ruleIds = await ruleIdsFor(
      "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n",
      'packages/core/src/__boundary-probe.test.ts',
    );
    expect(ruleIds).not.toContain('@typescript-eslint/no-restricted-imports');
  });
});

describe('@vesper/astro Zod import', () => {
  it('rejects zod and allows astro/zod', async () => {
    const file = 'packages/astro/src/__boundary-probe.ts';
    expect(await ruleIdsFor("import { z } from 'zod';\nexport { z };\n", file)).toContain(
      '@typescript-eslint/no-restricted-imports',
    );
    expect(await ruleIdsFor("import { z } from 'astro/zod';\nexport { z };\n", file)).not.toContain(
      '@typescript-eslint/no-restricted-imports',
    );
  });
});
