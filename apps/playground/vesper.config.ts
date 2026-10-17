import { defineConfig } from '@vesper/astro/config';

// Presentation, URLs, scheduling and custom widgets; field definitions live in
// src/content.config.ts (spec D2).
export default defineConfig({
  // A custom widget (spec §6.3.3): it claims any list field called `hours`.
  widgets: {
    'store-hours': {
      component: () => import('./src/cms/StoreHours.tsx'),
      accepts: (field) => field.kind === 'array',
      match: (field) => field.path.at(-1) === 'hours',
    },
  },
  // The fictional college is on the US East Coast; event times are entered in Eastern time.
  timeZone: 'America/New_York',
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
    events: {
      label: 'Events',
      url: '/events/:id',
      schedule: true,
      // Dates go to Details by default; an event's own times belong up front.
      placement: { startsAt: 'main', endsAt: 'main' },
    },
    fixtures: { label: 'Accessibility fixtures', search: false },
  },
});
