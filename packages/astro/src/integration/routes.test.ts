import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { routeFor, staticRoutesFromFiles, staticRoutesOf, type ResolvedRoute } from './routes.ts';

/** Routes shaped as Astro 7.4's `astro:routes:resolved` gives them for the playground. */
const route = (
  pattern: string,
  entrypoint: string,
  patternRegex: RegExp,
  params: string[] = [],
  extra: Partial<ResolvedRoute> = {},
): ResolvedRoute => ({
  pattern,
  entrypoint,
  patternRegex,
  params,
  type: 'page',
  origin: 'project',
  ...extra,
});

const routes: ResolvedRoute[] = [
  route('/admin', 'node_modules/vespercms/pages/admin.astro', /^\/admin\/?$/, [], {
    origin: 'external',
  }),
  route('/contact', 'src/pages/contact.astro', /^\/contact\/?$/),
  route('/site-tree.json', 'src/pages/site-tree.json.ts', /^\/site-tree\.json\/?$/, [], {
    type: 'endpoint',
  }),
  route('/blog/[...slug]', 'src/pages/blog/[...slug].astro', /^\/blog(?:\/(.*?))?\/?$/, [
    '...slug',
  ]),
  route('/programs/nursing', 'src/pages/programs/nursing', /^\/programs\/nursing\/?$/, [], {
    type: 'redirect',
  }),
  route('/', 'src/pages/index.astro', /^\/$/),
  route('/[...path]', 'src/pages/[...path].astro', /^(?:\/(.*?))?\/?$/, ['...path']),
];

describe('staticRoutesOf', () => {
  it('keeps the project’s own pages and endpoints with no parameters', () => {
    expect([...staticRoutesOf(routes, '/site')]).toEqual([
      ['/contact', 'src/pages/contact.astro'],
      ['/site-tree.json', 'src/pages/site-tree.json.ts'],
      ['/', 'src/pages/index.astro'],
    ]);
  });
});

describe('staticRoutesFromFiles', () => {
  const root = mkdtempSync(join(tmpdir(), 'vesper-routes-'));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the same from src/pages before Astro resolves its routes', () => {
    for (const file of [
      'index.astro',
      'contact.astro',
      'site-tree.json.ts',
      'blog/index.astro',
      'blog/[...slug].astro',
      '_partials/note.astro',
      'about/team.md',
    ]) {
      mkdirSync(join(root, 'src/pages', file, '..'), { recursive: true });
      writeFileSync(join(root, 'src/pages', file), '');
    }
    expect([...staticRoutesFromFiles(root, 'src')].sort()).toEqual([
      ['/', 'src/pages/index.astro'],
      ['/about/team', 'src/pages/about/team.md'],
      ['/blog', 'src/pages/blog/index.astro'],
      ['/contact', 'src/pages/contact.astro'],
      ['/site-tree.json', 'src/pages/site-tree.json.ts'],
    ]);
  });
});

describe('routeFor', () => {
  it('finds the route that renders a collection, in Astro’s priority order', () => {
    expect(routeFor(routes, ['/blog/welcome/', '/blog/2026/winter-market/'], '/site')).toEqual({
      route: { pattern: '/blog/[...slug]', entrypoint: 'src/pages/blog/[...slug].astro' },
      unmatched: [],
    });
    expect(routeFor(routes, ['/academics/', '/'], '/site').route?.pattern).toBe('/[...path]');
  });

  it('lists URLs no route can produce', () => {
    expect(routeFor(routes.slice(0, 4), ['/academics/nursing/'], '/site')).toEqual({
      unmatched: ['/academics/nursing/'],
    });
  });
});
