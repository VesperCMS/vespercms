# @vesper/astro

The Vesper integration for Astro.

**Status:** Phases 2 and 2.5 complete. The integration injects the studio at `/admin`, serves local mode's API in `astro dev`, and reads the site's Markdoc config and declared MDX components for the body editor.

## The integration

```js
// astro.config.mjs
import vesper from '@vesper/astro';
export default defineConfig({ integrations: [vesper()] });
```

Zero config. It:

- injects `/admin`, one **prerendered** page, so it works with `output: 'static'` and no adapter. Studio screens use hash routes (`/admin/#/c/blog`), so deep links work on any host. Astro's `base` is respected.
- in `astro dev`, serves local mode's API at `<base>_vesper/api/`. It reads and writes content files on disk, validates every save with the site's own Zod schemas, refuses a body the site couldn't build (Markdoc checked with the site's real config, custom attribute types and `validate` functions included; MDX props with their Zod schemas), and refuses any request that isn't the studio on this machine (DECISIONS.md).
- reads `markdoc.config.*` the way @astrojs/markdoc does (merged by its own `setupConfig`) and learns its `allowHTML` and `ignoreIndentation` options from `astro.config`, so the studio parses Markdoc exactly as the site does. The manifest's `markdoc` section keeps only the schema parts: tags, attributes, `children`, `selfClosing`, `inline`, partials, function names and variable keys (never values).
- writes `dist/_vesper/manifest.json` after `astro build`, which is how the cloud learns the schema.

| Option | Default | |
|---|---|---|
| `studio.deploy` | `true` | `false` leaves `/admin` out of production builds, for sites edited only locally. |
| `siteName` | the host of Astro's `site`, then the package name | Shown in the studio's top bar and page titles. |

The studio comes precompiled from `@vesper/admin`. React and React DOM are peer dependencies, shared with any custom widgets.

### `vesper:content`

```ts
import { getCollection, getEntry, render } from 'vesper:content';
```

A drop-in for `astro:content` (spec §6.11). In builds it's a plain re-export. In `astro dev` it also notes which entries each page shows (`render`, `getEntry`) or lists (`getCollection`, `getEntries`), and the dev toolbar's **Vesper** app links each one straight to its editor ("Edit this page"). Types are injected, so no setup is needed.

### Custom widgets

Register them in `vesper.config.ts` (spec §6.3.3):

```ts
widgets: {
  'store-hours': {
    component: () => import('./src/cms/StoreHours.tsx'),
    accepts: (field) => field.kind === 'array',
    match: (field) => field.path.at(-1) === 'hours',
  },
},
```

A widget is a React component that receives `WidgetProps` (`import type { WidgetProps } from '@vesper/astro/config'`). The integration compiles widget files, and the JSX files they import, with React's automatic runtime, so the site needs no `@astrojs/react`; nothing else in the site is affected. Start widget files with `/** @jsxImportSource react */` so TypeScript checks them as React. A widget that fails to load falls back to the built-in control, with a note.

## Field helpers (`@vesper/astro/fields`)

Each helper returns **plain Zod with `.meta()` attached**, imported from `astro/zod`, so Astro validates it like any other schema. Content files hold plain values. Drop the import and paste the raw Zod, and the behavior is identical:

| Helper | Raw Zod equivalent | Stored as |
|---|---|---|
| `fields.color({ palette?, alpha? })` | `z.string().regex(/^#[0-9a-f]{6}$/i).meta({ widget: 'color' })` | `"#1a73e8"` |
| `fields.geo()` | `z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).meta({ widget: 'geo' })` | `{ lat, lng }` |
| `fields.slug({ from })` | `z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).meta({ widget: 'slug', widgetOptions: { from } })` | `"my-post"` |
| `fields.url()` | `z.url().meta({ widget: 'url' })` | `"https://…"` |
| `fields.email()` | `z.email().meta({ widget: 'email', autocomplete: 'email' })` | `"a@b.com"` |
| `fields.datetime()` | `z.coerce.date().meta({ widget: 'datetime' })` | ISO 8601 |
| `fields.select(options)` | `z.enum([...]).meta({ widgetOptions: { labels } })` | `"value"` |
| `fields.markdown({ inline? })` | `z.string().meta({ widget: 'markdown' })` | Markdown string |
| `fields.file({ accept })` | `z.string().meta({ widget: 'file', widgetOptions: { accept } })` | relative path |

A test checks that each helper equals its raw equivalent, so this table can't drift. `fields.image()` (focal point and crops) arrives in Phase 2.7.

```ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { fields } from '@vesper/astro/fields';

const settings = defineCollection({
  loader: glob({ pattern: 'site.yaml', base: './src/content/settings' }),
  schema: z.object({ brandColor: fields.color({ palette: { Indigo: '#28335f' } }), website: fields.url() }),
});
```

## `vesper.config.ts` (`@vesper/astro/config`)

```ts
import { defineConfig } from '@vesper/astro/config';
export default defineConfig({
  collections: {
    pages: { url: '/:path', tree: true },
    settings: { singleton: true, label: 'Site settings' },
  },
});
```

It holds presentation, URLs, widgets and permissions, never field definitions (D2). Unknown keys warn rather than fail.

### Markdoc hints and MDX components (spec §6.5.1, §6.5.2)

Markdoc tags already declare their attributes in `markdoc.config.mjs`; the studio builds each tag's settings form from them. Optional UI hints live here, never in Markdoc's config:

```ts
markdoc: {
  tags: {
    callout: {
      label: 'Callout',
      summary: 'type', // shown in the block's header: "Callout · Warning"
      attributes: { type: { labels: { note: 'Note', warning: 'Warning', tip: 'Tip' } } },
    },
    youtube: { label: 'YouTube video', attributes: { title: { description: 'Describes the video for screen reader users.' } } },
  },
},
```

Hints cover a friendly name, help text, the summary attribute, value labels and a `widget` per attribute (so `color` and `geo` work inside tags too).

MDX components don't declare their props anywhere the editor can read, so they are blocks only when declared here with a Zod props schema (from `astro/zod`). Undeclared components, expressions, imports and exports stay protected source blocks:

```ts
mdx: {
  components: {
    Callout: { label: 'Callout', summary: 'type', children: true, props: z.object({ type: fields.select({ note: 'Note', tip: 'Tip' }).default('note'), title: z.string().optional() }) },
    YouTube: { label: 'YouTube video', props: z.object({ id: z.string(), title: z.string() }) },
  },
},
```

`children: true` makes a frame whose content stays editable; `inline: true` inserts the component inside a line of text. The studio loads `vesper.config.ts`, props schemas included, the first time an MDX body needs them, so it checks props exactly as the site does.
