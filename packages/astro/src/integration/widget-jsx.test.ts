import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { widgetEntries } from './widget-jsx.ts';

const dir = mkdtempSync(join(tmpdir(), 'vesper-widgets-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('widgetEntries', () => {
  it('finds the files vesper.config.ts imports lazily, as absolute POSIX paths', () => {
    const config = join(dir, 'vesper.config.ts');
    writeFileSync(
      config,
      [
        "import { defineConfig } from '@vesper/astro/config';",
        'export default defineConfig({',
        '  widgets: {',
        "    hours: { component: () => import('./src/cms/StoreHours.tsx') },",
        '    rating: { component: () => import("../shared/Rating.jsx") },',
        "    remote: { component: () => import('some-package/widget') },",
        '  },',
        '});',
      ].join('\n'),
    );
    const posix = dir.split('\\').join('/');
    expect(widgetEntries(config)).toEqual([
      `${posix}/src/cms/StoreHours.tsx`,
      `${posix.slice(0, posix.lastIndexOf('/'))}/shared/Rating.jsx`,
    ]);
  });

  it('is empty without a config file', () => {
    expect(widgetEntries(undefined)).toEqual([]);
    expect(widgetEntries(join(dir, 'missing.ts'))).toEqual([]);
  });
});
