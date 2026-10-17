# CLAUDE.md

Working rules for this repository. Each rule is one bold sentence plus the reason. The long-form reasoning, measurements and rejected alternatives live in `DECISIONS.md` under the same headings. Read that before relaxing a rule. The two files must never disagree.

`vesper-spec.md` is the source of truth for scope and decisions. Addendum 1 (D18–D23) is folded into it, and where the addendum text and older spec text conflict, the addendum wins.

## What Vesper is

A git-based CMS for Astro sites. The editor ("studio") is generated from the site's own `src/content.config.ts`. Content stays as files in the repo, and the built site is plain static output that runs on any host. The open-source packages (`core`, `astro`, `admin`, `ui`) are MIT. A paid cloud service (Cloudflare Workers) adds accounts without GitHub, drafts, previews, forms, comments, media and an agency dashboard.

It is the static, git-based sibling of Taproot (`C:\code\taproot`), not a storage mode inside it. Reuse Taproot's ideas where they fit, not its code paths.

## Where things stand

| Phase | Status |
|---|---|
| 0 Scaffold | Done (2026-10-17). CI green on GitHub (run 39054499051). |
| 1 Core | Designed in `PLAN.md`; starts after Jeremy reviews Phase 0 |

`PLAN.md` holds the current phase plan, the next phase's design and the roadmap.

**Build in the phase order of spec §11, and don't start a phase until the previous one meets its acceptance criteria.** Later phases build on the foundations of earlier ones.

**Decisions marked Proposed (D13, D15) are confirmed with Jeremy at the start of the phase that first depends on them.** They are defaults, not commitments.

**Items in spec §13 are open: propose options, never pick silently.** They are product calls.

**Never build anything on the spec's "Considered, not adopted" list (addendum §9) unless Jeremy asks for it.** That covers instant site notices, client reports, broken-link checks, uptime alerts, sitemap/RSS/OG images, search insights, conditional form fields, newsletters, payments, analytics, machine translation and AI writing.

**When unsure whether something belongs in the free or the paid tier, ask.** Tiering is a business decision.

## Commands

Always run tools through `npm run` (or `npm exec`), never a bare `npx tsc` or `node`. The `.npmrc` sets `--conditions=@vesper/source`, and it only applies inside npm.

