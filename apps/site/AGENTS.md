<!-- vesper:agents:start -->
<!-- Written by `vesper agents` from this site’s content config. Run it again after changing the schema or vesper.config.ts; anything between these markers is replaced. -->

## Content and the Vesper studio

People edit this site’s content in the Vesper studio at `/admin`, and every save is a change to a file in this repository. You can edit the same files. These rules keep the studio, the build and people’s history intact.

### Rules

- **The schema is `src/content.config.ts`.** The studio is built from it; there is no second schema. To add or change a field, edit the Zod schema there, with `z` imported from `astro/zod`, never `zod`. `vesper.config.ts` holds only presentation: labels, URLs, icons and widgets.
- **Change only what you mean to change.** Edit a value in place. Don’t reformat frontmatter or data files, reorder keys, change quoting or indentation, or run a formatter over content: the studio keeps every byte it didn’t edit, and people review content changes as diffs.
- **Write values as the file stores them, not as Zod parses them.** Leave out fields you aren’t setting, even ones with defaults, and keep dates in the form the file already uses.
- **Check your work with `npx astro build`.** It validates every entry against its schema and fails on a body that doesn’t parse. Afterwards `.vesper/a11y-report.json`, when present, lists accessibility issues on the built pages, with the entry each came from.

### Page trees

In `pages` and `docs`, the folder is the hierarchy:

- `folder/index.md` is the folder’s own page (any of the collection’s formats), and a top-level `index` file is the root page.
- An optional `_order.yaml` in each folder lists its pages’ slugs (file or folder names, without extensions) in menu order. Pages it doesn’t list follow, by title. When you add a page, add its slug where it belongs.
- Moving or renaming a page changes its URL and the URLs of every page under it. Prefer the studio’s Move: it moves the files, updates both `_order.yaml` files, adds a redirect for every old URL and rewrites internal links, as one change. By hand, do all four.
- `docs` pages go at most 2 levels deep: a top-level page is level 1, a page in its folder level 2.

### Redirects

`vesper.redirects.yaml`, beside `astro.config` (create it when there’s none), lists old addresses and where they went:

```yaml
- { from: /old-page, to: /new-page, status: 301, reason: manual, at: 2026-01-31 }
```

Add one whenever a published page’s URL changes. `from` and `to` are paths on the site without a trailing slash; `to` may also be a full URL elsewhere. Every build collapses chains and drops a redirect whose old address is a page again.

### Markdoc tags

Markdoc bodies (`.mdoc`) may use these tags from `markdoc.config.mjs`. The build fails on an unknown tag or a missing required attribute, and the studio refuses to save one.

- `{% callout %}…{% /callout %}` (Callout): a block holding paragraphs, lists, code blocks.
  - `type`: one of `note`, `tip`, `warning`. Default `"note"`.
  - `title`: text. Optional. Shown above the callout. Leave it empty to use the type.

Variables, conditionals (`{% if %}`), functions, partials and annotations are kept exactly as written by the studio; change them by hand only when asked.

### Collections

In URL patterns, `:id` is the entry’s ID (its path without the extension), `:path` is the ID without a trailing `/index`, `:slug` is its slug, and `:field` is that field’s value.

#### Pages (`pages`)

Markdown (`.md`) files in `src/content/pages/`, matching `**/[^_]*.md`. Fields go in the frontmatter; the rest of the file is the body. URL: `/:path`, as a page tree (see Page trees).

- `title`: text. Required.
- `summary`: text. Required. One or two sentences for search results and link previews.
- `hero`: an object with the fields below. Optional. The large statement at the top. Without one, the page starts with its title.
  - `heading`: text. Required.
  - `lead`: text. Required.
  - `actions`: a list of objects (at most 2 items) with the fields below. Default `[]`. The first is the main button; the second sits beside it.
    - `label`: text. Required.
    - `href`: text. Required. A path on this site, like /docs/, or a full address.
- `sections`: a list of objects with the fields below. Default `[]`.
  - `heading`: text. Required.
  - `intro`: Markdown on one line (bold, italic and links). Optional.
  - `points`: a list of objects with the fields below. Default `[]`.
    - `title`: text. Required.
    - `body`: Markdown on one line (bold, italic and links). Required.
- `hideFromSearch` (Hide from site search): `true` or `false`. Default `false`. The page stays on the site. It just won’t show up in the site’s own search.

#### Docs (`docs`)

Markdoc (`.mdoc`) files in `src/content/docs/`, matching `**/[^_]*.mdoc`. Fields go in the frontmatter; the rest of the file is the body. URL: `/docs/:path`, as a page tree (see Page trees).

- `title`: text. Required.
- `summary`: text. Required. One sentence. It sits under the title, in search results and in llms.txt.
- `menuLabel`: text. Optional. A shorter title for the docs menu.
- `hideFromSearch` (Hide from site search): `true` or `false`. Default `false`. The page stays on the site. It just won’t show up in the site’s own search.

#### Site settings (`settings`)

One entry: a single YAML file in `src/content/settings/`, matching `site.yaml`. Fields are the file’s top-level keys.

- `tagline`: text. Required. Shown in the footer.
- `nav` (Header links): a list of objects with the fields below. Default `[]`.
  - `label`: text. Required.
  - `href`: text. Required. A path on this site, like /docs/, or a full address.
- `repository`: a full URL. Optional. The source on GitHub, linked from the footer when set.
<!-- vesper:agents:end -->
