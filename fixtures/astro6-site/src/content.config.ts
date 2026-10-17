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
