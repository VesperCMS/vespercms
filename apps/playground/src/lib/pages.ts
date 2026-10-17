import { getCollection, type CollectionEntry } from 'astro:content';

/*
 * The folder is the hierarchy (spec §6.15): a page's URL is its entry ID,
 * which the glob loader already derives from the file path minus `/index`.
 * Phase 2.6 replaces these helpers with Vesper's own getTree/getBreadcrumbs.
 */

export type Page = CollectionEntry<'pages'>;

export function pageUrl(page: Page): string {
  return page.id === 'index' ? '/' : `/${page.id}/`;
}

export type Crumb = { title: string; url?: string };

/** Ancestors from the top down. Folders with no section page have no link. */
export async function breadcrumbs(page: Page): Promise<Crumb[]> {
  const pages = await getCollection('pages');
  const byId = new Map(pages.map((p) => [p.id, p]));
  const segments = page.id.split('/');
  const crumbs: Crumb[] = [{ title: 'Home', url: '/' }];
  for (let depth = 1; depth < segments.length; depth++) {
    const id = segments.slice(0, depth).join('/');
    const section = byId.get(id);
    const segment = segments[depth - 1] ?? id;
    crumbs.push(
      section
        ? { title: section.data.title, url: pageUrl(section) }
        : { title: segment.replaceAll('-', ' ') },
    );
  }
  return crumbs;
}
