# @vesper/core

The framework-free heart of Vesper. It runs unchanged in Node, in Cloudflare Workers and in the browser, so it imports nothing from Node, Astro, React, Vite or Zod.

**Status:** Phase 1 complete.

| Area | Exports |
|---|---|
| **Files** (spec §6.5) | `readEntryFile` / `writeEntryFile` for `.md`, `.mdx` and `.mdoc`. `readDataFile` / `writeDataFile` and `readCollectionFile` / `writeCollectionEntry` for JSON and YAML data. Lower-level `readYaml` / `writeYaml`, `readJson` / `writeJson`, `splitFrontmatter` and `diffValues`. |
| **Schema** (spec §6.2, §6.3) | `walkSchema` turns Zod 4 schemas into `FieldModel`s without importing Zod. `resolveWidgets` applies the spec §6.3 order. |
| **Manifest** | `buildManifest`, deterministic and hashed. |
| **Collections** | `globMatcher` and `defaultEntryId`, identical to Astro's glob loader. |
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
