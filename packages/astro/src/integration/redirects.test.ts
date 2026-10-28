import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Manifest } from '@vespercms/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SiteModel } from '../node/manifest.ts';
import { buildRedirects, nativeTargets, writeHostRules } from './redirects.ts';

const manifest: Manifest = {
  manifestVersion: 1,
  generator: { name: 'test', version: '0' },
  hash: 'x',
  site: { srcDir: 'src', urls: { base: '/', trailingSlash: 'ignore', buildFormat: 'directory' } },
  collections: [
    {
      name: 'pages',
      label: 'Pages',
      editable: true,
      source: {
        loader: 'glob',
        base: 'src/content/pages',
        pattern: '**/[^_]*.md',
        generateId: 'default',
        formats: ['md'],
      },
      entryKind: 'content',
      fields: [{ path: ['title'], kind: 'string', required: true, label: 'Title' }],
      presentation: { tree: true, url: '/:path' },
    },
  ],
  forms: [],
  diagnostics: [],
};
const model: SiteModel = { manifest, schemas: new Map(), mdxProps: new Map(), widgetNames: [] };
/** The build's instant. */
const NOW = new Date('2026-10-26T16:00:00Z');

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'vesper-redirects-'));
  mkdirSync(join(root, 'src/content/pages/academics'), { recursive: true });
  writeFileSync(join(root, 'src/content/pages/academics/index.md'), '---\ntitle: Academics\n---\n');
  writeFileSync(join(root, 'src/content/pages/about.md'), '---\ntitle: About\n---\n');
  writeFileSync(
    join(root, 'vesper.redirects.yaml'),
    [
      '- { from: /programs, to: /academics-old, status: 301 }',
      '- { from: /academics-old, to: /academics, status: 301 }',
      '- { from: /about, to: /academics, status: 301 }',
      '- { from: /contact-us, to: /contact, status: 302 }',
      '- { from: /mine, to: /about, status: 301 }',
      '',
    ].join('\n'),
  );
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const routes = new Map([['/contact', 'src/pages/contact.astro']]);

describe('buildRedirects', () => {
  it('cleans the file against the site’s pages and hands the rest to Astro', async () => {
    const built = await buildRedirects({
      root,
      model,
      routes,
      env: {},
      existing: { '/mine': '/x' },
      at: NOW,
    });
    expect(built.targets).toEqual([]);
    expect(built.astro).toEqual({
      '/programs': { status: 301, destination: '/academics/' },
      '/academics-old': { status: 301, destination: '/academics/' },
      '/contact-us': { status: 302, destination: '/contact/' },
    });
    expect(built.warnings.map((w) => w.message)).toEqual([
      '/about is a page again, so its redirect to /academics was removed.',
    ]);
  });

  it('leaves URLs a native rule covers to that rule', async () => {
    const built = await buildRedirects({
      root,
      model,
      routes,
      env: { NETLIFY: 'true' },
      existing: {},
      at: NOW,
    });
    expect(built.targets).toEqual(['netlify']);
    expect(built.astro).toEqual({});
    expect(built.redirects.map((r) => r.from)).toEqual([
      '/programs',
      '/academics-old',
      '/contact-us',
      '/mine',
    ]);
  });
});

