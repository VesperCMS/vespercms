import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'vesper:content';
import { docMarkdown } from '../../lib/docs.ts';

// Each docs page as Markdown (/docs/getting-started/install.md), for people
// and agents who want the source rather than the page. /docs.md is the root's.
export const getStaticPaths = (async () => {
  const docs = await getCollection('docs');
  return docs
    .filter((doc) => doc.id !== 'index')
    .map((doc) => ({ params: { path: doc.id }, props: { doc } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ doc: CollectionEntry<'docs'> }> = ({ props }) =>
  new Response(docMarkdown(props.doc), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
