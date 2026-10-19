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
| 1 Core | Done (2026-10-17). CI green on GitHub (run 39060134100); outcome in `PLAN.md` |
| 2 Integration and local mode | Done (2026-10-17). CI green on GitHub (run 39072815810); outcome and open questions in `PLAN.md` |
| 2.5 Markdoc tags and MDX components | Done (2026-10-17). CI green on GitHub (run 39085788652); outcome and open questions in `PLAN.md` |
| 2.6 URLs, hierarchy and redirects | Done (2026-10-18). CI green on GitHub (run 39134480284); outcome and open questions in `PLAN.md` |
| 2.7 Focal points, crops and `<Img>` | Done (2026-10-18). CI green on GitHub (run 39141980527); outcome and open questions in `PLAN.md` |
| 2.8 Accessibility checks, studio and build | Done (2026-10-18). CI green on GitHub (run 39152989394); outcome and open questions in `PLAN.md` |
| Studio design pass | Done (2026-10-18), ahead of 2.9. CI green on GitHub (run 39169607328); outcome and open questions in `PLAN.md` |
| 2.9 Site search | Done (2026-10-19). CI green on GitHub (run 39264241554); outcome and open questions in `PLAN.md` |

`PLAN.md` holds the current phase plan, the next phase's design and the roadmap.

**Build in the phase order of spec §11, and don't start a phase until the previous one meets its acceptance criteria.** Later phases build on the foundations of earlier ones.

**Decisions marked Proposed (D13, D15) are confirmed with Jeremy at the start of the phase that first depends on them.** They are defaults, not commitments.

**Items in spec §13 are open: propose options, never pick silently.** They are product calls.

**Never build anything on the spec's "Considered, not adopted" list (addendum §9) unless Jeremy asks for it.** That covers instant site notices, client reports, broken-link checks, uptime alerts, sitemap/RSS/OG images, search insights, conditional form fields, newsletters, payments, analytics, machine translation and AI writing.

**When unsure whether something belongs in the free or the paid tier, ask.** Tiering is a business decision.

## Commands

Always run tools through `npm run` (or `npm exec`), never a bare `npx tsc` or `node`. The `.npmrc` sets `--conditions=@vesper/source`, and it only applies inside npm.

**Preview the playground on port 4402 (`.claude/launch.json`), never 4321, 4400 or 4401.** Jeremy's own sites run on 4321 in dev, and a studio opened on the wrong port would edit that site's files. The e2e tests own 4400 (static build) and 4401 (studio) and never reuse a running server, so a preview can't stand in for what they test.

**Never serve `scripts/studio-site.mjs` yourself while `npm run e2e` runs.** Both use the one copy in `e2e/.studio-site`, and two dev servers over the same files make the tests' saves fail.

**Don't edit `packages/` or the playground's config while `npm run e2e` runs in the same checkout, from this session or another.** The studio tests run `astro dev` from source, so Vite reloads `/admin` mid-test and the test's unsaved edits are lost. `markdoc.spec.ts` fails such a test with "The studio reloaded mid-test".

**Under an AI agent on macOS or Linux, `astro dev` starts in the background and returns; a script that needs it attached passes `--ignore-lock`.** Astro 7 detects agents and detaches the server, so a test runner reads it as exited and the port stays taken (DECISIONS.md, "The studio test server stays attached under an AI agent").

**On Windows, stopping a background `npm run dev` leaves `astro dev` running, and it locks native modules so `npm ci` fails with EPERM.** Find the tree's root shell and stop it with `taskkill /PID <pid> /T /F`. Never kill Node processes that belong to other projects.

