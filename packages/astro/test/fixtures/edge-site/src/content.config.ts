import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { fields } from 'vespercms/fields';

// Edge cases for the manifest: an unknown widget name, a custom ID function,
// a custom parser, a loader that isn't glob() or file(), a non-object schema,
// a field claimed by a custom widget through match(), and an icon field that
// offers a name Lucide doesn't have.
const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes', generateId: ({ entry }) => entry }),
  schema: z.object({
    title: z.string(),
    summary: z.string().meta({ widget: 'fancy-editor' }),
    hours: z.array(z.string()),
    related: z.array(reference('people')).optional(),
    icon: fields.icon(['leaf', 'leef']).optional(),
  }),
});

const people = defineCollection({
  loader: file('src/data/people.csv', { parser: (text: string) => text.split('\n').map((id) => ({ id })) }),
  schema: z.object({ id: z.string() }),
});

const remote = defineCollection({
  loader: { name: 'remote-api', load: async () => {} },
  schema: z.object({ title: z.string() }),
});

const loose = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/loose' }),
  schema: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
});

export const collections = { notes, people, remote, loose };
