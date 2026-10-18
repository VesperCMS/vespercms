import {
  breadcrumbsOf,
  buildTree,
  childrenOf,
  entryUrlKey,
  formatUrl,
  type Crumb,
  type FolderOrders,
  type PageNode,
  type UrlPattern,
  type UrlSettings,
} from '@vesper/core/urls';

/*
 * The site helpers in `vesper:content` (spec §6.15.7): `getTree`,
 * `getChildren`, `getBreadcrumbs` and `getUrl`. They run in the site's own
 * pages, in dev and at build, over Astro's entries and the same URL and
 * tree code the studio uses, so the site and the studio always agree.
 *
 * The integration generates the data: each collection's URL pattern, title
 * keys and parsed `_order.yaml` files, plus the site's URL settings.
 */

export type HelperData = {
  settings: UrlSettings;
  collections: Record<
    string,
    {
      url?: string;
      /** Keys to read a title from, in order. */
      titleKeys: string[];
      /** `_order.yaml` files by folder path in the tree. */
      orders: FolderOrders;
    }
  >;
};

type Entry = { id: string; collection: string; data?: unknown };

export function createHelpers<E extends Entry>(
  data: HelperData,
  getCollection: (collection: string) => Promise<E[]>,
  functions: Readonly<Record<string, UrlPattern | undefined>> = {},
) {
  const patternOf = (collection: string): UrlPattern | undefined =>
    functions[collection] ?? data.collections[collection]?.url;

  /** The entry's URL on the site, from its collection's `url` pattern; undefined for data-only collections. */
  function getUrl(entry: Entry): string | undefined {
    const key = entryUrlKey(patternOf(entry.collection), entry, data.settings);
    return key === null ? undefined : formatUrl(key, data.settings);
  }

  function titleOf(entry: E): string {
    const values = (entry.data ?? {}) as Record<string, unknown>;
    for (const key of data.collections[entry.collection]?.titleKeys ?? ['title', 'name']) {
      const value = values[key];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
    return entry.id;
  }

  /** A collection's pages, nested by folder and ordered by `_order.yaml`, the root page first. */
  async function getTree(collection: string): Promise<PageNode<E>[]> {
    const entries = await getCollection(collection);
    return buildTree(
      entries.map((entry) => ({
        id: entry.id,
        title: titleOf(entry),
        url: getUrl(entry) ?? null,
        entry,
      })),
      data.collections[collection]?.orders ?? {},
    );
  }

  /** A page's children, in order. */
  async function getChildren(collection: string, entry: E | string): Promise<PageNode<E>[]> {
    return childrenOf(await getTree(collection), typeof entry === 'string' ? entry : entry.id);
  }

  /** The trail from the home page to the entry, both included: `[{ title, url }]`. */
  async function getBreadcrumbs(collection: string, entry: E | string): Promise<Crumb[]> {
    return breadcrumbsOf(await getTree(collection), typeof entry === 'string' ? entry : entry.id);
  }

  return { getTree, getChildren, getBreadcrumbs, getUrl };
}
