import type { CollectionEntry, PageNode } from 'vesper:content';

/** The docs tree's pages in menu order: each section, then its pages. */
export function flatten(tree: PageNode<'docs'>[]): PageNode<'docs'>[] {
  const pages: PageNode<'docs'>[] = [];
  const walk = (nodes: PageNode<'docs'>[]) => {
    for (const node of nodes) {
      if (node.url && node.entry) pages.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return pages;
}

/**
 * Where a docs page's Markdown copy lives: its address with `.md` in place of
 * the trailing slash, as llms.txt suggests. /docs/ itself is /docs.md.
 */
export function markdownPath(id: string): string {
  return id === 'index' ? '/docs.md' : `/docs/${id}.md`;
}

/** A docs page as Markdown for AI tools: its title, its summary, then its source. */
export function docMarkdown(doc: CollectionEntry<'docs'>): string {
  return `# ${doc.data.title}\n\n> ${doc.data.summary}\n\n${(doc.body ?? '').trim()}\n`;
}
