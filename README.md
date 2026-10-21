# Vesper

A git-based CMS for Astro sites.

- Installs with one command (`npx astro add @vesper/astro`).
- Builds its editor from the site's existing content collections, so there is no second schema to write.
- Keeps content as files in the repo, and keeps the built site plain static output that runs on any host.

The open-source studio works locally during `astro dev`, and against GitHub when every editor has a GitHub account. A paid cloud adds editor accounts without GitHub, drafts and review, and roles scoped to folders; previews, forms, comments, media storage and an agency dashboard come later.

> **Status:** Phases 0 to 3 are done, and Phase 4 (the cloud) is in its real-world check. Nothing is on npm yet. The docs are at [vespercms.com/docs](https://vespercms.com/docs/).

## Repository

| Path | What it is |
|---|---|
| `packages/core` | Schema introspection, manifest, serializers, storage, URLs, image geometry, accessibility rules and the cloud's shared pieces. No framework imports. |
| `packages/astro` | The Astro integration: `/admin`, the dev API, `vesper:content`, `<Img>`, `<Search>`, the build's checks, and the `vesper` command. |
| `packages/admin` | The studio at `/admin`, precompiled for sites. |
| `packages/ui` | Design tokens and the accessible component kit. |
| `apps/playground` | An Astro 7 site that exercises every feature. Its content doubles as test fixtures. |
| `apps/site` | vespercms.com: the marketing pages and the docs, edited with Vesper. |
| `templates/oauth-relay` | The GitHub sign-in relay a site owner deploys for GitHub mode. |
| `vesper-spec.md` | The product and build spec. The source of truth for scope and decisions. |
| `CLAUDE.md` / `DECISIONS.md` / `PLAN.md` | Working rules, the reasons behind them, and where each phase stands. |

## Development

Requires Node 22.22+ (24 recommended) and npm 10+.

```bash
npm install
npm run dev
```

Always run tools through `npm run`: the repo's `.npmrc` sets a Node condition that resolves workspace packages to their TypeScript source.

## License

MIT for the open-source packages. The cloud service is hosted, and lives in its own private repository.
