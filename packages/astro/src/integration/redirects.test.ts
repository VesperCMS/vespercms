import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Manifest } from '@vesper/core';
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
      const built = await buildRedirects({ root, model, routes, env: {}, existing: {} });
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
