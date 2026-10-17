import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { getSecret } from 'astro:env/server';

// Imports a runtime-only module, which can't load outside Astro. Vesper must
// report it plainly and keep going.
const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/posts' }),
  ...(getSecret('X') ? {} : {}),
});

export const collections = { posts };
