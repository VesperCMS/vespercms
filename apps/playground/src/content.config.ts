import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

/*
 * The playground's schemas exercise every field mapping in spec §6.2. They use
 * raw Zod plus `.meta()` hints until Phase 1 ships the `fields.*` helpers.
 * Where a helper is coming, the raw Zod here is exactly what that helper will
 * produce, so swapping it in changes nothing about validation.
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
      category: z.enum(['news', 'guides', 'stories']),
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
    email: z.email().meta({ autocomplete: 'email' }),
    url: z.url().optional(),
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
          body: z.string().meta({ widget: 'markdown', widgetOptions: { inline: true } }),
        }),
      )
      .default([]),
  }),
});

export const collections = { blog, authors, pages };
