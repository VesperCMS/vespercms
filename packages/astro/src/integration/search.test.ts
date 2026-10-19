import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  annotateHtml,
  hasNoindex,
  indexSearch,
  indexSize,
  openSearchXml,
  pageLanguage,
  searchFile,
} from './search.ts';

const page = (main = '<main id="main">Hi</main>') =>
  `<!doctype html><html lang="en"><head><title>T</title></head><body><header>Site</header>${main}</body></html>`;

describe('the copy of a page Pagefind reads', () => {
  it('marks the first <main> as the content, and writes the annotations into <head>', () => {
    const html = annotateHtml(
      page(),
      {
        title: 'Harbor "at" dawn',
        date: { text: 'August 22, 2026', iso: '2026-08-22' },
        filters: [
          ['Section', ['Blog posts']],
          ['Tags', ['a&b', 'c']],
        ],
        sort: [['publishedAt', '2026-08-22T00:00:00.000Z']],
      },
      { body: true, thumbnail: '/_vesper/search/images/abc.webp' },
    );
    expect(html).toBe(
      '<!doctype html><html lang="en"><head><title>T</title>' +
        '<meta data-pagefind-meta="title[content]" content="Harbor &quot;at&quot; dawn">' +
        '<meta data-pagefind-meta="date[content]" content="August 22, 2026">' +
        '<meta data-pagefind-meta="datetime[content]" content="2026-08-22">' +
        '<meta data-pagefind-filter="Section[content]" content="Blog posts">' +
        '<meta data-pagefind-filter="Tags[content]" content="a&amp;b">' +
        '<meta data-pagefind-filter="Tags[content]" content="c">' +
        '<meta data-pagefind-sort="publishedAt[content]" content="2026-08-22T00:00:00.000Z">' +
        '<meta data-pagefind-meta="thumbnail[content]" content="/_vesper/search/images/abc.webp">' +
        '</head><body><header>Site</header><main data-pagefind-body id="main">Hi</main></body></html>',
    );
  });

  it('marks <body> on a page with no <main>, and nothing when the site marks its own', () => {
    expect(annotateHtml(page('<div>Hi</div>'), null, { body: true })).toContain(
      '<body data-pagefind-body>',
    );
    expect(annotateHtml(page(), null, { body: false })).toBe(page());
  });

  it('keeps filter names Pagefind can read', () => {
    const html = annotateHtml(
      page(),
      { title: 'T', filters: [['Kind: [a]', ['x']]], sort: [] },
      {
        body: false,
      },
    );
    expect(html).toContain('data-pagefind-filter="Kind a[content]" content="x"');
  });
});

describe('what the indexer reads from a page', () => {
  it('finds noindex in a robots meta, in either attribute order', () => {
    expect(hasNoindex('<meta name="robots" content="noindex, follow">')).toBe(true);
    expect(hasNoindex("<meta content='noindex' name='robots'>")).toBe(true);
    expect(hasNoindex('<meta name="description" content="noindex">')).toBe(false);
  });

  it('reads the page’s language', () => {
    expect(pageLanguage('<html lang="es-MX" class="x">')).toBe('es-MX');
    expect(pageLanguage('<html>')).toBe('en');
  });
});

describe('opensearch.xml', () => {
  it('points browsers at /search with an absolute template', () => {
    expect(
      openSearchXml({
        siteName: 'Highlands Community College',
        site: 'https://example.edu',
        searchPage: '/sub/search/',
      }),
    ).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
        '  <ShortName>Highlands Commun</ShortName>',
        '  <Description>Search Highlands Community College</Description>',
        '  <InputEncoding>UTF-8</InputEncoding>',
        '  <Url type="text/html" method="get" template="https://example.edu/sub/search/?q={searchTerms}"/>',
        '</OpenSearchDescription>',
        '',
      ].join('\n'),
    );
  });
});

describe('the index on disk', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function bundle(): string {
    const dist = mkdtempSync(join(tmpdir(), 'vesper-search-'));
    dirs.push(dist);
    const out = join(dist, '_vesper/search');
    mkdirSync(join(out, 'index'), { recursive: true });
    mkdirSync(join(out, 'fragment'), { recursive: true });
    const file = (path: string, bytes: number) => {
      writeFileSync(join(out, path), 'x'.repeat(bytes));
    };
    writeFileSync(
      join(out, 'pagefind-entry.json'),
      JSON.stringify({
        version: '1.5.2',
        languages: {
          en: { hash: 'en_1', wasm: 'en', page_count: 30 },
          fr: { hash: 'fr_1', wasm: 'fr', page_count: 2 },
        },
      }),
    );
    file('pagefind.js', 100);
    file('pagefind-worker.js', 50);
    file('wasm.en.pagefind', 700);
    file('wasm.fr.pagefind', 600);
    file('pagefind.en_1.pf_meta', 10);
    file('pagefind.fr_1.pf_meta', 5);
    file('index/en_a.pf_index', 30);
    file('index/en_b.pf_index', 40);
    file('index/fr_a.pf_index', 200);
    file('fragment/en_a.pf_fragment', 20);
    return dist;
  }

  it('weighs a first search by the heaviest language', () => {
    expect(indexSize(join(bundle(), '_vesper/search'))).toEqual({
      pages: 32,
      languages: 2,
      // The chunks and each language's metadata.
      index: 30 + 40 + 200 + 20 + 10 + 5,
      // The script and worker, then French: 600 + 5 + 200 beats English's 700 + 10 + 40.
      firstQuery: 100 + 50 + 600 + 5 + 200,
    });
  });

  it('serves files from the index in dev, and nothing outside it', () => {
    const dist = bundle();
    expect(searchFile(dist, 'pagefind.js')).toBe(join(dist, '_vesper/search/pagefind.js'));
    expect(searchFile(dist, 'index/en_a.pf_index')).not.toBeNull();
    expect(searchFile(dist, '../../etc/passwd')).toBeNull();
    expect(searchFile(dist, 'index')).toBeNull();
    expect(searchFile(dist, 'missing.js')).toBeNull();
  });
});

