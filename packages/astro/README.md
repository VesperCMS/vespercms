# @vesper/astro

The Vesper integration for Astro.

**Status:** Phase 2, in progress. The integration injects the studio at `/admin` and serves local mode's API in `astro dev`. The studio's list and editor screens, widgets, media and the dev toolbar are still being built.

## The integration

```js
// astro.config.mjs
import vesper from '@vesper/astro';
export default defineConfig({ integrations: [vesper()] });
```

Zero config. It:

- injects `/admin`, one **prerendered** page, so it works with `output: 'static'` and no adapter. Studio screens use hash routes (`/admin/#/c/blog`), so deep links work on any host. Astro's `base` is respected.
- in `astro dev`, serves local mode's API at `<base>_vesper/api/`. It reads and writes content files on disk, validates every save with the site's own Zod schemas, and refuses any request that isn't the studio on this machine (DECISIONS.md).
- writes `dist/_vesper/manifest.json` after `astro build`, which is how the cloud learns the schema.

| Option | Default | |
|---|---|---|
| `studio.deploy` | `true` | `false` leaves `/admin` out of production builds, for sites edited only locally. |
| `siteName` | the host of Astro's `site`, then the package name | Shown in the studio's top bar and page titles. |

The studio comes precompiled from `@vesper/admin`. React and React DOM are peer dependencies, shared with any custom widgets.

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
