import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { fields } from '@vesper/astro/fields';

/*
 * vespercms.com's content, edited in Vesper's own studio at /admin. The
 * schemas stay plain (no unions), so every field gets a real control rather
 * than raw YAML.
 */

const link = z.object({
  label: z.string(),
  href: z.string().meta({ description: 'A path on this site, like /docs/, or a full address.' }),
});

const pages = defineCollection({
  // The folder is the hierarchy (spec §6.15): index.md is the home page.
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().meta({
      widget: 'textarea',
      description: 'One or two sentences for search results and link previews.',
    }),
    hero: z
      .object({
        heading: z.string(),
        lead: z.string().meta({ widget: 'textarea' }),
        actions: z
          .array(link)
          .max(2)
          .default([])
          .meta({ description: 'The first is the main button; the second sits beside it.' }),
      })
      .meta({
        description: 'The large statement at the top. Without one, the page starts with its title.',
      })
      .optional(),
    sections: z
      .array(
        z.object({
          heading: z.string(),
          intro: fields.markdown({ inline: true }).optional(),
          points: z
            .array(z.object({ title: z.string(), body: fields.markdown({ inline: true }) }))
            .default([]),
        }),
      )
      .default([]),
    hideFromSearch: fields.hideFromSearch(),
  }),
});

const docs = defineCollection({
  // Markdoc, for callouts (markdoc.config.mjs). Each folder is a section of
  // the docs menu, with its own index page and _order.yaml.
  loader: glob({ pattern: '**/[^_]*.mdoc', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().meta({
      widget: 'textarea',
      description: 'One sentence. It sits under the title, in search results and in llms.txt.',
    }),
    menuLabel: z
      .string()
      .optional()
      .meta({ description: 'A shorter title for the docs menu.', placement: 'details' }),
    hideFromSearch: fields.hideFromSearch(),
  }),
});

const settings = defineCollection({
  loader: glob({ pattern: 'site.yaml', base: './src/content/settings' }),
  schema: z.object({
    tagline: z.string().meta({ widget: 'textarea', description: 'Shown in the footer.' }),
    nav: z.array(link).default([]).meta({ label: 'Header links' }),
    repository: fields
      .url()
      .optional()
      .meta({ description: 'The source on GitHub, linked from the footer when set.' }),
  }),
});

export const collections = { pages, docs, settings };
