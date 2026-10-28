import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { fields } from 'vespercms/fields';

/*
 * vespercms.com's content, edited in Vesper's own studio at /admin. The
 * schemas stay plain (no unions), so every field gets a real control rather
 * than raw YAML.
 */

const link = z.object({
  label: z.string(),
  href: z.string().meta({ description: 'A path on this site, like /docs/, or a full address.' }),
});

// Lucide's names (lucide.dev), chosen from a short list so the page stays one
// family of pictures. Add a name here to offer it in the studio, which shows
// each beside its picture.
const icon = fields.icon({
  accessibility: 'Accessibility',
  blocks: 'Blocks',
  bot: 'Bot',
  'code-xml': 'Code',
  crop: 'Crop',
  'file-check': 'File with a check',
  'file-diff': 'File with changes',
  'file-text': 'Document',
  'folder-lock': 'Locked folder',
  globe: 'Globe',
  images: 'Images',
  keyboard: 'Keyboard',
  laptop: 'Laptop',
  'layout-template': 'Layout',
  'list-tree': 'Outline',
  mail: 'Mail',
  rocket: 'Rocket',
  search: 'Search',
  'shield-check': 'Shield',
  signpost: 'Signpost',
  'sliders-horizontal': 'Settings',
  'sun-moon': 'Sun and moon',
  table: 'Table',
  'text-cursor-input': 'Text field',
});

// A screenshot pair: the studio looks different in each theme, so the dark
// picture replaces the light one for visitors who use the dark theme.
const pictures = <Src extends z.ZodType>(image: () => Src) => ({
  image: fields
    .image(image)
    .optional()
    .meta({ description: 'A screenshot or picture, shown in the light theme.' }),
  imageDark: image().optional().meta({
    label: 'Image, dark theme',
    description: 'The same picture in the dark theme. It shares the alt text above.',
  }),
});

const pages = defineCollection({
  // The folder is the hierarchy (spec §6.15): index.md is the home page.
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/pages' }),
  schema: ({ image }) =>
    z.object({
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
          description:
            'The large statement at the top. Without one, the page starts with its title.',
        })
        .optional(),
      sections: z
        .array(
          z.object({
            heading: z.string(),
            intro: fields.markdown({ inline: true }).optional(),
            // With a picture, the section is a row: its words on one side, the
            // picture on the other. Points with pictures are cards with them on top.
            ...pictures(image),
            points: z
              .array(
                z.object({
                  title: z.string(),
                  body: fields.markdown({ inline: true }),
                  icon: icon.optional(),
                  ...pictures(image),
                }),
              )
              .default([]),
          }),
        )
        .default([]),
      closing: z
        .object({
          heading: z.string(),
          lead: fields.markdown({ inline: true }).optional(),
          command: z.string().optional().meta({
            description: 'A shell command shown with a Copy button, like the install command.',
          }),
          actions: z.array(link).max(2).default([]),
        })
        .meta({ description: 'The last word, after the sections.' })
        .optional(),
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
