import {
  ContentService,
  entryUrlKey,
  formatUrl,
  manifestHash,
  type Diagnostic,
  type Manifest,
} from '@vespercms/core';
import type { SiteModel } from '../node/manifest.ts';
import { LocalStorage } from '../node/storage-local.ts';
import { urlSettings } from './redirects.ts';
import { routeFor, type CollectionRoute, type ResolvedRoute } from './routes.ts';

/*
 * The route check (spec §6.15.1): each collection's URL pattern against the
 * routes Astro resolved. A collection whose URLs no route can produce gets
 * a warning; the route that renders it is recorded in the manifest, for
 * previews. A flat collection whose entries sit in folders gets a hint to
 * use `tree: true` (§6.15.2).
 */

export type SiteCheck = { routes: Map<string, CollectionRoute>; diagnostics: Diagnostic[] };

export async function checkSite(
  model: SiteModel,
  root: string,
  routes: readonly ResolvedRoute[],
): Promise<SiteCheck> {
  const storage = new LocalStorage(root);
  const content = new ContentService(storage, model.manifest);
  const settings = urlSettings(model);
  const found = new Map<string, CollectionRoute>();
  const diagnostics: Diagnostic[] = [];
  for (const collection of model.manifest.collections) {
    if (!collection.editable) continue;
    const fn = model.urlFunctions?.[collection.name];
    const pattern =
      fn ??
      (typeof collection.presentation.url === 'string' ? collection.presentation.url : undefined);
    let entries: Awaited<ReturnType<ContentService['entriesOf']>>;
    try {
      entries = await content.entriesOf(collection.name);
    } catch {
      continue;
    }
    if (
      !collection.presentation.tree &&
      collection.source.loader === 'glob' &&
      entries.filter((e) => e.id.includes('/')).length > 1
    ) {
      diagnostics.push({
        level: 'info',
        code: 'suggest-tree',
        message: `"${collection.name}" keeps entries in folders. Set tree: true for it in vesper.config.ts to edit it as an outline of pages.`,
        collection: collection.name,
      });
    }
    if (pattern === undefined) continue;
    const urls = entries.flatMap((entry) => {
      const key = entryUrlKey(
        pattern,
        { id: entry.id, collection: collection.name, data: entry.data },
        settings,
      );
      // Astro's route patterns include the base.
      return key === null ? [] : [formatUrl(key, settings)];
    });
    if (urls.length === 0) continue;
    const { route, unmatched } = routeFor(routes, urls, root);
    if (route) found.set(collection.name, route);
    if (unmatched.length > 0) {
      const examples = unmatched.slice(0, 3).join(', ');
      diagnostics.push({
        level: 'warning',
        code: 'url-without-route',
        message: `No page in src/pages can show ${unmatched.length === 1 ? 'this' : `${String(unmatched.length)} of these`} "${collection.name}" URLs: ${examples}${unmatched.length > 3 ? ', …' : ''}. Add a route for them, or change the collection's url in vesper.config.ts.`,
        collection: collection.name,
      });
    }
  }
  return { routes: found, diagnostics };
}

/** The manifest with each collection's route recorded, re-hashed. */
export async function withRoutes(
  manifest: Manifest,
  routes: ReadonlyMap<string, CollectionRoute>,
): Promise<Manifest> {
  const { generator, hash: _hash, ...content } = manifest;
  const next = {
    ...content,
    collections: content.collections.map((collection) => {
      const route = routes.get(collection.name);
      const { route: _old, ...rest } = collection;
      return route ? { ...rest, route } : rest;
    }),
  };
  return { ...next, generator, hash: await manifestHash(next) };
}
