import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { UrlSettings } from '@vesper/core';
import { formatUrl } from '@vesper/core';
import type { Plugin } from 'vite';
import type { SiteModelCache } from './site-model.ts';
import { SEARCH_DIR, searchFile, type SearchOptions } from './search.ts';

/*
 * `virtual:vesper/search` gives <Search> what it needs from the integration's
 * options: where the index and the /search page are, the site's words, and
 * the fields each section can be sorted by. In `astro dev`, the last build's
 * index is served from `dist/_vesper/search/`, so search works there once
 * the site has been built (spec §6.19).
 */

const SEARCH = 'virtual:vesper/search';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.webp': 'image/webp',
};

export function searchPlugin(options: {
  cache: SiteModelCache;
  search: SearchOptions;
  settings: UrlSettings;
  siteName: string;
  /** The build's output folder, whose index `astro dev` serves. */
  dist: string;
  /** Whether the build makes `sitemap-index.xml` (@astrojs/sitemap). */
  sitemap: boolean;
  dev: boolean;
}): Plugin {
  const { settings, search } = options;
  const base = settings.base.endsWith('/') ? settings.base : `${settings.base}/`;
  const bundle = `${base}${SEARCH_DIR}/`;
  return {
    name: 'vesper:search',
    resolveId(id) {
      return id === SEARCH ? `\0${SEARCH}` : null;
    },
    async load(id) {
      if (id !== `\0${SEARCH}`) return null;
      const { manifest } = await options.cache.get();
      const sort: Record<string, { key: string; label: string; kind: string }[]> = {};
      for (const [name, keys] of Object.entries(search.sort ?? {})) {
        const collection = manifest.collections.find((c) => c.name === name);
        if (!collection) continue;
        sort[collection.label] = keys.flatMap((key) => {
          const field = collection.fields?.find((f) => f.path.join('.') === key);
          return field &&
            (field.kind === 'date' || field.kind === 'number' || field.kind === 'string')
            ? [{ key, label: field.label, kind: field.kind }]
            : [];
        });
      }
      const site = settings.site ? new URL(settings.site) : null;
      const value = {
        bundle,
        page: formatUrl('/search', settings),
        home: formatUrl('/', settings),
        siteName: options.siteName,
        openSearch: site ? `${base}opensearch.xml` : null,
        host: site?.host ?? null,
        sitemap: options.sitemap ? `${base}sitemap-index.xml` : null,
        noJsLink: search.noJsLink ?? null,
        noJsFallback: search.noJsFallback ?? null,
        strings: search.strings ?? {},
        sort,
      };
      return `export const search = ${JSON.stringify(value)};`;
    },
    configureServer(server) {
      if (!options.dev) return;
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0] ?? '';
        if (!path.startsWith(bundle)) {
          next();
          return;
        }
        const file = searchFile(options.dist, decodeURIComponent(path.slice(bundle.length)));
        if (!file) {
          next();
          return;
        }
        response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-store');
        response.end(readFileSync(file));
      });
    },
  };
}
