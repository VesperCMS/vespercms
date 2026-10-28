import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * Phase 2.9's build criteria (spec §11): the index holds pages from every
 * searchable collection, with their titles, sections, tags and thumbnails,
 * and never hidden, draft-file or scheduled entries. Search works from
 * dist/ (the e2e suite searches it on the plain static server).
 *
 * A copy of the playground gains an event scheduled for 2099 (the
 * playground's own scheduled events will have gone live by the time this
 * runs again) and a page that asks robots not to index it. It's built as
 * is, then again with `base: '/sub/'`, a `site` and no /search page of its
 * own, for base-prefixed URLs, opensearch.xml and the injected page, and
 * last with no <Search> in its layout.
 */

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const playground = join(repo, 'apps', 'playground');
const site = join(repo, 'e2e', '.search-site');
const SKIP = new Set(['node_modules', 'dist', '.astro', '.vesper']);

/** The environment a site builds in, without Vitest's variables (DECISIONS.md). */
function siteEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(VITEST.*|NODE_ENV|DEV|PROD|MODE|SSR|BASE_URL|TEST)$/.test(key),
    ),
  );
}

function astroBuild(): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      '--conditions=@vesper/source',
      join(repo, 'node_modules/astro/bin/astro.mjs'),
      'build',
      '--root',
      site,
    ],
    { cwd: repo, encoding: 'utf8', env: siteEnv() },
  );
}

type Fragment = {
  url: string;
  meta: Record<string, string>;
  filters: Record<string, string[]>;
};

/**
 * Every page in the index, by URL: Pagefind's fragments are gzipped JSON.
 * Empty when there's no index, so a failed build shows its own error.
 */
function readIndex(dist: string): Map<string, Fragment> {
  const folder = join(dist, '_vesper/search/fragment');
  const pages = new Map<string, Fragment>();
  if (!existsSync(folder)) return pages;
  for (const file of readdirSync(folder)) {
    const text = gunzipSync(readFileSync(join(folder, file)))
      .toString('utf8')
      .replace(/^pagefind_dcd/, '');
    const fragment = JSON.parse(text) as Fragment;
    pages.set(fragment.url, fragment);
  }
  return pages;
}

let first: SpawnSyncReturns<string>;
let firstIndex: Map<string, Fragment>;
let firstFiles: string[];
let deployed: string;
let firstOpenSearch: boolean;
let thumbnail: { width?: number; height?: number; format?: string };
let second: SpawnSyncReturns<string>;
let secondIndex: Map<string, Fragment>;

beforeAll(async () => {
  rmSync(site, { recursive: true, force: true });
  cpSync(playground, site, {
    recursive: true,
    filter: (path) => !path.split(/[\\/]/).some((part) => SKIP.has(part)),
  });
  writeFileSync(
    join(site, 'src/content/events/far-future.md'),
    '---\ntitle: The far future\nsummary: Scheduled long after this test.\nstartsAt: 2099-06-01T10:00:00-04:00\npublishAt: 2099-01-01T08:00:00-05:00\n---\n\nNot yet.\n',
  );
  writeFileSync(
    join(site, 'src/pages/noindexed.astro'),
    '---\n---\n<html lang="en"><head><meta name="robots" content="noindex"><title>Not for search</title></head><body><main><h1>Not for search</h1></main></body></html>\n',
  );
  first = astroBuild();
  const dist = join(site, 'dist');
  firstIndex = readIndex(dist);
  firstFiles = existsSync(join(dist, '_vesper/search'))
    ? readdirSync(join(dist, '_vesper/search'))
    : [];
  deployed = readFileSync(join(dist, 'blog/harbor-at-dawn/index.html'), 'utf8');
  firstOpenSearch = existsSync(join(dist, 'opensearch.xml'));
  const harbor = firstIndex.get('/blog/harbor-at-dawn/');
  // Read into memory: given a path, sharp keeps the file open on Windows,
  // and the second build couldn't empty dist/.
  thumbnail = harbor?.meta.thumbnail
    ? await sharp(readFileSync(join(dist, harbor.meta.thumbnail))).metadata()
    : {};

  const config = join(site, 'astro.config.mjs');
  const text = readFileSync(config, 'utf8');
  if (!text.includes('export default defineConfig({'))
    throw new Error('astro.config.mjs no longer calls defineConfig({');
  writeFileSync(
    config,
    text.replace(
      'export default defineConfig({',
      "export default defineConfig({\n  base: '/sub/',\n  site: 'https://example.edu',",
    ),
  );
  rmSync(join(site, 'src/pages/search.astro'));
  second = astroBuild();
  secondIndex = readIndex(dist);
}, 400_000);

afterAll(() => {
  rmSync(site, { recursive: true, force: true });
});

