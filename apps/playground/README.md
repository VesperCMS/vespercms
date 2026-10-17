# Vesper playground

An Astro 7 site that exercises every Vesper feature (spec §11, Phase 0). It stands in for a customer's site: plain static output, no adapter, its own stylesheet.

**Its content is test data.** The serializer tests use these files to prove a save changes only what the editor touched, so:

- never run a formatter over `src/content/`, `src/data/` or `fixtures/` (they're in `.prettierignore`);
- `src/content/blog/notes-from-the-field.md` is committed with CRLF line endings on purpose (`-text` in `.gitattributes`).

## Schemas and config

- `src/content.config.ts` uses every `fields.*` helper from `@vesper/astro/fields`:
  - `select`, `email`, `url`, `slug`, `markdown`, `file`, `datetime`, `color` and `geo`;
  - `locations` keeps their raw Zod equivalents on purpose;
  - the blog hero stays raw Zod until `fields.image()` lands in Phase 2.7.
- `vesper.config.ts` sets presentation only: labels, URL patterns, `tree` for pages, `singleton` for settings, `schedule` for events, `search: false` for the fixtures, the site's `timeZone`, and `placement` to keep event times in the main column (spec D2).
- It also registers the example custom widget, `store-hours` (`src/cms/StoreHours.tsx`), which claims the locations' `hours` field by its name (spec §6.3.3).
- Pages read content through `vesper:content`, so the dev toolbar's Vesper app can link each page to its entries (spec §6.10).
- `npm run manifest` at the repo root prints the manifest Vesper builds from these files.

## Commands

From the repository root:

```bash
npm run dev -w @vesper/playground      # astro dev
npm run build -w @vesper/playground    # static build into dist/
npm run preview -w @vesper/playground  # serve dist/ with the no-rewrite static server
npm run check -w @vesper/playground    # astro check
```

## What each collection covers

| Collection | Loader | Exercises |
|---|---|---|
| `blog` | `glob('**/[^_]*.md')` | `image()` inside the §6.6.2 hero object (focal point, one manual crop, decorative), `reference()` single and multi, tags, enum, `z.coerce.date()` and `z.date()`, date-only and datetime values, an unmappable union, a nested `index.md` (ID `2026/winter-market`), a CRLF file, and an `_`-prefixed file the pattern skips |
| `authors` | `file('src/data/authors.json')` | JSON data collection; `z.email()`, `z.url()` |
| `pages` | `glob('**/[^_]*.{md,mdx}')` | The folder hierarchy (spec §6.15): section `index.md` pages, four levels deep at `academics/nursing/clinical-placements/`, `_order.yaml` files, a folder with no index (`admissions/`), an `_`-prefixed draft the pattern skips, a field group, a repeater with an inline-markdown widget, and an MDX page with a declared (`Callout`) and an undeclared, imported (`Gallery`) component. The root `index.md` is the home page's content. |
| `docs` | `glob('**/[^_]*.mdoc')` | Markdoc (spec §6.5.1): a block tag with children (`callout`), a self-closing tag (`youtube`), an inline tag (`abbr`), a partial (`_support-hours.mdoc`, included from two folder depths), `$product` variables, `{% if %}`/`{% else /%}`, functions (`equals`, `and`) and a class annotation (`{% .lead %}`). Tags are defined in `markdoc.config.mjs`. |
| `settings` | `glob('site.yaml')` | A singleton (one entry, ID `site`) read by the layout: a folded `>-` string, a commented-out key, a colour with a named palette, `z.url()`, the site time zone (spec §6.17), and a repeater mixing block and flow maps. |
| `locations` | `file('src/data/locations.yaml')` | One YAML file holding many entries. `geo` (a lat/lng object) and `color` (a hex string), tagged with `.meta({ widget })` exactly as `fields.geo()` and `fields.color()` will produce them. Flow and block maps, single and double quotes. |
| `events` | `glob('**/[^_]*.md')` | Scheduling (spec §6.17, D18): `publishAt` / `unpublishAt` as ISO 8601 with offsets, covering past, future, expired, an `unpublishRedirect`, and one entry whose publish and unpublish times are the two different 1:30 AMs of the November 1, 2026 daylight-saving change. Filtering arrives in Phase 4.5; for now every event is built. |
| `fixtures` | `glob('**/[^_]*.mdoc')` | `accessibility-mistakes.mdoc`: one deliberate mistake per studio accessibility check (spec §6.18, layer 1), including a failing `textColor`, an untagged PDF (`public/files/untagged-brochure.pdf`) and a video with an empty title. Excluded from the e2e axe gate, which instead checks that axe flags it. |

## Other fixtures

- `vesper.redirects.yaml`: a two-hop redirect chain and a manual 302 (spec §6.15.5). Data only until Phase 2.6.
- `src/pages/contact.astro`: a static route that Phase 2.6's move validation must refuse to collide with.
- `src/forms.config.ts`: the contact form (department select for routing, an upload field, a confirmation email). `<Form>` renders it from Phase 6.
- The header reserves the spot for `<Search />` (Phase 2.9).

## Upload hygiene samples

`fixtures/uploads/` holds a HEIC with GPS data, an EXIF-rotated JPEG and an SVG with embedded scripts, each with its expected result and provenance in that folder's README. They sit outside `public/`, so the build never serves them.

## Images

The blog images are generated illustrations (simple SVG shapes rendered by sharp), not photographs. They're kept on purpose: they have no provenance risk, and the real-photo cases are covered by the hygiene samples. Their alt text describes what they actually show.
