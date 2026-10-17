# @vesper/core

The framework-free heart of Vesper. It runs unchanged in Node, in Cloudflare Workers and in the browser, so it imports nothing from Node, Astro, React, Vite or Zod.

**Status:** Phase 0 skeleton. It exports the manifest format version and the normalized `FieldModel` type (spec §6.3.1). Phase 1 adds:

- **Schema introspection:** walks a site's Zod 4 schemas into field models, resolves widgets, and builds the manifest.
- **Serializers:** read and write `.md`, `.mdx`, `.mdoc`, `.json` and `.yaml` content with round-trip fidelity. Saving one field changes only that field's bytes.
- **Storage adapter interface:** list, read and atomic multi-file commits, shared by the local, GitHub and cloud modes.

The design is in the repository's `PLAN.md`.

## Development

From the repository root:

```bash
npm test            # Vitest, straight from src/
npm run typecheck   # tsc -b plus the test tsconfig
npm run check:dist  # builds dist/ and imports it the way npm consumers will
```

Inside this workspace, `@vesper/core` resolves to `src/index.ts` through the `@vesper/source` export condition. Published consumers get `dist/`.
