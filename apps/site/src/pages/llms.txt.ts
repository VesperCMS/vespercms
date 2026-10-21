import type { APIRoute } from 'astro';
import { getEntry, getTree } from 'vesper:content';
import { markdownPath } from '../lib/docs.ts';

/*
 * /llms.txt (llmstxt.org): what Vesper is, then every docs page in menu
 * order, linked to its Markdown copy. Built from the same tree as the docs
 * menu, so it follows every move and reorder in the studio.
 */
export const GET: APIRoute = async ({ site }) => {
  const home = await getEntry('pages', 'index');
  const tree = await getTree('docs');
  const url = (path: string) => (site ? new URL(path, site).href : path);
  const item = (node: (typeof tree)[number]) =>
    node.entry
      ? `- [${node.title}](${url(markdownPath(node.entry.id))}): ${node.entry.data.summary}`
      : null;

  const lines = [
    '# Vesper',
    '',
    `> ${home?.data.summary ?? 'A git-based CMS for Astro sites.'}`,
    '',
    `Every docs page is also Markdown: add .md to its address in place of the trailing slash. All of them in one file: ${url('/llms-full.txt')}`,
    '',
    "For a site that uses Vesper, `npx vesper agents` writes instructions for coding agents, generated from that site's own schema, into its AGENTS.md.",
  ];
  for (const node of tree) {
    lines.push('', `## ${node.title}`, '');
    for (const page of [node, ...node.children]) {
      const line = item(page);
      if (line) lines.push(line);
    }
  }
  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
