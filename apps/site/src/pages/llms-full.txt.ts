import type { APIRoute } from 'astro';
import { getTree } from 'vesper:content';
import { docMarkdown, flatten } from '../lib/docs.ts';

// Every docs page's Markdown in one file, in menu order, for tools that
// read a whole manual at once.
export const GET: APIRoute = async () => {
  const pages = flatten(await getTree('docs'));
  const text = pages.map((node) => (node.entry ? docMarkdown(node.entry) : '')).join('\n---\n\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
