# Vesper

A git-based CMS for Astro sites.

- Installs with one command (`npx astro add @vesper/astro`).
- Builds its editor from the site's existing content collections, so there is no second schema to write.
- Keeps content as files in the repo, and keeps the built site plain static output that runs on any host.

The open-source studio works locally during `astro dev`, and against GitHub when every editor has a GitHub account. A paid cloud service adds editor accounts without GitHub, drafts, previews, forms, comments, media storage and an agency dashboard.

> **Status:** Phase 0 (scaffold). Nothing is published yet.

## Repository

| Path | What it is |
|---|---|
| `packages/core` | Schema introspection, manifest, serializers, storage adapter interface. No framework imports. |
| `packages/ui` | Design tokens and (from Phase 2) the accessible component kit. |
| `apps/playground` | An Astro 7 site that exercises every feature. |
| `vesper-spec.md` | The product and build spec. The source of truth for scope and decisions. |
| `CLAUDE.md` / `DECISIONS.md` | Working rules, and the reasons behind them. |

## Development

Requires Node 22.22+ (24 recommended) and npm 10+.

```bash
npm install
npm run dev
```

Always run tools through `npm run`: the repo's `.npmrc` sets a Node condition that resolves workspace packages to their TypeScript source.

## License

MIT for the open-source packages. The cloud service is hosted and not part of this repository.