| Command | What it does |
|---|---|
| `npm install` | Install all workspaces. |
| `npm run dev` | The playground in `astro dev`, with the studio at `/admin`. Nothing to prebuild. Astro picks 4321 or the next free port; previews use 4402 (see above). |
| `npm test` | Vitest, from source (no build needed). |
| `npm run typecheck` | `tsc -b` over package build configs, then each package's `tsconfig.json` (which includes tests). |
| `npm run lint` | ESLint, including the core package-boundary rules. |
| `npm run format` / `format:check` | Prettier over code and config (never prose or content). |
| `npm run a11y:contrast` | Token contrast (WCAG 2.1, both themes) and the §10.4 token budget, parsed from `packages/ui/src/tokens.css`. |
| `npm run changeset` | Record a release note and bump for changed `@vesper/*` packages (all share one version). |
| `npm run build` | `dist/` for every package: tsc for the libraries, Vite for the studio bundle and its CSS. |
| `npm run build -w @vesper/playground` | Static build of the playground into `apps/playground/dist/`, and its accessibility report into `apps/playground/.vesper/`. |
| `npm run e2e` | Playwright + axe. `static`: the built playground on `scripts/static-server.mjs` (build first). `studio`: `/admin` on `astro dev` over a throwaway copy of the playground (`scripts/studio-site.mjs`). |
| `npm run manifest` | Print the playground's manifest, generated from source. |
| `npm run check:dist` | Build `dist/` and import every published entry point with the source condition off. |

## Layout

```
packages/core      Schema introspection, manifest, serializers, storage interface, URL and image geometry, accessibility rules. No framework imports.
packages/astro     The Astro integration (vesper(), /admin, dev API, vesper:content), fields helpers, defineConfig, Node tooling, <Img>, the crop step, the build's accessibility check, and site search (the Pagefind index, <Search>, /search).
packages/ui        Design tokens and the accessible component kit. Tokens enforce the §10.4 budget.
packages/admin     The studio at /admin: screens, widgets, body editor, upload hygiene. Precompiled for sites.
apps/playground    Astro 7 site that exercises every feature. Its content doubles as test fixtures.
fixtures/          astro6-site: an Astro 6 site, installed on its own, for the Astro 6 CI job.
e2e/               Playwright specs: static-site.spec.ts (the built site) and studio/ (local mode).
scripts/           Repo tooling (contrast check, static server, dist check, studio test site).
```

Later phases add `templates/oauth-relay` (Phase 3), `packages/create-vesper` and `apps/docs` (Phase 9). The cloud (`cloud-api`, `cloud-app`) lives in its own private repository, never this one (spec §13.3, decided 2026-10-19).

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

