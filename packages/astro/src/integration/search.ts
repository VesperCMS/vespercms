import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import {
  ContentService,
  PageService,
  cropForRatio,
  firstImage,
  formatUrl,
  globMatcher,
  imageValueOf,
  isDraft,
  isHiddenFromSearch,
  isPublished,
  pixelRect,
  searchAnnotations,
  searchSettingsProblems,
  titleOf,
  urlKey,
  type CollectionManifest,
  type DataValue,
  type SearchAnnotations,
  type StaticRoutes,
  type StoredEntry,
  type UrlSettings,
} from '@vespercms/core';
import type { IndexFile } from 'pagefind';
import type { SiteModel } from '../node/manifest.ts';
import { LocalStorage } from '../node/storage-local.ts';
import { builtPages, skipReason } from './a11y.ts';

/*
 * Site search at build (spec §6.19, D23). After the build, every page the
 * site means to be found is handed to Pagefind's Node API as an annotated
 * copy: the entry's title, date, filters and sort keys as `<meta>` tags, and
 * `data-pagefind-body` on its `<main>`. The file in `dist/` is never
 * written. The index goes to `dist/_vesper/search/`: plain static files that
 * work on any host, with no MIME type to set (DECISIONS.md, "Pagefind needs
 * no MIME type").
 */

export type SearchOptions = {
  /** Per collection, the fields offered as filters: text, lists of text, selects and references. */
  filters?: Record<string, string[]>;
  /** Per collection, the fields results can be sorted by: dates, numbers and text. */
  sort?: Record<string, string[]>;
  /** Pages to leave out, by URL path, with `*` and `**` (`'/tags/**'`). */
  exclude?: string[];
  /** Without JavaScript, `/search` sends visitors here instead of the home page. */
  noJsLink?: string;
  /** Without JavaScript, `/search`'s form searches the site on DuckDuckGo (needs Astro's `site`). */
  noJsFallback?: 'duckduckgo';
  /** The interface's words in other languages, by the page's `lang` (`{ fr: { button: 'Rechercher' } }`). */
  strings?: Record<string, Record<string, string>>;
};

/** Where the index goes, under the site's `base`. */
export const SEARCH_DIR = '_vesper/search';

/** A first search, in uncompressed bytes: what a host without compression sends (DECISIONS.md). */
export const FIRST_QUERY_BUDGET = 300 * 1024;

/** Pagefind's own interfaces and highlighter, which `<Search>` doesn't use. */
const BUNDLED_UI = new Set([
  'pagefind-ui.js',
  'pagefind-ui.css',
  'pagefind-modular-ui.js',
  'pagefind-modular-ui.css',
  'pagefind-component-ui.js',
  'pagefind-component-ui.css',
  'pagefind-highlight.js',
]);

