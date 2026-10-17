import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The spec §10.4 design budget, checked in the studio's source. tokens.css
 * already removes off-budget colours, weights and shadows from Tailwind; this
 * catches the rest: thick borders, extra font weights, ad hoc shadows and
 * stray hex colours in class names.
 */

const roots = ['packages/ui/src', 'packages/admin/src'].map((dir) => join(process.cwd(), dir));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path);
    return /\.tsx$/.test(entry.name) && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

const RULES: [string, RegExp][] = [
  ['hairline (1px) borders only', /\bborder(-[trblxy])?-[2-9]\b/],
  [
    'two font weights (regular and semibold)',
    /\bfont-(thin|extralight|light|medium|bold|extrabold|black)\b/,
  ],
  ['shadows only on overlays (shadow-overlay)', /\bshadow-(?!overlay\b)[a-z0-9]+/],
  ['colours only from the tokens', /\b(bg|text|border|outline)-\[#/],
];

describe('the design budget (spec §10.4)', () => {
  const files = roots.flatMap(sources);

  it('finds the studio’s source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(RULES)('%s', (_rule, pattern) => {
    const offending = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          pattern.test(line) ? [`${file}:${String(i + 1)}: ${line.trim()}`] : [],
        ),
    );
    expect(offending).toEqual([]);
  });
});
