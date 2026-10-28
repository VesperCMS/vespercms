import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ContentService, PageService, type TreeHooks } from '@vespercms/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { staticRoutesFromFiles } from '../src/integration/routes.ts';
import { loadSiteModel } from '../src/node/manifest.ts';
import { LocalStorage } from '../src/node/storage-local.ts';

/*
 * Phase 2.6's second "Done when" (spec §11): the built site serves every
 * old URL as a redirect to the new one, with no chains.
 *
 * A copy of the playground (at the playground's depth, so its relative
 * imports resolve) has Nursing and its three pages moved to the top level
 * exactly as the studio does it: PageService over LocalStorage, one change
 * set. Then `astro build` runs on the copy, and dist/ is served by
 * scripts/static-server.mjs, the plain host with no rewrites. Every old URL,
 * the four moved pages and the file's own chain, must reach its page in one
 * Vesper hop, and that page must be a real page, not another redirect.
 */

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const playground = join(repo, 'apps', 'playground');
const site = join(repo, 'e2e', '.move-site');
const SKIP = new Set(['node_modules', 'dist', '.astro', '.vesper']);

let server: Server | undefined;
let origin = '';

beforeAll(() => {
  rmSync(site, { recursive: true, force: true });
  cpSync(playground, site, {
    recursive: true,
    filter: (path) => !path.split(/[\\/]/).some((part) => SKIP.has(part)),
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (server)
      server.close(() => {
        resolve();
      });
    else resolve();
  });
  rmSync(site, { recursive: true, force: true });
});

/** What a visitor's browser gets at `path`: the host's own slash redirect, then the page. */
async function visit(path: string): Promise<{ status: number; url: string; html: string }> {
  let url = path;
  for (let hops = 0; hops < 3; hops++) {
    const response = await fetch(origin + url, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status === 301 && location === `${url}/`) {
      url = location;
      continue;
    }
    return { status: response.status, url, html: await response.text() };
  }
  throw new Error(`${path} redirected too often`);
}

const refreshTarget = (html: string) =>
  /<meta http-equiv="refresh" content="\d+;url=([^"]+)">/.exec(html)?.[1] ?? null;

describe('moving a section, then building', () => {
  it('serves every old URL as one redirect to a real page', { timeout: 300_000 }, async () => {
    const model = await loadSiteModel({
      root: site,
      srcDir: 'src',
      urls: { base: '/', trailingSlash: 'ignore', buildFormat: 'directory' },
    });
    const storage = new LocalStorage(site);
    const content: ContentService = new ContentService(storage, model.manifest, {
      tree: (): TreeHooks => pages.hooks(),
    });
    const pages: PageService = new PageService(storage, model.manifest, content, {
      routes: () => staticRoutesFromFiles(site, 'src'),
    });
    const moved = await pages.move({ collection: 'pages', path: 'academics/nursing', parent: '' });
    expect(moved).toMatchObject({ ok: true, pages: 4, links: 8, redirects: 4 });

    const build = spawnSync(
      process.execPath,
      [
        '--conditions=@vesper/source',
        join(repo, 'node_modules/astro/bin/astro.mjs'),
        'build',
        '--root',
        site,
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    expect(build.status, build.stderr || build.stdout).toBe(0);
    expect(existsSync(join(site, 'dist', 'nursing', 'index.html'))).toBe(true);

    const { createStaticServer } = (await import(
      pathToFileURL(join(repo, 'scripts', 'static-server.mjs')).href
    )) as { createStaticServer: (options: { root: string }) => Server };
    server = createStaticServer({ root: join(site, 'dist') });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

    const expected: Record<string, string> = {
      '/academics/nursing': '/nursing/',
      '/academics/nursing/clinical-placements': '/nursing/clinical-placements/',
      '/academics/nursing/clinical-placements/partner-hospitals':
        '/nursing/clinical-placements/partner-hospitals/',
      '/academics/nursing/rn-to-bsn': '/nursing/rn-to-bsn/',
      // The file's own chain now ends at the moved page, in one hop.
      '/programs/nursing': '/nursing/',
      '/academics/nursing-old': '/nursing/',
      '/apply-now': '/admissions/apply/',
    };
    for (const [old, target] of Object.entries(expected)) {
      const page = await visit(old);
      expect(page.status, old).toBe(200);
      expect(refreshTarget(page.html), old).toBe(target);
      const landing = await visit(target);
      expect(landing.status, target).toBe(200);
      expect(
        refreshTarget(landing.html),
        `${target} is a real page, not another redirect`,
      ).toBeNull();
      expect(landing.url).toBe(target);
    }

    // Every redirect the build wrote is one of these, or an unpublished event's
    // (the playground builds as of 26 October 2026), and the moved page's links point at it.
    const written = JSON.parse(
      readFileSync(join(site, 'dist', '_vesper', 'redirects.json'), 'utf8'),
    ) as { key: string; to: string }[];
    expect(Object.fromEntries(written.map((r) => [r.key, r.to]))).toEqual({
      ...expected,
      '/events/fall-open-house': '/events/',
      '/events/summer-orientation': '/admissions/apply/',
    });
    const academics = await visit('/academics/');
    expect(academics.html).toContain('href="/nursing/"');
    expect(academics.html).not.toContain('href="/academics/nursing/"');
  });
});
