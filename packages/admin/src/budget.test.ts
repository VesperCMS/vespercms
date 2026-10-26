import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The spec §10.4 design budget, checked in the studio's source. tokens.css
 * already removes off-budget colours, sizes, weights, radii and shadows from
 * Tailwind; this catches the rest: thick borders, extra font weights, ad hoc
 * shadows, rings and glass, stray colours and arbitrary sizes in class names.
 */

const root = process.cwd();
const roots = ['packages/ui/src', 'packages/admin/src'].map((dir) => join(root, dir));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path);
    return /\.tsx$/.test(entry.name) && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

/** Repo-relative, with forward slashes. */
const name = (file: string) => relative(root, file).split(sep).join('/');

/*
 * Shadows are for overlays, plus four named effects in their named places
 * (DECISIONS.md, "Four named glows, and glass on what floats"). Glass is only
 * for what floats.
 */
const SHADOWS = ['overlay', 'glow-accent', 'glow-selected', 'glass-edge', 'glass-overlay'];
const PLACES: [string, RegExp, string[]][] = [
  [
    'glow-accent: the primary button',
    /\b(shadow-glow-accent|animate-glow-pulse)\b/,
    ['packages/ui/src/components/Button.tsx'],
  ],
  [
    // Not a pane's rows, which are a flat fill (DECISIONS.md, "A pane's current row is a flat fill").
    'glow-selected: the current item in a menu or a choice list',
    /\bshadow-glow-selected\b/,
    ['packages/ui/src/components/choices.tsx', 'packages/ui/src/components/overlays.tsx'],
  ],
  [
    'glass-edge and glass-bar: the top bar and pane headers',
    /\b(shadow-glass-edge|glass-bar)\b/,
    ['packages/admin/src/app/Screen.tsx'],
  ],
  [
    'glass on overlays',
    /\b(glass-raised|shadow-glass-overlay|scrim)\b/,
    ['packages/ui/src/components/overlays.tsx'],
  ],
];

const RULES: [string, RegExp][] = [
  ['hairline (1px) borders only', /\bborder(-[trblxy])?-[2-9]\b/],
  [
    'two font weights (regular and semibold)',
    /\bfont-(thin|extralight|light|medium|bold|extrabold|black)\b/,
  ],
  [
    'shadows only on overlays, plus the named glows',
    new RegExp(String.raw`\bshadow-(?!(${SHADOWS.join('|')})\b)[a-z0-9-]+`),
  ],
  ['rings only as the focus halo (glow-focus)', /\bring-(?!6\b|\(color:--glow-focus\))[a-z0-9([-]/],
  [
    'colours only from the tokens',
    /\b(bg|text|border|outline|ring|shadow|fill|stroke)-\[(#|rgba?\(|hsla?\()/,
  ],
  ['type sizes only from the scale', /\btext-\[\d/],
  [
    // The token scale is 1, 2, 3, 4, 6, 8, 12 and 16 (4px steps); 0.5 nudges a
    // control's inside by 2px, and 10 clears a 40px control.
    'spacing only from the scale',
    /(^|[\s'"`])-?(p|m|gap|space)(-[xy]|[trblxyse])?(-[xy])?-(1\.5|2\.5|3\.5|5|7|9|11|14|20|24|\[)/,
  ],
  ['radii only from the scale', /\brounded(-[trblse]{1,2})?-\[/],
];

function offending(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        pattern.test(line) ? [`${name(file)}:${String(i + 1)}: ${line.trim()}`] : [],
      ),
  );
}

describe('the design budget (spec §10.4)', () => {
  const files = roots.flatMap(sources);

  it('finds the studio’s source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(RULES)('%s', (_rule, pattern) => {
    expect(offending(files, pattern)).toEqual([]);
  });

  it.each(PLACES)('%s, and nowhere else', (_place, pattern, allowed) => {
    const elsewhere = offending(
      files.filter((file) => !allowed.includes(name(file))),
      pattern,
    );
    expect(elsewhere).toEqual([]);
  });

  it('draws every focus outline solid', () => {
    // Tailwind 4's `outline-none` sets the style through --tw-outline-style,
    // which `outline-2` then reuses: without `outline-solid` beside it, the
    // ring has a width and no style, and nothing is drawn.
    const missing = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [...text.matchAll(/(?<![\w\-[\]#.:=])([\w\-[\]#.:=]+):outline-2\b/g)]
        .map((m) => m[1] ?? '')
        .filter((variant) => !text.includes(`${variant}:outline-solid`))
        .map((variant) => `${name(file)}: ${variant}:outline-2`);
    });
    expect(missing).toEqual([]);
  });

  it('gives every duration the properties it animates, in the same state', () => {
    // `transition-property` starts as `all`, so a duration whose state names no
    // properties animates everything, focus rings included (DECISIONS.md,
    // "Transitions never touch focus"). The two sit on one line to be checked.
    const loose = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => {
          const classes = line.split(/[\s'"`]+/);
          return classes
            .map((c) => /^(.*)duration-\d+$/.exec(c)?.[1])
            .filter((state) => state !== undefined)
            .filter(
              (state) =>
                !classes.some(
                  (c) => c === `${state}transition` || c.startsWith(`${state}transition-`),
                ),
            )
            .map((state) => `${name(file)}:${String(i + 1)}: ${state}duration-…`);
        }),
    );
    expect(loose).toEqual([]);
  });

  it('tokens.css declares exactly the named shadows', () => {
    const tokens = readFileSync(join(root, 'packages/ui/src/tokens.css'), 'utf8');
    const declared = [...tokens.matchAll(/^\s*--shadow-([a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...SHADOWS].sort());
  });
});
