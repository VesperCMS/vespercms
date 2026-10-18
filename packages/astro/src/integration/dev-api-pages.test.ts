import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Manifest } from '@vesper/core';
import { z } from 'astro/zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevApi } from './dev-api.ts';

/*
 * The dev API's page routes (spec §6.15) over a small site on disk: the
 * outline, moves (planned and done), order, section pages and redirects.
 */

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

const files: Record<string, string> = {
  'src/content/pages/index.md': '---\ntitle: Home\n---\n\nSee [Nursing](/academics/nursing/).\n',
  'src/content/pages/academics/index.md': '---\ntitle: Academics\n---\n',
  'src/content/pages/academics/_order.yaml': '- nursing\n- business\n',
  'src/content/pages/academics/nursing/index.md': '---\ntitle: Nursing\n---\n',
  'src/content/pages/academics/nursing/rn-to-bsn.md': '---\ntitle: RN to BSN\n---\n',
  'src/content/pages/academics/business.md': '---\ntitle: Business\n---\n',
  'src/content/pages/admissions/apply.md': '---\ntitle: Apply\n---\n',
};

let root: string;
let server: Server;
let base: string;
const read = (path: string) =>
  existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'vesper-pages-api-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const api = createDevApi({
    root,
    base: '/_vesper/api/',
    model: () =>
      Promise.resolve({
        manifest,
        schemas: new Map([['pages', z.object({ title: z.string() })]]),
        mdxProps: new Map(),
        widgetNames: [],
      }),
    routes: () => new Map([['/contact', 'src/pages/contact.astro']]),
  });
  server = createServer((req, res) => {
    api(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/_vesper/api`;
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

const call = async (path: string, method = 'GET', body?: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'X-Vesper': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

describe('dev API: pages', () => {
  it('serves the outline and every page with a URL', async () => {
    const tree = await call('/tree?collection=pages');
    expect(tree.status).toBe(200);
    const nodes = tree.body.nodes as { slug: string }[];
    expect(nodes.map((n) => n.slug)).toEqual(['', 'academics', 'admissions']);
    const pages = await call('/pages');
    expect((pages.body as unknown as { url: string }[]).map((p) => p.url).sort()).toEqual([
      '/',
      '/academics/',
      '/academics/business/',
      '/academics/nursing/',
      '/academics/nursing/rn-to-bsn/',
      '/admissions/apply/',
    ]);
  });

  it('refuses an address a static route owns, in words, writing nothing', async () => {
    const result = await call('/move', 'POST', {
      collection: 'pages',
      path: 'admissions/apply',
      parent: '',
      slug: 'contact',
    });
    expect(result).toEqual({
      status: 422,
      body: {
        ok: false,
        reason: 'invalid',
        message:
          '/contact/ is already a page on this site that isn’t edited here (src/pages/contact.astro). Choose a different address.',
      },
    });
    expect(read('src/content/pages/admissions/apply.md')).not.toBeNull();
  });

  it('plans a move without writing, then moves the folder on disk', async () => {
    const request = { collection: 'pages', path: 'academics/nursing', parent: '' };
    const plan = await call('/move?dryRun=1', 'POST', request);
    expect(plan.body).toMatchObject({ ok: true, pages: 2, links: 1, redirects: 2 });
    expect(read('src/content/pages/nursing/index.md')).toBeNull();

    const moved = await call('/move', 'POST', request);
    expect(moved.status).toBe(200);
    expect(read('src/content/pages/academics/nursing/index.md')).toBeNull();
    expect(read('src/content/pages/nursing/rn-to-bsn.md')).toBe('---\ntitle: RN to BSN\n---\n');
    expect(read('src/content/pages/academics/_order.yaml')).toBe('- business\n');
    expect(read('src/content/pages/index.md')).toContain('[Nursing](/nursing/)');
    expect(read('vesper.redirects.yaml')).toContain(
      '- { from: /academics/nursing, to: /nursing, status: 301, reason: move, at: ',
    );
  });

  it('reorders, and creates a missing section page', async () => {
    const reordered = await call('/reorder', 'POST', {
      collection: 'pages',
      path: 'admissions',
      direction: 'up',
    });
    expect(reordered.body).toMatchObject({ ok: true, position: { index: 1, of: 3 } });
    expect(read('src/content/pages/_order.yaml')).not.toBeNull();

    const section = await call('/section', 'POST', { collection: 'pages', path: 'admissions' });
    expect(section.body).toMatchObject({ ok: true, id: 'admissions' });
    expect(read('src/content/pages/admissions/index.md')).toBe('---\ntitle: Admissions\n---\n\n');
  });

  it('reads and saves redirects, refusing a stale version', async () => {
    const doc = await call('/redirects');
    expect(doc.status).toBe(200);
    const stale = await call('/redirects', 'PUT', { version: 'old', redirects: [] });
    expect(stale.status).toBe(409);
    const saved = await call('/redirects', 'PUT', {
      version: doc.body.version,
      redirects: [
        ...(doc.body.redirects as unknown[]),
        { from: '/visit', to: '/academics', status: 302 },
      ],
    });
    expect(saved.status).toBe(200);
    expect(read('vesper.redirects.yaml')).toContain(
      '- { from: /visit, to: /academics, status: 302 }',
    );
  });
});
