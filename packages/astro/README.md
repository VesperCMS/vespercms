# @vesper/astro

The Vesper integration for Astro.

**Status:** Phases 2 to 3 complete. The integration injects the studio at `/admin`, serves local mode's API in `astro dev`, reads the site's Markdoc config and declared MDX components for the body editor, handles URLs, page trees and redirects, renders images with their focal points and crops, checks every built page's accessibility structure, builds the site's search, and in GitHub mode lets editors publish from the deployed site.

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
- when the site uses Astro's own Sharp image service, wraps it so each image's stored crop is cut before Astro resizes it (see "Images" below). The build log says so.
- writes `dist/_vesper/manifest.json` after `astro build`, which is how the cloud learns the schema.
- after `astro build`, checks every page's accessibility structure and writes `.vesper/a11y-report.json` beside `dist/` (see "Accessibility checks at build" below).
- after `astro build`, when a page uses `<Search>`, indexes the site with Pagefind into `dist/_vesper/search/`, and injects a plain `/search` page unless the site has its own. With no `<Search>` in the site's own pages, the build writes no index and leaves the injected page out (see "Site search" below).

| Option | Default | |
|---|---|---|
| `studio.deploy` | `true` | `false` leaves `/admin` out of production builds, for sites edited only locally. |
| `siteName` | the host of Astro's `site`, then the package name | Shown in the studio's top bar and page titles. |
| `a11y` | `{}` | Accessibility checks at build. `{ failBuildOn: 'error' }` (or `'warning'`) fails the build on an issue at that level; `false` turns the check off. |
| `github` | off | GitHub mode (see below): `{ relay }`, plus `repo`, `branch`, `root` or `apiUrl` when git can't tell them. |
| `cloud` | off | The cloud (see below): `{ project }`, or `true` to read `VESPER_PROJECT`. |
| `search` | `{}` | Site search. `filters` and `sort` name each collection's fields, `exclude` leaves pages out by URL, `noJsLink` and `noJsFallback` decide what `/search` offers without JavaScript, `strings` gives other languages' words. `false` turns search off. |
| `imageService` | `true` | `false` leaves Astro's image service alone. `<Img>` then uses Astro's own server crop for each ratio, with the focal point as `object-position`, and manual crops aren't applied. |

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
| `fields.color({ palette?, alpha?, contrast? })` | `z.string().regex(/^#[0-9a-f]{6}$/i).meta({ widget: 'color' })` | `"#1a73e8"` |
| `fields.geo({ defaultCenter?, zoom? })` | `z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).meta({ widget: 'geo' })` | `{ lat, lng }` |
| `fields.slug({ from })` | `z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).meta({ widget: 'slug', widgetOptions: { from } })` | `"my-post"` |
| `fields.url()` | `z.url().meta({ widget: 'url' })` | `"https://…"` |
| `fields.email()` | `z.email().meta({ widget: 'email', autocomplete: 'email' })` | `"a@b.com"` |
| `fields.datetime()` | `z.coerce.date().meta({ widget: 'datetime' })` | ISO 8601 |
| `fields.select(options)` | `z.enum([...]).meta({ widgetOptions: { labels } })` | `"value"` |
| `fields.markdown({ inline? })` | `z.string().meta({ widget: 'markdown' })` | Markdown string |
| `fields.file({ accept })` | `z.string().meta({ widget: 'file', widgetOptions: { accept } })` | `"/files/brochure.pdf"` |
| `fields.hideFromSearch()` | `z.boolean().default(false).meta({ label: 'Hide from site search', description, placement: 'details', search: 'hide' })` | `true` / `false` |

A test checks that each helper equals its raw equivalent, so this table can't drift. Options a helper takes go into `widgetOptions`, as they would in the raw form:

- `fields.color({ contrast: 'text' })` (or `'large-text'`, `'graphic'`) adds `widgetOptions: { contrast }`: the studio then checks the colour against the site's `a11y.backgrounds`, at 4.5:1 for text and 3:1 otherwise.
- `fields.geo({ defaultCenter: { lat, lng }, zoom })` adds `widgetOptions: { defaultCenter, zoom }`: where the map starts when the field is empty.
- `fields.markdown({ inline: true })` adds `widgetOptions: { inline: true }`: a single paragraph with bold, italic and links, and no lists.

`fields.file()` uploads go to `public/files/` (or beside the file they replace) and store the public path, `/files/brochure.pdf`. A file chosen from under `src/` is stored relative to the entry instead, such as `./brochure.pdf`.

`fields.image(image, { ratios? })` takes Astro's `image` helper from the schema function, so `src` still resolves to `ImageMetadata` (spec §6.6.2):

```ts
schema: ({ image }) => z.object({ hero: fields.image(image, { ratios: ['wide', 'square'] }) }),
```

It stores `{ src, alt, decorative?, focus?: { x, y }, crops?: { [ratio]: { x, y, w, h } } }`, every number 0–1 from the top left. `alt` is required unless the image is decorative (`alt: ""`, `decorative: true`); focal points and crops must lie inside the image. Its raw Zod is in the helper's doc comment, and a test keeps the two equal. `ratios` names the crops the studio previews; without it, every ratio the site declares.

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

### Collection icons

```ts
collections: {
  blog: { icon: 'newspaper' },
  events: { icon: 'calendar-days' },
},
```

