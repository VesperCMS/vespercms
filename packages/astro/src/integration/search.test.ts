import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  annotateHtml,
  hasNoindex,
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
