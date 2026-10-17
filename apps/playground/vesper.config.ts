import { defineConfig } from '@vesper/astro/config';

// Presentation, URLs and scheduling only: field definitions live in
// src/content.config.ts (spec D2).
export default defineConfig({
  collections: {
    blog: {
      label: 'Blog posts',
      url: '/blog/:id',
      listFields: ['title', 'publishedAt'],
      newEntryPath: ':slug',
    },
    authors: { label: 'People' },
    pages: { label: 'Pages', url: '/:path', tree: true },
    docs: { label: 'Docs', url: '/docs/:id' },
    settings: { label: 'Site settings', singleton: true },
    locations: { label: 'Locations' },
    events: { label: 'Events', url: '/events/:id', schedule: true },
    fixtures: { label: 'Accessibility fixtures', search: false },
  },
});
