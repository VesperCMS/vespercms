# Vesper playground

An Astro 7 site that exercises every Vesper feature (spec §11, Phase 0). It stands in for a customer's site: plain static output, no adapter, its own stylesheet.

**Its content is test data.** The serializer tests use these files to prove a save changes only what the editor touched, so:

- never run a formatter over `src/content/`, `src/data/` or `fixtures/` (they're in `.prettierignore`);
- `src/content/blog/notes-from-the-field.md` is committed with CRLF line endings on purpose (`-text` in `.gitattributes`).

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

## Images

The blog images are generated illustrations (simple SVG shapes rendered by sharp), not photographs. They will be replaced with openly licensed photos once those are approved. Their alt text describes what they actually show.
