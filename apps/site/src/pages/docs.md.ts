import type { APIRoute } from 'astro';
import { getEntry } from 'vesper:content';
import { docMarkdown } from '../lib/docs.ts';

// /docs/ as Markdown; the other pages are in docs/[...path].md.ts.
export const GET: APIRoute = async () => {
  const doc = await getEntry('docs', 'index');
  if (!doc) throw new Error('src/content/docs/index.mdoc is missing');
  return new Response(docMarkdown(doc), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