describe('indexing a build', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const model = {
    manifest: {
      manifestVersion: 1,
      generator: { name: 'test', version: '0' },
      hash: '',
      site: { srcDir: 'src' },
      collections: [],
      forms: [],
      diagnostics: [],
    },
    schemas: new Map(),
    mdxProps: new Map(),
    widgetNames: [],
  } as const;
  const settings = { base: '/', trailingSlash: 'ignore', buildFormat: 'directory' } as const;
  const searchBox = '<div data-vesper-search="dialog"></div>';

  function site(pages: Record<string, string>): { root: string; dist: string } {
    const root = mkdtempSync(join(tmpdir(), 'vesper-index-'));
    dirs.push(root);
    const dist = join(root, 'dist');
    for (const [file, html] of Object.entries(pages)) {
      mkdirSync(join(dist, file, '..'), { recursive: true });
      writeFileSync(join(dist, file), html);
    }
    return { root, dist };
  }
  const index = (where: { root: string; dist: string }, extra = {}) =>
    indexSearch({
      ...where,
      model: { ...model, manifest: { ...model.manifest } } as never,
      settings,
      routes: () => new Map(),
      search: {},
      ...extra,
    });

  it('builds nothing when no page uses <Search>, and says how to add it', async () => {
    const where = site({ 'index.html': page() });
    const result = await index(where);
    expect(result).toEqual({
      built: false,
      warnings: [],
      info: [
        'Search: no page uses <Search>, so no index was built. Add <Search /> from @vesper/astro/components to a layout, or set vesper({ search: false }).',
      ],
    });
  });

  it('indexes the site’s pages, leaving out 404, noindex, excluded and search pages', async () => {
    const where = site({
      'index.html': page(`<main>${searchBox}Welcome</main>`),
      'about/index.html': page('<main>About us</main>'),
      'tags/a/index.html': page('<main>Tag</main>'),
      '404.html': page('<main>Not found</main>'),
      'search/index.html': page('<main><div data-vesper-search="inline"></div></main>'),
      'private/index.html': page('<main>Private</main>').replace(
        '</head>',
        '<meta name="robots" content="noindex"></head>',
      ),
    });
    const result = await index(where, { search: { exclude: ['/tags/**'] } });
    expect(result.built).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.info).toEqual([
      expect.stringMatching(
        /^Search: indexed 2 pages in 1 language, \d+ KB of index\. A first search loads \d+ KB\.$/,
      ),
    ]);
    const out = join(where.dist, '_vesper/search');
    expect(existsSync(join(out, 'pagefind.js'))).toBe(true);
    // Pagefind's own interfaces aren't used, so they aren't deployed.
    expect(existsSync(join(out, 'pagefind-ui.js'))).toBe(false);
    expect(existsSync(join(out, 'pagefind-component-ui.js'))).toBe(false);
    // The deployed page is never changed.
    expect(readFileSync(join(where.dist, 'about/index.html'), 'utf8')).toBe(
      page('<main>About us</main>'),
    );
  });

  it('respects a site’s own data-pagefind-body, and warns with the pages it leaves out', async () => {
    const where = site({
      'index.html': page(`<main data-pagefind-body>${searchBox}Welcome</main>`),
      'about/index.html': page('<main>About us</main>'),
    });
    const result = await index(where);
    expect(result.warnings).toEqual([
      'Search: / uses data-pagefind-body, so Pagefind leaves out the 1 page without it: /about/. Add data-pagefind-body to their layout, or leave pages out with search: { exclude }.',
    ]);
    expect(result.info[0]).toMatch(/^Search: indexed 1 page in 1 language/);
  });

  it('warns when a first search is over the budget, and about settings it can’t use', async () => {
    const where = site({ 'index.html': page(`<main>${searchBox}Welcome</main>`) });
    const result = await index(where, { budget: 1024, search: { filters: { blog: ['tags'] } } });
    expect(result.warnings).toEqual([
      'Search: search.filters names "blog", but there\'s no collection by that name.',
      expect.stringMatching(
        /^Search: a first search loads \d+ KB, over the 1 KB budget for a host without compression\./,
      ),
    ]);
  });
});
