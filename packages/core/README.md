# @vesper/core

The framework-free heart of Vesper. It runs unchanged in Node, in Cloudflare Workers and in the browser, so it imports nothing from Node, Astro, React, Vite or Zod.

**Status:** Phases 1, 2, 2.5 and 2.6 complete.

| Area | Exports |
|---|---|
| **Files** (spec §6.5) | `readEntryFile` / `writeEntryFile` for `.md`, `.mdx` and `.mdoc`. `readDataFile` / `writeDataFile` and `readCollectionFile` / `writeCollectionEntry` for JSON and YAML data. Lower-level `readYaml` / `writeYaml`, `readJson` / `writeJson`, `splitFrontmatter` and `diffValues`. |
| **Bodies** (spec §6.5, §6.5.1, §6.5.2) | `parseBody` splits a body into blocks with exact ranges: Markdown, protected source, and tags (Markdoc tags and MDX elements, as containers with child blocks when laid out on their own lines). Inline tags, variables, annotations and inline JSX are chips. Markdoc is parsed with Astro's tokenizer options (`parseMarkdoc`). `assembleBody` splices edited items back, keeping untouched bytes, containers' openings and closings included. |
| **Tags** | `markdocTags` / `markdocTagLayout` / `editMarkdocTag` and `jsxTagLayout` / `editJsxTag` read a tag's attributes with their spans and change one attribute's bytes in place. `markdocOpening` / `jsxOpening` write new tags in house style. |
| **Body validation** | `validateMarkdocBody` blocks exactly what Astro's build fails on, in plain language; `validateMdxBody` checks declared components with an injected props check. `resolvePartial` / `partialChecker` find partial files as Astro does. |
| **Schema** (spec §6.2, §6.3) | `walkSchema` turns Zod 4 schemas into `FieldModel`s without importing Zod. `resolveWidgets` applies the spec §6.3 order. |
| **Manifest** | `buildManifest`, deterministic and hashed. Its optional `markdoc` section (from `extractMarkdocSchema`, structural, never importing Markdoc's config code) and `mdx` section carry tags, attributes, settings fields and declared components. `markdocConfigFromManifest` rebuilds a config `Markdoc.validate()` accepts in the browser. |
| **Collections** | `globMatcher` and `defaultEntryId`, identical to Astro's glob loader. `folderKey` slugs a folder path the same way. |
| **URLs** (spec §6.15, also `@vesper/core/urls`) | `entryUrlKey` expands a collection's `url` pattern (`:id`, `:path`, `:slug`, `:<field>`, `:<date>\|yyyy`) or runs its function form; `formatUrl` adds Astro's `base` and trailing slash; `urlKey` / `parseSiteUrl` read a link back. `buildTree`, `childrenOf` and `breadcrumbsOf` nest a tree collection by folder and order it by `_order.yaml`. `cleanRedirects` collapses chains, removes loops and drops redirects onto real pages; `hostRedirects` and the rule writers produce `_redirects`, `.htaccess`, nginx and Vercel rules; `parseRedirectsCsv` reads plain, WordPress and Drupal exports. `@vesper/core/urls` is the same without the parsers, for a site's own pages. |
| **Studio services** | `ContentService` lists, reads, creates, saves and deletes entries over any storage adapter. `MediaService` lists and uploads media. `PageService` serves a tree's outline, moves a page and everything under it as one change set (its files, both `_order.yaml` files, a redirect per page, every rewritten link), reorders, creates section pages and edits the redirects file. `rewriteBody` / `rewriteValues` change links to moved pages and keep relative paths pointing at the same files. |
| **Storage** | The `StorageAdapter` interface, `MemoryStorage`, `gitBlobSha`, and the contract suite at `@vesper/core/testing`. |

Saves change only the bytes of values that changed: an unchanged save returns identical bytes. Every write is re-read and verified before it is returned. When a save can't be done exactly, it throws `SerializationError` and nothing is written.

See `test/README.md` for the round-trip corpus, and DECISIONS.md for the reasons behind each choice.

## Development

From the repository root:

```bash
npm test            # Vitest, straight from src/
npm run typecheck   # tsc -b plus the test tsconfig
npm run check:dist  # builds dist/ and imports it the way npm consumers will
```

Inside this workspace, `@vesper/core` resolves to `src/index.ts` through the `@vesper/source` export condition. Published consumers get `dist/`.