describe('the search index at build', () => {
  it('builds, and says what it indexed and what a first search weighs', () => {
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toMatch(
      /Search: indexed \d+ pages in 1 language, \d+ KB of index\. A first search loads \d+ KB\./,
    );
    expect(first.stdout).not.toMatch(/over the 300 KB budget/);
  });

  it('holds pages from every searchable collection, and the site’s own pages', () => {
    for (const url of [
      '/blog/harbor-at-dawn/',
      '/academics/nursing/',
      '/docs/getting-started/',
      '/events/nursing-info-session/',
      '/',
      '/contact/',
    ])
      expect(firstIndex.has(url), url).toBe(true);
  });

  it('gives each entry its title, Section, tags, date and a square thumbnail', () => {
    const harbor = firstIndex.get('/blog/harbor-at-dawn/');
    expect(harbor?.meta).toMatchObject({
      title: 'Harbor at dawn',
      date: 'September 14, 2026',
      datetime: '2026-09-14',
    });
    expect(harbor?.filters).toMatchObject({
      Section: ['Blog posts'],
      Tags: expect.arrayContaining(['harbor', 'photography']) as unknown,
    });
    expect(harbor?.meta.thumbnail).toMatch(/^\/_vesper\/search\/images\/[0-9a-f]{16}\.webp$/);
    expect(thumbnail).toMatchObject({ width: 128, height: 128, format: 'webp' });
    expect(firstIndex.get('/events/nursing-info-session/')?.filters).toEqual({
      Section: ['Events'],
    });
    // Static pages have no section.
    expect(firstIndex.get('/contact/')?.filters).toEqual({});
  });

  it('never holds hidden, scheduled, unpublished, unsearched or noindex pages', () => {
    for (const url of [
      '/contact-thanks/',
      '/events/far-future/',
      '/events/summer-orientation/',
      '/fixtures/accessibility-mistakes/',
      '/noindexed/',
      '/search/',
      '/admin/',
      '/404',
    ])
      expect(firstIndex.has(url), url).toBe(false);
    // Draft files never become pages at all.
    expect([...firstIndex.keys()].some((url) => url.includes('unpublished-idea'))).toBe(false);
  });

  it('writes only what <Search> loads, and never changes a deployed page', () => {
    expect(firstFiles).toContain('pagefind.js');
    expect(firstFiles.filter((file) => /ui|highlight/.test(file))).toEqual([]);
    expect(deployed).not.toContain('data-pagefind-meta');
    expect(deployed).not.toContain('data-pagefind-body');
    // Without Astro's `site` there's no absolute URL for it.
    expect(firstOpenSearch).toBe(false);
  });
});

describe('the search index under a base, with a site', () => {
  it('prefixes every result and the bundle with the base', () => {
    expect(second.status, second.stderr).toBe(0);
    expect(secondIndex.size).toBe(firstIndex.size);
    for (const url of secondIndex.keys()) expect(url.startsWith('/sub/'), url).toBe(true);
    expect(secondIndex.get('/sub/blog/harbor-at-dawn/')?.meta.thumbnail).toMatch(
      /^\/sub\/_vesper\/search\/images\//,
    );
    const home = readFileSync(join(site, 'dist/index.html'), 'utf8');
    expect(home).toContain('&quot;bundle&quot;:&quot;/sub/_vesper/search/&quot;');
    expect(home).toContain('href="/sub/search/"');
  });

  it('injects a plain /search page when the site has none, kept out of search engines', () => {
    const page = readFileSync(join(site, 'dist/search/index.html'), 'utf8');
    expect(page).toContain('data-vesper-search="inline"');
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(page).toContain('<noscript>');
  });

  it('writes opensearch.xml, and <SearchHead> links it under the site’s name', () => {
    expect(readFileSync(join(site, 'dist/opensearch.xml'), 'utf8')).toContain(
      'template="https://example.edu/sub/search/?q={searchTerms}"',
    );
    expect(readFileSync(join(site, 'dist/index.html'), 'utf8')).toContain(
      '<link rel="search" type="application/opensearchdescription+xml" title="example.edu" href="/sub/opensearch.xml">',
    );
  });
});

/*
 * The injected /search page renders <Search variant="inline"> itself, so
 * once counted as the site using search, and every site was indexed.
 */
describe('a site with no <Search> of its own', () => {
  let third: SpawnSyncReturns<string>;
  beforeAll(() => {
    const layout = join(site, 'src/layouts/BaseLayout.astro');
    const text = readFileSync(layout, 'utf8');
    const uses = [
      "import { Search, SearchHead } from 'vespercms/components';\n",
      '<SearchHead />',
      '<Search />',
    ];
    for (const use of uses)
      if (!text.includes(use)) throw new Error(`BaseLayout.astro no longer has ${use.trim()}`);
    writeFileSync(
      layout,
      uses.reduce((source, use) => source.replace(use, ''), text),
    );
    third = astroBuild();
  }, 200_000);

  it('builds no index, and leaves out the /search page and opensearch.xml', () => {
    expect(third.status, third.stderr).toBe(0);
    expect(third.stdout).toContain(
      'Search: no page uses <Search>, so no index was built and the /search page was left out.',
    );
    const dist = join(site, 'dist');
    expect(existsSync(join(dist, '_vesper/search'))).toBe(false);
    expect(existsSync(join(dist, 'search'))).toBe(false);
    expect(existsSync(join(dist, 'opensearch.xml'))).toBe(false);
  });
});
