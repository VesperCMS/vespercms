import { AsyncLocalStorage } from 'node:async_hooks';
import { defineMiddleware } from 'astro:middleware';

/*
 * Dev only: which entries does this page read? (spec §6.10.) The
 * `vesper:content` helpers record each entry a page loads into the store
 * this middleware opens for the request, and the list is added to the page
 * for the dev toolbar's "Edit this page". Production builds never include
 * this middleware, and `vesper:content` is plain `astro:content` there.
 */

/** `shown`: rendered or fetched by ID. `listed`: part of a collection the page reads. */
export type PageEntry = {
  collection: string;
  id: string;
  kind: 'shown' | 'listed';
  title?: string;
};

const KEY = Symbol.for('vesper.pageEntries');
const registry = globalThis as typeof globalThis & {
  [KEY]?: AsyncLocalStorage<Map<string, PageEntry>>;
};
const storage = (registry[KEY] ??= new AsyncLocalStorage<Map<string, PageEntry>>());

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.request.method !== 'GET') return next();
  const entries = new Map<string, PageEntry>();
  // Rendering streams, so the page is read inside the store's context too.
  const result = await storage.run(entries, async () => {
    const response = await next();
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('text/html')) return { response, html: null };
    return { response, html: await response.text() };
  });
  if (result.html === null) return result.response;

  const list = JSON.stringify([...entries.values()]).replaceAll('<', '\\u003c');
  const tag = `<script type="application/json" id="vesper-page-entries">${list}</script>`;
  const html = result.html.includes('</body>')
    ? result.html.replace('</body>', `${tag}</body>`)
    : result.html + tag;
  const headers = new Headers(result.response.headers);
  headers.delete('content-length');
  return new Response(html, { status: result.response.status, headers });
});