- **`icon`** names a [Lucide](https://lucide.dev/icons) icon as that page lists it, in kebab case. The studio shows it beside the collection's name on Home, in the Content menu and before the collection's heading. Without one, a collection gets a page, a tree collection an outline and a singleton sliders.
- The drawing is looked up when the manifest is built, from the site's own `lucide` package, so the studio never carries the whole icon set. `lucide` is an optional peer dependency: install it (`npm install lucide`) only if you name an icon. Without it, or for a name Lucide doesn't have, the build warns and the collection keeps its default.

### URLs, trees and redirects (spec §6.15)

```ts
collections: {
  pages: { url: '/:path', tree: true, maxDepth: 4 },
  blog: { url: '/blog/:publishedAt|yyyy/:slug' },
  people: { url: (entry) => `/people/${entry.id}` }, // the escape hatch: pure, no server-only imports
},
redirects: { native: ['apache'] },
```

- **`url`** is the one source of truth for where an entry lives: "View on site", the link picker, redirects, breadcrumbs and the helpers all use it. Tokens: `:id`, `:path` (the ID without a trailing `/index`; a top-level `index` is the root), `:slug`, `:<field>`, and `:<dateField>|yyyy`, `|mm`, `|dd` (calendar dates keep their day; times are read in the site's `timeZone`). Generated URLs follow Astro's `base`, `trailingSlash` and `build.format`. A function gets the entry's `id`, `collection` and `data` (its frontmatter, typed `unknown`, so narrow it before reading a field) and returns the entry's path on the site.
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

### Images (spec §6.6.3)

```ts
images: {
  ratios: { wide: 16 / 9, square: 1, portrait: 4 / 5 }, // width / height; og (1.91) is built in
  maxUploadEdge: 3000, // uploads with a longer edge are scaled down in the browser
},
```

The ratios drive the studio's crop previews and `<Img ratio>`, so editors see exactly the crops the site renders.

### Accessibility (spec §6.18)

```ts
a11y: {
  backgrounds: { 'Page, light': '#ffffff', 'Page, dark': '#12151f' }, // what text is drawn on
  blockPublishOn: ['missing-alt'], // optional: these rules' notes refuse a save
},
collections: {
  docs: { headingStart: 1 }, // the body holds its own h1; 2 by default
},
```

The studio checks each entry as it's edited (layer 1): alt text, heading order and empty headings, vague and new-tab links, tables without a header row, typed lists, empty names on embeds, video captions, text colours against the declared backgrounds, and PDFs (tagged, title, language). Notes appear beside the field they concern, and every note only warns unless its rule is in `blockPublishOn`. Rule IDs: `missing-alt`, `alt-file-name`, `alt-redundant`, `alt-too-long`, `heading-skip`, `heading-extra-top`, `heading-empty`, `link-vague`, `link-new-window`, `table-header`, `color-contrast`, `tag-name-empty`, `fake-list`, `pdf-untagged`, `pdf-no-title`, `pdf-no-language`, `video-captions`.

A Markdoc tag or declared MDX component gets the embed checks from its own schema: a required `title`, `alt`, `label` or `aria-label` attribute left empty is a note, and a tag with a `captions` attribute asks to confirm captions when it's absent or off.

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

Hints cover a friendly name, help text, the summary attribute, value labels and a `widget` per attribute. A widget applies as it would to a schema field of the attribute's type: a `String` attribute can take `textarea`, `url` or `color` (the full picker, since hints carry no `widgetOptions`), or a custom widget. `Object` and `Array` attributes are edited as YAML, so `geo` can't apply; naming it warns in the terminal and keeps the YAML field.

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

## Accessibility checks at build (spec §6.18, layer 2)

After every `astro build`, each built page is loaded into jsdom (no browser) and axe-core runs only its structure rules: language, page title, landmarks, heading order, image alt, form labels, names on links and buttons, duplicate IDs, basic ARIA, list and table structure. Colour contrast and other visual rules need a rendered page and aren't checked here. Astro's redirect pages and the studio's shell are skipped.

- **The report** is `.vesper/a11y-report.json` in the project, never in `dist/`, so it's never deployed. The integration writes `.vesper/.gitignore` so it stays out of git. Each page with issues lists them in plain words, with axe's impact as `error` or `warning`, the element, and a link to axe's explanation.
- **Page to entry.** A page is traced to the entry that produced it through its collection's `url` in vesper.config.ts, the URLs the studio uses, with the entry's file and its studio link ("fix in studio"). Pages without one (listings, the 404 page, collections with no `url`) have `entry: null`.
- **Failing the build** is off by default. `vesper({ a11y: { failBuildOn: 'error' } })` fails it after the report is written.
- It adds about a tenth of a second a page, plus a few seconds to load jsdom. `vesper({ a11y: false })` turns it off.

Automated checks find some problems, not all. The report says so, and nothing replaces testing with a keyboard and a screen reader (D19).

## Images (`@vesper/astro/components`)

`<Img>` renders an image field (spec §6.6.5) through Astro's own `<Image>`, `<Picture>` and `getImage()`:

```astro
---
import { Img, getImg } from '@vesper/astro/components';
const og = await getImg({ image: post.data.hero, ratio: 'og', width: 1200 }); // for <meta property="og:image">
---
<Img image={post.data.hero} ratio="wide" widths={[480, 960, 1440]} sizes="100vw" />
<Img image={post.data.hero} art={{ base: 'square', '(min-width: 48rem)': 'wide' }} />
<Img image={post.data.hero} layout="full-width" />
```

| Prop | What it does |
|---|---|
| `ratio` | A name from `images.ratios`, or a number. Uses the editor's own crop for that ratio if there is one, otherwise the crop the focal point gives, at that exact ratio. A fixed `width` and `height` without `ratio` count as a ratio too (with the focal point's crop). |
| `art` | Art direction: a `<picture>` with a `<source media>` per query, each with its own crop and size, then `base` for everything else. `formats` (default WebP) and `fallbackFormat` work as in Astro's `<Picture>`. |
| neither | Fluid: the whole image, no server crop; the focal point becomes `object-position` (`62% 35%`), so CSS cropping keeps the subject in frame. |
| always | `alt` from the field, `alt=""` when decorative. Every other Astro image prop passes through. `srcset` widths never go past the crop's own width. |

**How crops are cut.** With Astro's default Sharp service, the integration wraps it (`@vesper/astro/image-service`): the stored rectangle is cut from the upright image, then Astro resizes and encodes it as usual. The crops are ordinary files in `dist/`, so they work on every host (D16). `sharp` is an optional peer dependency: the copy Astro's own service already uses.

**With the wrapper off** (`vesper({ imageService: false })`) or **with a host's image service** (Cloudflare, Netlify, Vercel), `<Img>` still works: it asks for the ratio's size, which is Astro's own server crop (at the nearest of Sharp's anchors on Astro's Sharp service), and keeps the focal point as `object-position`. Manual crop rectangles are only applied with the wrapper, on Astro's default build-time Sharp service.

Never pass a focal point as Astro's `position`: Sharp accepts only its own keywords there, and `"62% 35%"` fails the build (DECISIONS.md).

## Site search (`@vesper/astro/components`)

Search is free and static (D23): once a page uses `<Search>`, every build indexes the site with [Pagefind](https://pagefind.app) into `dist/_vesper/search/`. It's plain files, so it works on any host, with no MIME type or rewrite to set. Until then the build writes no index and no `/search` page, and its log says so.

```astro
---
// In your layout
import { Search, SearchHead } from '@vesper/astro/components';
---
<head>
  <SearchHead />  <!-- opensearch.xml, when Astro's `site` is set -->
</head>
<header>
  <Search />      <!-- a "Search" button; Ctrl/⌘+K opens it too -->
</header>
```

```js
// astro.config.mjs
vesper({
  search: {
    filters: { blog: ['tags', 'author'] }, // text, lists of text, selects, references
    sort: { blog: ['publishedAt'] },       // dates, numbers, text
    exclude: ['/tags/**'],
  },
});
```

- **`<Search />`** is a button that opens a dialog: the field, filters as checkboxes (every entry's `Section` is its collection's label, then your `filters`), "Sort" once a section with a sort field is chosen, and results as a list of links with the date, an excerpt and a thumbnail of the entry's first image (its square crop). The count is announced once typing pauses. `<Search variant="inline" />` puts the same in the page; `<Search shortcut={false} />` drops Ctrl/⌘+K.
- **What's indexed:** every built page except Astro's redirect pages, `/admin`, `404`, the search page itself, pages with `<meta name="robots" content="noindex">`, and `exclude` patterns; and of entry pages, none from a collection with `search: false` in vesper.config.ts, none hidden with `fields.hideFromSearch()` (or a boolean `noindex`, at the top level or under `seo`), and none outside their publish window. The index reads each page's `<main>`, unless your pages mark their own content with `data-pagefind-body`. The deployed HTML is never changed.
- **`/search`** is injected as a plain page unless the site has `src/pages/search.astro` (put `<Search variant="inline" />` in your layout there). The injected page doesn't count as a use of `<Search>`, and the build leaves it out when nothing else uses it. It reads `?q=`. Without JavaScript it says search needs JavaScript and links to the home page (or `noJsLink`); `noJsFallback: 'duckduckgo'` makes its form search the site on DuckDuckGo instead.
- **In `astro dev`**, search uses the last build's index; before the first build it says so.
- **The build log** says how many pages it indexed and what a first search loads, and warns above 300 KB (uncompressed, as a host without compression sends it).
- **Other languages:** Pagefind keeps an index per `<html lang>`. `<Search>`'s words are English; give others with `search: { strings: { fr: { button: 'Rechercher', label: 'Rechercher sur ce site' } } }` (the keys are in `components/search/strings.ts`). The words written into the page (the button, the field's label, Close and the no-JavaScript text) follow `<Search>`'s `lang` prop, which defaults to Astro's current locale, then `en`; only the script reads `<html lang>`. Without Astro's i18n routing, a page in another language passes it: `<Search lang="fr" />`. The injected `/search` page takes its language the same way, so such a site puts its own in `src/pages/search.astro`.

**Theming.** `<Search>` inherits the site's font and colours. Four custom properties do the rest:

```css
:root {
  --vesper-search-accent: #1f5fd1;   /* focus ring and the tint of matches */
  --vesper-search-surface: #ffffff;  /* the dialog's background (default: Canvas) */
  --vesper-search-border: #4d566b;   /* borders: keep 3:1 against the surface */
  --vesper-search-radius: 0.5rem;
}
```

## GitHub mode (spec §6.8)

Editors sign in with their own GitHub account on the deployed site's `/admin` and publish from there. Each save is one commit to the repository's default branch, and the site's host rebuilds as on any push.

```js
// astro.config.mjs
vesper({ github: { relay: 'https://vesper-github-relay.your-account.workers.dev' } })
```

1. **The relay.** Deploy `templates/oauth-relay` (its README walks through creating the GitHub App and installing it on the repository). GitHub's token exchange needs the app's secret and can't be called from a browser, so it goes through the relay, which stores nothing.
2. **The repository.** `owner/name`, the default branch and the site's folder in the repository (for a monorepo) are read from git, or from the host's environment. Set `repo`, `branch` or `root` when they can't be read; the build log says so.
3. **The schemas.** At build, `content.config.ts` is also built for the browser into `_vesper/schemas.js`, so the studio checks saves with your real schemas. A config that imports Node-only code can't be; the log says why, the site still builds, and the studio checks what the manifest knows, with your build as the last check.

`astro dev` stays local mode. GitHub mode is on in built sites only.

**Hosts that check commit authors.** In GitHub mode each editor is the author of their commits. On private repositories, Vercel builds only commits by team members and Netlify holds unknown authors for approval: add your editors there, or build with GitHub Actions or Cloudflare Pages.

**A Content Security Policy for `/admin`**, if your host sets headers, needs `connect-src` for `https://api.github.com` and your relay, and `img-src blob:` for previews.

## The cloud (spec §6.9)

Editors sign in to Vesper on the deployed site's `/admin`. Their saves are drafts, kept by the cloud until someone who may publish does, as one commit by Vesper's GitHub App. Editors need no GitHub account.

```js
// astro.config.mjs
vesper({ cloud: { project: 'site_…' } })
```

- **The project ID** is the site's, from its settings in the dashboard: an identifier, not a secret. `VESPER_PROJECT` works too.
- **The cloud's addresses** are Vesper's own, `https://app.vespercms.com` and `https://api.vespercms.com`, so the project ID is all a site needs. Staging and tests set `app` and `api` (or `VESPER_CLOUD_APP` and `VESPER_CLOUD_API`), always both: one alone would sign in at one cloud and save to another.
- **The schemas** are built for the browser as in GitHub mode, so drafts are checked with your real schemas.

`astro dev` stays local mode; the cloud is on in built sites. A site can have GitHub mode too: the sign-in screen then offers both. Roles and grants are set per person in the dashboard, not in `vesper.config.ts`.


## The `vesper` command

The package installs a `vesper` command (`src/node/cli.ts`). It loads the site's configs through the site's own Vite, like the integration.

```sh
npx vesper agents            # write instructions for coding agents into AGENTS.md
npx vesper agents --check    # in CI: fail when AGENTS.md no longer matches the schema
npx vesper manifest          # print the manifest the studio is built from
```

- **`vesper agents`** turns the manifest into a guide for coding agents: the rules that keep the studio and the build working (splice, never reformat; raw values; check with `astro build`), the parts the site uses (images, page trees, redirects, Markdoc tags, declared MDX components), and every collection with its files, URL and fields. It goes between `<!-- vesper:agents:start -->` and `<!-- vesper:agents:end -->` in `AGENTS.md`, or `--file` relative to the site; the rest of the file is left alone. The output is deterministic, so `--check` compares bytes. Claude Code reads `CLAUDE.md`: an `@AGENTS.md` line there imports the file.
- **`vesper manifest`** prints the manifest, or writes it with `--out`, and exits with an error when a diagnostic is an error.
- Both take `--root <site>` and `--src-dir <dir>`.

`agentGuide(manifest)` and `withAgentGuide(file, guide)` do the same as functions, from `@vesper/astro/node`.
