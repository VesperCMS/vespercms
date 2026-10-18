import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Raw Zod from this site's own astro/zod (Astro 6's copy), with the parts
// Vesper detects by behaviour: image(), reference() and .meta() hints.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().meta({ label: 'Headline' }),
      cover: image().optional(),
      // fields.image()'s documented raw Zod (spec §6.6.2), on Astro 6's own Zod.
      hero: z
        .object({
          src: image(),
          alt: z.string(),
          decorative: z.boolean().optional(),
          focus: z
            .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
            .meta({ label: 'Focal point' })
            .optional(),
          crops: z
            .record(
              z.string(),
              z
                .object({
                  x: z.number().min(0).max(1),
                  y: z.number().min(0).max(1),
                  w: z.number().gt(0).max(1),
                  h: z.number().gt(0).max(1),
                })
                .refine((r) => r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9, {
                  message: 'The crop must lie inside the image.',
                }),
            )
            .optional(),
        })
        .refine((v) => (v.decorative === true ? v.alt === '' : v.alt.trim() !== ''), {
          message: 'Describe this image, or mark it decorative.',
          path: ['alt'],
        })
        .meta({ widget: 'image' })
        .optional(),
      author: reference('authors'),
      category: z.enum(['news', 'guides']),
      publishedAt: z.coerce.date(),
      draft: z.boolean().default(false),
    }),
});

const authors = defineCollection({
  loader: file('src/data/authors.json'),
  schema: z.object({ name: z.string(), email: z.email().optional() }),
});

export const collections = { blog, authors };