**Read YAML with `files/yaml/read.ts` (Astro 7.4's exact options), and edit structurally only when it says the block is editable.** Astro 7.4 parses with `yaml` and older Astro with js-yaml; where they disagree, a structural save could silently change content for one of them.

**Save through `writeEntryFile`, `writeDataFile` or `writeCollectionEntry`, never by writing text yourself.** They splice, verify the result reads back exactly, and refuse rather than write anything wrong.

**Edit raw input values, never Zod's parsed output.** Defaults, coercions and transforms must not leak into files the editor didn't touch.

**Parse Markdoc bodies with `parseBody` / `parseMarkdoc` and the manifest's Markdoc options, never `Markdoc.parse(text)`.** Astro parses with its own tokenizer options (`allowComments`, plus `html` with `allowHTML`), and Markdoc's defaults read HTML comments and inline HTML differently.

**Change a tag through `editMarkdocTag` or `editJsxTag`, and never run `Markdoc.format()` over content.** They change one attribute's bytes and keep the rest of the tag; `format` normalizes everything it touches.

### URLs, hierarchy and redirects

**Compute an entry's URL with `entryUrlKey` and `formatUrl` from `@vesper/core/urls`, never by replacing tokens in a pattern yourself.** The studio, the dev API, the build and `vesper:content` must agree on every address (spec §6.15.1).

**Change a tree's structure through `PageService` (moves, order, child and section pages), never by renaming files or editing `_order.yaml` yourself.** A move is one change set: its files, both order files, a redirect per page and every rewritten link (spec §6.15.4).

**Write a redirect's target as the page's exact URL (`formatUrl`: base and trailing slash), never a bare key.** On a plain host a bare path gets the host's own slash redirect first, so every redirect becomes a chain.

**Redirects that need the host's rules before the build runs go into the repository when the studio writes them, not into `dist`.** Vercel reads `vercel.json` before building; everything else is written into `dist` at build.

### Images

**Compute crops with `@vesper/core/images` (`cropForRatio`, `pixelRect`), never by hand.** The studio's previews, `<Img>` and the crop step must cut the same rectangle.

**Never pass a focal point as Astro's `position`; it goes into `style` as `object-position`.** Sharp takes only its own keywords, and a percentage fails the build (DECISIONS.md, "Astro hands `position` to Sharp unchanged").

**A new option for the crop step goes into its `propertiesToHash`, its `/_image` URL and its HTML filter.** Astro hashes only the properties a service names and passes the rest to the page as attributes.

**A focal-point or crop edit writes only the entry, never the image file.** Edits are non-destructive (spec §6.6); the studio e2e test hashes every file under `src/` to prove it.

### Static output, any host

**No feature may depend on a host's rewrites, headers, functions or image service.** The built site and the studio must work when `dist/` is copied to an FTP host (D4, D16). Host-specific extras are optional and always have a universal fallback.

**Test static behavior against `scripts/static-server.mjs`, never a dev server or a host with rewrites.** It behaves like Apache with no `.htaccess`: `/x/` serves `x/index.html`, `/x` redirects to `/x/` only if that folder exists, everything else is a 404.

**The studio uses hash routing (`/admin/#/…`) and respects Astro's `base`, `trailingSlash` and `build.format`.** Deep links must survive a reload on a host with no rewrite rules.

### Accessibility checks

**Accessibility rules live in `@vesper/core` (`entryChecker` for the studio, `BUILD_RULES` for the build). The studio, the build and the cloud use them, never their own copies.** Spec §6.18 asks for one rule set and one message style; the image widget's Phase 2 alt advice was folded in for that reason.

**The accessibility report goes to `.vesper/` in the project, never into `dist/`.** A report must never be deployed (spec §6.18); the integration refuses to write it inside the output folder, and CI checks `dist/`.

**A rule joins `BUILD_RULES` only once its result in jsdom has been checked against Chromium.** jsdom has no layout, so visual rules give wrong answers there; a snapshot pins the list (DECISIONS.md, "The build checks with axe-core in jsdom").

**A built page is traced to its entry only through the collection's `url`, never by recording reads at build.** Production `vesper:content` stays a plain re-export (spec §6.10, §6.11).

**Notes are text beside their field: no badges, no panel, and the count stays outside the live status.** Spec §10.4; an announcement on every keystroke would drown the editor.

### Site search

**Annotate a page for Pagefind in the copy handed to `addHTMLFile`, never in `dist/`.** The deployed page must stay the one Astro built (DECISIONS.md, "What the index knows about a page").

**`<Search>` loads no framework on public pages: its script is Vesper's own, on Pagefind's JS API.** Pagefind's Component UI failed the spec's criteria, and React alone would break the 300 KB first-search budget (DECISIONS.md, "Site search is Vesper's own UI on Pagefind's JS API").

**The dialog's live region stays inside the `<dialog>`.** `showModal()` makes everything outside it inert, live regions included, which is how Pagefind's modal lost its announcements.

**Leave entries out of the index with `isPublished` and `isHiddenFromSearch` from `@vesper/core`, never a date check of your own.** Phase 4.5's build filtering uses the same window, so search and the site can't disagree.

### Studio and cloud

**The studio only ever runs from the site itself at `/admin`. `app.{{domain}}` never hosts a second copy of the editor.** Cloud features are reached by signing in to the cloud from the studio (D14).

**Cloud-only features are absent, not disabled, when the studio isn't connected.** No upsell banners (spec §6.9).

**The accent is Pine, and fixed: no picker, setting or config key chooses another.** Choosing an accent is white-label, the higher paid tier, in Phase 9 (DECISIONS.md, 2026-10-18).

**The studio's font is Figtree 400 and 600, self-hosted in `@vesper/admin`; `/admin` never requests anything from Google or a CDN.** Code, slugs and URLs use the system monospace stack (DECISIONS.md, "The studio self-hosts Figtree").

**Pair every `outline-2` with `outline-solid` (`data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid`).** Tailwind 4's `outline-none` sets the outline style to `none` through a variable `outline-2` reuses, so the ring otherwise isn't drawn; the budget test checks it (DECISIONS.md, "Every focus outline is drawn solid").

**Never transition what changes as focus moves (focus rings, the halo, chevrons): hover colours only, and nothing under reduced motion.** After a screen reader's or a script's click, React Aria moves focus only once every running transition has ended, and focus sits on the page meanwhile (DECISIONS.md, "Transitions never touch focus").

**A body blocks saving only for what the site's build would fail on (`validateMarkdocBody`'s filter); everything else is a warning. Unknown tags and functions block only in the dev API (`siteConfig`), which has the site's whole config.** Blocking on less would let a broken build through, and blocking on more would stop saves whenever the studio knows less of the config than Astro does.

