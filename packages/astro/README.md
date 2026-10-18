# @vesper/astro

The Vesper integration for Astro.

**Status:** Phases 2, 2.5 and 2.6 complete. The integration injects the studio at `/admin`, serves local mode's API in `astro dev`, reads the site's Markdoc config and declared MDX components for the body editor, and handles URLs, page trees and redirects.

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
- learns the site's routes from `astro:routes:resolved`: a page can't take an address a file in `src/pages` owns, each collection's rendering route is recorded in the manifest, and a collection whose URLs no route can produce gets a warning.
- at build, cleans `vesper.redirects.yaml` and hands it to Astro, and writes the host's own redirect rules when it has them (see below).
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

A drop-in for `astro:content` (spec §6.11). In builds it re-exports Astro's module. In `astro dev` it also notes which entries each page shows (`render`, `getEntry`) or lists (`getCollection`, `getEntries`), and the dev toolbar's **Vesper** app links each one straight to its editor ("Edit this page"). Types are injected, so no setup is needed.

It adds the site helpers (spec §6.15.7), which use the same URL and tree code as the studio:

```ts
import { getBreadcrumbs, getChildren, getTree, getUrl } from 'vesper:content';
const tree = await getTree('pages'); // nested by folder, ordered by _order.yaml, the home page first
const kids = await getChildren('pages', entry); // [{ title, url, entry, children, … }]
const crumbs = await getBreadcrumbs('pages', entry); // [{ title, url }], from Home to the entry
const href = getUrl(entry); // from the collection's url pattern, with base and trailing slash
```

A folder with no section page is still a node, with no entry and `url: null`. The module embeds each collection's `_order.yaml` files; in `astro dev` a change to one reloads the site's pages.

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

### URLs, trees and redirects (spec §6.15)

```ts
collections: {
  pages: { url: '/:path', tree: true, maxDepth: 4 },
  blog: { url: '/blog/:publishedAt|yyyy/:slug' },
  people: { url: (entry) => `/people/${entry.id}` }, // the escape hatch: pure, no server-only imports
},
redirects: { native: ['apache'] },
```

- **`url`** is the one source of truth for where an entry lives: "View on site", the link picker, redirects, breadcrumbs and the helpers all use it. Tokens: `:id`, `:path` (the ID without a trailing `/index`; a top-level `index` is the root), `:slug`, `:<field>`, and `:<dateField>|yyyy`, `|mm`, `|dd` (calendar dates keep their day; times are read in the site's `timeZone`). Generated URLs follow Astro's `base`, `trailingSlash` and `build.format`.
- **`tree: true`** shows the collection as an outline: the folder is the hierarchy, `folder/index.md` is the folder's section page, and an optional `_order.yaml` in each folder lists its children by slug (unlisted ones follow by title). Keep `_` files out of the glob, as in `'**/[^_]*.md'`; the manifest warns when a pattern would pick up `_order.yaml`.
- **`maxDepth`** limits how deep pages may go. There's no default (DECISIONS.md).

**Redirects** live in `vesper.redirects.yaml` at the site root (next to `astro.config`): `- { from: /old, to: /new, status: 301, reason: move, at: 2026-10-18 }`. Moving a page in the studio adds one for the page and each page under it; the studio's Redirects screen adds the rest, with CSV import. Every write and every build cleans the list: chains collapse, loops go, and a redirect whose old address is a real page again is dropped.

At build, the cleaned redirects go to Astro's `redirects`, so static output gets an HTML redirect page at each old URL, aimed at the new page's exact URL so it lands in one hop. That works on any host. True 301s come from the host's own rules, detected from the build environment or set in `redirects.native`:

| Host | Detected by | Output |
|---|---|---|
| Netlify | `NETLIFY` | `_redirects` in `dist`, forced (`301!`), Vesper's block first |
| Cloudflare Pages | `CF_PAGES` | `_redirects` in `dist` |
| Vercel | `VERCEL` | `redirects` in the site's `vercel.json`, kept in step by the studio whenever it writes redirects (Vercel reads the file before the build) |
| Apache / LiteSpeed | `native: ['apache']` | `RedirectMatch` lines in `dist/.htaccess` between `# BEGIN vesper` and `# END vesper` |
| nginx | `native: ['nginx']` | `dist/_vesper/nginx-redirects.conf`, for the server admin to include |

URLs a native rule covers get no HTML page. `dist/_vesper/redirects.json` lists the cleaned redirects (the S3 deploy template's input, Phase 9). Redirects aren't served by `astro dev`.

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
