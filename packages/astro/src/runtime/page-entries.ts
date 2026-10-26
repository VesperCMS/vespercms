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
  /** A scheduled entry's status words now ("Scheduled · Sat, Oct 31, 8:00 AM"). */
  status?: string;
  /** Visitors wouldn't see it in a build now: before its time, or after it came down. */
  outside?: true;
};

/**
 * The note on a page whose own entry is outside its window (spec §6.17):
 * fixed at the top, dev only, so an editor looking at the page knows what
 * visitors won't see.
 */
function scheduleNote(entries: PageEntry[]): string {
  const entry = entries.find((e) => e.kind === 'shown' && e.outside && e.status);
  if (!entry?.status) return '';
  const after = entry.status.startsWith('Unpublished')
    ? 'Visitors no longer see this page.'
    : 'Visitors won’t see this page until then.';
  const text = `${entry.status}. ${after}`.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
  return `<div id="vesper-schedule-note" role="note" style="position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483646;max-width:calc(100% - 32px);padding:8px 16px;border-radius:8px;background:#181b28;color:#fff;font:15px/1.5 system-ui,sans-serif">${text}</div>`;
}

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
  const tag = `${scheduleNote([...entries.values()])}<script type="application/json" id="vesper-page-entries">${list}</script>`;
  const html = result.html.includes('</body>')
    ? result.html.replace('</body>', `${tag}</body>`)
    : result.html + tag;
  const headers = new Headers(result.response.headers);
  headers.delete('content-length');
  return new Response(html, { status: result.response.status, headers });
});
