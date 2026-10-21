## Content and the Vesper studio

People edit this site’s content in the Vesper studio at `/admin`, and every save is a change to a file in this repository. You can edit the same files. These rules keep the studio, the build and people’s history intact.

### Rules

- **The schema is `src/content.config.ts`.** The studio is built from it; there is no second schema. To add or change a field, edit the Zod schema there, with `z` imported from `astro/zod`, never `zod`. `vesper.config.ts` holds only presentation: labels, URLs, icons and widgets.
- **Change only what you mean to change.** Edit a value in place. Don’t reformat frontmatter or data files, reorder keys, change quoting or indentation, or run a formatter over content: the studio keeps every byte it didn’t edit, and people review content changes as diffs.
- **Write values as the file stores them, not as Zod parses them.** Leave out fields you aren’t setting, even ones with defaults, and keep dates in the form the file already uses.
- **Check your work with `npx astro build`.** It validates every entry against its schema and fails on a body that doesn’t parse. Afterwards `.vesper/a11y-report.json`, when present, lists accessibility issues on the built pages, with the entry each came from.

### Images

An image field stores an object: `{ src, alt, decorative?, focus?, crops? }`.

- `src` is the image file’s path relative to the entry’s file, as Astro’s `image()` expects. Put new images beside the collection’s existing ones, or in `src/assets/<collection>/`.
- `alt` is required. Say what the image shows that the text around it doesn’t. For a purely decorative image, write `alt: ""` and `decorative: true`.
- `focus: { x, y }` is the focal point, and `crops: { <ratio>: { x, y, w, h } }` holds crops for named ratios. Every number is from 0 to 1, measured from the top left. Editors set both in the studio; leave them as they are unless asked.
- Never edit the image file to crop or resize it. Crops are cut at build, and the original stays as uploaded.
- This site’s ratios (width ÷ height): `wide` 1.78, `square` 1, `portrait` 0.8, `og` 1.91.

### Page trees

In `pages`, the folder is the hierarchy:

- `folder/index.md` is the folder’s own page (any of the collection’s formats), and a top-level `index` file is the root page.
- An optional `_order.yaml` in each folder lists its pages’ slugs (file or folder names, without extensions) in menu order. Pages it doesn’t list follow, by title. When you add a page, add its slug where it belongs.
- Moving or renaming a page changes its URL and the URLs of every page under it. Prefer the studio’s Move: it moves the files, updates both `_order.yaml` files, adds a redirect for every old URL and rewrites internal links, as one change. By hand, do all four.

### Redirects

`vesper.redirects.yaml`, beside `astro.config` (create it when there’s none), lists old addresses and where they went:

```yaml
- { from: /old-page, to: /new-page, status: 301, reason: manual, at: 2026-01-31 }
```

Add one whenever a published page’s URL changes. `from` and `to` are paths on the site without a trailing slash; `to` may also be a full URL elsewhere. Every build collapses chains and drops a redirect whose old address is a page again.

### Markdoc tags

Markdoc bodies (`.mdoc`) may use these tags from `markdoc.config.mjs`. The build fails on an unknown tag or a missing required attribute, and the studio refuses to save one.

- `{% callout %}…{% /callout %}` (Callout): a block holding paragraphs, lists.
  - `type`: one of `note`, `warning`, `tip`. Default `"note"`.
  - `title`: text. Optional. Shown above the callout. Leave it empty to use the type.
- `{% youtube /%}` (YouTube video): self-closing.
  - `id` (Video ID): text. Required. The part after “v=” in the video’s address.
  - `title`: text. Required. Describes the video for screen reader users.
  - `captions` (The video has captions): `true` or `false`. Optional.
- `{% abbr %}…{% /abbr %}` (Abbreviation): inline, inside a line of text.
  - `title` (Full form): text. Required. What the abbreviation stands for.

Variables, conditionals (`{% if %}`), functions, partials and annotations are kept exactly as written by the studio; change them by hand only when asked. The config declares variables `$product.name`, `$product.beta`, `$product.tier`.

### MDX components

MDX bodies may use these components, which the studio edits as blocks and checks against their props. Anything else in an MDX body (other components, imports, expressions) the studio keeps as source.

- `<Callout>…</Callout>` (Callout): a block with content inside.
  - `type`: one of `note`, `warning`, `tip`. Default `"note"`.
  - `title`: text. Optional.

### Collections

In URL patterns, `:id` is the entry’s ID (its path without the extension), `:path` is the ID without a trailing `/index`, `:slug` is its slug, and `:field` is that field’s value.

#### Blog posts (`blog`)

Markdown (`.md`) files in `src/content/blog/`, matching `**/[^_]*.md`. Fields go in the frontmatter; the rest of the file is the body. URL: `/blog/:id`.