describe('buildRedirects with scheduled entries', () => {
  const events = {
    ...manifest.collections[0],
    name: 'events',
    label: 'Events',
    source: {
      loader: 'glob' as const,
      base: 'src/content/events',
      pattern: '*.md',
      generateId: 'default' as const,
      formats: ['md'],
    },
    presentation: {
      url: '/events/:id',
      schedule: {
        unpublish: true,
        publishAt: 'publishAt',
        unpublishAt: 'unpublishAt',
        unpublishRedirect: 'unpublishRedirect',
      },
    },
  };
  const scheduled: SiteModel = {
    ...model,
    manifest: { ...manifest, collections: [manifest.collections[0], events] as never },
  };
  let site: string;
  beforeAll(() => {
    site = mkdtempSync(join(tmpdir(), 'vesper-unpublish-'));
    mkdirSync(join(site, 'src/content/events'), { recursive: true });
    mkdirSync(join(site, 'src/content/pages'), { recursive: true });
    writeFileSync(join(site, 'src/content/pages/calendar.md'), '---\ntitle: Calendar\n---\n');
    writeFileSync(join(site, 'src/content/pages/index.md'), '---\ntitle: Home\n---\n');
    const event = (name: string, lines: string[]) => {
      writeFileSync(
        join(site, `src/content/events/${name}.md`),
        ['---', `title: ${name}`, ...lines, '---', ''].join('\n'),
      );
    };
    event('open-house', [
      'unpublishAt: 2026-10-25T00:00:00-04:00',
      'unpublishRedirect: /calendar/',
    ]);
    event('orientation', [
      'unpublishAt: 2026-07-16T00:00:00-04:00',
      'unpublishRedirect: /calendar/',
    ]);
    event('lecture', ['unpublishAt: 2026-11-13T00:00:00-05:00', 'unpublishRedirect: /calendar/']);
    event('concert', ['publishAt: 2026-10-31T08:00:00-04:00']);
    // The file's own redirect for an address an unpublished entry also redirects.
    writeFileSync(
      join(site, 'vesper.redirects.yaml'),
      '- { from: /events/orientation, to: /, status: 301 }\n- { from: /concert, to: /events/concert, status: 302 }\n',
    );
  });
  afterAll(() => {
    rmSync(site, { recursive: true, force: true });
  });

  it('adds a temporary redirect for each unpublished entry, and lets the file win', async () => {
    const built = await buildRedirects({
      root: site,
      model: scheduled,
      routes: new Map(),
      env: {},
      existing: {},
      at: NOW,
    });
    expect(built.astro).toEqual({
      '/events/open-house': { status: 302, destination: '/calendar/' },
      '/events/orientation': { status: 301, destination: '/' },
      '/concert': { status: 302, destination: '/events/concert/' },
    });
    expect(built.redirects[0]).toMatchObject({ from: '/events/open-house', reason: 'unpublish' });
    expect(built.warnings.map((w) => w.message)).toEqual([
      '/events/orientation/ is unpublished and asks to send visitors to /calendar/, but vesper.redirects.yaml has a redirect from it too, which is used instead.',
      // A page that isn't live yet isn't one of the build's pages.
      '/concert redirects to /events/concert, which isn’t a page on this site.',
    ]);
  });

  it('writes an unpublished entry’s redirect into each host’s rules, temporarily', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'vesper-dist-'));
    try {
      const built = await buildRedirects({
        root: site,
        model: scheduled,
        routes: new Map(),
        env: { NETLIFY: 'true' },
        existing: {},
        at: NOW,
      });
      // Netlify's rule carries it, so Astro writes no page for it.
      expect(built.astro).toEqual({});
      writeHostRules(
        dist,
        { ...built, targets: ['apache', 'netlify'] },
        { base: '/', trailingSlash: 'ignore', buildFormat: 'directory' },
      );
      expect(readFileSync(join(dist, '.htaccess'), 'utf8')).toContain(
        'RedirectMatch 302 ^/events/open-house/?$ /calendar/',
      );
      expect(readFileSync(join(dist, '_redirects'), 'utf8')).toContain(
        '/events/open-house /calendar/ 302!',
      );
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('adds nothing for an entry that’s still live, and redirects it once it isn’t', async () => {
    const later = await buildRedirects({
      root: site,
      model: scheduled,
      routes: new Map(),
      env: {},
      existing: {},
      at: new Date('2026-11-13T05:00:00Z'),
    });
    expect(Object.keys(later.astro)).toContain('/events/lecture');
    const earlier = await buildRedirects({
      root: site,
      model: scheduled,
      routes: new Map(),
      env: {},
      existing: {},
      at: new Date('2026-07-01T00:00:00Z'),
    });
    expect(Object.keys(earlier.astro)).toEqual(['/concert']);
  });
});

describe('nativeTargets', () => {
  it('detects hosts from the build environment and adds configured ones', () => {
    expect(nativeTargets({ CF_PAGES: '1' }, ['apache'])).toEqual(['apache', 'cloudflare']);
    expect(nativeTargets({ VERCEL: '1', NETLIFY: 'false' })).toEqual(['vercel']);
    expect(nativeTargets({})).toEqual([]);
  });
});

describe('writeHostRules', () => {
  it('merges each host’s rules into dist, keeping the site’s own lines', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'vesper-dist-'));
    try {
      writeFileSync(join(dist, '.htaccess'), 'ErrorDocument 404 /404.html\n');
      const built = await buildRedirects({ root, model, routes, env: {}, existing: {}, at: NOW });
      const written = writeHostRules(
        dist,
        { ...built, targets: ['apache', 'netlify', 'nginx'] },
        { base: '/', trailingSlash: 'ignore', buildFormat: 'directory' },
      );
      expect(written).toEqual([
        '.htaccess',
        '_redirects',
        '_vesper/nginx-redirects.conf',
        '_vesper/redirects.json',
      ]);
      expect(readFileSync(join(dist, '.htaccess'), 'utf8')).toBe(
        [
          'ErrorDocument 404 /404.html',
          '# BEGIN vesper',
          '# Written by Vesper from vesper.redirects.yaml. Edits here are replaced.',
          'RedirectMatch 301 ^/programs/?$ /academics/',
          'RedirectMatch 301 ^/academics-old/?$ /academics/',
          'RedirectMatch 302 ^/contact-us/?$ /contact/',
          'RedirectMatch 301 ^/mine/?$ /about/',
          '# END vesper',
          '',
        ].join('\n'),
      );
      expect(readFileSync(join(dist, '_redirects'), 'utf8')).toContain(
        '/programs /academics/ 301!',
      );
      expect(existsSync(join(dist, '_vesper/nginx-redirects.conf'))).toBe(true);
      const list = JSON.parse(
        readFileSync(join(dist, '_vesper/redirects.json'), 'utf8'),
      ) as unknown[];
      expect(list[0]).toEqual({
        from: '/programs',
        to: '/academics/',
        status: 301,
        key: '/programs',
      });
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