| Command | What it does |
|---|---|
| `npm install` | Install all workspaces. |
| `npm run dev` | The playground in `astro dev` (http://localhost:4321). Nothing to prebuild. |
| `npm test` | Vitest, from source (no build needed). |
| `npm run typecheck` | `tsc -b` over package build configs, then each package's `tsconfig.json` (which includes tests). |
| `npm run lint` | ESLint, including the core package-boundary rules. |
| `npm run format` / `format:check` | Prettier over code and config (never prose or content). |
| `npm run a11y:contrast` | Token contrast (WCAG 2.1, both themes) and the §10.4 token budget, parsed from `packages/ui/src/tokens.css`. |
| `npm run changeset` | Record a release note and bump for changed `@vesper/*` packages (all share one version). |
| `npm run build -w @vesper/playground` | Static build of the playground into `apps/playground/dist/`. |
| `npm run e2e` | Playwright + axe against the built playground on `scripts/static-server.mjs` (no rewrites, no headers). Build first. |
| `npm run check:dist` | Build `dist/` and import every published entry point with the source condition off. |

## Layout

```
packages/core      Schema introspection, manifest, serializers, storage interface. No framework imports.
packages/ui        Design tokens (Phase 0), accessible components (Phase 2). Tokens enforce the §10.4 budget.
apps/playground    Astro 7 site that exercises every feature. Its content doubles as test fixtures.
scripts/           Repo tooling (contrast check, static server, dist check).
```

Later phases add `packages/astro` (Phase 1), `packages/admin` (Phase 2), `templates/oauth-relay` (Phase 3), `apps/cloud-api` and `apps/cloud-app` (Phase 4), `packages/create-vesper` and `apps/docs` (Phase 9).

## Constraints that are easy to violate

### Packages and imports

**`packages/core` imports nothing from Node, Astro, React, Vite or Zod.** It must run in Node, in Workers and in the browser (spec §12), and it reads site schemas structurally.

**In anything that touches a site's schemas, import Zod from `astro/zod`, never `zod`.** A second Zod copy makes `.meta()` hints silently disappear (spec §6.3).

**Workspace code imports `@vesper/*` by package name, which resolves to `src/` through the `@vesper/source` condition. Never import from a `dist/` path.** The dev loop never builds, so `dist/` is stale by definition; `check:dist` covers the published path.

**Use only erasable TypeScript syntax: no enums, namespaces or constructor parameter properties.** Node's built-in type stripping runs workspace sources directly, and it can't transform those (`erasableSyntaxOnly` enforces this).

**Relative imports carry the `.ts` extension.** Node needs real file names, and `rewriteRelativeImportExtensions` turns them into `.js` in `dist/`.

**`packages/core` has no `@types/node`. If code there needs `process`, `Buffer` or `node:*`, it belongs in `@vesper/astro`.** The missing types make typecheck fail before review has to catch it.

### Content files

**Never re-stringify a whole file to save one field. Splice the change into the original text.** Re-saving through the `yaml` Document API rewrote 73 of 988 real frontmatter blocks; round-trip fidelity is a hard requirement (spec §6.5).

**Never run a formatter over content, fixtures or the playground's content folders.** They are byte-exact test data, protected by `.prettierignore`, `.editorconfig` and `-text` in `.gitattributes`.

**Edit raw input values, never Zod's parsed output.** Defaults, coercions and transforms must not leak into files the editor didn't touch.

### Static output, any host

**No feature may depend on a host's rewrites, headers, functions or image service.** The built site and the studio must work when `dist/` is copied to an FTP host (D4, D16). Host-specific extras are optional and always have a universal fallback.

**Test static behavior against `scripts/static-server.mjs`, never a dev server or a host with rewrites.** It behaves like Apache with no `.htaccess`: `/x/` serves `x/index.html`, `/x` redirects to `/x/` only if that folder exists, everything else is a 404.

**The studio uses hash routing (`/admin/#/…`) and respects Astro's `base`, `trailingSlash` and `build.format`.** Deep links must survive a reload on a host with no rewrite rules.

### Studio and cloud

**The studio only ever runs from the site itself at `/admin`. `app.{{domain}}` never hosts a second copy of the editor.** Cloud features are reached by signing in to the cloud from the studio (D14).

**Cloud-only features are absent, not disabled, when the studio isn't connected.** No upsell banners (spec §6.9).

## Accessibility is an acceptance criterion

**WCAG 2.1 AA is the floor for the studio, the dashboard and every component shipped onto customer sites. Meet 2.2 AA where it's cheap (D11).** Agencies sell to colleges and public bodies.

**Every new screen passes an automated axe check through Playwright, and the PR notes a manual keyboard pass.** Automated checks find many problems, not all.

**Vesper reports accessibility. It never claims compliance and never ships an overlay (D19).** Checks find many problems, not all, and overlays make sites worse.

## Interface budget (spec §10.4)

Treat these like lint rules. Breaking one needs a dated note in `DECISIONS.md`.

- At most one primary (accent-filled) button per screen.
- At most two levels of navigation visible at once.
- No colored status badges. Status is text.
- No icon-only buttons except close, overflow ("…") and drag handles, all with accessible names.
- At most five color tokens beyond neutrals on any screen: accent, accent-subtle, danger, focus, plus optional warning.
- No tabs inside the editor.
- Body text 15–16px, line-height ≥ 1.5, two font weights.
- Spacing only from the token scale. Hairline borders only.

**If a new feature has no obvious quiet place in the interface, stop and propose one instead of adding a panel.** Every feature PR states where it lives in the UI and what it hides behind.

## Conventions

**TypeScript strict everywhere, Zod 4.** Same baseline as Taproot.

**Add no dependency without a one-line justification in the PR or commit message. Prefer platform APIs.** Every dependency is attack surface and upgrade cost.

**Small commits, one concern each, with conventional commit messages.** They are easier to review and to revert.

**Never commit secrets. Use `.dev.vars` locally and Wrangler secrets in production.** The repo will go public.

**Every user-facing string is plain language: "publish," "draft," "history," never "commit," "branch" or "SHA."** Editors aren't developers.

**Comments explain why, not what.** A comment earns its place by recording a constraint or a rejected alternative.

## Definition of done for a phase

- `npm run dev` brings up the playground and anything the phase touches, with seed or fixture data.
- Typecheck, lint and unit tests pass. New behavior has tests.
- axe (via Playwright) passes on every new screen, and a manual keyboard pass is noted.
- Each package has a README. Anything deployable has deployment notes.
- `DECISIONS.md` and `CLAUDE.md` are updated.