- `title`: text. Required.
- `summary`: text. Required. One or two sentences for cards and search.
- `hero`: an image (see Images), with crops for `wide`, `square`. Optional.
- `author`: the ID of an entry in `authors`. Required.
- `related`: a list of IDs of entries in `blog`. Optional.
- `tags`: a list of strings. Default `[]`.
- `category`: one of `news`, `guides`, `stories`. Required.
- `publishedAt`: a date, such as `2026-01-31`. Required.
- `updatedAt`: a date, such as `2026-01-31`. Optional.
- `draft`: `true` or `false`. Default `false`.
- `hideFromSearch` (Hide from site search): `true` or `false`. Default `false`. The page stays on the site. It just won’t show up in the site’s own search.
- `series`: any value the schema accepts (a Zod union); the studio edits it as raw YAML. Optional.

#### People (`authors`)

Entries are the items in `src/data/authors.json`. Keep the file’s shape: each entry’s ID is its `id`, or its key in an object.

- `name`: text. Required.
- `role`: text. Optional.
- `email`: an email address. Required.
- `url`: a full URL. Optional.
- `handle`: a slug: lowercase letters, numbers and hyphens. Optional.

#### Pages (`pages`)

Markdown (`.md`) or MDX (`.mdx`) files in `src/content/pages/`, matching `**/[^_]*.{md,mdx}`. Fields go in the frontmatter; the rest of the file is the body. URL: `/:path`, as a page tree (see Page trees).

- `title`: text. Required.
- `summary`: text. Optional.
- `nav` (Navigation): an object with the fields below. Optional.
  - `label`: text. Optional. Shorter title for menus.
  - `hidden`: `true` or `false`. Default `false`.
- `sections`: a list of objects with the fields below. Default `[]`.
  - `heading`: text. Required.
  - `body`: Markdown on one line (bold, italic, code and links). Required.
- `brochure`: a path to a file. Optional.
- `hideFromSearch` (Hide from site search): `true` or `false`. Default `false`. The page stays on the site. It just won’t show up in the site’s own search.

#### Docs (`docs`)

Markdoc (`.mdoc`) files in `src/content/docs/`, matching `**/[^_]*.mdoc`. Fields go in the frontmatter; the rest of the file is the body. URL: `/docs/:id`.

- `title`: text. Required.
- `summary`: text. Required.
- `order`: a whole number. Optional.
- `updated`: a date and time, ISO 8601 with an offset, such as `2026-01-31T09:30:00-05:00`. Optional.

#### Site settings (`settings`)

One entry: a single YAML file in `src/content/settings/`, matching `site.yaml`. Fields are the file’s top-level keys.

- `siteName`: text. Required.
- `tagline`: text. Required.
- `brandColor`: a hex colour such as `#1a73e8`. Required.
- `website`: a full URL. Required.
- `headquarters`: a map location, `{ lat, lng }`. Optional.
- `timeZone`: text. Required. IANA time zone name, for example America/New_York (spec §6.17).
- `social`: a list of objects with the fields below. Default `[]`.
  - `network`: one of `mastodon`, `bluesky`, `instagram`, `youtube`, `linkedin`. Required.
  - `url`: a full URL. Required.

#### Locations (`locations`)

Entries are the items in `src/data/locations.yaml`. Keep the file’s shape: each entry’s ID is its `id`, or its key in an object.

- `name`: text. Required.
- `address`: text. Required.
- `geo` (Map location): a map location, `{ lat, lng }`. Required.
- `color` (Map pin color): a hex colour such as `#1a73e8`. Required.
- `open`: `true` or `false`. Required.
- `hours`: a list of objects with the fields below. Optional.
  - `days`: text, not empty. Required.
  - `opens`: text matching `/^\d\d:\d\d$/`. Required.
  - `closes`: text matching `/^\d\d:\d\d$/`. Required.

#### Events (`events`)

Markdown (`.md`) files in `src/content/events/`, matching `**/[^_]*.md`. Fields go in the frontmatter; the rest of the file is the body. URL: `/events/:id`.

- `title`: text. Required.
- `summary`: text. Required.
- `startsAt`: a date and time, ISO 8601 with an offset, such as `2026-01-31T09:30:00-05:00`. Required.
- `endsAt`: a date and time, ISO 8601 with an offset, such as `2026-01-31T09:30:00-05:00`. Optional.
- `location`: the ID of an entry in `locations`. Optional.
- `publishAt`: a date and time, ISO 8601 with an offset, such as `2026-01-31T09:30:00-05:00`. Optional.
- `unpublishAt`: a date and time, ISO 8601 with an offset, such as `2026-01-31T09:30:00-05:00`. Optional.
- `unpublishRedirect`: text. Optional. Where visitors go after this event is unpublished.

#### Accessibility fixtures (`fixtures`)

Markdoc (`.mdoc`) files in `src/content/fixtures/`, matching `**/[^_]*.mdoc`. Fields go in the frontmatter; the rest of the file is the body. URL: `/fixtures/:id`. Left out of site search.

- `title`: text. Required.
- `summary`: text. Required.
- `textColor`: a hex colour such as `#1a73e8`. Required.
- `brochure`: a path to a file. Optional.
