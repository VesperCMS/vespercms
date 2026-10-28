import { defineConfig } from 'vespercms/config';

// Presentation and URLs; the fields live in src/content.config.ts (spec D2).
export default defineConfig({
  markdoc: {
    tags: {
      callout: {
        label: 'Callout',
        summary: 'type',
        attributes: {
          type: { labels: { note: 'Note', tip: 'Tip', warning: 'Warning' } },
          title: { description: 'Shown above the callout. Leave it empty to use the type.' },
        },
      },
    },
  },
  collections: {
    pages: { label: 'Pages', url: '/:path', tree: true, icon: 'panels-top-left' },
    // Two levels, sections and their pages, so the docs menu never nests deeper.
    docs: { label: 'Docs', url: '/docs/:path', tree: true, maxDepth: 2, icon: 'book-open' },
    settings: { label: 'Site settings', singleton: true, icon: 'settings' },
  },
});
