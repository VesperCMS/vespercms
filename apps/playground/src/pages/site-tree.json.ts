import type { APIRoute } from 'astro';
import {
  getBreadcrumbs,
  getChildren,
  getCollection,
  getTree,
  getUrl,
  type PageNode,
} from 'vesper:content';

/*
 * Everything Vesper's site helpers return for the playground, as JSON (spec
 * §6.15.7). The e2e suite fetches it from the static build and from astro
 * dev and requires the two to match.
 */

const outline = (nodes: PageNode<'pages'>[]): unknown[] =>
  nodes.map(({ path, slug, title, id, url, depth, children }) => ({
    path,
    slug,
    title,
    id,
    url,
    depth,
    children: outline(children),
  }));

export const GET: APIRoute = async () => {
  const pages = await getCollection('pages');
  const urls: Record<string, string | undefined> = {};
  for (const name of ['pages', 'blog', 'docs', 'events', 'authors'] as const) {
    for (const entry of await getCollection(name)) urls[`${name}/${entry.id}`] = getUrl(entry);
  }
  const children: Record<string, unknown> = {};
  const breadcrumbs: Record<string, unknown> = {};
  for (const page of pages) {
    children[page.id] = outline(await getChildren('pages', page));
    breadcrumbs[page.id] = await getBreadcrumbs('pages', page);
  }
  const body = { tree: outline(await getTree('pages')), children, breadcrumbs, urls };
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: { 'Content-Type': 'application/json' },
  });
};
