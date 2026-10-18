import { defineConfig } from '@vesper/astro/config';
import { fields } from '@vesper/astro/fields';
import { z } from 'astro/zod';

// Presentation, URLs, scheduling and custom widgets; field definitions live in
// src/content.config.ts (spec D2).
export default defineConfig({
  // UI hints for the tags in markdoc.config.mjs (spec §6.5.1). The tags
  // themselves, their attributes and their rules stay in that file.
  markdoc: {
    tags: {
      callout: {
        label: 'Callout',
        summary: 'type',
        attributes: {
          type: { labels: { note: 'Note', warning: 'Warning', tip: 'Tip' } },
          title: { description: 'Shown above the callout. Leave it empty to use the type.' },
        },
      },
      youtube: {
        label: 'YouTube video',
        summary: 'title',
        attributes: {
          id: { label: 'Video ID', description: 'The part after “v=” in the video’s address.' },
          title: { description: 'Describes the video for screen reader users.' },
          captions: { label: 'The video has captions' },
        },
      },
      abbr: {
        label: 'Abbreviation',
        summary: 'title',
        attributes: {
          title: { label: 'Full form', description: 'What the abbreviation stands for.' },
        },
      },
    },
  },
  // MDX components the body editor may show as blocks (spec §6.5.2). Gallery,
  // used in campus-life.mdx, is deliberately left out: it stays a source chip.
  mdx: {
    components: {
      Callout: {
        label: 'Callout',
        summary: 'type',
        children: true,
        props: z.object({
          type: fields.select({ note: 'Note', warning: 'Warning', tip: 'Tip' }).default('note'),
          title: z.string().optional(),
        }),
      },
    },
  },
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
  // Crops the site renders (spec §6.6.3). The studio previews these, and
  // <Img ratio="…"> uses them; `og` (1.91:1) is built in.
  images: {
    ratios: { wide: 16 / 9, square: 1, portrait: 4 / 5 },
  },
  // The page backgrounds in src/styles/site.css (light and dark), so the
  // studio can check text colours from fields.color({ contrast: 'text' })
  // against both (spec §6.18). No blockPublishOn: every note only warns.
  a11y: {
    backgrounds: { 'Page, light': '#ffffff', 'Page, dark': '#12151f' },
  },
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
    // The URL lets the build's accessibility report trace the page to its entry.
    fixtures: { label: 'Accessibility fixtures', url: '/fixtures/:id', search: false },
  },
});
