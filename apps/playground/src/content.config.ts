import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { fields } from '@vesper/astro/fields';

/*
 * The playground's schemas exercise every field mapping in spec §6.2 and
 * every `fields.*` helper (spec §6.3.2). The locations collection keeps
 * the raw Zod that fields.geo() and fields.color() produce, as the
 * documented equivalent.
 */

const blog = defineCollection({
  // `[^_]` keeps `_`-prefixed drafts and helper files out of the collection.
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().meta({ label: 'Title' }),
      summary: z
        .string()
        .meta({ widget: 'textarea', description: 'One or two sentences for cards and search.' }),
      // The spec §6.6.2 image: alt text or decorative, a focal point, and crops for the
      // ratios the studio previews (vesper.config.ts declares them).
      hero: fields.image(image, { ratios: ['wide', 'square'] }).optional(),
      author: reference('authors'),
      related: z.array(reference('blog')).optional(),
      tags: z.array(z.string()).default([]),
      category: fields.select({ news: 'News', guides: 'Guides', stories: 'Stories' }),
      publishedAt: z.coerce.date(),
      updatedAt: z.date().optional(),
      draft: z.boolean().default(false),
      // Site search's switch (spec §6.19): the studio shows it in Details.
      hideFromSearch: fields.hideFromSearch(),
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
  schema: ({ image }) =>
    z.object({
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
      // Blocks: a list of different kinds, told apart by `type` (DECISIONS.md, "Blocks are
      // a discriminated union of objects"). Each kind's .meta() names it in the Add menu.
      blocks: z
        .array(
          z.discriminatedUnion('type', [
            z
              .object({
                type: z.literal('text'),
                heading: z.string().optional(),
                body: fields.markdown(),
              })
              .meta({ label: 'Text', description: 'A heading and a few paragraphs.' }),
            z
              .object({
                type: z.literal('faq'),
                heading: z.string(),
                items: z.array(
                  z.object({
                    question: z.string(),
                    answer: z.string().meta({ widget: 'textarea' }),
                  }),
                ),
              })
              .meta({ label: 'FAQ', description: 'Questions and answers.' }),
            z
              .object({
                type: z.literal('figure'),
                image: fields.image(image),
                caption: z.string().optional(),
              })
              .meta({ label: 'Figure', description: 'One picture, with a caption.' }),
          ]),
        )
        .optional(),
      brochure: fields.file({ accept: 'application/pdf' }).optional(),
      hideFromSearch: fields.hideFromSearch(),
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
    // One of two kinds, chosen in the studio before its own fields (a single union).
    ticket: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('free') }).meta({ label: 'Free' }),
        z
          .object({ kind: z.literal('paid'), price: z.number().min(0), url: fields.url() })
          .meta({ label: 'Paid', description: 'Bought ahead, at the address below.' }),
      ])
      .optional(),
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
    // A text colour: the studio checks it against vesper.config.ts's a11y.backgrounds.
    textColor: fields.color({ contrast: 'text' }),
    brochure: fields.file({ accept: 'application/pdf' }).optional(),
  }),
});

export const collections = { blog, authors, pages, docs, settings, locations, events, fixtures };
