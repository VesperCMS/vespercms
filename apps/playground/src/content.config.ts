import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { fields } from '@vesper/astro/fields';

/*
 * The playground's schemas exercise every field mapping in spec §6.2 and
 * every `fields.*` helper (spec §6.3.2). The locations collection keeps
 * the raw Zod that fields.geo() and fields.color() produce, as the
 * documented equivalent. The blog hero stays raw until fields.image()
 * ships in Phase 2.7.
 */

/** A normalized rectangle, 0–1 with the origin top-left (spec §6.6.2). */
const cropRect = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

const blog = defineCollection({
  // `[^_]` keeps `_`-prefixed drafts and helper files out of the collection.
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().meta({ label: 'Title' }),
      summary: z
        .string()
        .meta({ widget: 'textarea', description: 'One or two sentences for cards and search.' }),
      // The §6.6.2 image object, written out the way `fields.image(image, { ratios })` will
      // produce it in Phase 2.7.
      hero: z
        .object({
          src: image(),
          alt: z.string(),
          decorative: z.boolean().optional(),
          focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
          crops: z.record(z.string(), cropRect).optional(),
        })
        .refine((hero) => (hero.decorative === true ? hero.alt === '' : hero.alt.trim() !== ''), {
          message: 'Describe this image, or mark it decorative.',
          path: ['alt'],
        })
        .meta({ widget: 'image', widgetOptions: { ratios: ['wide', 'square'] } })
        .optional(),
      author: reference('authors'),
      related: z.array(reference('blog')).optional(),
      tags: z.array(z.string()).default([]),
      category: fields.select({ news: 'News', guides: 'Guides', stories: 'Stories' }),
      publishedAt: z.coerce.date(),
      updatedAt: z.date().optional(),
      draft: z.boolean().default(false),
      // Deliberately unmappable: the editor shows a raw YAML field for unions (spec §6.2).
      series: z
        .union([z.string(), z.object({ name: z.string(), part: z.number().int().positive() })])
        .optional(),
    }),
});

const authors = defineCollection({
  loader: file('src/data/authors.json'),
  schema: z.object({
    name: z.string(),
    role: z.string().optional(),
    email: fields.email(),
    url: fields.url().optional(),
    // A slug-style field that isn't named `slug`: on file() data, `id` decides the entry ID.
    handle: fields.slug({ from: 'name' }).optional(),
  }),
});

const pages = defineCollection({
  // The folder is the hierarchy (spec §6.15): `academics/nursing/index.md` is
  // /academics/nursing/. `_order.yaml` and `_`-prefixed drafts sit beside the
  // pages and are kept out by the pattern.
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().optional(),
    nav: z
      .object({
        label: z.string().optional().meta({ description: 'Shorter title for menus.' }),
        hidden: z.boolean().default(false),
      })
      .meta({ label: 'Navigation' })
      .optional(),
    sections: z
      .array(
        z.object({
          heading: z.string(),
          body: fields.markdown({ inline: true }),
        }),
      )
      .default([]),
    brochure: fields.file({ accept: 'application/pdf' }).optional(),
  }),
});

const docs = defineCollection({
  // Markdoc entries. Tags, partials, variables and conditionals are covered by
  // markdoc.config.mjs and the files themselves (spec §6.5.1).
  loader: glob({ pattern: '**/[^_]*.mdoc', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    order: z.number().int().optional(),
    updated: fields.datetime().optional(),
  }),
});

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);

const settings = defineCollection({
  // A singleton: one YAML file, one entry (ID `site`). vesper.config.ts marks
  // it `singleton: true` from Phase 1.
  loader: glob({ pattern: 'site.yaml', base: './src/content/settings' }),
  schema: z.object({
    siteName: z.string(),
    tagline: z.string().meta({ widget: 'textarea' }),
    brandColor: fields.color({ palette: { Indigo: '#28335f', Pine: '#2f5d50', Brick: '#8a3b3b' } }),
    website: fields.url(),
    headquarters: fields.geo({ zoom: 14 }).optional(),
    timeZone: z
      .string()
      .meta({ description: 'IANA time zone name, for example America/New_York (spec §6.17).' }),
    social: z
      .array(
        z.object({
          network: z.enum(['mastodon', 'bluesky', 'instagram', 'youtube', 'linkedin']),
          url: fields.url(),
        }),
      )
      .default([]),
  }),
});

const locations = defineCollection({
  loader: file('src/data/locations.yaml'),
  schema: z.object({
    name: z.string(),
    address: z.string(),
    // The raw Zod that fields.geo() and fields.color() produce (spec §6.3.2). These stay
    // raw on purpose, as the documented equivalent of the helpers.
    geo: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .meta({ widget: 'geo', label: 'Map location' }),
    color: hexColor.meta({ widget: 'color', label: 'Map pin color' }),
    open: z.boolean(),
    // Edited with the playground's custom "store-hours" widget (src/cms/StoreHours.tsx),
    // which vesper.config.ts registers and matches by the field's name (spec §6.3.3).
    hours: z
      .array(
        z.object({
          days: z.string().min(1),
          opens: z.string().regex(/^\d\d:\d\d$/),
          closes: z.string().regex(/^\d\d:\d\d$/),
        }),
      )
      .optional(),
  }),
});

const events = defineCollection({
  // Scheduling is on for this collection (vesper.config.ts from Phase 1). The
  // build-time filtering by publishAt/unpublishAt arrives in Phase 4.5 (D18).
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    startsAt: fields.datetime(),
    endsAt: fields.datetime().optional(),
    location: reference('locations').optional(),
    publishAt: fields.datetime().optional(),
    unpublishAt: fields.datetime().optional(),
    unpublishRedirect: z
      .string()
      .meta({ widget: 'url', description: 'Where visitors go after this event is unpublished.' })
      .optional(),
  }),
});

const fixtures = defineCollection({
  // Deliberately inaccessible test pages (addendum §7). Excluded from the
  // e2e axe gate and from real-content checks; the studio's layer-1 checks
  // must flag every mistake in them.
  loader: glob({ pattern: '**/[^_]*.mdoc', base: './src/content/fixtures' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    textColor: fields.color(),
    brochure: fields.file({ accept: 'application/pdf' }).optional(),
  }),
});

export const collections = { blog, authors, pages, docs, settings, locations, events, fixtures };