**An inline node view sets no `contentEditable` inside itself; ProseMirror already makes the view's own element non-editable.** ProseMirror's caret handling steps over a non-editable element inside a node view as if it were a widget, and on a Mac ⌘← and ⌘→ beside a chip at either end of a line then did nothing (DECISIONS.md, "A chip is non-editable once, on its own element").

**On a Mac, ⇧⌘← and ⇧⌘→ beside a chip are left to the browser through `handleDOMEvents`, and no line key is bound to a textblock command.** ProseMirror's own Shift step selected only the chip, and a textblock command goes to the paragraph's ends, which breaks wrapped lines (DECISIONS.md, "⇧⌘← and ⇧⌘→ beside a chip are the browser's").

## Accessibility is an acceptance criterion

**WCAG 2.1 AA is the floor for the studio, the dashboard and every component shipped onto customer sites. Meet 2.2 AA where it's cheap (D11).** Agencies sell to colleges and public bodies.

**Every new screen passes an automated axe check through Playwright, and the PR notes a manual keyboard pass.** Automated checks find many problems, not all.

**Vesper reports accessibility. It never claims compliance and never ships an overlay (D19).** Checks find many problems, not all, and overlays make sites worse.

## Interface budget (spec §10.4)

Treat these like lint rules. Breaking one needs a dated note in `DECISIONS.md`.

- At most one primary (accent-filled) button per screen.
- At most two levels of navigation visible at once.
- No colored status badges. Status is text.
- No icon-only buttons except close, overflow ("…"), drag handles, the outline's expand toggle and the body editor's formatting tools (DECISIONS.md, 2026-10-18), all with accessible names; the formatting tools also show a tooltip. Everywhere else an icon sits beside its words, and icons come only from the kit's `Icon` (Lucide).
- At most five color tokens beyond neutrals on any screen: accent, accent-subtle, danger, focus, plus optional warning.
- No tabs inside the editor.
- Body text 15–16px, line-height ≥ 1.5, two font weights.
- Spacing only from the token scale. Hairline borders only.
- Type sizes and radii only from the tokens: `text-title`, `text-heading-1`–`3`, `text-body`, `text-label`, `text-small`, `text-caption`; `rounded-sm`, `-md`, `-lg`, `-full` (DECISIONS.md, "One type scale replaces Tailwind's sizes").
- Shadows only on overlays (`shadow-overlay`), plus four named glows in their named places: `glow-accent` (the primary button), `glow-selected` (the current item), `glow-focus` (outside the focus ring) and `glass-edge` (DECISIONS.md, 2026-10-18).
- Glass only on what floats (the top bar, menus, popovers, drawers, dialogs, the scrim), at least 88% fill, with solid fallbacks.

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