/** The marker `<Search>` renders; the inline variant (the `/search` page) says so. */
const USES_SEARCH = /\sdata-vesper-search=["']?(dialog|inline)/;
const HAS_BODY = /<[a-z][^>]*\sdata-pagefind-body(?=[\s=/>])/i;

export type SearchResult = { info: string[]; warnings: string[]; built: boolean };

/** The entry a built page shows, with what search needs to know about it. */
type PageEntry = {
  collection: CollectionManifest;
  id: string;
  data: DataValue;
  /** The entry's file, site-relative. */
  path: string;
};

/** Builds the index, or explains why not. Never throws for content problems. */
export async function indexSearch(options: {
  root: string;
  dist: string;
  model: SiteModel;
  settings: UrlSettings;
  routes: () => StaticRoutes;
  search: SearchOptions;
  /** Whether `/search` is Vesper's own page, injected because the site has none. */
  injectedPage?: boolean;
  now?: Date;
  /** The first-search budget in bytes; tests set a small one. */
  budget?: number;
}): Promise<SearchResult> {
  const { root, dist, model, settings, search } = options;
  const result: SearchResult = { info: [], warnings: [], built: false };
  const now = options.now ?? new Date();
  for (const problem of searchSettingsProblems(model.manifest, search))
    result.warnings.push(`Search: ${problem}`);

  const pages = builtPages(dist, settings.base).map((page) => ({
    ...page,
    html: readFileSync(join(dist, page.file), 'utf8'),
  }));
  // A stale index from an earlier build in the same folder would be served as is.
  rmSync(join(dist, SEARCH_DIR), { recursive: true, force: true });
  // Vesper's page renders <Search variant="inline"> on every site, so it isn't
  // a use of search. It's found by its route, not its markup, so a site's own
  // /search page always counts and is never removed.
  const injected = options.injectedPage
    ? pages.find((page) => urlKey(page.url, settings) === '/search')
    : undefined;
  if (!pages.some((page) => page !== injected && USES_SEARCH.test(page.html))) {
    // Without an index the page could only say that search failed to load.
    if (injected) removePage(dist, injected.file);
    result.info.push(
      `Search: no page uses <Search>, so no index was built${injected ? ' and the /search page was left out' : ''}. Add <Search /> from vespercms/components to a layout, or set vesper({ search: false }).`,
    );
    return result;
  }

  const content = new ContentService(new LocalStorage(root), model.manifest);
  const stored = new Map<string, Promise<StoredEntry[]>>();
  const entriesOf = (name: string) => {
    let found = stored.get(name);
    if (!found) {
      found = content.entriesOf(name);
      stored.set(name, found);
    }
    return found;
  };
  const entries = await pageEntries(root, model, options.routes, entriesOf);
  const titles = await referenceTitles(model, entriesOf);
  const excluded = (search.exclude ?? []).map((pattern) =>
    globMatcher(pattern.replace(/^\/+|\/+$/g, '')),
  );
  const siteBody = pages.some((page) => HAS_BODY.test(page.html));
  const thumbnails = await thumbnailMaker(join(dist, SEARCH_DIR, 'images'), settings.base);
  if (!thumbnails.available)
    result.info.push('Search: results have no thumbnails, because sharp isn’t installed.');

  const indexed: { url: string; content: string }[] = [];
  const withoutBody: string[] = [];
  const withoutMain: string[] = [];
  for (const page of pages) {
    if (skipReason(page.file, page.html) || isNotFound(page.file)) continue;
    if (/\sdata-vesper-search=["']?inline/.test(page.html) || hasNoindex(page.html)) continue;
    const key = urlKey(page.url, settings);
    const path = key ?? page.url.slice(settings.base.length);
    if (excluded.some((matches) => matches(path.replace(/^\/+|\/+$/g, '')))) continue;
    const entry = key === null ? undefined : entries.get(key);
    if (entry) {
      const { collection, data } = entry;
      if (collection.presentation.search === false) continue;
      if (isHiddenFromSearch(collection, data)) continue;
      if (!isPublished(collection.presentation.schedule, data, now)) continue;
      if (isDraft(collection, data)) continue;
    }
    if (siteBody && !HAS_BODY.test(page.html)) {
      withoutBody.push(page.url);
      continue;
    }
    const annotations = entry
      ? searchAnnotations({
          collection: entry.collection,
          id: entry.id,
          data: entry.data,
          settings: {
            ...(search.filters?.[entry.collection.name]
              ? { filters: search.filters[entry.collection.name] }
              : {}),
            ...(search.sort?.[entry.collection.name]
              ? { sort: search.sort[entry.collection.name] }
              : {}),
          },
          locale: pageLanguage(page.html),
          ...(settings.timeZone ? { timeZone: settings.timeZone } : {}),
          referenceTitle: titles,
        })
      : null;
    const thumbnail = entry ? await thumbnails.make(root, entry) : undefined;
    if (!siteBody && !/<main(?=[\s>])/i.test(page.html)) withoutMain.push(page.url);
    indexed.push({
      url: key === null ? page.url : formatUrl(key, settings),
      content: annotateHtml(page.html, annotations, {
        body: !siteBody,
        ...(thumbnail ? { thumbnail } : {}),
      }),
    });
  }

  if (withoutBody.length > 0) {
    const marked = pages.find((page) => HAS_BODY.test(page.html))?.url ?? '';
    result.warnings.push(
      `Search: ${marked} uses data-pagefind-body, so Pagefind leaves out the ${String(withoutBody.length)} ${withoutBody.length === 1 ? 'page' : 'pages'} without it: ${listOf(withoutBody)}. Add data-pagefind-body to their layout, or leave pages out with search: { exclude }.`,
    );
  }
  if (withoutMain.length > 0) {
    result.info.push(
      `Search: ${listOf(withoutMain)} ${withoutMain.length === 1 ? 'has' : 'have'} no <main>, so all of <body> is indexed there.`,
    );
  }

  const out = join(dist, SEARCH_DIR);
  const errors = await writeIndex(indexed, out);
  result.built = true;
  for (const error of errors) result.warnings.push(`Search: ${error}`);
  const size = indexSize(out);
  result.info.push(
    `Search: indexed ${String(size.pages)} ${size.pages === 1 ? 'page' : 'pages'} in ${String(size.languages)} ${size.languages === 1 ? 'language' : 'languages'}, ${kb(size.index)} of index. A first search loads ${kb(size.firstQuery)}.`,
  );
  const budget = options.budget ?? FIRST_QUERY_BUDGET;
  if (size.firstQuery > budget) {
    result.warnings.push(
      `Search: a first search loads ${kb(size.firstQuery)}, over the ${kb(budget)} budget for a host without compression. Leave out pages with search: { exclude }, or turn on compression at the host.`,
    );
  }
  return result;
}

/**
 * The copy of a page Pagefind reads: the annotations as `<meta>` tags before
 * `</head>`, and `data-pagefind-body` on the first `<main>` (or `<body>`)
 * when the site marks no content area of its own.
 */
export function annotateHtml(
  html: string,
  annotations: SearchAnnotations | null,
  options: { body: boolean; thumbnail?: string },
): string {
  let out = html;
  if (options.body) {
    const main = /<main(?=[\s>])/i.exec(out);
    const at = main ?? /<body(?=[\s>])/i.exec(out);
    if (at) {
      const end = at.index + at[0].length;
      out = `${out.slice(0, end)} data-pagefind-body${out.slice(end)}`;
    }
  }
  const tags: string[] = [];
  const meta = (attribute: string, name: string, value: string) =>
    tags.push(`<meta data-pagefind-${attribute}="${name}[content]" content="${escape(value)}">`);
  if (annotations) {
    meta('meta', 'title', annotations.title);
    if (annotations.date) {
      meta('meta', 'date', annotations.date.text);
      meta('meta', 'datetime', annotations.date.iso);
    }
    for (const [name, values] of annotations.filters)
      for (const value of values) meta('filter', filterName(name), value);
    for (const [key, value] of annotations.sort) meta('sort', filterName(key), value);
  }
  // Our own key, not Pagefind's `image`, which it fills from the page's first <img>.
  if (options.thumbnail) meta('meta', 'thumbnail', options.thumbnail);
  if (tags.length === 0) return out;
  const head = /<\/head\s*>/i.exec(out);
  const at = head ? head.index : (/<body(?=[\s>])/i.exec(out)?.index ?? 0);
  return `${out.slice(0, at)}${tags.join('')}${out.slice(at)}`;
}

/** The page's `<html lang>`, or `en`. */
export function pageLanguage(html: string): string {
  return /<html[^>]*\slang=["']?([^"'\s>]+)/i.exec(html)?.[1] ?? 'en';
}

/** A `<meta name="robots">` that says `noindex`. */
export function hasNoindex(html: string): boolean {
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/gi)) {
    if (/\sname=["']?robots["'\s>]/i.test(tag) && /\scontent=["'][^"']*noindex/i.test(tag))
      return true;
  }
  return false;
}

const isNotFound = (file: string) => file === '404.html' || file === '404/index.html';

/** Pagefind reads `name[content]` and `name:value`, so a name can't hold either. */
const filterName = (name: string) =>
  name
    .replace(/[[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const listOf = (urls: readonly string[]) =>
  urls.length <= 3
    ? urls.join(', ')
    : `${urls.slice(0, 2).join(', ')} and ${String(urls.length - 2)} more`;

const kb = (bytes: number) => `${String(Math.round(bytes / 1024))} KB`;

type EntriesOf = (collection: string) => Promise<StoredEntry[]>;

/** Each entry's page by URL key, with its data, traced as the accessibility report traces it. */
async function pageEntries(
  root: string,
  model: SiteModel,
  routes: () => StaticRoutes,
  entriesOf: EntriesOf,
): Promise<Map<string, PageEntry>> {
  const storage = new LocalStorage(root);
  const pages = new PageService(
    storage,
    model.manifest,
    new ContentService(storage, model.manifest),
    { routes, ...(model.urlFunctions ? { urlFunctions: model.urlFunctions } : {}) },
  );
  const map = new Map<string, PageEntry>();
  for (const page of await pages.pageEntries()) {
    const collection = model.manifest.collections.find((c) => c.name === page.collection);
    if (!collection) continue;
    const entry = (await entriesOf(collection.name)).find((e) => e.id === page.id);
    map.set(page.key, { collection, id: page.id, data: entry?.data, path: page.path });
  }
  return map;
}

/** Every entry's title by collection, for reference filters, read before any page is annotated. */
async function referenceTitles(
  model: SiteModel,
  entriesOf: EntriesOf,
): Promise<(collection: string, id: string) => string | undefined> {
  const loaded = new Map<string, Map<string, string>>();
  for (const collection of model.manifest.collections) {
    try {
      const entries = await entriesOf(collection.name);
      loaded.set(
        collection.name,
        new Map(entries.map((entry) => [entry.id, titleOf(collection, entry.data, entry.id)])),
      );
    } catch {
      // A collection Vesper can't read (a custom loader) gives its IDs, not titles.
    }
  }
  return (collection, id) => loaded.get(collection)?.get(id);
}

type Thumbnails = {
  available: boolean;
  make: (root: string, entry: PageEntry) => Promise<string | undefined>;
};

type SharpModule = typeof import('sharp');

/**
 * Square thumbnails of each entry's first image, cut where `<Img>` would cut
 * the square crop: the stored crop, or the focal point's (spec §6.6.3).
 * 128px WebP, shown at 64px. Named by a hash of the file and the rectangle,
 * so unchanged images keep their names across builds.
 */
async function thumbnailMaker(folder: string, base: string): Promise<Thumbnails> {
  let sharp: SharpModule['default'];
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return { available: false, make: () => Promise.resolve(undefined) };
  }
  const prefix = `${base.endsWith('/') ? base : `${base}/`}${SEARCH_DIR}/images/`;
  return {
    available: true,
    make: async (root, entry) => {
      const image = firstImage(entry.collection, entry.data);
      const src = typeof image?.value.src === 'string' ? image.value.src : '';
      if (!image || !src || /^[a-z]+:|^\//i.test(src)) return undefined;
      const file = resolve(root, dirname(entry.path), src);
      if (!existsSync(file)) return undefined;
      try {
        const input = readFileSync(file);
        const meta = await sharp(input, { failOn: 'none' }).metadata();
        if (!meta.width || !meta.height || meta.format === 'svg' || (meta.pages ?? 1) > 1)
          return undefined;
        // Orientations 5 to 8 turn the picture a quarter: crops are measured upright.
        const upright =
          (meta.orientation ?? 1) >= 5
            ? { width: meta.height, height: meta.width }
            : { width: meta.width, height: meta.height };
        const { rect } = cropForRatio(imageValueOf(image.value), 'square', 1, upright);
        const hash = createHash('sha256')
          .update(input)
          .update(JSON.stringify(rect))
          .digest('hex')
          .slice(0, 16);
        const name = `${hash}.webp`;
        const out = join(folder, name);
        if (!existsSync(out)) {
          mkdirSync(folder, { recursive: true });
          const data = await sharp(input, { failOn: 'none' })
            .rotate()
            .extract(pixelRect(rect, upright))
            .resize(128, 128, { fit: 'cover' })
            .webp({ quality: 70 })
            .toBuffer();
          writeFileSync(out, data);
        }
        return prefix + name;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Indexes the pages and writes the bundle. Pagefind hands the files back as
 * bytes (`getFiles`) and they're written here, never by its `writeFiles`:
 * Pagefind 1.5.2 answers that before its writes reach the disk, and `close()`
 * kills the service, so a file could ship empty (DECISIONS.md, "Vesper
 * writes Pagefind's files itself").
 */
async function writeIndex(
  pages: readonly { url: string; content: string }[],
  out: string,
): Promise<string[]> {
  const pagefind = await import('pagefind');
  const errors: string[] = [];
  let files: readonly IndexFile[] = [];
  try {
    const created = await pagefind.createIndex({});
    errors.push(...created.errors);
    const index = created.index;
    if (!index) return errors;
    for (const page of pages) {
      const added = await index.addHTMLFile({ url: page.url, content: page.content });
      errors.push(...added.errors.map((error) => `${page.url}: ${error}`));
    }
    // The wrapper leaves `files` out when Pagefind answers with an error.
    const bundle: { errors: string[]; files?: IndexFile[] } = await index.getFiles();
    errors.push(...bundle.errors);
    files = bundle.files ?? [];
  } finally {
    await pagefind.close();
  }
  return [...errors, ...writeBundle(files, out)];
}

/** Removes a built page, and its folder when that leaves it empty (`search/index.html`). */
function removePage(dist: string, file: string): void {
  const path = resolve(dist, file);
  rmSync(path, { force: true });
  const folder = dirname(path);
  if (folder !== resolve(dist) && readdirSync(folder).length === 0)
    rmSync(folder, { recursive: true });
}

/**
 * Writes the files Pagefind returned into `out`, each whole before this
 * returns, leaving out Pagefind's own interfaces.
 */
export function writeBundle(files: readonly IndexFile[], out: string): string[] {
  const errors: string[] = [];
  const folder = resolve(out);
  for (const file of files) {
    if (BUNDLED_UI.has(file.path)) continue;
    const target = resolve(folder, file.path);
    if (!target.startsWith(folder + sep)) {
      errors.push(
        `Pagefind returned ${file.path}, outside the index's folder, so it wasn't written.`,
      );
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  return errors;
}

/**
 * What the index weighs, and what a first search loads: the script, its
 * worker, and the largest language's WebAssembly, metadata and largest
 * index chunk, uncompressed.
 */
export function indexSize(out: string): {
  pages: number;
  languages: number;
  index: number;
  firstQuery: number;
} {
  const size = (path: string) => (existsSync(path) ? statSync(path).size : 0);
  const entry = JSON.parse(readFileSync(join(out, 'pagefind-entry.json'), 'utf8')) as {
    languages: Record<string, { hash: string; wasm?: string; page_count: number }>;
  };
  const languages = Object.entries(entry.languages);
  const chunks = (folder: string) =>
    existsSync(join(out, folder))
      ? readdirSync(join(out, folder)).map((file) => ({
          file,
          size: size(join(out, folder, file)),
        }))
      : [];
  const index = chunks('index');
  const all = [...index, ...chunks('fragment'), ...chunks('filter')];
  const metas = languages.map(([, language]) =>
    size(join(out, `pagefind.${language.hash}.pf_meta`)),
  );
  const perLanguage = languages.map(([code, language]) => {
    const largest = Math.max(
      0,
      ...index.filter((chunk) => chunk.file.startsWith(`${code}_`)).map((chunk) => chunk.size),
    );
    return (
      size(join(out, `wasm.${language.wasm ?? 'unknown'}.pagefind`)) +
      size(join(out, `pagefind.${language.hash}.pf_meta`)) +
      largest
    );
  });
  return {
    pages: languages.reduce((sum, [, language]) => sum + language.page_count, 0),
    languages: languages.length,
    index: all.reduce((sum, chunk) => sum + chunk.size, 0) + metas.reduce((a, b) => a + b, 0),
    firstQuery:
      size(join(out, 'pagefind.js')) +
      size(join(out, 'pagefind-worker.js')) +
      Math.max(0, ...perLanguage),
  };
}

/** `opensearch.xml` (spec §6.19), so browsers offer the site's search. Needs an absolute URL. */
export function openSearchXml(options: {
  siteName: string;
  site: string;
  searchPage: string;
}): string {
  const template = new URL(`${options.searchPage}?q={searchTerms}`, options.site).href.replace(
    '%7BsearchTerms%7D',
    '{searchTerms}',
  );
  // ShortName may be at most 16 characters, counted as people see them.
  const short = Array.from(new Intl.Segmenter().segment(options.siteName), (s) => s.segment)
    .slice(0, 16)
    .join('');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
    `  <ShortName>${xmlText(short)}</ShortName>`,
    `  <Description>${xmlText(`Search ${options.siteName}`)}</Description>`,
    '  <InputEncoding>UTF-8</InputEncoding>',
    `  <Url type="text/html" method="get" template="${xmlText(template)}"/>`,
    '</OpenSearchDescription>',
    '',
  ].join('\n');
}

const xmlText = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Serves the last build's index in `astro dev`, so `<Search>` works there too. */
export function searchFile(dist: string, path: string): string | null {
  const out = resolve(dist, SEARCH_DIR);
  const file = resolve(out, `.${sep}${path}`);
  if (!file.startsWith(out + sep) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}
