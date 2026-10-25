# DECISIONS.md

The long form of `CLAUDE.md`. That file states each rule in one sentence; this one records why: what was measured, what was rejected, and what would make us revisit. It isn't loaded automatically. Read the relevant section before relaxing a rule. The two files must never disagree, and the spec's decision table (D1–D23 in `vesper-spec.md` §3) outranks both.

Entries are dated, newest last within each section, and headed `### YYYY-MM-DD: Title`.

---

## Product decisions from the spec

The spec's D1–D17 are recorded in `vesper-spec.md` §3 and aren't repeated here. Addendum 1 asked for one dated entry per new decision.

### 2026-10-17: D18, scheduling is time-correct at build

**Entries carry `publishAt` / `unpublishAt`, and the `vesper:content` helpers filter by them during every build.** So any rebuild at or after the scheduled time produces the right site, on any host, with or without the cloud. The cloud's only job is to trigger a rebuild at the exact time (Durable Object alarms, then a deploy hook or `repository_dispatch`). The rejected alternative, the cloud committing content at the scheduled time, fails silently if the cloud is unreachable at that moment. Commit-now-filter-at-build degrades to "live at the next rebuild." Public repositories can opt into `holdScheduledDrafts` because a future post committed to a public repo is visible early.

### 2026-10-17: D19, report accessibility, never claim compliance, never ship an overlay

**Vesper's checks (studio, build, cloud scans) report problems in plain language, with one sentence on why each matters.** Automated checks find a fraction of real issues, so the UI and docs say manual testing is still needed. Vesper never injects a front-end accessibility widget or overlay: they don't fix underlying problems and often add new ones.

### 2026-10-17: D20, confirmation emails can't become a spam cannon

**A form with confirmation emails requires Turnstile, rate-limits each recipient address, uses a template fixed by the site owner, and by default never echoes the submitter's free-text fields.** Otherwise anyone could use a client's form to send arbitrary text to arbitrary addresses from our sending domain. Only fields marked `safeToEcho` (by default, name fields) can be merged into the template.

### 2026-10-17: D21, uploaded files are private

**Form uploads live in R2 under per-site keys, are never publicly reachable, and are downloaded only through 15-minute signed links from the dashboard.** Retention follows the form's submission retention. Uploads often hold personal documents such as résumés and transcripts. There's no antivirus scanning at launch, which is why the allowed types are a safe list and executables and archives are always rejected.

### 2026-10-17: D22, one event-and-delivery system for integrations

**Forms, comments, publishing and accessibility reports all emit events into one queued, retried, logged delivery system.** Each integration is an event, a destination, a field mapping and a delivery log. One system means one place to see failures, and nothing fails silently.

### 2026-10-17: D23, site search is free and static

**The integration builds a Pagefind index at build time into `dist/_vesper/search/`.** Search is plain static files that work on any host (D16), with no service to pay for or run. The cloud adds nothing required for search. A paid "search insights" extra is on the do-not-build list until Jeremy chooses it.

### 2026-10-17: D13 and D15 are confirmed

**Jeremy confirmed both decisions on October 17, 2026, ahead of Phase 4:**
- D13: drafts live in the cloud, and git receives only published changes.
- D15: per-site cloud data lives in a Durable Object per site, using its built-in SQLite.

Phase 1's storage design already assumes D13: a draft records the git blob SHA it was based on, and conflicts are a version comparison.

### 2026-10-19: Jeremy's calls on the open product decisions (spec §13)

**Jeremy took the recommendation on every open item on October 19, 2026. `vesper-spec.md` §13 records each one; the reasons are here.**
- **§13.3, the cloud's license: closed, in a separate private repository.** A closed license can be opened later and an open one can't be closed. It also settles Phase 4's question: `cloud-api` and `cloud-app` never enter this MIT repository, which goes public at launch.
- **§13.4, plans and prices: the addendum's numbers stay placeholders.** Entitlements are built on them, pricing stays per site with the Agency bundle (10 sites, then per site), and the final numbers come in Phase 5 from measured cost.
- **§13.5, pull-request mode: Phase 9,** or sooner only for a paying agency that asks. D13's cloud drafts and review cover most teams.
- **§13.7, a Git Gateway–compatible API: no.** An Astro site on Decap already keeps its content as files, so it switches by installing Vesper. The API would be maintenance for a wedge that's already open.
- **§13.8, self-hosting the cloud: no.** At most an Institution contract term later.
- **§13.9, geocoding: OpenCage, proxied and cached by the cloud,** once its current terms and price are checked before Phase 4. Coordinates are saved into the site's files, which is permanent storage, so the provider's terms must allow keeping results. Rejected: Nominatim's public server (its usage policy forbids autocomplete) and geocoders whose terms limit storing results. **Checked on 2026-10-20, and it passes.** OpenCage's terms let a customer store results permanently, even after cancelling, with OpenStreetMap's attribution (opencagedata.com/terms, /faq). It recommends calling the API from a server. The free trial is for testing only; production starts at $50 a month for 10,000 requests a day (opencagedata.com/pricing). Geocoding isn't in Phase 4's build list, so the plan is bought when a client needs address search.
- **§13.10, machine-suggested alt text: not for now.** It sits close to "AI writing" on the not-adopted list, and D19's posture favours human judgement. Revisit after launch.
- **§13.11, cloud-rendered previews: after launch,** as D17 already says.
- **§13.12, conditional form fields: not adopted.** Forms stay static and routing covers the cases. Show/hide logic would need its own accessibility work (announcing fields that appear) for little gain.
- **§13.13, the scan engine: measure Cloudflare Browser Rendering first** (it fits D7), and set page caps from that cost in Phase 8.5.
- **§13.14, custom sending domains: Agency and Institution.** The Site plan sends from Vesper's domain, with reply-to set to the site owner. A sending domain means DNS records (SPF, DKIM) per customer, which is support work.
- **Still Jeremy's to do (§13.1):** claim the `@vesper` org on npmjs.com. On October 19, 2026 no package was published under `@vesper`; whether the scope itself is held couldn't be checked from here. The cloud's domain, vespercms.com, was registered at Cloudflare on 2026-10-20.

### 2026-10-19: GitHub mode gets a free relay, and the site's build checks custom validators

**Jeremy confirmed both on October 19, 2026, ahead of Phase 3.**
- **The cloud runs a free OAuth relay for GitHub mode (spec §6.8), and `templates/oauth-relay` stays for sites that want their own.** The relay turns GitHub mode's setup into minutes instead of deploying a Worker first, and a token exchange costs next to nothing on Workers. It needs the §13.1 domain.
- **In GitHub mode, the site's build is the last check for Markdoc's custom attribute types and `validate` functions.** They're code, so only the dev API can run them (2026-10-17, "The browser checks Markdoc with the manifest"). A save that fails them fails the deploy, and the live site stays as it was.

## Process

### 2026-10-17: The repo starts private and goes public at launch

**The GitHub repository is private until launch, then made public.** The open-source packages are MIT from the first commit, so nothing committed may be unfit for publication: no client content, no secrets, no unlicensed media.

### 2026-10-17: Only Jeremy's own sites go into the committed test corpus

**The serializer round-trip corpus commits files from jazzy-astro5, thosegeeks-astro and cookingnerdy-astro only. Client sites (domsys, washcofair, vhcc-catalog) run from a local private path (`VESPER_PRIVATE_CORPUS`) that CI never sees.** Client content can't go into a repo that will be public. The three own sites give about 120 files, well over the 30 that Phase 1 requires. Synthetic fixtures cover what the real corpus lacks: JSON content, YAML anchors, BOM, TOML, MDX import lines, mixed line endings.

### 2026-10-17: Sample media must be redistributable

**Every committed photo, PDF or sample upload is CC0, public domain or MIT-compatible, with its source and license recorded next to it.** The repo is MIT and will be public. Hygiene samples (a HEIC with GPS data, an EXIF-rotated JPEG) come from openly licensed test sets, and each download is approved first.

### 2026-10-25: The repositories live in the vespercms organization

**Jeremy chose on 2026-10-25 to call the project vespercms in every URL. This repository moved from `jeremybise/vesper` to `vespercms/vespercms`, and the cloud's from `jeremybise/vesper-cloud` to `vespercms/vespercms-cloud`, in the organization that already owns the VesperCMS GitHub App.** GitHub redirects the old names, so links and clones keep working, and dated entries here and in PLAN.md keep the names they had at the time.
- `vesper-github-test` stays on Jeremy's own account: it stands in for a customer's repository, and customers aren't in the organization.
- What moved with it: the cloud's submodule URL, its CI checkouts and its README (vespercms-cloud f4fcbd4), and both local remotes. The submodule's folder stays `vesper/`, and the local checkouts keep their folders.
- What the move broke until it's reconnected by hand: the cloud's CI token (`VESPER_READ_TOKEN`, scoped to the old owner), the VesperCMS app's access to this repository (installed on Jeremy's account, not the organization), and Cloudflare Pages' access for vespercms.com.
- The npm scope is still `@vesper`, and unclaimed. Whether it becomes `@vespercms` too is open (spec §13.1).

## Packages and tooling

### 2026-10-17: Workspace packages resolve to source through a custom export condition

**Every package's `exports` lists `"@vesper/source": "./src/index.ts"` first. Node gets the condition from `.npmrc` (`node-options=--conditions=@vesper/source`), Vite and Vitest from `scripts/vite-source-conditions.mjs`, and TypeScript from `customConditions`.** Nothing in the dev loop reads `dist/`, so it can never be stale. Taproot's `pre*` build hooks exist because of exactly that staleness.

Node 22.18+ strips types from `.ts` files whose real path is outside `node_modules`. Workspace symlinks resolve to `packages/*/src`, so this works without a build step. Astro loads `astro.config.mjs` with a plain Node `import()` first, so a site config in this workspace can import `@vesper/astro` from source. `scripts/source-condition.test.mjs` keeps this proven.

What it costs:
- Only erasable TypeScript syntax (`erasableSyntaxOnly`).
- Relative imports use `.ts` (`rewriteRelativeImportExtensions` emits `.js`).
- Tools must run through `npm run`, because a bare `npx` outside npm scripts doesn't see `.npmrc`'s node-options.

`scripts/check-dist.mjs` covers the published path by importing every entry point with `NODE_OPTIONS` cleared.

The Vite side is a plugin using `configEnvironment`, not plain `resolve.conditions`:
- Astro loads `content.config.ts` in its own Vite environments (`astro` for dev and sync, `prerender` for builds), which top-level and `ssr` settings never reach.
- Vesper's isolated config loader also adds the Node process's own custom `--conditions` to each of its environments. A real site has none, so nothing changes there.

Found when CI's test job, which doesn't build first, failed to resolve `@vesper/astro/fields`. Locally a `dist/` left over from earlier builds had hidden it, so the loop is now verified with every `dist/` deleted.

Rejected:
- `tsc --watch` beside dev: a second process, and still racy.
- Shipping TypeScript source to npm, as Taproot's Astro packages do: Node refuses to strip types under `node_modules`, and Astro imports integrations through Node.

### 2026-10-17: TypeScript 6.0, not 7

**Pin `typescript` to 6.0.3.** TypeScript 7.0 is out, but typescript-eslint 8.71 supports `>=4.8.4 <6.1.0`, and `@astrojs/check` supports `^5 || ^6`. Revisit when both support 7.

### 2026-10-17: ESLint 9, with the package boundaries as lint rules

**Use ESLint 9.39 with typescript-eslint `strictTypeChecked`, not ESLint 10.** `eslint-plugin-jsx-a11y` 6.10 (needed from Phase 2 for the React packages) supports ESLint up to 9 only. The boundaries in spec §5 and §12 are enforced as lint rules: no Node, framework, Zod or other `@vesper/*` imports in core; Zod only from `astro/zod` in `@vesper/astro`. Patterns use `regex` rather than gitignore-style globs, because a glob like `vite` would also match a relative `./vite` path. `scripts/eslint-boundaries.test.mjs` proves each rule fires: a typo in a rule name or glob would otherwise disable the guard silently.

### 2026-10-17: Prettier formats code, never prose or content

**`.prettierignore` excludes every `.md`, `.mdx` and `.mdoc` file, the content and fixture folders, and the redirects file.** Content files are test data, and the serializer's job is to preserve their exact bytes, so formatting them would destroy the evidence. Prose (spec, CLAUDE.md, READMEs) keeps its authored formatting, because Prettier re-pads every table and makes doc diffs unreadable.

### 2026-10-17: `@vesper/core` builds without `@types/node`

**Core's tsconfig sets `lib: ["ES2023", "DOM"]` and `types: []`.** `DOM` provides the platform APIs shared by browsers, Workers and Node (`TextDecoder`, `crypto.subtle`, `URL`). With no Node types, any use of `process`, `Buffer` or `node:*` fails typecheck, which enforces spec §12's "runs in Node, Workers and the browser" before review has to. The build uses `tsconfig.build.json` (no Node types, tests excluded). The package's `tsconfig.json` covers tests too and adds Node types, since tests read fixtures from disk; editors, ESLint and `npm run typecheck` use it.

### 2026-10-17: End-to-end tests use a deliberately dumb static server

**`scripts/static-server.mjs` is a dependency-free `node:http` server, and it's the only host the e2e suite uses.** It mimics Apache with no `.htaccess`, S3 website hosting and `python -m http.server`:
- `/x/` serves `x/index.html`;
- `/x` 301s to `/x/` only when `x` is a folder with an index;
- every other path is a 404, served with the site's own `404.html`;
- there are no rewrites, no SPA fallback, no clean-URL guessing, and no headers beyond Content-Type and Content-Length.

`serve` and `sirv` were rejected because their clean-URL and single-page-app modes would hide exactly the bugs D16 forbids. The same server becomes the spec §6.16 test-matrix host: later phases add `/admin` deep links, redirects, forms and search to the suite. The e2e run also blocks every request that isn't to the local site, so a page that only renders correctly with network access fails the test.

### 2026-10-18: The studio e2e tests run in one worker, and fail loudly when the studio reloads

**The `studio` Playwright project sets `workers: 1` as well as `fullyParallel: false`. `markdoc.spec.ts` fails a test whose page reloaded after it opened the guide, with "The studio reloaded mid-test".** Every studio test shares one copy of the playground (`e2e/.studio-site`) and one `astro dev`. `fullyParallel: false` only keeps a file's own tests in order. `studio.spec.ts` and `markdoc.spec.ts` still ran side by side in two workers, and `--repeat-each 6` ran its six copies in six workers, each one appending "Last line." to the same guide and restoring it. The YouTube test failed 6 of 6 that way. With one worker it passes 10 of 10.

The other cause came from outside the tests. `astro dev` serves the studio from `packages/*/src`, so an edit there during a run makes Vite reload `/admin`, which throws the editor's unsaved edits away. In the one full-run failure captured, another session had edited `BodyEditor.tsx` 30 ms before the reload. The test then failed on whatever it checked next, a save that never landed or a block no longer selected, so the new check names the real cause instead.

Longer timeouts were rejected because slowness wasn't the cause. With nothing edited during the run, the full suite passed ten times in a row before this change. The YouTube test also passed 5 of 5 with Chromium's CPU slowed sixfold, as long as it ran in one worker.

### 2026-10-18: Builds started from Vitest drop Vitest's environment

**The image integration tests run `astro build` without `NODE_ENV`, `DEV`, `PROD`, `MODE`, `SSR`, `BASE_URL`, `TEST` and `VITEST*` in the child's environment.** Vitest sets them, and Astro 6 read them as a development build: its `<Image>` wrote the dev-only `data-image-component` into the fixture's HTML. Without them the build is the one a site runs.

### 2026-10-19: The studio test server stays attached under an AI agent

**`scripts/studio-site.mjs` starts `astro dev` with `--ignore-lock`.** Astro 7 detects an AI agent (through `am-i-vibing`) and, on macOS and Linux, starts `astro dev` in the background and returns at once. Playwright then reads its web server as having exited, and the detached server keeps port 4401. `--ignore-lock` is Astro's documented way to run a one-off foreground server; it's the same server for a person in a terminal, where nothing backgrounds. Windows never backgrounds (Astro skips it there), which is why it didn't show before.

### 2026-10-17: axe gates on WCAG 2.1 A/AA and reports 2.2

**Every built page must have zero axe violations for `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`. `wcag22aa` findings are attached to the test as annotations but don't fail it.** D11 makes 2.1 AA the floor and 2.2 AA a goal "where it's cheap." Pages that are deliberately broken test fixtures are listed, with the reason, in `AXE_EXCLUDED` in `e2e/static-site.spec.ts`. They still have to load.

## Studio

### 2026-10-17: The UI kit is built on React Aria Components (spec §13.2)

**`packages/ui` wraps React Aria Components (Apache-2.0), not Radix.**
- The kit (spec §10.5) needs primitives Radix doesn't have:
  - a combobox (reference and tag pickers);
  - a tree (the WAI-ARIA tree with type-ahead, §6.15.2);
  - a keyboard-navigable table;
  - time-zone-aware date and time fields (scheduling, D18);
  - drag and drop with keyboard alternatives.
- With Radix, Vesper would hand-build exactly the hardest accessibility pieces.
- Little Taproot reuse is lost: Taproot only imports Radix Dialog and Tabs.
- The cost is a larger bundle and a more verbose API. Both are acceptable in a studio that loads only at `/admin`. It's styled with Tailwind 4 through React Aria's data attributes and our own tokens, never a kit's default look (D12).

### 2026-10-17: The body editor splices changed blocks into the original text

**Bodies are parsed with the parser the site renders with: remark/micromark (GFM) for `.md`, plus the MDX extensions for `.mdx`, and Markdoc's parser for `.mdoc`. Each top-level block keeps its source range.**
- Tiptap 3 edits the document, and every block remembers the content it was loaded with.
- On save, unchanged blocks copy their original bytes, and the whitespace between two untouched neighbors is kept too.
- Only changed or new blocks are serialized, in one house style.
- Blocks the writing view can't represent faithfully (undeclared JSX, raw HTML, front-loaded imports, tables) are protected source blocks, edited as raw text. Since Phase 2.5, Markdoc tags and declared MDX components are blocks of their own (see "Markdoc tags and declared MDX components are nested blocks").

Rejected:
- Tiptap's Markdown serializer for the whole body: it normalizes list markers, emphasis, escaping and wrapping, which spec §6.5 forbids.
- Source-only editing: it fails the non-technical editors Vesper is for.

This is the same rule §6.5.1 already sets for Markdoc tags, so `.md`, `.mdx` and `.mdoc` share one mechanism. The cost: an edit inside a long list re-serializes that whole list. It can be made finer later.

### 2026-10-17: Map tiles come from MapLibre with OpenFreeMap by default (spec §13.9, tiles only)

**`fields.geo` renders its map with MapLibre GL JS (BSD-3-Clause). The default style is OpenFreeMap: free, no API key, OpenStreetMap data. A `vesper.config.ts` option points it at MapTiler, Stadia or self-hosted tiles instead.**
- OpenStreetMap's own tile servers forbid this use, and keyed providers don't suit free GitHub-mode sites.
- The map loads lazily, only when a geo field is on screen.
- The lat/lng number inputs stay the real controls, so a failed or blocked map never stops editing (§6.3.2).
- OpenStreetMap attribution is shown.
- OpenFreeMap is a community service without an SLA, which is why the style can be overridden.

Geocoding (cloud address search) is still open. It is decided before Phase 4.

### 2026-10-17: `/admin` is built by the site's Vite from a precompiled studio

**`@vesper/admin` ships compiled JavaScript and CSS. The integration injects one prerendered `/admin` page whose client script the site's own Vite bundles, together with the site's custom widgets (through a virtual module) and the manifest.**
- Custom widgets are the site's own components (spec §6.3.3), so only the site's build can bundle them.
- A studio compiled per site from TypeScript and Tailwind would be slow and fragile, so the heavy part ships ready-made.
- The site needs no `@astrojs/react` and no Tailwind, and Astro's `base` and `studio.deploy: false` keep working.

A site on React 18 can't run the studio: it resolves the site's React. Jeremy chose on 2026-10-19 to require React 19 rather than ship the studio its own copy (see "The studio needs React 19").

### 2026-10-17: MDX components need a declared schema (spec §13.6)

**An MDX component gets an editable block only when `vesper.config.ts` declares it with a Zod props schema. Undeclared components stay protected source chips.** Guessing props from TypeScript types is brittle. A wrong guess would show the wrong controls and could drop data on save.

### 2026-10-17: The studio's content operations live in core, over the storage adapter

**`ContentService` (`@vesper/core`) lists, reads, creates, saves and deletes entries over any `StorageAdapter`, exactly as Astro's `glob()` and `file()` loaders see them.** Local mode runs it in the dev server. GitHub mode (Phase 3) can run the same code in the browser over the GitHub adapter, so entry IDs, conflict checks and file fidelity can't differ between modes. Validation is injected (`Validator`), because only the site's own Zod schemas can validate, and they live wherever the site's config was loaded.

### 2026-10-17: The local dev API answers only the studio, on this machine

**The middleware at `<base>_vesper/api/` refuses a request unless:**
- its Host is localhost, `127.0.0.1` or `::1` (this also defeats DNS rebinding);
- `Sec-Fetch-Site`, when present, is `same-origin` or `none`, and any `Origin` matches the Host;
- it carries `X-Vesper: 1`, which forces a CORS preflight on any cross-origin attempt.

Why all three: Vite's default CORS policy allows every localhost origin, so another dev server open in the same browser (a different port on localhost is same-site) could otherwise read and write this site's files. The one exception to the header rule is `GET /file`, because `<img src>` can't send headers. It serves media types only (images, PDF, video), never escapes the site root, and still refuses cross-site requests.

### 2026-10-17: Save errors are plain language; the schema author's own messages win

**`issuesFromZod` rewrites Zod's built-in messages ("Invalid input: expected string, received undefined" becomes "This is required.") and keeps any message the schema's author wrote, such as a `.refine()` message.** It reads issues structurally, so core still never imports Zod. Saves validate with `reportInput: true` so a missing value can be told from a wrong one.

### 2026-10-17: Local mode saves when you press Save

**In local mode the editor writes to disk only on Save (or Ctrl/⌘+S). It shows "Unsaved changes" in the top bar, asks before you leave with unsaved changes, and warns on reload.** Autosave to disk would write half-finished values that the schema rejects, and every write makes Astro reload the site. Autosave belongs to cloud drafts (Phase 4), where a draft isn't the published file.

### 2026-10-17: The studio page ignores Astro's reload after content changes

**After any content file changes, Astro tells every open page to reload. The studio page skips that one reload (a `full-reload` with path `*`, or with no path at all, which is what a Markdoc entry's change sends, and no `triggeredBy`) through Vite's `vite:beforeFullReload` hook, because the studio made the change and reloading would throw away its state.** Code changes and manifest changes still reload it. This relies on Vite's client reading the payload after its listeners run (true in Vite 5 to 8). If that ever changes, the studio simply reloads after a save, as it did before. A file changed by someone else while it's open is caught at save time as a conflict.

### 2026-10-17: Times are entered in the site's time zone and written with that day's offset

**`vesper.config.ts` takes a `timeZone` (an IANA name, checked when the config loads). Date-time fields show and accept wall time in that zone, name the zone in text ("Times are in Eastern Time, the site's time zone."), and fall back to the editor's own zone, saying so, when none is set.** A value carries the offset the editor meant: the studio sends `{ "$date": "2026-11-07T10:00:00-05:00" }`, core keeps the offset as a hidden property on the Date, and the YAML writer uses it in place of the old value's offset. So a time moved across a DST change is written `-05:00`, not October's `-04:00`. A file that stores UTC (`Z`) keeps UTC. Plain `Intl`, no time zone library.

### 2026-10-17: The body editor loads on first use

**Tiptap, its Markdown support and the body editor load as a separate chunk the first time an entry with a body (or a Markdown field) is opened, behind a short "Loading the body editor…" status.** They were over half of the `/admin` script: the first load went from 1,818 KB to 843 KB minified. The home screen, lists and data-only entries never need them.

Amended in Phase 2.5: body checks (Markdoc, micromark and the validation around them) and `vesper.config.ts` (with the Zod it brings for MDX props schemas) load the same way, on first use. Imported eagerly, they took the first load to 1,480 KB. Now it is 846 KB, with the checks in a 513 KB chunk and `vesper.config` in an 85 KB one. The entry editor imports the checks the first time a body needs validating; `virtual:vesper/widgets` imports `vesper.config.ts` the first time a custom widget renders or an MDX body needs its components' props schemas.

### 2026-10-17: The geo field's map loads only when asked for

**Latitude and longitude are two always-visible number fields, the real controls (spec §6.3.2). "Show on a map" loads MapLibre and OpenFreeMap tiles on demand.** The map is about 1 MB of code and fetches tiles from the internet, so it shouldn't load for every location entry, and the studio works offline without it. The pin is a real button: arrow keys move it (Shift for ten times as far) and each move is announced. MapLibre's worker is passed in with `setWorkerUrl` and a Vite `?url` import, so it works in dev and in a site's build.

### 2026-10-17: References keep their stored shape, and lists of them keep their order

**A reference field stores an entry ID, and a value already stored as `{ collection, id }` keeps that shape. A list of references is an ordered list with Move up, Move down and Remove buttons and a search box to add more,** because order usually matters (related posts) and must not depend on drag-and-drop. An entry is never offered as a reference to itself.

### 2026-10-17: The integration compiles custom widgets as React, and nothing else

**Astro sites default to `"jsx": "preserve"`, and a site needn't have `@astrojs/react`. So a `pre` Vite plugin compiles the files `vesper.config.ts` imports lazily as widgets, and any JSX files those import in turn, with React's automatic runtime (Oxc on Vite 8, esbuild on Vite 7).** No other file in the site is touched, so sites using Preact, Solid or Astro's own JSX are unaffected. `WidgetProps` lives in `@vesper/core` (it has no React in it), re-exported from `@vesper/astro/config` for sites and from `@vesper/admin`. A widget that throws or fails to load falls back to the built-in control for its field, with a one-line note.

### 2026-10-17: "Edit this page" separates entries a page shows from ones it lists

**In `astro dev`, `vesper:content` notes each entry a page reads, into a per-request store opened by a dev-only middleware (`AsyncLocalStorage`), and the middleware appends the list to the page as JSON for the toolbar app.** `render()` and `getEntry()` mark an entry as shown; `getCollection()` and `getEntries()` mark it as listed, because `getStaticPaths` calls `getCollection()` for every page of a route. The toolbar app shows the shown entries first and the listed ones behind a disclosure. Builds don't include the middleware or the toolbar app, and `vesper:content` is a plain `export * from 'astro:content'` there.

### 2026-10-17: The writing view owns only blocks it can round-trip

**A body block is editable in the writing view only if every node in it is one the editor writes back faithfully (paragraphs, headings, lists, quotes, code, rules, emphasis, strong, code spans, links, images, strikethrough), and parsing what the editor would save gives the same document again. Everything else is a protected source block, named in words ("Component, kept as written") and edited as raw text (in a small dialog since Phase 2.5, or in the source view).** That covers tables, footnotes, reference-style links, task items, links or images with titles, HTML, undeclared JSX, expressions and imports. Markdoc tags and declared MDX components have been blocks since Phase 2.5, and inline tags, variables and annotations are chips inside writable blocks. Each writable block's editor node remembers its block index (not copied when a block is split). On save, a node whose JSON is unchanged copies its original bytes, and `assembleBody` keeps the spacing around untouched neighbours, so typing in one paragraph changes only that paragraph's lines. Tiptap 3 with `@tiptap/markdown` (as in Taproot), StarterKit minus underline (no Markdown for it) and the trailing empty line.

### 2026-10-17: The body editor's keyboard and toolbar

**The formatting toolbar is one Tab stop (React Aria's toolbar pattern) with words, not icons (spec §10.4): Bold, Italic, Heading, Subheading, Bullets, Numbers, Quote, Code, Link, Image. Escape moves focus from the text to the toolbar, so leaving the editor never depends on Tab, which indents list items.** Images inserted into the body go through the same picker and hygiene as image fields, and need alt text (or "decorative") before they're inserted.

### 2026-10-17: Upload hygiene strips metadata losslessly unless the pixels must change

**JPEG, PNG and WebP uploads lose their EXIF, XMP, IPTC, text and comment data by dropping those segments or chunks, so the image data is byte-for-byte the original. They're re-encoded through a canvas only when the pixels must change: a photo whose EXIF orientation isn't upright, or one larger than `maxUploadEdge` (3000px by default).** Re-encoding drops all metadata too. Colour profiles (JPEG APP2) are kept. SVG is sanitized with DOMPurify's SVG profile, plus `foreignObject`, `set` or `animate` that rewrite links or handlers, and `javascript:`/`data:` links. Files are typed by their bytes, not their names. Duplicates are found by content hash against the site's files (the git blob SHA since Phase 3, see "Duplicate uploads are found by git blob SHA"), and the editor chooses between reusing the existing file and uploading a copy. Over 5 MB asks first; over 20 MB is refused (the dev API enforces the hard limit too).

### 2026-10-17: HEIC converts only where the browser can decode it, for now

**HEIC photos are converted to JPEG when the browser can decode them (Safari). Elsewhere the studio says plainly to export a JPEG first or to use Safari.** The browser libraries that decode HEIC everywhere (libheif-js, heic-to) are LGPL-3.0. Whether that suits the studio bundle was Jeremy's call, raised at the end of Phase 2. **He kept this for launch on 2026-10-19.** An LGPL library inside an MIT bundle would draw questions from the legal reviews of the colleges and public bodies Vesper sells to. If editors ask for it, `heic-to` loads as a separate, unmodified chunk on the first HEIC upload, with its licence notice.

### 2026-10-17: Images go beside their siblings; other files go to `public/files`

**A new image goes into the folder of the image it replaces, else `<srcDir>/assets/<collection>/`, and the entry stores a path relative to its own file, so Astro's `image()` processes it. A file field (PDFs and so on) uploads to `public/files/` and stores `/files/name.pdf`,** because a file to link to must be served as is, and files under `src/assets` aren't. The media service lists `<srcDir>/assets` and `public`, and computes "Used on" by looking in every entry's file for each of the ways Astro resolves a path to that file.

### 2026-10-17: Secondary fields go to Details by rule, and authors can override

**The editor puts slugs, dates, tags, ordering, SEO and scheduling fields in the Details section (spec §10.3). Everything else stays in the main column, in schema order.** A field's `placement` overrides the rule, set either with `.meta({ placement: 'details' })` or in `vesper.config.ts` as `collections.blog.placement: { summary: 'details' }`.

### 2026-10-17: In this workspace, the integration compiles the studio's CSS from source

**When `@vesper/admin/studio.css` resolves to `src/` (the `@vesper/source` condition), the integration adds `@tailwindcss/vite` to the site's Vite. Installed from npm, it resolves to the precompiled `dist/studio.css` and Tailwind never loads.** So the playground stays a zero-config site, and the dev loop still never builds `dist/`. `@tailwindcss/vite` is a devDependency of `@vesper/astro` for this reason only.

### 2026-10-17: Markdoc tags and declared MDX components are nested blocks

**A Markdoc tag or MDX element laid out as an opening line, content and a closing line is a container: its opening, its closing and its children are separate parts of the block. A tag without content, or with content on its opening's line, is one piece (a card). Inline tags, variables, annotations, inline JSX and expressions are chips inside Markdown blocks.** A save re-writes a container's opening only when its attributes change, splices its children block by block with the same spacing rules as the body, and never re-writes its closing. Unknown Markdoc tags and undeclared components stay protected source blocks (§13.6, decided: MDX needs a declared schema).
- Markdoc records only line ranges, so offsets come from lines, and every chip found by Markdoc's own `parseTags` (with code spans blanked) must match the tree's count of inline tags and variables. When they disagree, the block is kept as written.
- Containers get one editor node type each, made from the manifest, and their content expression comes from Markdoc's `children`: only allowed node types fit inside, including on paste. Protected blocks always fit.
- Indented content (JSX children, Markdoc with `allowIndentation`) keeps its indentation: new and changed children are indented like the original's first child.

Rejected: one generic container node type with the allowed children checked by a plugin. It can't stop a paste, and an insert would "fit" by splitting the frame.

### 2026-10-17: Inline chips travel through the Markdown serializer as placeholders

**For Tiptap's Markdown parser and serializer, each chip is one private-use placeholder (`U+E000`, the chip's source as hex, `U+E001`). The editor node's only real attribute is that source. After serializing, placeholders become each chip's current source.** Marks can span chips, nothing is ever escaped or rewrapped inside one, and the writing view's round-trip check (parse, serialize, parse again) still applies to the whole block. A block whose only change is inside its chips (an inline tag's settings, a variable edited as text) doesn't go through the serializer at all: the chips' new text is spliced into the block's original text, so Markdown the editor would restyle (`__strong__`) stays as written. Found by the jazzy corpus, where `affiliateLink` sits inline 69 times.

### 2026-10-17: A body blocks saving exactly when Astro's build would fail

**`validateMarkdocBody` blocks on Markdoc errors at `error` or `critical` level, except the ones @astrojs/markdoc ignores: `variable-undefined` (pages can pass variables in) and Markdoc's own "Partial … not found" (Astro resolves partial files itself). In its place, a partial's file must exist relative to the entry, as Astro resolves it. Unknown tags and functions block in the dev API, which validates with the site's own config, and are warnings in the browser.** Measured in @astrojs/markdoc 2.1: `raiseValidationErrors` applies exactly that filter and fails the build. The spec's table says unknown tags get "a validation warning", while Markdoc rates them critical, so a save that keeps one would break the next build. The browser's config is rebuilt from the manifest and can know less than the build (an `extends` it couldn't read), so blocking there would refuse good saves; there they warn, and the dev API refuses the save (`siteConfig`). Jeremy chose this on 2026-10-19 over warning everywhere (Phase 2.5's first build) and blocking everywhere. HTML and comment nodes that Astro turns into its own tags before validating aren't reported. Messages are plain language and name the block ("YouTube video: Title is required."), and each issue records the attribute at fault, so a settings form shows it under that field.

### 2026-10-17: The browser checks Markdoc with the manifest; the dev API with the real config

**In the studio, `Markdoc.validate()` runs with a config rebuilt from the manifest: types, `matches`, `required`, `children`, `selfClosing`, `inline`, slots. On save, the dev API validates again with the site's real config, merged by @astrojs/markdoc's own `setupConfig`, so custom attribute type classes and `validate` functions run too, and it refuses a body with blocking issues.** Custom classes and functions are code: they can't go into a JSON manifest. Bundling `markdoc.config.mjs` into `/admin` instead was rejected: `@astrojs/markdoc/config` imports Astro's server runtime, and a config may `extends` integrations such as Shiki, neither of which belongs in a browser bundle. In GitHub mode (Phase 3), the build is the last check for those custom validators.

### 2026-10-17: MDX props are checked with the real Zod schema, in the browser too

**`virtual:vesper/widgets` also exports a loader for each declared component's props schema, so the studio validates props with the site's own Zod schema in every mode, and the dev API checks them again on save.** `vesper.config.ts` already reaches `/admin` for custom widgets. It loads the first time an MDX body needs the schemas (see "The body editor loads on first use"), so `astro/zod` (about 60 KB) never weighs on the first load. Props that hold code (`on={fn}`) or spreads are shown read-only, kept byte for byte and not validated; a component with a spread isn't checked at all.

### 2026-10-17: One Settings dialog per block, reached by Enter on a selected block

**Each frame and card is a group named after its tag ("Callout · Warning") with one Settings button. The dialog holds the attributes as fields, rendered with the frontmatter widgets, plus Move up, Move down and Remove. On the keyboard: arrow onto a block (ProseMirror selects it), Enter opens its settings, Alt+↑/↓ move it, Delete removes it, and Escape inside a frame selects the frame.** Buttons inside the text are out of the Tab order (jazzy has pages with dozens of chips), except the Settings button of the frame the cursor is in, so Tab from inside a frame reaches it. The dialog focuses its first field (the chosen option, in a radio group), applies changes as they're made so Ctrl+Z undoes them, and returns to the text with the block still selected. A selection change onto a block is announced ("YouTube video selected. Press Enter for its settings."). An inline chip moves with cut and paste, as text does. A new tag with attributes opens its settings straight away. Rejected: a "…" menu on every block, which would add a second button to every frame for actions the dialog already has.

### 2026-10-17: The "/" list is a small ProseMirror plugin, and the text becomes a combobox while it's open

**Typing "/" at the start of a line or after a space opens a listbox of what fits at the cursor, filtered as you type; Enter or Tab inserts, Escape closes. While it's open, the editor element has `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`; otherwise it's `role="textbox"` with `aria-multiline`.** The ARIA attributes come from `editorProps.attributes` as a function of the state, the only place that can replace Tiptap's own `role="textbox"`. What fits is asked of the schema directly (`canReplace`), because inserting through ProseMirror would make a block "fit" by splitting the frame the cursor is in. A tag that doesn't say whether it's inline is offered inline only if it holds no block children and isn't self-closing (a Markdoc tag may go either way). The toolbar's Insert menu offers the same list for people who don't use "/". Rejected: `@tiptap/suggestion`, a dependency for about a hundred lines, whose list isn't a combobox.

### 2026-10-17: Partials are `.mdoc` files named like partials, nearest the entry first

**The partial card's file picker lists `.mdoc` files whose name starts with `_` or that sit in a `partials` folder, ordered by how far they are from the entry, and stores the path relative to the entry, as @astrojs/markdoc resolves it. A new partial starts out pointing at the nearest one.** Astro's glob loader skips `_` files, so they're the usual place for partials; but `_` alone also marks drafts (the playground's `_unpublished-idea.md`), hence `.mdoc` only. Existence is checked against every Markdown and Markdoc file under the source folder, so a partial elsewhere is still valid.

### 2026-10-18: The page outline is a treegrid, and its expand toggle is an icon

**Tree collections open as an outline built on React Aria's `Tree`, a single-column `treegrid`, not WAI-ARIA's plain `tree` (spec §6.15.2 names `tree`/`treeitem`).** Each row holds buttons (its "…" menu, its drag handle), and WAI-ARIA's guidance is a treegrid when rows hold interactive content; a `treeitem` can't. The keyboard model is the tree pattern's: Up/Down move, Right expands then reaches the row's buttons, Left collapses or goes to the parent, Home/End jump, typing finds a row, Enter opens the page. Rows carry `aria-level` and `aria-expanded`.

Two additions on top:
- Alt+↑/↓ move the focused page among its siblings, as blocks move in the body editor, and Shift+F10 (or the menu key) opens its menu.
- Drag and drop is React Aria's, with its keyboard mode (Enter on the handle, arrows to "Insert between…" or "Drop on…", Enter). A drop between pages reorders; a drop onto a page opens the same move dialog as "Move to…", so its effects are confirmed.

Every change is announced in a polite live region: "Nursing moved under Academics, position 1 of 3." React Aria's key handling keeps row key events to itself, so the outline reads them in the capture phase from whichever row has focus.

**Budget note (spec §10.4, icon-only buttons):** the expand toggle is a "▸" button with no visible text. It's React Aria's chevron: named "Expand" or "Collapse", outside the Tab order, and only a mouse affordance, since the arrow keys expand and collapse. It's the one icon-only control beyond close, overflow and drag handles, and it's the convention every outline uses. Confirmed by Jeremy, 2026-10-19.

### 2026-10-18: The Redirects screen lives behind the Site menu

**Redirects are a site setting (spec §6.15.5: "a small Redirects screen in site settings"), so the screen is the top bar's Site menu's second item, beside Media.** One primary action, "Add redirect". Edit and delete sit in each row's "…" menu. "Import from CSV…" is a secondary button that opens a preview: what's added, what replaces an existing redirect, and each skipped row with its reason (pattern redirects, `?query` addresses a static site can't tell apart, status codes that aren't redirects, rows turned off in a WordPress export). Nothing is saved until the import is confirmed. Every save goes through the same cleanup as the build, so the screen also lists what needs a look. Kinds are words: Permanent (301, 308) and Temporary.

### 2026-10-18: The link picker writes the page's address

**The body editor's link dialog is a text field that suggests pages by title (React Aria's ComboBox with custom values), and choosing one writes the page's current address, base and trailing slash included.** The content stays plain and portable, and a later move rewrites it. URL fields get a "Choose a page…" button beside the native URL input, since the widget contract has the editor own the field's label. A field whose schema takes only full URLs (`z.url()`, as `fields.url()` makes) gets the site's address in front when Astro's `site` is set, and no picker when it isn't: a path would fail its own validation.

### 2026-10-18: The focal point is the image as a button; the crop box is an application

**The image field's focal point is one native button holding the image: a click or tap sets the point, the marker drags, and the arrow keys move it 1% (Shift, 10%). "Across (%)" and "Down (%)" number fields beside it are the way in without seeing or pointing, as the geo field's latitude and longitude are (spec §6.3.2). Every move made with the keys or the pointer is announced politely: "Focal point 62% across, 35% down."** A screen reader in browse mode keeps the arrow keys for itself on a button, which is why the number fields exist; the button is still one Tab stop, with its position in its description.

**The crop dialog's box is one focusable element with `role="application"`, named "Crop box for Wide (16:9)" and described by its position and its keys.** A two-way box has no ARIA widget role, and `application` is the role that makes screen readers pass the arrow keys through to it. jsx-a11y counts it as non-interactive, so that one element carries a lint exception with the reason (confirmed by Jeremy, 2026-10-19; his screen reader pass can still send it back to number fields). The box takes focus as the dialog opens, in a layout effect: React's `autoFocus` works only on form controls, and React Aria's dialog focuses itself unless focus is already inside. Arrows move it 1%, Shift+→ and Shift+↓ grow it and Shift+← and Shift+↑ shrink it around its centre, Enter applies and Escape cancels; each change is announced. The corner handles are for the pointer and hidden from assistive technology.

**Where it lives (spec §10.4):** inside the image field, behind one "Focal point & crops" disclosure, and only for fields that store a focal point or crops. The crop tools are behind each preview's "Adjust crop" button, in a dialog in a new wide size whose one primary action is "Apply crop". No icon-only buttons, no tabs, hairline borders; the image outside the crop is dimmed with the `content` token at half strength.

### 2026-10-19: The studio needs React 19

**When `/admin` is part of the build (always in `astro dev`, and in builds unless `studio.deploy: false`), the integration reads the version of `react` that `@vesper/admin` resolves, and stops with a plain message if it's older than 19 or missing: "Vesper's studio needs React 19, and this site has React 18.3.1. Install React 19 with `npm install react@19 react-dom@19`, then restart."** The studio is bundled by the site's Vite with the site's custom widgets, so it runs on the site's React, and React 18 would fail in the browser instead of at build. npm already refuses the peer conflict at install; pnpm and Yarn only warn, so this is the backstop. Rejected: loading the studio's own React beside the site's. Two Reacts on one page break hooks in custom widgets, which must share the studio's React, and React 19 is nearly two years old.

### 2026-10-19: A chip is non-editable once, on its own element

**The chip's React view sets no `contentEditable`. The `contenteditable="false"` that keeps the caret out of a chip is the one ProseMirror puts on every leaf node view's own element.** On a Mac, with the caret right after a chip that starts a line, ⌘← left it there, and ⌘→ did the same right before a chip that ends a line. Reproduced on 2026-10-19 in Playwright's Chromium and in Chrome 155 on macOS, with keys sent through the Claude in Chrome extension (⌘← on a plain line moved there as it should). Before the browser moves the caret, prosemirror-view 1.42.6 runs `skipIgnoredNodesBefore` (or `After`), which steps over DOM it can ignore: zero-size hack nodes, and non-editable elements with no view of their own. It walked into the chip's element, took our inner `contentEditable={false}` span for such an element, then crossed the zero-size `ProseMirror-separator` image beside the chip. 1.42.6 puts one before an atom that starts a line, and Chrome and Safari have long had one after an atom that ends a line. That left the caret at the line's edge, exactly where the browser's own `moveToLeftEndOfLine:` lands next, so ProseMirror saw no change, and 50ms later it put the caret back. Without the inner attribute the walk stops at the chip, and the browser's move is the only one. It struck only when the browser's caret sat inside the text beside the chip, as after arrowing or clicking there; where ProseMirror places the caret itself (between elements) the walk never starts.

Rejected: binding ⌘← to `selectTextblockStart`, which goes to the paragraph's start, not the visual line's, and so breaks wrapped lines; and a keymap that runs only after a leading chip, which is more code and fixed only one of the two keys. ProseMirror's main branch had no fix as of 2026-10-19. The e2e test presses the keys on macOS only, since Linux has no ⌘←. A unit test checks the attribute stays gone on every platform. ⇧⌘← right after a chip, and ⇧⌘→ before one, selected just that chip for a different reason; see the next entry.

### 2026-10-19: ⇧⌘← and ⇧⌘→ beside a chip are the browser's

**On a Mac, when ⇧⌘← or ⇧⌘→ would extend the selection over a chip, or any other leaf such as a line break, right beside the caret, the studio's `handleDOMEvents.keydown` returns true. ProseMirror then leaves the key alone, and the browser extends the selection to the visual line's end.** prosemirror-view 1.42.6's `selectHorizontally` has a Shift branch that, with a leaf beside the head, extends the selection over that one node whatever other modifiers are held, and prevents the default, so the browser's `moveToLeftEndOfLineAndModifySelection:` never ran. Seen in Chrome 155 on macOS (caret after a mid-line chip at 338, line start 329: head 337), and confirmed on 2026-10-19 in the Claude app's Chromium 152 (head 266 against a line start of 262). With the handler, in Playwright's Chromium, ⇧⌘← after a mid-line chip, after two chips that start a line, and after a chip on a later visual line of a wrapped paragraph lands exactly where it does from plain text on that line, and ⇧⌘→ before one likewise. That holds with the caret arrowed there through the text and with ProseMirror putting it there (→ from a selected chip).

`handleDOMEvents` is ProseMirror's documented way to leave an event's default to the browser. `handleKeyDown` can't, because ProseMirror prevents the default whenever it returns true. Skipping ProseMirror's keydown also skips `skipIgnoredNodes`, but in exactly these cases its Shift branch had already returned before that ran, so nothing is lost. The handler reads the key's side as ProseMirror does in Chrome (← is backward unless the text runs right to left) and takes ⇧⌘ with no other modifier, so ⇧← still selects just the chip.

Rejected: binding Shift-Mod-ArrowLeft and -Right to commands that select to the textblock's ends, which are the paragraph's ends, not the visual line's, and break wrapped lines (as with ⌘← above); and preventing the default, then copying the browser's move with `Selection.modify('extend', 'left', 'lineboundary')`, which is non-standard and only imitates what the browser does itself. The e2e test types over each selection and checks the saved line, on macOS only. A unit test with the platform set to a Mac checks that the key is left to the browser, on every platform CI runs. Still open: with the chip itself selected, ⇧⌘← leaves a caret before it, as ← does, because ProseMirror's branch for a selected inline node ignores modifiers.

### 2026-10-21: Studio additions from dogfooding are built between phases

**Building vespercms.com and editing it through the cloud showed six gaps in the studio: tables, history, inline code in one-line Markdown fields, duplicate and copy links, the ⌘K palette, and the tab title. None is in a phase of spec §11. Jeremy approved all six on 2026-10-21 and took every recommendation in PLAN.md's "Studio additions from dogfooding (design)". They're built between phases, in that section's order, not held for Phase 9's polish.** Each lands as its own step with an outcome note, as the icons did after the design pass. The entries below record each call. Step 1, the tab title and code in one-line Markdown fields, was built the same day; CLAUDE.md's rules change as each step lands.

### 2026-10-21: Tables are edited as a grid, and a save splices cells

**A pipe table whose cells are each one line of inline Markdown the writing view writes back becomes a grid in the body editor: the WAI-ARIA data grid pattern, with arrow keys between cells, Enter or F2 to edit one in the one-line Markdown editor, and row and column actions behind a "Table actions" overflow button and Shift+F10. Saving changes only the cells, rows and columns that changed, through a core writer beside `editMarkdocTag`, and refuses a result that doesn't read back as intended. Everything else stays a protected block, as now (calls T1 to T4).**
- **Padding (T1).** In an aligned table, a changed cell is padded to its column's width when it fits. When it's longer, it gets one space on each side and that row stops lining up. No other row changes, so one edit is one line, as "No unrelated diff" defines it. GFM ignores padding, so the page is the same. Rejected: re-aligning the column, which rewrites every row for one changed price; and never padding, which makes an aligned table ragged on its first edit. Of the 48 tables in vespercms.com and the corpus, 47 are compact and one is aligned, so this rarely shows.
- **A grid (T2).** The keys are predictable, and screen readers treat a grid as one thing. Rejected: a ProseMirror table in the text (`prosemirror-tables`), where arrows move through text rather than cells, screen readers' table commands are unreliable inside an editable region, and cell-by-cell splicing would have to map ProseMirror's table model back to the source.
- **Pipe tables first (T3).** Every table in this repository's content is a pipe table, and none uses `{% table %}`. A `{% table %}` stays a protected block until a site uses one; the design already covers it (a cell is its `* ` line).
- **Inserting (T4).** "Table" in the Insert menu and the "/" list inserts a compact pipe table, in every format.

### 2026-10-21: History comes from git in every mode, and is free outside the cloud

**Jeremy chose on 2026-10-21 (call H1): an entry's history, viewing an earlier version and restoring it are free in local and GitHub modes, and part of the cloud. In the cloud a restore becomes a draft, as spec §7.4 says. In local and GitHub modes it loads the earlier values as unsaved changes, and Save or Publish writes them through the usual splice and checks. Spec §4 and §7.4 are changed to match.** It's git's own data, read with the editor's own sign-in or the developer's own git, and costs the cloud nothing in those modes. What only the cloud does stays paid: restoring as a draft, and review. Rejected: history in the cloud only, as §7.4 first placed it.
- **Local mode without git (H2)** has no History item. An Astro site without git is rare, and git is the history. Rejected: copies of each save in `.vesper/history/`, which would duplicate git and need pruning.
- **An earlier version is shown (H3)** in the entry's own form, read-only, with the fields that differ from now named and marked in words. Editors see content, not file syntax. Rejected: the two files' text side by side, as the cloud's conflict compare shows it (YAML and Markdown source).
- **The cloud's API** gains a history list and a version's bytes, in `@vesper/core`'s contract first. The API resolves a version's blob itself, from that commit's tree, and refuses a path outside the site's folder. `POST /blobs` is never widened to every blob in the repository.

### 2026-10-21: One-line Markdown fields have code

**The compact Markdown editor turns on code, in inline and multi-line fields alike, with a Code tool and ⌘E, as the body editor has (call C1). The round-trip check stays, so a value it can't write back as it is still falls back to plain text.** Backticks are core Markdown, and every common renderer handles them. vespercms.com's home page avoided code formatting only because the editor couldn't show it. Rejected: an opt-in `fields.markdown({ code: true })`, which every site that wants code would have to find. Built 2026-10-21. A code span holding a backtick (``` ``a`b`` ```) round-trips too, so it opens in the editor rather than as text.

### 2026-10-21: The compact Markdown editor checks marked's tokens before the round trip

**A Markdown field opens in the compact editor only when every token marked reads from its value is one the editor holds: paragraphs, text, escapes, bold, italic, code, links, hard breaks, and lists outside one-line fields. Anything else (a strikethrough, an image, a quote, a rule, a table, a code block, a task list, a link definition, HTML), a GFM footnote, or a named character reference Tiptap doesn't decode (`&nbsp;`) opens as plain text. The round-trip check stays after it.** The round trip compared `parse(serialize(parse(value)))` with `parse(value)`, so whatever Tiptap's parser dropped on the first parse was missing from both sides and passed. `Was ~~$40~~ now $30.` opened as "Was $40 now $30.", and the first edit saved that; a rule, a table or (in a one-line field) a list opened as an empty field. Before code was on, a code span vanished the same way, text and all. marked is the lexer Tiptap parses with (`MarkdownManager.instance`), so the walk reads exactly the tokens the parser does, with no new dependency, and a code span or an escape is never mistaken for what it holds. That replaced the raw `<` test, which also sent code holding `<` (`` `<Search>` ``) to plain text, and an autolink (`<https://…>`) now opens in the editor too. Footnotes and entities are text to marked, so they're matched in its text tokens, where an escaped `\[` or `\&` is already a token of its own. Rejected: turning on the dropped extensions, which widens the editor and still leaves tables, footnotes and definitions; comparing the doc's text with the value's, which misses dropped marks (the strikethrough's text survives); a second parser such as micromark, a dependency that reads a different dialect from Tiptap's; and comparing `serialize(parse(value))` with the value byte for byte, which falls back on every harmless difference (`_a_` and `*a*`, an autolink written out).

### 2026-10-21: Duplicate starts an unsaved copy that keeps the original's text

**"Duplicate" in the editor's "…" menu (and the outline's row menu) opens an unsaved new entry with every value copied, " (copy)" after the title, and fields holding the entry's own address cleared (call D1). Saving reads the original and splices the copy's changes into its text, so comments, key order and body bytes carry over. In a tree, the copy goes right after its original among its siblings, and a page is copied without its subpages (D2).** Nothing is written until the editor saves, as with any new entry. Rejected: marking the copy `draft: true` (a copy saved on purpose wouldn't appear), and saving it at once (abandoned copies fill the folder). "Copy page address" and "Copy editing link" sit in the same menu; where the Clipboard API isn't available (a site on plain `http`), a dialog shows the link selected instead.

### 2026-10-21: ⌘K opens the palette, except inside text

**⌘K (Ctrl+K) opens the command palette on every screen, except when focus is in a text editor (the body or a Markdown field), where it stays Link; Escape moves focus to the editor's toolbar, and ⌘K works from there (call P1). The palette finds entries by title, address and file name, plus places to go, new entries, and the open entry's actions. It doesn't search body text (P2).** Both are the common conventions, and neither moves. Rejected: moving Link to another key, and giving the palette another key (⌘/). Body search would mean reading every body on first open in GitHub mode and the cloud.

### 2026-10-21: The studio's tab title is always the screen, then the site

**The `/admin` page's own title becomes "Studio · {siteName}", the same pattern every screen already sets ("Content · {siteName}"), instead of "{siteName} · Vesper" (call N1).** On vespercms.com the old title read "Vesper · Vesper". Vesper's name was in the tab only until the first screen opened anyway, and the favicon is Vesper's mark. One pattern everywhere is also one less thing for white-label to replace. Rejected: dropping the suffix only when the site is called Vesper, and changing vespercms.com's `siteName`, which would work around the studio instead of fixing it. Built 2026-10-21.

### 2026-10-25: Studio layout and fields are built between phases

**After editing vespercms.com, Jeremy found the studio stark, with a lot of clicking back and forth between a list and its entries, and long forms with lists hard to scan. On 2026-10-25 he took every recommendation in PLAN.md's "Studio layout and fields (design)": sections and list rows in the form, the entry list beside the editor on wide screens, Appearance and pictures in the user menu, and list attributes for Markdoc tags. They're built between phases, in that section's order, as the dogfooding additions are.** The entries below record each call. Two are exceptions, recorded under "Studio design": the list pane departs from spec §10.3, and GitHub's pictures narrow the rule from "The studio self-hosts Figtree". None is built yet, so CLAUDE.md's rules change only as each one lands.

### 2026-10-25: Top-level groups are sections, and list items are rows that open in place

**In the editor, a top-level object or list is a section: a hairline above it, its legend holding an `h2` in `text-heading-3`, and more space above it than between plain fields. Objects inside the form lose their frames and get an indent guide instead. The image and geo widgets keep their frames, which hold a preview or a map.**

**A list of objects or images shows each item as one row:**
- **Its name** comes from the item's content: the field a `summary` hint names, else `title`, `name`, `label`, `heading` or `text`.
- **A muted detail** follows the name.
- **A "…" menu** holds Move up, Move down, Duplicate and Remove. Alt+↑/↓ on the row also moves the item.

**Rows open in place, as the kit's `Disclosure` (call F1). They're closed when an entry opens, except a new item and any item holding a field that a refused save or Go to field leads to. Closed items stay mounted, `hidden="until-found"`, so the browser's find still reaches them. No drag handles yet (F3).**

Why: on vespercms.com's home page the form was 9,628px tall, with 66 move and remove buttons. 22 of its 30 groups were named "Item N (required)", and a group's legend looked exactly like a field's label. Spec §10.2 asks for typography and space, not boxes.

Rejected:
- Opening an item in a view of its own with a trail, as Sanity now does. The rest of the entry goes out of sight, Back means two things, and a refused save has to send people into the right view.
- A dialog or drawer per item, since nested lists then stack dialogs.
- Only restyling, with every item open, which leaves the page several screens long.
- Drag handles now. Drop targets inside open, nested lists are hard to get right, and §10.6 asks for the keyboard way first. Drag can follow with React Aria's drag and drop, as the outline has it.

### 2026-10-25: The studio marks what's optional

**Studio labels say "(optional)" on fields that aren't required, and nothing on required ones. Required controls carry `aria-required`, so screen readers still say it. List items say neither (call F2). Public forms (`<Form>`, spec §6.13) keep "(required)", where visitors expect it.** In a Zod schema a field is required unless it says otherwise, so most forms have far more required fields than optional ones. vespercms.com's home page had 65 "(required)" labels, and would have 13 "(optional)" ones. Spec §6.5.1's line for `required: true` is changed to match. Rejected: keeping "(required)", which stays on 43 labels of that page even without list items; and marking whichever is rarer per form, where a label with no mark would mean different things in different entries.

### 2026-10-25: Appearance is in the user menu, and local mode has a user menu

**The user menu gains "Appearance": System, Light and Dark, as a single-choice section. The choice sets `data-theme` on `<html>`, or removes it for System. It's kept per viewer in `localStorage` (`vesper:appearance`), and an inline script in `admin.astro` applies it before the page paints. Local mode gets a user menu too, named by git's `user.name` (else "You"), holding only Appearance (call A1). The editor's bar still doesn't carry the user menu.** The tokens already switched on `html[data-theme]`, but nothing set it. Rejected: Appearance in the Site menu in local mode only, which would move it between modes; and a separate "Appearance" menu in local mode.

### 2026-10-25: The user menu shows the person's picture, or their initials

**The user menu's button shows a picture beside the name, never alone.**
- **GitHub mode** uses `avatar_url` from the `/user` call it already makes. The request is covered under "Studio design", "GitHub mode loads the editor's picture from GitHub".
- **The cloud:** `CloudUser` gains `avatar`, an address on the API's own domain (call A3). The cloud stores the GitHub picture of people who sign in with GitHub, and an upload from the dashboard's account page for anyone. Uploads are resized, re-encoded and stripped of metadata.
- **Everyone else, and any picture that fails to load,** gets initials in `accent` on `accent-subtle`.

The cloud's contract changes first, one change at a time with History's and Phase 4.5's. Account settings stay in the dashboard, so the studio never uploads a picture.

Rejected:
- Gravatar, which would send a hash of the person's email address from `/admin` to a third party.
- Initials only in the cloud.
- An upload from the studio's own menu, which would put account settings in two places and give the studio an upload to the cloud that isn't content.

### 2026-10-25: Markdoc list and object attributes take a shape from `vesper.config.ts`

**A Markdoc attribute of type `Array` or `Object` can take a Zod `schema` hint among `vesper.config.ts`'s Markdoc hints. Its Settings dialog then renders it with the frontmatter's widgets, rows included. Without a hint it stays the raw YAML field. Markdoc's own validation stays the authority when saving (call M1). Variables and conditions stay protected chips until a site uses them (M3).**

Why: Markdoc can't describe what's inside an `Array`. MDX components' `props` (spec §6.5.2) are the precedent for giving a component a shape in `vesper.config.ts`. Jazzy's `faq` tag, a list of questions on 9 pages, is the real case. Spec §6.5.1's table and its list of hints are changed to match.

Rejected: guessing the shape from the values in the file. A new tag has nothing to guess from, and one odd item changes the form.

## Schema introspection

### 2026-10-17: Walk the Zod schema; don't build the manifest from Astro's JSON Schemas

**The manifest comes from walking the site's Zod 4 schemas directly, not from `.astro/collections/*.schema.json`.** Spec §6.2 asked us to check the JSON Schema route first. Astro 7.3's `generateJSONSchema` uses `z.toJSONSchema(…, { io: 'input' })`, and `.meta()` keys do survive it. But `image()` comes out as a plain string, and `reference()` as an anonymous union with the collection name gone (it lives only in a closure). Both have to be special-cased (spec §6.2), so the JSON Schema route can't produce a correct manifest on its own. Phase 2 may still cross-check collection names against those files.

### 2026-10-17: Site configs are read by the site's own Vite, in an isolated server, with two shims

**`@vesper/astro/node` loads `content.config.ts`, `vesper.config.ts` and `forms.config.ts` through `server.ssrLoadModule` on a throwaway Vite server.**
- It uses the site's own Vite, resolved from the site (falling back through its Astro), so it is Vite 8 on Astro 7 and Vite 7 on Astro 6.
- The server runs with no config file, no env loading, no file watching and no dependency optimization.
- Vite is needed because content configs use path aliases and extensionless imports that Node's type stripping can't handle.
- Running inside Astro was rejected, because introspection must not change how Astro loads the same file.

The two shims only add information:
- **`astro:content`** re-exports Astro's own `defineCollection`, `createReference()` and `z` (from the public `astro/content/runtime` and `astro/zod`). Runtime-only functions throw if a config calls them.
- **`astro/loaders`** wraps the real `glob()` and `file()`, so Astro's own option checks still run, and attaches their options under `Symbol.for('vesper.loader')`.

Measured on Vite 8 SSR: Vite externalizes bare `astro/*` imports before any plugin's `resolveId` runs. So the loaders shim is wired in with a `resolve.alias` to a virtual module, and that module imports Astro's real loaders by absolute path. `astro:content` reaches the plugin normally, because it isn't a package name.

Any other `astro:*` module (for example `astro:env/server`) throws a plain-language error. The manifest then reports `content-config` and lists no collections; nothing crashes.

Schema functions are called with an `image()` that returns `z.string().meta({ vesper: { kind: 'image' } })`, made with the site's own `astro/zod`. Astro's real `image()` is an unmarked string transform.

Validation never uses these shims. Studio and cloud validation run the real schema (Phase 2 and later).

A test runs `astro sync` on the playground and checks Vesper's entry IDs and file paths against `.astro/data-store.json` for every collection. Generating the playground manifest takes about a second.

### 2026-10-17: Markdoc's config and options are read as Astro reads them

**The isolated loader reads `markdoc.config.*` (Astro's four names, in its order) and merges it with @astrojs/markdoc's own exported `setupConfig`, so Astro's heading node, `extends` and the HTML tag are included. The integration's options live only in its closure, so `astro.config` is loaded too, with `@astrojs/markdoc` aliased to a wrapper that records the options it's called with (`allowHTML`, `ignoreIndentation`).** Those options decide Astro's Markdoc tokenizer (`allowComments` always; `html` and `allowIndentation` with `allowHTML`), which Vesper then parses with. Parsing with Markdoc's defaults was wrong in both directions: jazzy's `{% comment %}` text inside `<!-- -->` became four undefined tags, and the playground's inline HTML became text the editor could retype. When `astro.config` can't be loaded on its own, Astro's defaults are assumed and an info diagnostic says so. The manifest keeps only schema parts: render targets by name, variables by their keys, never their values.

### 2026-10-17: Detect `reference()` by behavior, not shape

**A schema counts as an Astro reference when it is a pipe from a string-or-object union into a transform, and a probe parse of a string returns `{ id, collection }`.** Astro 6.4's union has three options; 7.x adds a number option. Matching the exact shape would break between majors, but the probe works on both.

### 2026-10-17: Refinements keep their base kind; transforms become raw fields

**`.refine()` and `.check()` don't change a field's kind or widget. `.transform()` and `z.preprocess()` make the field `unknown`, edited as raw YAML.** The spec's "custom transforms, refinements, unions → raw YAML" was written with Zod 3 in mind, where refinements created a separate effects wrapper. In Zod 4, a refinement is a check on the same schema, so its type is still known. Validation still runs the refinement (the blog hero's "alt text or decorative" rule, for example), and the editor shows the real control. A transform changes what the file holds into something else, so editing the parsed form would write the wrong value back.

### 2026-10-17: The field model extends the spec's shape with optional keys only

**`FieldModel` keeps every key from spec §6.3.1, and adds only optional ones:**
- `nullable`, `format`, `coerce`, `defaultDynamic`;
- `inferredWidget`, `unknownReason`, `extraKeys`;
- `hidden`, `readOnly`, `placeholder`, `autocomplete`, `safeToEcho`;
- `search` (Phase 2.9): `'hide'` marks the boolean from `fields.hideFromSearch()`;
- constraint details: `patternFlags`, `step`, `integer` and inclusive bounds.

The studio needs each of them to render the right control or message. They stay optional, so the spec's shape is still a valid model.
- **Date defaults** are almost always "now", so they get `defaultDynamic` and no stored value: a value frozen at build time would be wrong.
- **Meta** is copied only for known keys, and only if it's plain JSON. Functions in `widgetOptions` are dropped with a warning, and Vesper's internal `vesper` marker key never reaches the manifest.

### 2026-10-17: Widgets are resolved when the manifest is built

**The spec §6.3 resolution order (explicit widget, custom `match`, inference, raw) runs in Node while the manifest is built. The manifest stores the resolved widget and the inferred fallback.** Custom widgets' `accepts` and `match` are functions in `vesper.config.ts`, and functions can't go into a JSON manifest. Resolving at build means the studio only looks components up by name, and falls back to `inferredWidget` if a component fails to load. A check that throws counts as a rejection with a warning; it never crashes the build.

### 2026-10-17: The manifest is deterministic and hashed by content

**The manifest has no timestamps. It keeps the configs' own order, uses POSIX paths, and carries a SHA-256 of its canonical JSON (sorted keys), excluding the generator version.** The same site must produce the same bytes on Windows and Linux, so the snapshot test is meaningful and the cloud can tell a schema change from a Vesper upgrade. The playground's manifest is committed as a snapshot (`packages/astro/test/__snapshots__/playground.manifest.json`), so schema-mapping changes show up in review as a readable diff.

## Content files

### 2026-10-17: Saves splice edits into the original text

**A save changes only the bytes of the values that changed. Whole-block re-stringifying is a flagged fallback for constructs we can't splice (anchors, aliases, tags).** Measured on 988 real YAML frontmatter blocks from seven local sites: `yaml`'s `parseDocument(…).toString({ lineWidth: 0 })` changed 73 of them (unfolded `>-` strings, re-spaced flow sequences, re-quoting). The `yaml` CST round-tripped all 988 byte-for-byte. Spec §6.5 names the Document API, but its acceptance criterion is "no unrelated diffs," and only splicing meets it.

### 2026-10-17: Values are read the way Astro 7.4 reads them, and js-yaml must agree

**The editor reads YAML with `yaml`'s `parseDocument` using Astro 7.4's exact options (`customTags: ['timestamp'], merge: true, schema: 'core'`). A block is editable structurally only when js-yaml reads the same values. Otherwise it is source-only, edited as raw text.**

- Astro changed parsers in 7.4: `@astrojs/internal-helpers` 0.13 uses `yaml`, while Astro 6.x through 7.3 (0.10, 0.11) use js-yaml. The two disagree on real files:
  - Two domsys files with multi-line single-quoted inline SVG at column 0 parse in js-yaml and fail in `yaml`.
  - `!!float 1` reads as `1` in js-yaml and `"1"` in `yaml`.
- If the editor read with one parser while the site built with the other, a save could change what visitors see in a field nobody touched. Requiring agreement makes every structural edit safe on both Astro majors.
- The real cost is small: every block in the committed corpus is editable, and its values match Astro's own `parseFrontmatter` exactly (`test/yaml-read.corpus.test.ts`).
- The design first assumed js-yaml was the reader, because the Astro 7.3 install it was checked against still used js-yaml. The parity test against the installed Astro caught the change.

### 2026-10-17: "No unrelated diff" has a precise, tested meaning

**A save has no unrelated diff when:**
1. an unchanged save returns the input bytes exactly;
2. after trimming the common prefix and suffix, the bytes that changed for an edit at path P all lie within the lines holding P's key and value;
3. a frontmatter edit leaves every body byte alone, and a body edit leaves every frontmatter byte alone.

`packages/core/test/yaml-write.corpus.test.ts` and `entry-file.corpus.test.ts` check this:
- for every editable YAML block and entry in the corpus (165 real files from four sites, plus CRLF and mixed-EOL variants) and the fixtures;
- with one type-appropriate edit per top-level field, or its first nested leaf;
- re-reading every result to the intended value.

The anchors fixture is the one allowed exception, because it takes the flagged re-render fallback.

### 2026-10-17: TOML is read-only in v1

**Files with `+++` TOML frontmatter, and `.toml` data files, are read and shown but not edited.** No formatting-preserving TOML editor exists, and re-serializing would break round-trip fidelity. None of the sites in the corpus uses TOML. Revisit if a customer site needs it.

### 2026-10-17: A file's version is its git blob SHA, in every storage mode

**`StorageAdapter` versions are git blob SHA-1s, computed with Web Crypto.** Local, GitHub and cloud modes then agree on what "this exact file" means. A cloud draft's `base_sha` (spec §8.2) is just a version, and conflict checks are a string comparison. One shared validator (`storage/validate.ts`) applies the same rules in every adapter, and the contract suite (`@vesper/core/testing`) proves each adapter follows them.

### 2026-10-17: A `file()` entry's version is its own, not the file's

**Entries of a `file()` collection share one file, so each entry's version is the git blob SHA of its canonical JSON (prefixed `entry:`), not the file's SHA.** Two people editing different authors in `authors.json` don't conflict. The save still re-reads the file, checks the entry's version, locates the entry by id and commits with the file's current SHA as the expected version, so a write can't race another one.

### 2026-10-17: Appending to a JSON array splices the item in, shaped like its neighbours

**jsonc-parser reformats the previous item when it inserts into a multi-line array, which is an unrelated diff. The writer now inserts the new item itself, on its own line at the last item's indent: one line if the last item is one line (keeping `{ "a": 1 }` or `{"a":1}` spacing), indented over several lines otherwise.** Found by the first `file()` collection create test; covered in `json/write.test.ts`.

### 2026-10-17: Local saves are best-effort atomic

**`LocalStorage.commit` checks every change first, writes new contents to temporary files and renames them into place, and restores the originals if any step fails.** Filesystems have no multi-file transactions, so a crash in the middle of a save can still leave part of it applied. Git shows exactly what happened, and local mode is a developer's own machine. It never lists or writes `node_modules`, `dist`, `.git`, `.astro` or `.vesper`.

Amended in Phase 2.5: on Windows a rename over a file fails with `EPERM` for a few milliseconds while anything else has the file open, and right after a save the dev server's watcher reads it (antivirus does the same). In repeated studio e2e runs, a few saves in a hundred failed this way. The rename is now retried on `EPERM`, `EACCES` and `EBUSY` for about a second and a quarter, as graceful-fs does, and a temporary file is removed if the save fails anyway, so none is left in the content folder.

### 2026-10-17: Line endings are pinned to LF, and fixtures are byte-exact

**`.gitattributes` sets `* text=auto eol=lf` and marks fixture folders `-text`.** Git for Windows ships `core.autocrlf=true`, which rewrites every working-tree file as CRLF. Real sites contain CRLF and mixed-EOL files (domsys has 56 files committed as CRLF), and the serializer must preserve whatever it finds. So test data has to reach the tests exactly as committed, on Windows and Linux alike.

### 2026-10-17: A tag is edited one attribute at a time; new tags use one house style

**`editMarkdocTag` and `editJsxTag` change one attribute's value bytes, remove an attribute with the whitespace before it, or insert a new one after the nearest earlier attribute in schema order. Everything else in the tag (other values, quoting, spacing, order, multi-line arrays) stays byte-identical. A value set back to its default is removed. New tags put attributes in schema order and leave out defaults and empty values.** Markdoc records no attribute positions, so a scanner finds each span, and its reading must agree with Markdoc's `parseTags` before anything is changed; MDX openings are read by micromark, which records positions. Markdoc strings are double-quoted with Markdoc's only escapes (`\"`, `\\`, `\n`, `\r`, `\t`). JSX strings are `"…"`, then `'…'`, then `{"…"}` when they hold both quotes or an `&` (JSX decodes character references in quoted attributes); other values go in braces. Brace values are read as plain JavaScript literals; anything else is code, kept and never edited. Rejected: `Markdoc.format()` on a changed tag, which normalizes the whole tag and, run on the file, the whole document (spec §6.5.1).

### 2026-10-17: Trailing whitespace belongs to the gap after a block

**A Markdoc block's range stops at its last non-whitespace character. Trailing spaces on its last line, and the blank line Markdoc counts into a list, belong to the gap after it, which a save keeps.** Rewriting a block used to drop them (the serializer trims), an unrelated diff the jazzy corpus suite found in seven files. mdast already ended blocks there.

### 2026-10-18: Lists that are edited and resized change item by item

**When a list is reordered, or edited and resized at once, the writer now compares the items both versions share by position, then pushes or deletes at the end. It used to replace the whole list.** Replacing re-renders it, and at a file's root that dropped `_order.yaml`'s comment and turned `vesper.redirects.yaml`'s one-line flow maps into block maps. A new item after one-line flow maps is written as one too (`- { from: /a, to: /b, status: 301 }`), as JSON arrays already shaped new items like their neighbours. The corpus suites pass unchanged: every changed byte still lies within the lines of the values that changed.

### 2026-10-18: A new key beside one-line flow maps is one too

**When a key is added to a block map whose last value is a one-line flow map (or flow list), the new value is written the same way.** Adding a wide crop beside `square: { x: 0.40, y: 0.10, w: 0.45, h: 0.675 }` used to write a five-line block map. It's the map counterpart of Phase 2.6's rule for list items after one-line flow maps. Beside block maps nothing changes, and the corpus suites pass unchanged.

### 2026-10-25: A list attribute written one item per line changes item by item

**When a Markdoc attribute's list was written one item per line:**
- a changed item rewrites only its own line;
- a new item is written in the same layout after the last;
- a removed item goes with its line;
- a moved item moves its line as it is.

**Any other layout is written whole, as now. The result must read back as intended, or the save is refused. `editJsxTag` does the same for array props (call M2).**

Why: `editMarkdocTag` writes a changed value with `markdocValue`, on one line. Changing one answer in Jazzy's seven-question `faq` would rewrite about 2,200 characters as a single line, against "No unrelated diff". `editJsxTag`'s `JSON.stringify` does the same. It's the attribute counterpart of "Lists that are edited and resized change item by item".

Rejected: always writing the whole value.

## URLs, hierarchy and redirects

### 2026-10-18: The redirects file lives at the site root

**`vesper.redirects.yaml` sits next to the site's `astro.config`, not at the repository root (spec §6.15.5 says "repo root").** For a normal site they're the same folder. In a monorepo or an agency repository holding several sites they aren't, and redirects belong to one site: its URLs, its build, its host's output. The integration knows the site root and has no reliable way to find the repository's. The playground already keeps the file there. Confirmed with Jeremy.

### 2026-10-18: Page trees have no default depth limit

**`maxDepth` is an optional per-collection setting in `vesper.config.ts` (`pages: { tree: true, maxDepth: 4 }`), with no default.** A built-in limit would refuse legitimate moves on sites nested deeper than we guessed: the playground is four levels deep, and university sites often go further. When a site sets it, a move or new page beyond it is refused before anything is written, with a plain message ("Pages can be at most 4 levels deep here"). Confirmed with Jeremy.

### 2026-10-18: One URL module, keys inside, Astro's URLs outside

**Every URL-aware feature goes through `@vesper/core/urls`: "View on site", the link picker, moves, redirects, breadcrumbs and the `vesper:content` helpers, in the studio, the dev server and the build alike.** Inside, a page's address is a *key*: a site path with no base, query, hash or trailing slash (`/academics/nursing`, and `/` for the home page). The redirects file stores keys. Outside, `formatUrl` writes what a browser asks for: Astro's `base` in front, and a trailing slash when `trailingSlash` is `always`, or `ignore` with `build.format: 'directory'` (Astro's defaults).
- `:path` drops a trailing `/index`, and a top-level `index` is the root. Astro's glob loader already gives `foo/index.md` the ID `foo` but keeps a top-level `index.md` as `index`, so both spellings land on the same page (spec §6.15.1, "Index IDs").
- Date tokens read a date at midnight UTC (YAML's `2026-10-17`) as that calendar day everywhere, and other times in the site's `timeZone`, else UTC, so the studio and the build can't disagree about a post's year.
- A function-form `url` runs where `vesper.config.ts` is loaded (the dev API, the build, `vesper:content`). The studio's own bundle doesn't run it, so those entries have no "View on site" there.

### 2026-10-18: Redirects point at the page's exact URL

**A redirect's target is written in the page's canonical form, `/academics/nursing/`, never the bare key.** Measured on `scripts/static-server.mjs`, the plain host: `/programs/nursing` first gets the host's own slash redirect to `/programs/nursing/`, then Astro's meta refresh. If the refresh pointed at `/academics/nursing`, the host would add a third hop. Astro passes a string destination through untouched (it adds no base), so Vesper adds the base itself.

### 2026-10-18: Cleaning the redirects file

**`cleanRedirects` runs every time the file is written and at every build:**
- an entry that isn't a redirect is kept in the file untouched but not used, with a warning, so a hand edit is never silently lost;
- a repeated `from` keeps the later entry;
- a redirect whose `from` is a real page again is dropped, with a warning: the page wins;
- a cycle is removed whole, including a redirect to itself;
- chains collapse onto their final address, and the result is temporary (302, or 307 after a 308) if any hop was, because the final address isn't permanent then;
- a target on the site that's neither a page nor a redirect is flagged, never removed: it may be a file or a route Vesper can't see.

The build cleans against every content URL and every static route in `src/pages`. Routes aren't resolved yet when Astro's config is set up, so at that point the static routes are read from the files in `src/pages` (no `[params]`, no `_` names, as Astro does). The dev API uses Astro's resolved list.

### 2026-10-18: Host rules, and when HTML redirect pages are skipped

**Astro's HTML redirect pages are the universal default (D16). Native rules are added when the host is detected (`NETLIFY`, `CF_PAGES`, `VERCEL`) or named in `redirects.native` (`apache`, `nginx`), and URLs a native rule covers get no HTML page.**
- Netlify's `_redirects` uses the forced form (`301!`), and Vesper's block goes first, since the first matching rule wins.
- Cloudflare Pages has no forced form, so each old URL gets a rule with and without the slash.
- Apache gets `RedirectMatch` (mod_alias, so no mod_rewrite), matching with or without a slash, between `# BEGIN vesper` and `# END vesper` in `dist/.htaccess`, after whatever `public/.htaccess` held.
- nginx gets `location =` blocks in `dist/_vesper/nginx-redirects.conf`.

Vercel is the exception. It reads `vercel.json` before the build runs, so rules written during the build never apply (reported in Vercel's community forum and a Vercel-hosted write-up; Vercel's own docs don't say). So the studio keeps the site's `vercel.json` in step whenever it writes the redirects file, in the same change set, replacing only the entries whose `source` is one of Vesper's old or new addresses. At build, only redirects already in `vercel.json` count as covered; the rest keep their HTML page. Confirmed by Jeremy, 2026-10-19.

`dist/_vesper/redirects.json` lists the cleaned redirects: the input for the S3 deploy template (Phase 9, spec §6.16), which sets each redirect page's website-redirect metadata.

Rejected: serving redirects in `astro dev`. Merging them into Astro's config there means watching the redirects file, and Astro restarts the dev server when a watched file changes, which would reload the studio after every move.

### 2026-10-18: A move is one change set, validated first

**Moving or renaming a page moves its whole folder (or its one file) with every file in it, in one change set: the moves, both parents' `_order.yaml`, the redirects file with a redirect for every page that moved, every file whose links changed, and `vercel.json` when the site has one.** In local mode that's one set of renames; in GitHub mode it will be one tree.

Before anything is written, a move is refused in plain words for:
- a bad address segment;
- a move into its own subtree;
- an address another page in any collection has;
- an address a static route in `src/pages` owns ("/contact/ is already a page on this site that isn't edited here (src/pages/contact.astro).");
- `/admin` or `/_vesper`;
- `maxDepth`;
- a page whose frontmatter sets its own `slug` (its ID doesn't follow its file, so moving the file wouldn't move the page).

A page with no folder that gains a child becomes `page/index.md` in the same change set, at the same URL. New pages in a tree go through the same address checks. A new or moved page goes at the end of its new parent's `_order.yaml` when the folder has one; folders without one keep sorting by title.

### 2026-10-18: Which links a move rewrites

**A move rewrites links to the old addresses in every content file on the site, entries and non-entries (partials, drafts) alike:**
- Markdown links, images and reference definitions;
- `href` and `src` in raw HTML;
- Markdoc and MDX attributes whose string value is an old page URL;
- frontmatter fields shown with the URL widget, at any depth.

Each change replaces only that address's bytes and keeps its shape: base or not, trailing slash or not, `?query` and `#hash`, angle brackets. Links relative to the page's URL (`nursing/`, `../apply/`) become root-relative when either end moves, the one form that can't be misread from the new place. References relative to the *file* keep pointing at the same files when the file moves or its target does: images, MDX `import` paths, Markdoc `{% partial file %}`, and frontmatter values starting with `./` or `../`. Links inside code are left alone, and a destination with escapes or entities is skipped (it would need decoding to compare). The confirmation counts links on other pages only. Attributes are matched by value, not by declared type: a tag attribute holding exactly an old page URL is a link in all but name.

Not built: §6.15.6's optional build check for internal links that resolve to nothing. It overlaps "weekly broken-link checks" on the do-not-build list, and moves already rewrite the links they break, so Jeremy decided on 2026-10-19 not to build it.

### 2026-10-18: `vesper:content` embeds each folder's order

**The site helpers (`getTree`, `getChildren`, `getBreadcrumbs`, `getUrl`) run the same code as the studio over Astro's entries. The virtual module embeds the URL settings, each collection's pattern and title keys, and its parsed `_order.yaml` files as JSON. It imports `vesper.config.ts` only when a collection uses a function-form `url`.**
- Embedding keeps the helpers free of `node:fs`, so they'll run unchanged where previews render on Workers (Phase 7).
- In `astro dev`, a changed `_order.yaml` invalidates the module and reloads the site's pages, with no `triggeredBy`, so the studio ignores it.
- Titles come from the collection's title-like string field, then `title` and `name`.
- Unlisted children sort with `Intl.Collator('en', { numeric: true })`, fixed so a build server and an editor's browser order alike ("Step 2" before "Step 10").
- Breadcrumbs run from the home page to the entry, both included. A folder with no section page is a crumb with `url: null`.

Parity between dev and build is tested by comparing `/site-tree.json` from both.

### 2026-10-18: Route checks come from Astro's resolved routes

**`astro:routes:resolved` (Astro 5 and later, so 6 and 7) gives each route's pattern, regex, parameters, type and origin. Static routes are the project's own pages and endpoints with no parameters; Vesper's injected `/admin` and redirect routes don't count.** In dev the check runs alongside startup rather than holding it up, and logs each message once. At build it records in the manifest, for each collection, the route that renders most of its URLs (`collections[].route`, for previews), and warns about URLs no route can produce. A flat collection kept in folders gets a hint, in dev only, to set `tree: true` (spec §6.15.2, "the editor suggests").

## Images

### 2026-10-18: Astro hands `position` to Sharp unchanged, so focal points go into `style`

**`<Img>` never passes a focal point as Astro's `position`. It writes it as an inline `object-position` style, and sends Sharp only one of Sharp's own anchor keywords.** Spec §6.6.5 asked this to be checked first. Measured with real builds on Astro 7.4.0 (Sharp 0.35.5) and on the Astro 6 fixture's 6.4.8 (Sharp 0.34.5), which behave the same:
- `position` and `fit` reach the image service untouched: in the transform at build, and as `position=` and `fit=` query parameters on `/_image` in dev. Sharp uses them only when both `width` and `height` are set, as `resize({ fit, position })`.
- Sharp accepts only its own keywords there: `top`, `right top`, `left`, `centre` and so on, plus `entropy` and `attention`. `position="62% 35%"` fails the build with "Could not transform image" (Sharp: "Expected valid position/gravity/strategy for position but received 62% 35%"), and the same image is a 500 in dev. So does CSS's own keyword order, `"top right"`.
- `layout` makes it worse: Astro then sets `fit: cover` and `position: center` by default, and every `srcset` width carries both a width and a height, so `position` reaches Sharp for every responsive image.
- On the page, `position` becomes `data-astro-image-pos`, and Astro's stylesheet has rules only for keyword pairs. `62%-35%` matches nothing, so a percentage would do nothing in CSS even if Sharp accepted it.
- An inline `style="object-position: 62% 35%"` passes through to the `<img>` and beats Astro's layered rule. It doesn't move a server crop: with `width` and `height` set, Sharp cuts the centre (or the keyword's anchor) first.
- `fit` maps to Sharp's own names (`contain` becomes `inside`, `none` is dropped). `fit="contain"` with 400×400 wrote a 400×267 file into an `<img width="400" height="400">`.
- A transform key Astro doesn't know (`crop`) reaches the service, but it isn't in the hashed properties, so two different crops of one image shared one output file. It also leaked into the page as `crop="[object Object]"`.

What follows for Phase 2.7:
- With the crop wrapper, `<Img>` sends a normalized `crop` rectangle; the wrapper adds `crop` to the hashed properties, to `/_image` URLs and their parsing, and keeps it out of the HTML attributes.
- Without the wrapper (turned off, or a host's image service), `<Img>` asks for the ratio's exact width and height, which is Astro's own server crop. With Astro's Sharp service it also picks the anchor keyword nearest the crop Vesper would have made. The focal point, relative to whatever was cut, goes into `style` as `object-position`.
- A fluid image (no ratio) gets no server crop, only the `object-position` style.

### 2026-10-18: Crops are cut by a step inside Astro's Sharp service

**`@vesper/astro/image-service` is Astro's own Sharp service plus one transform option, `crop`. It cuts the rectangle out of the upright image (`rotate()` then `extract()`), passes the result as a lossless PNG to Astro's own `transform`, and leaves everything else to it: formats, quality, `srcset`, the build's cache. Images without a crop go straight to Astro's transform, byte for byte.**
- Astro hashes only the properties a service names (above), so `propertiesToHash` is Astro's list plus `crop`. `getURL` adds `crop=x,y,w,h` to `/_image` and `parseURL` reads it back, so dev crops too. `getHTMLAttributes` drops it, or it would reach the page as `crop="[object Object]"`.
- The rectangle is measured on the image as browsers show it, which is what the studio's previews and dialog measure. An EXIF-rotated photo is turned upright before the cut (tested with the playground's orientation-6 sample).
- SVG and animated images are never cropped: Astro passes them through or animates them, and Sharp's `extract` would break an animation.
- Cutting into Astro's input rather than reimplementing its transform means a new Astro option or encoder setting keeps working. The cost is one extra decode and a PNG encode (level 0) per cropped size, at build time only.

**The integration installs it only where the site uses Astro's own Sharp service**: the one service, or either target of Astro 7.4's `{ build, runtime }`, keeping the service's `config`. A host's service (Cloudflare, Netlify, Vercel) or a site's own is left alone. The build log says the step is on and how to turn it off, and `vesper({ imageService: false })` turns it off. It's an integration option, not a `vesper.config.ts` key, because it changes Astro's own config in `astro:config:setup`, beside `image.service`, before Vesper reads `vesper.config.ts` at all.

`sharp` is an optional peer dependency of `@vesper/astro`: the step loads the copy Astro's own service loads (Astro lists it as an optional dependency), and a strict installer such as pnpm only lets a package import what it declares. Confirmed by Jeremy, 2026-10-19.

In this workspace the Astro 6 fixture's crop step loads the root's Astro 7 Sharp service, because `@vesper/astro` resolves `astro` from its own folder; a published install resolves the site's own Astro. The fixture test still proves what differs between majors: the service swap, Astro 6's hashing and build step calling `transform` with `crop`, and `<Img>` compiled by Astro 6.

### 2026-10-18: `<Img>` asks Astro for the crop, never for a percentage

**`<Img>` and `getImg()` (`@vesper/astro/components`) hand Astro's own `<Image>`, `<Picture>` and `getImage()` what each mode needs, worked out by `planImg` and `planArt` (`@vesper/astro/images`), which run in Node without Astro and are unit-tested:**
- A ratio comes from `ratio` (a name from `images.ratios`, or a number) or from a fixed `width` and `height`. Only a named ratio can have a manual crop.
- With the crop step: the ratio's exact width and height, and `crop`. Without it, on Astro's Sharp service: the same size (Astro's own server crop) and `position` set to the nearest of Sharp's anchors, which `sharpAnchor` picks from the crop Vesper would have cut. On any other service: the size alone. Which service renders the page comes from `imageConfig.service.entrypoint` in `astro:assets`, per environment on Astro 7.4.
- The focal point always goes into `style` as `object-position`, measured within whatever was actually cut, so a stylesheet that boxes the image differently still keeps the subject in frame. The site's own `style` wins.
- `srcset` widths stop at the crop's own width, as Astro stops at the original's: a 1080-pixel square is never offered as 1440w. With a `layout` and no `widths`, the widths follow Astro's own rule from its breakpoints, against the crop's width.
- Art direction is a `<picture>` built with `getImage()`: a `<source media>` per breakpoint in the order given (one per format), each with its own crop and its own `width` and `height`; then the base ratio's sources and the `<img>` in the fallback format Astro's `<Picture>` would choose.
- A ratio name the site doesn't declare fails the build, naming the ones it does.

The component ships as source (`components/Img.astro`, like the `/admin` page) for the site's own Astro to compile, and `virtual:vesper/images` gives it the site's ratios. `check:dist` can't import an `.astro` file, so its published path is covered only by the fixtures' builds.

### 2026-10-18: Ratios and stored values

**Ratios are declared once in `vesper.config.ts` (`images.ratios`, width / height) and reach the studio and `<Img>` through the manifest's `site.images`, which also lists the built-in `og` (1.91:1) unless the site redefines it.** An image field that lists a ratio the site doesn't declare gets a warning. `images.maxUploadEdge` now reaches the studio's upload hygiene; it was fixed at 3000 pixels.
- A focal point is stored with two decimals, the 1% steps the control moves in; a crop with four, a tenth of a pixel on a 1,000-pixel image. Both are one-line flow maps, as in the spec.
- A stored crop whose shape no longer matches its ratio (the image was replaced by one of another shape) is trimmed to the ratio around its own centre, never grown.
- Applying the crop dialog untouched over a ratio with no manual crop writes nothing, so the focal point's crop isn't frozen by accident. "Reset to focal point" removes the ratio's crop, and removing the last one removes `crops`.

### 2026-10-19: Replacing an image clears its geometry, not its words

**When the image field gets a different image from the picker (chosen or uploaded), it drops `focus` and `crops` and keeps `alt` and `decorative`. A note beside the alt text, or beside the decorative option when that's set, says "You replaced the image. Check that the alt text still describes it." (or "that it's still decorative"). The note goes once the editor changes either one.** Phase 3's real-world check found the problem: replacing changed only `src`, so a new picture went live with the old one's description, focal point and crops, in every mode. No rule caught it, because the alt text wasn't empty. Jeremy chose this on 2026-10-19 over clearing all three (the missing-alt check would then ask for new words) and over leaving it as built.
- A focal point and crops are positions on one picture. On another they point at nothing in particular, and a crop of the wrong shape is trimmed (above). Setting them again takes seconds.
- Alt text is words an editor wrote for this page, and a replacement is often the same subject: a better photo of the same scene. Clearing it would throw good words away. Keeping it silently is how the old description went live, so the note asks for a look.
- The note is text beside its field and part of that control's description, like the rules' notes, but it isn't a rule. No check can tell whether words still describe a picture, so the note isn't counted, never blocks a save, and stays out of the live status. It lives in the studio, not the file, so it's gone after a reload.
- A first image (nothing to clear), the same image again (not even how its path is written) and a plain `image()` field, which stores only a path, change nothing.

## Accessibility checks

### 2026-10-18: One rule set, in core, narrow on purpose

**The studio's accessibility checks (spec §6.18, layer 1) are plain functions in `@vesper/core` (`entryChecker`, `checkFields`, `checkBody`), so local, GitHub and cloud modes find exactly the same things. The spec's twelve rows became seventeen rule IDs (`A11Y_RULE_IDS`), so `a11y.blockPublishOn` names exactly what it blocks.** Each note has a plain message about this case, one sentence on why it matters, a docs slug for the explanation the docs will hold (Phase 9), and its place: a field's value path, or body offsets and a line.
- Bodies are read with the parser the site renders with (micromark with GFM, plus MDX; Markdoc with Astro's tokenizer options) into a short list of facts with offsets, and every rule runs over the facts, so the three formats share every rule. HTML inside a body (and lowercase JSX in MDX) is read with a small tag scanner: core can't have a DOM, since it runs in Workers.
- The patterns are narrow, because a note that fires on good content teaches people to ignore notes. A file-name alt is an image extension, a camera or screenshot name (`IMG_2041`, `PXL_…`), or one hyphen- or underscore-joined word holding an underscore or a digit. "Image of" counts only at the start. A fake list needs two or more lines starting like list items, so "1999. That was a year." isn't one. A new-tab link is fine when its text, `aria-label` or `title` says "new tab" or "new window".
- The image widget's own alt-text advice from Phase 2 is gone: its notes now come from these rules, beside the alt text box, in the same words as everywhere else.
- Over the playground's real content the rules find one thing, a question: the callouts guide's video doesn't say whether it has captions.

Rejected: running axe in the studio over a rendered preview. Local and GitHub modes have no rendered page of the entry (previews are Phase 7), and the content rules see what a rendered page hides, such as an alt that is a file name.

### 2026-10-18: An empty alt in the body is decorative

**`![](photo.jpg)` in a body is `alt=""`, which is HTML's mark for a decorative image, and it's exactly what the studio's image dialog writes for "Decorative image" (Phase 2). So it gets no note. `missing-alt` fires for an HTML or JSX `<img>` with no `alt` at all, and for an image field with no alt text that isn't marked decorative.** The fixture's empty Markdown alt is the decorative case, and an HTML `<img>` with no alt was added for `missing-alt`. The cost: content imported with forgotten alts written as `alt=""` (WordPress writes those) passes silently. The alternatives are a note on every empty alt (which can't be cleared for images that really are decorative) or a decorative marker in the body syntax (only Markdoc and MDX could carry one). Confirmed by Jeremy, 2026-10-19.

### 2026-10-18: Embed names and captions come from the tag's own schema

**A Markdoc tag or declared MDX component gets `tag-name-empty` when a required attribute named `title`, `alt`, `label` or `aria-label` is empty text, and `video-captions` when its schema has a `captions` attribute and the tag leaves it out or turns it off.** A missing required attribute is already a validation error; Markdoc's `required` accepts `""`, which is the case left. No new hint in vesper.config.ts: a site that names its attributes differently doesn't get these two checks, and an explicit hint can come later if one is asked for. A note's subject carries the block's summary value ("YouTube video “A campus walking tour”"), so two videos' notes can be told apart.

### 2026-10-18: Text colours are opted in, and backgrounds are declared

**`fields.color({ contrast: 'text' | 'large-text' | 'graphic' })` marks a colour for the check, and `vesper.config.ts` `a11y.backgrounds` names the colours the site draws text on. Each marked colour is checked against each background (4.5:1 for text, 3:1 otherwise), and a note names the background it fails on.** Not every colour field is text: the playground's map pin colour isn't. Reading backgrounds from the site's CSS was rejected: custom properties can be computed, themed or `light-dark()` pairs (the playground's are). With no backgrounds declared, nothing is checked, and the manifest warns once per marked field. Ratios are WCAG 2.1's, rounded down to one decimal in messages, so a failing colour never reads as passing ("2.3:1"). Confirmed by Jeremy, 2026-10-19.

### 2026-10-18: Each collection sets where its body's headings start

**`collections.<name>.headingStart` (1 to 6) is the level a body's top headings should have; 2 when absent, because a layout usually renders the title as the page's `h1`.** A heading above it is `heading-extra-top`, a second `h1` when it's 1 is too, and a heading more than one level below the previous (the title counts as `start − 1`) is `heading-skip`. A per-collection key fits sites where docs bodies hold their own `h1` and blog bodies don't. The alternatives are a site-wide `a11y.headingStart` with overrides, or a `.meta()` hint on the title field. Compact Markdown fields get no heading checks. Confirmed by Jeremy, 2026-10-19.

### 2026-10-18: Notes sit under their field; the count opens a drawer

**A field's notes sit under its help and error text as "Accessibility note: …" plus why it matters, and join its control's `aria-describedby`. The body's are listed under the body editor, each with Show. The top bar's status gains a quiet text button, "21 accessibility notes", that opens the kit's `Drawer` with every note grouped by field in form order (title, main fields, body, Details), each with "Go to field".** No tabs and no badges (spec §10.4): the only colour is a hairline warning border, and the words say what it is.
- The count sits outside the live status region, so typing doesn't announce every change in it.
- Show finds the block by parsing the current text again and taking the editor node at the same place (blocks map to nodes one to one, nested only in containers), then selects it: a caret in a text block, a node selection on a card, which the editor already announces. Notes aren't drawn inside the editor's text, where a screen reader would read them as content.
- Go to field closes the drawer and moves focus with a timeout, not an animation frame. React Aria gives focus back to the drawer's trigger in an animation frame, but only if focus fell to the page, so moving it first wins; and animation frames don't run while the window is hidden, which left focus on the page in the app's browser pane. A field inside Details opens Details first and takes focus once it's rendered.
- The drawer's title is an `h2` (React Aria's dialog sets it), so the groups are `h3`.

### 2026-10-18: The publish gate refuses a save, and Save stays focusable

**With `a11y.blockPublishOn`, a note on a listed rule refuses the save the way a body the build would fail on is refused (Phase 2.5): the error summary takes focus and links each blocking note to its field, and the count reads "3 accessibility notes, 1 blocks saving".** The spec says the gate "disables Publish, with the reason in text and a link to the field". A disabled button can't take focus, so a keyboard user couldn't reach it to learn why, and Ctrl+S would do nothing at all. The gate checks the values at the moment of saving, not the last debounced check. It runs in the studio only: the PDF rules need PDF.js, and the gate is a site's policy, not a file the build can't read. In local mode the gate refuses a save too, and then offers **Save anyway** under the summary, with the reason in words: saving there only changes the file on this computer, and the site still won't publish the entry until the notes are fixed. Jeremy chose this on 2026-10-19 over refusing outright (a developer couldn't keep work in progress) and over warning only (the gate would vanish in the one mode a developer sees it in). The studio asks its storage back end (`publishesOnSave()`), not which mode it's in, so GitHub and cloud modes never offer it. Save anyway is a secondary button beside the summary, which has focus after the refusal; once it saves, focus moves to Save, since the summary and the button are gone.

### 2026-10-18: PDFs are read with PDF.js, in the browser, on first use

**PDFs in file fields, and site PDFs linked from the body, are read with `pdfjs-dist`'s legacy build in the browser, so the check works in every mode. It loads the first time an entry has a PDF to check, its worker through a Vite `?url` import as MapLibre's is, and stays external in the studio's build. Each PDF is read once per session.** Tagged means the document marks itself tagged and its first page has a structure tree; the title comes from the info dictionary, else XMP; the language from the catalog.
- Weight: 524 KB plus a 1,321 KB worker, minified, never in the first load. The modern build (459 KB plus 1,264 KB) needs `Uint8Array.prototype.toHex`, so Chrome 140, Firefox 133 or Safari 18.2. Installed, `pdfjs-dist` is 35 MB, and npm also installs its optional `@napi-rs/canvas` (37 MB on Windows) unless optional dependencies are skipped.
- PDF.js 6 returns `getMarkInfo()` as a `Map`, though its types say an object, and an absent XMP block as `null`; both are read defensively.
- The alternative is a small reader of Vesper's own for the three facts: a few KB, but a hand-written parser of an untrusted binary format (object streams, compression, encryption), and the spec names PDF.js.
- Confirmed by Jeremy, 2026-10-19: the legacy build stays. The modern one saves about 120 KB but would shut out older Safari on locked-down college machines.

### 2026-10-18: The build checks with axe-core in jsdom

**In `astro:build:done`, every built page is loaded into jsdom with `runScripts: 'outside-only'` (the page's own scripts never run), axe-core is compiled once as a `vm.Script` and run in each page's context, and only the structure rules in `BUILD_RULES` run.** Measured on the playground's 38 built files with the same 60 rules, against axe in Chromium:

| DOM | Matches Chromium | Per page | Module load | Installed |
|---|---|---|---|---|
| jsdom 30.1 | Every page, once `document.elementFromPoint` is shimmed | about 100 ms (21 ms to parse, 14 to load axe, 66 to run) | 2.7 s | 25 MB, 30 packages |
| happy-dom 21.0 | Every page | about 60 ms | 1.1 s | 20 MB, 7 packages |
| linkedom 0.18 | Can't run axe (no `screen`, no `getComputedStyle`) | | | 1.8 MB |

Without the shim, jsdom's page-level rules (`landmark-one-main`, `page-has-heading-one`) error out into "incomplete" and miss real problems. jsdom won over happy-dom because it never runs the page's scripts while still letting axe in, it's axe's documented environment, and it's already the repo's test DOM; happy-dom needs JavaScript evaluation on to load axe, which runs the page's inline scripts too.
- The rule list is pinned by a snapshot test: a rule joins only once its result without layout is checked. Contrast, `link-in-text-block`, `target-size` and `scrollable-region-focusable` need a rendered page (layer 3).
- axe's impact maps to `error` (critical, serious) or `warning` (moderate, minor), which is what `failBuildOn` compares against.
- Astro's redirect pages fail four landmark and language rules by their template, and `/admin` fails landmark rules before its script runs; both are skipped and counted, as the e2e gate skips them.
- The check runs at every build, as the spec has it; only failing is off by default. It adds about a tenth of a second a page plus loading jsdom, and `vesper({ a11y: false })` turns it off.
- Confirmed by Jeremy, 2026-10-19: jsdom, and the check on by default.

### 2026-10-18: Built pages are traced to entries by URL

**Each built page's URL key is matched to the entry whose collection `url` pattern produces it, through `PageService.pageEntries` and `entryUrlKey`, the same code "View on site", the link picker and the redirects use.** Function-form URLs work because the build loads vesper.config.ts. Recording which entries each page reads during the build was rejected: spec §6.10 has production builds emit no mapping, and §6.11 keeps production `vesper:content` a plain re-export. The cost is that a collection with no `url` can't be traced; its pages report `entry: null`. The playground's fixtures collection got a `url` for this.

### 2026-10-18: The report lives in `.vesper/`, never in `dist/`

**The report is `.vesper/a11y-report.json` in the project root, and the integration writes `.vesper/.gitignore` (`*`) beside it, so it's never deployed and never committed by accident. If the output folder would contain `.vesper/` (an `outDir` of the project root), nothing is written and the build log says why.** It has no timestamp, so the same build writes the same bytes; a cloud upload (Phase 8.5) adds the time. `failBuildOn` throws after the report is written, so its reasons are there to read. CI checks that the report exists beside `dist/` and that nothing in `dist/` looks like one, and passes it to the e2e job as its own artifact.

## Site search

### 2026-10-19: Site search is Vesper's own UI on Pagefind's JS API

**`<Search>` is a small, framework-free script of Vesper's (`components/search/ui.ts`) on Pagefind's JS API, not Pagefind's Component UI and not the studio's React kit. Jeremy chose this on 2026-10-19 (Phase 2.9, call 1).** Spec §6.19 made Component UI conditional on an accessibility audit. The audit (Chromium through Playwright, axe-core 4.14 on WCAG 2.0–2.2 A/AA, at 1280px, 200% zoom and 320px, in light, dark, forced colours and reduced motion; details in PLAN.md, "Audit of Pagefind's Component UI") found three failures of the spec's own criteria:
- the modal never announces result counts: its live regions are appended to `<body>`, outside the `<dialog>`, and `showModal()` makes them inert (WCAG 4.1.3);
- most results are `aria-hidden` placeholders until an IntersectionObserver sees them, so the list a screen reader reaches doesn't match the count (WCAG 1.3.1);
- the filter group's name is 3.91:1 at 11px (WCAG 1.4.3).

The first two sit in Pagefind's own code, so a theme or template can't fix them. Rejected: Component UI with workarounds (the fixes reach into Pagefind's internals and could break with any release), and the ui kit's React Aria components compiled for the site (React 19 alone is 75 KB gzipped, about 600 KB uncompressed with the components, over the whole 300 KB budget on a host without compression). Findings 1 to 9 are drafted for Pagefind/pagefind and go upstream only with Jeremy's OK, after his screen reader check of findings 1 and 2.

What the script does instead: a native `<dialog>` opened with `showModal()`, whose polite live region is inside it; a labelled `type="search"` field; results as a `<ul>` of real links, ten at a time, with "Show more results" moving focus to the first new one; filters as checkboxes in a `<fieldset>` per filter; Escape closes from anywhere without clearing the field first, and focus returns to the button. Measured on the playground, a first search loads 164 KB of Pagefind, uncompressed.

### 2026-10-19: Results are a list of links, not a combobox

**The field and the results are separate: ArrowDown moves from the field to the first result, and the results are ordinary links. Jeremy chose this on 2026-10-19 (call 2).** Spec §6.19 asks both for "results as a real list of links" and, as a fallback, for "the combobox/listbox pattern", which conflict: a listbox's options can't be links. Pagefind's searchbox gives links `role="option"`, so screen readers stop treating them as links: they leave the links list and lose "open in new tab", and axe fails every one on `label-content-name-mismatch`.

### 2026-10-19: Ctrl/⌘+K opens search, and there's no "/" shortcut

**Ctrl+K (⌘K on a Mac) opens the dialog, named in the button's `aria-keyshortcuts` and its description. `<Search shortcut={false}>` turns it off. Jeremy chose this on 2026-10-19 (call 3).** Spec §6.19 names "/". WCAG 2.1.4 (A) requires a way for the visitor to turn off or remap a single-character shortcut, and a setting the site's developer controls doesn't count. A shortcut with a modifier is outside 2.1.4, so it needs no switch.

### 2026-10-19: Hide from site search is a schema field

**An entry is hidden from site search by a boolean its schema declares: `fields.hideFromSearch()` (marked with `.meta({ search: 'hide' })`), or a boolean named `noindex` at the top level or under `seo`, found by name. The manifest names it as `presentation.searchHidden`, and the studio shows the switch in Details only where the collection has pages and is searched. Jeremy chose this on 2026-10-19 (call 4).** Astro validates the value and the site's layout can reuse it for `<meta name="robots">`. Rejected: a key Vesper writes into frontmatter without a schema field (Zod strips unknown keys, so the site's code never sees it, and `.strict()` schemas fail the build), and a list of hidden entries in a file of Vesper's (a second place to keep in step when pages move).

### 2026-10-19: The index leaves out entries outside their publish window

**Until Phase 4.5 filters the build itself (D18), the indexer leaves out entries whose `publishAt` is in the future or whose `unpublishAt` has passed, with `isPublished` from `@vesper/core`. Phase 4.5's filtering will use the same function. Jeremy chose this on 2026-10-19 (call 5).** The playground's builds still produce `harvest-concert` before 31 October 2026, and search must never offer it. Because the playground's own dates go by, the integration test adds an event scheduled for 2099, and the e2e tests check only what stays true.

### 2026-10-19: What the index knows about a page

**The build hands Pagefind an annotated copy of each page; the file in `dist/` is never written.** Pagefind's Node API takes the HTML as a string (`addHTMLFile`), so the copy never touches disk.
- **Content area.** With no `data-pagefind-body` anywhere, the copy marks the first `<main>` (or `<body>`). Without it Pagefind indexes the whole `<body>` except `<nav>` and `<footer>`, and every result began with the header's text. If any page has the attribute, the site's markup rules, and the build warns with the pages Pagefind then leaves out (Jeremy's call 6: it's Pagefind's documented behaviour, and some sites use it to choose their pages).
- **Annotations** are `<meta data-pagefind-…>` tags before `</head>`: the entry's title, a date in words and as ISO for `<time datetime>`, `Section` (the collection's label) and the `search.filters` fields as filters, and the `search.sort` fields as sort keys, dates as ISO in UTC so they sort as text. A date with no time is that day everywhere; a `fields.datetime()` value shows its time in the site's time zone.
- **Thumbnails** use Vesper's own `thumbnail` key, not Pagefind's `image`, which Pagefind fills from a page's first `<img>` and gave the blog listing one post's picture. Each is the first image field's square crop, cut as `<Img>` cuts it (`cropForRatio`, `pixelRect`), 128px WebP, named by a hash of the file and the rectangle.
- **Left out:** Astro's redirect pages, `/admin`, `404`, any page with `<Search variant="inline">` (the search page itself), pages with `<meta name="robots" content="noindex">`, `search.exclude` patterns, and entries of collections with `search: false`, hidden entries and entries outside their publish window. With no page using `<Search>`, no index is built, and Vesper's own `/search` page doesn't count (2026-10-21, below).
- **Filter counts** come from Pagefind's `totalFilters` (counts for the query, ignoring the filters), so a label doesn't change under a checkbox as it's ticked, and the filters are drawn again only for a new query. Pagefind counts nothing until its filter index is loaded, so the script calls `filters()` once after `init()`.

### 2026-10-19: Pagefind needs no MIME type

**No host setting and no `.htaccess` line is needed for search.** Pagefind's files are `wasm.<lang>.pagefind`, `*.pf_meta`, `*.pf_index`, `*.pf_fragment` and `*.pf_filter`. Its script fetches each as bytes, gunzips them itself and instantiates the WebAssembly from memory, so `WebAssembly.instantiateStreaming`, the only path that needs `application/wasm`, is never taken. `scripts/static-server.mjs` serves them as `application/octet-stream`, as a host with no settings would, and the e2e tests search through it.

### 2026-10-19: The /search page, and visitors without JavaScript

**`/search` is injected with `injectRoute` unless the site has its own `src/pages/search.astro`, which wins. The injected page is plain, asks search engines not to index it, and reads `?q=`. Without JavaScript the header's button is a link to it, and its form explains "Search needs JavaScript." with a link to the home page (or `search.noJsLink`), plus the site map when `@astrojs/sitemap` makes one. `noJsFallback: 'duckduckgo'` makes the form search the site on DuckDuckGo instead, saying so. Jeremy chose these on 2026-10-19 (calls 7 and 8).** Generating a sitemap ourselves is on the do-not-build list. `opensearch.xml` needs an absolute URL, so it's written only when Astro's `site` is set, and `<SearchHead />` in the layout's `<head>` links it (`rel="search"` isn't allowed in `<body>`).

### 2026-10-21: Vesper's /search page isn't a use of `<Search>`

**Whether a site uses search is decided from its own pages. With no `<Search>` in them, the build writes no index and removes the injected `/search` page from `dist/`. A site's own `src/pages/search.astro` always counts and is never removed. Jeremy confirmed this on 2026-10-21.** The injected page renders `<Search variant="inline">`, so it passed the build's check on every site: every site was indexed, and the "no page uses `<Search>`" path could never run. A docs writer reported it on 2026-10-21 (the Astro 6 fixture has no `<Search>`, yet its build held a full index). A copy of the playground with `<Search>` taken out of its layout reproduced it: 29 pages indexed, and the injected page was the only one with the marker. The unit test's fixture had no injected page, so it missed this.
- **Found by its route, not its markup.** The integration records whether it injected `/search`, and only then does the build set aside the page whose key is `/search`. A marker in the page's HTML would also be in a site's own page copied from it, which must count and must never be removed.
- **The page goes with the index.** With no index, its search could only say "Search couldn't load." The page is Vesper's, so removing it never touches a page of the site's own.
- **Search runs before the accessibility check**, so the report never counts a page the build then removes.
- **A sitemap may still list `/search/`.** `@astrojs/sitemap` lists the pages Astro reports as built, which includes the injected page. On a site with a sitemap and no `<Search>`, that entry is now a 404 where before it was a `noindex` page. A site that minds can leave it out with the sitemap's `filter`.

Rejected: indexing every site, as the code did (it costs build time for a search no page offers, against the 2026-10-19 rule above); keeping the page with no index (a search page that can't search); and deciding from the site's source before the build (only the built HTML says whether a page renders `<Search>`, and `injectRoute` has to run before that).

### 2026-10-19: Pagefind is a dependency, and the budget counts uncompressed bytes

**`pagefind` is a regular dependency of `@vesper/astro` (call 9), and the build warns when a first search loads more than 300 KB uncompressed (call 10). Jeremy chose both on 2026-10-19.** Search is on by default (D23), so the indexer must be there; it adds a 58 MB binary for the build machine's platform, as it does for Starlight. The budget counts what a host without compression sends: the script, its worker, and the heaviest language's WebAssembly, metadata and largest index chunk. Pagefind's three bundled interfaces and its highlighter (about 420 KB) are never written to the output, since `<Search>` uses none of them.

### 2026-10-19: Vesper writes Pagefind's files itself

**The build takes the index from Pagefind as bytes (`getFiles`) and writes each file itself, synchronously, after `close()`. It never calls `writeFiles`.** In Pagefind 1.5.2 the service answers `WriteFiles` before its writes reach the disk, and the Node API's `close()` then kills the writes still queued, leaving those files empty:
- `write()` in `pagefind/src/output/mod.rs` awaits `write_all` on a `tokio::fs::File` and drops it without `flush()`. Tokio's `poll_write` returns as soon as it has handed the bytes to a blocking-pool task (`tokio/src/fs/file.rs`, 1.50.0, the version Pagefind locks), and only `flush` waits for that task. So `join_all` over the files resolves and the service answers with writes still pending.
- `close()` in `lib/index.js` calls `backend.kill()` (`lib/service.js`) and resolves at once. A queued write never runs, and the file stays as `File::create` left it: empty. Pagefind's CLI is safe, because returning from `main` drops the tokio runtime, which waits for blocking tasks.

Found when Windows CI run 39297706062 failed `search.test.ts` with an empty `pagefind-entry.json` right after `writeFiles`. Reproduced on a 15-core Mac by indexing one page in a loop: some file was still empty when `writeFiles` resolved in 25 of 500 runs idle and 13 of 500 under load (two busy loops per core). With `close()` straight after, as the build did, files stayed empty for good in 0 of 300 runs idle and 4 of 300 under load, `pagefind-entry.json` in three of them. A real build could have deployed an empty `pagefind-entry.json` or `pagefind-worker.js`, so search would fail on the live site with nothing in the build log. Through `getFiles`, 0 of 1,000 runs under load were short.

Upstream knows: Pagefind/pagefind#1271 reports the race, #1272 fixed it on `main` (2026-08-15) by flushing each file, and #1373 asks for a release. 1.5.2 (2026-04-12) is still the latest, so there's nothing new to file. `getFiles` stays after a release too: nothing is in flight when it answers, and Pagefind's own interfaces are never written, where `writeFiles` wrote them for the build to delete.

The cost is memory: the index crosses the service's pipe base64-encoded twice, and Node holds all of it at once. Measured once each on synthetic sites: at 2,000 pages (4.9 MB of index), Node's peak went from 67 MB to 117 MB, in the same 1.2 s; at 10,000 pages (21.6 MB), from 69 MB to 288 MB, and writing took 6.1 s instead of 13.6 s. If a very large site runs short, a Pagefind release with #1272 makes `writeFiles` safe again.

Rejected: waiting before `close()` until no file is empty (Starlight's workaround in #1373). #1271 also saw files cut at a 4 KiB boundary, not only empty ones, and only `getFiles` says what each file's size should be. Not calling `close()` doesn't help either: the service exits on stdin EOF with `process::exit(0)`, which drops the same writes, and a read straight after the answer still races them. `search-write.test.ts` stands in a fake Pagefind with 1.5.2's timing (empty files, bytes after the answer, dropped on `close()`); the old code fails it with CI's `Unexpected end of JSON input`.

### 2026-10-19: Search's words are English, with the site's own for other languages

**`<Search>` ships English words and takes others from `vesper({ search: { strings: { fr: { … } } } })`, keyed by the page's `<html lang>` and filled in one by one.** The design proposed seeding them from Pagefind's MIT-licensed translations where the messages match. That isn't done: Pagefind's translations live inside its bundled interfaces, which aren't shipped, and its messages differ from Vesper's. It's a follow-up if a site asks.

## The cloud

Phase 4's design is in PLAN.md. Jeremy took every recommendation on 2026-10-20 (calls 1 to 9, and the smaller defaults). The facts behind the calls were checked that day, with the sources below.

### 2026-10-20: The split: the studio's half here, the cloud's in a private repository

**Anything that ships in `/admin` or runs on a customer's site is MIT and lives in this repository. Anything that holds a secret, stores customer data or runs at the cloud's domain lives in a private `vesper-cloud` repository (§13.3).** The studio speaks the cloud's API, so that API's types and its contract suite (`runCloudContract`) live here in `@vesper/core`, and the studio is built and tested against a fake cloud (`scripts/cloud-fake.mjs`), never against the private code. Grant evaluation lives in core too, as §7.5 asks: the API and the studio use the same function.

### 2026-10-20: The cloud's repository builds on this one as a submodule

**`vesper-cloud` holds this repository as a git submodule and lists its `packages/*` in its own npm workspaces, pinned to one commit (call 1).** Through Phase 4 the studio and the cloud change together, and a submodule needs no release in between. Rejected: prereleases on npm (every studio change would need a release first, and the `@vesper` org isn't claimed yet) and GitHub Packages (the same release step, plus a registry). Until this repository goes public, the cloud's CI reads it with a read-only token.

### 2026-10-20: The studio stays signed in with tokens bound to a key (DPoP)

**The studio makes a non-extractable key pair, keeps it in IndexedDB, and binds every token to it. A 10-minute access token is renewed in the background with a rotating refresh token, bound to the same key, which lapses after 12 hours unused or 7 days at most. Only then does the studio redirect to sign in again (call 2; spec §7.2 changed).** The spec's first version redirected whenever the 10-minute token expired and on every reload, which would send an editor away and back every 10 minutes while working. A copied token is useless without the key, which can't leave the browser. A script on the site's own pages could still use the key while `/admin` is open, so tokens stay short, and the API checks membership and grants again on every write. Rejected: a 1-hour token in `sessionStorage` (a copied token works anywhere for an hour).

### 2026-10-21: A sign-in in progress can finish in any tab

**The studio keeps a cloud sign-in's state, PKCE verifier and route in `localStorage` under that state, for 30 minutes, and takes them out as the callback reads them. Any tab on the site can then finish the sign-in, and a callback whose state no tab began is still refused.** Signing in by email link comes back in the tab the mail client opens, which has its own `sessionStorage`. Kept there, the first real sign-in on vesper-github-test.pages.dev was refused as one that "didn't start here". A script that can read `localStorage` on the site can read `sessionStorage` too, so the verifier is no more exposed; it now waits at most half an hour, which covers a 15-minute sign-in link. GitHub mode keeps its pending sign-in in `sessionStorage`, because GitHub's sign-in never leaves the tab.

### 2026-10-21: Review emails open Changes, and an open studio checks for new drafts and reviews

**`#/changes` is Home with the Changes drawer open; closing it goes back to `#/`. The cloud's review emails ("Review the changes") and changes-requested emails ("See your changes") link there, and a sign-in started there comes back there. A studio connected to the cloud asks for drafts and reviews again whenever its tab comes back into view, and once a minute while it's in view, one check at a time.** In the first real review, the email opened the studio's Home with nothing pointing at the review, and the approver's studio, open since before the request, showed no sign of it until reloaded: it asked once on opening, then only after the approver's own actions. A check is three small requests, and the cloud caches the tree by commit. Rejected: a separate review screen (Changes already lists reviews for approvers; DECISIONS.md, "Drafts, reviews and Publish live behind a Changes button") and pushing updates over a socket (a Durable Object could, but a minute's delay is fine for reviews). Outside the cloud, `#/changes` is Home: GitHub and local mode have no drafts or reviews.

### 2026-10-20: Grants are set in the dashboard, not in `vesper.config.ts`

**A site admin gives each member a role and, optionally, grants (a collection, an entry glob, and whether publishing needs approval), picked in the dashboard from the site's manifest. The unused `roles` key leaves `vesper.config.ts` (call 3; spec §6.4 and §7.5 changed).** A college's web office changes who can edit what without a developer or a deploy, and the API holds the grants it enforces instead of trusting a deployed file. Rejected: named roles in the config (every change waits for a deploy) and both (two places to look when someone can't edit).

### 2026-10-20: Drafts, reviews and Publish live behind a Changes button

**In cloud mode the top bar gains a Changes button with its count in words ("3 changes"). It opens a drawer listing your drafts, each with a checkbox, and "Publish 3 changes", and for approvers what's waiting for their review. Home's "drafts waiting" line links to it (call 4).** It's one quiet control with no new level of navigation, and the drawer is the pattern Details and the accessibility notes already use. Rejected: a Changes screen in the sidebar, a navigation item that isn't content.

### 2026-10-20: A draft is the file the save would write

**A cloud draft is the bytes a local save would have written, made by the same services, splices and checks, kept with the git version it was based on. Publishing commits those bytes.** Spec §8.2's sketch stored parsed data and a body; the file's own text keeps round-trip fidelity (§6.5) in one place, and publishing is exactly what local mode would have written. Uploads from a field wait in R2 under the site's prefix and go out in the publish's commit, as `ChangeSet.defer` does in GitHub mode.

### 2026-10-20: The app's bot is the author, and its commits are Verified

**Cloud publishes are committed with an installation token and no author, committer or signature of their own, so GitHub signs them and shows them as Verified, and they pass a rule requiring signed commits. The editor is named in `Co-authored-by` (with a no-reply address at the domain, never their email) and `Vesper-Editor` trailers (§7.3).** GitHub signs a bot's commit only when the request "contains no custom author information, custom committer information, and no custom signature information" (docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#signature-verification-for-bots). A public repository's history is public forever, so an editor's email never goes into it.

Hosts that check authors: Netlify holds a private repository's deploys from authors it doesn't recognize, except GitHub Marketplace bots, auto-approve or a build hook (docs.netlify.com/deploy/deploy-overview/#deploy-permissions). Vercel deploys a private repository's commit only when its author has access to the project, and its docs don't mention app bots (vercel.com/docs/git#deploying-private-git-repositories). Cloud editors have no GitHub accounts, so no author of theirs would pass either rule. The deployment notes cover both hosts, and a Marketplace listing is for launch.

### 2026-10-20: A branch rule that refuses a push is said plainly

**If a branch rule refuses a cloud publish, the studio says so plainly, as GitHub mode does. The dashboard reads the branch's rules when the repository is connected and warns then. Opening a pull request instead waits for pull-request mode in Phase 9 (call 5; spec §7.3 changed).** Rulesets come from `GET /repos/{owner}/{repo}/rules/branches/{branch}` (Metadata read) and classic protection from `GET /repos/{owner}/{repo}/branches/{branch}` (Contents read); a refused push is a 422 whose message isn't documented, so it isn't parsed (docs.github.com/en/rest/repos/rules; docs.github.com/en/rest/branches/branches). A pull-request fallback would add a third state, published but not merged, across the studio, deploy status and drafts.

### 2026-10-20: Connecting a repository confirms who installed the app

**After the app is installed, the person connecting signs in to GitHub once, and the cloud keeps the installation only if `GET /user/installations` lists it for them.** GitHub warns that the `installation_id` returned to the app's setup page can be spoofed, and recommends exactly this check (docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url). The app has "Request user authorization during installation" on, and the install link carries a `state` back (docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app). Only the person connecting needs a GitHub account; editors never do.

### 2026-10-20: A Vesper organization owns the public GitHub App

**A new GitHub organization for Vesper owns the app, which is public and asks for Contents read and write plus Metadata, Commit statuses, Checks and Deployments read-only, with webhooks for installation changes only (call 8).** The app moves with the product rather than with ThoseGeeks or a personal account, and an organization can have several owners. Deploy status reads statuses, check runs and deployments, which hosts use in different mixes (docs.github.com/en/rest/authentication/permissions-required-for-github-apps).

### 2026-10-21: The app is VesperCMS, with no webhooks yet

**The organization and the app are both VesperCMS (`vespercms`, ID 5410635), created by Jeremy on 2026-10-21 with the permissions above, installable on any account, and with webhooks off.** "Vesper" alone is a GitHub user's name, and an app can't take another account's name. Nothing in the cloud receives webhooks yet, so an uninstall goes unnoticed until a publish fails; they come on with an endpoint for them (vesper-cloud PLAN.md). GitHub sends every install back to the app's first callback URL, production's, so staging can't connect a repository with this app.

### 2026-10-21: A site needs only its project ID

**The build's cloud addresses default to `https://app.vespercms.com` and `https://api.vespercms.com`. Staging and tests set both, through `vesper({ cloud: { app, api } })` or `VESPER_CLOUD_APP` and `VESPER_CLOUD_API`; a build that sets only one warns and leaves the cloud off.** One address with the other defaulted would send sign-in to one cloud and saves to another, and the studio would fail at its first request instead of at build.

### 2026-10-20: No sign-up before billing

**In Phase 4 an operator script creates each account, and everyone else joins by invite (call 6).** There's no billing until Phase 5, and the first sites are ThoseGeeks' own. Open sign-up with the 30-day trial (§13.4) comes with billing.

### 2026-10-20: Email Service, with Resend for sign-in links

**Cloudflare Email Service sends the cloud's email, and Resend sends sign-in links as well, as a fallback (call 7, as §7.8 says).** Email Service is still in beta (public since 2026-04-16), needs Workers Paid and the sending domain on Cloudflare's DNS, includes 3,000 emails a month then $0.35 per 1,000, and gives new accounts an unpublished daily quota that grows with reputation (developers.cloudflare.com/email-service/; /platform/pricing/; /platform/limits/). A sign-in link that never arrives locks a client out.

### 2026-10-20: The free relay waits for launch

**The cloud's free relay for GitHub mode (decided 2026-10-19) waits for launch preparation in Phase 9 (call 9).** An open relay would let any website ask for tokens to repositories where Vesper's app is installed, so it needs a list of registered sites, which means deciding whether a free dashboard account exists. That's a tier decision for launch; GitHub mode works today with the template.

### 2026-10-20: Microsoft sign-in checks the tenant, and Vesper gets verified before colleges

**Microsoft sign-in accepts any organization and personal accounts, and checks each token's issuer against its own tenant (`tid`). Vesper's app gets publisher verification before a college is onboarded.** Verification isn't required for sign-in alone, but a tenant that lets people consent only to verified publishers blocks an unverified app (learn.microsoft.com/en-us/entra/identity-platform/access-tokens#validate-the-issuer; /publisher-verification-overview; learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent).

### 2026-10-20: A draft passes the same checks as a save, and a new entry waits for its first save

**A cloud draft is saved only when it passes everything a local save checks: the site's schemas, the body's build checks. Until then the editor's status says "Not saved yet: some fields need attention", and the work stays on this device. A new entry isn't autosaved: its first draft is saved by hand ("Save draft", Ctrl+S, or Publish), and after that it saves itself a moment after typing stops.** A draft is then always a file the site could build, so publishing never has to check again in a place the schemas can't run (the cloud can't run the site's Zod schemas). A new entry's file name comes from its title at the first save, and a half-typed title would make a poor one. The publish gate (§6.18) applies to Publish, never to a draft.

### 2026-10-20: Unsaved changes are kept on this device until the cloud has them

**In the cloud, the editor writes its unsaved changes to IndexedDB as they're typed, puts them back when the entry opens again, and clears them once a draft is saved. While the cloud can't be reached, saving tries again, waiting longer each time (5 seconds, doubling, up to a minute).** Spec §6.9: with the cloud unreachable, nothing is lost. Nothing is written or cleared until the kept copy has been looked for: an entry opens clean, and clearing it then deleted what was about to be restored (the browser tests found it).

### 2026-10-20: Token renewals run one tab at a time

**The studio renews its tokens inside a Web Lock named for the project, and first adopts tokens another tab already stored.** Refresh tokens rotate, and a used one coming back ends the whole sign-in, which is what makes a stolen one useless. Two tabs renewing at once would sign each other out.

### 2026-10-20: What a grant shows in the studio

**The studio hides what a member can't change (spec §7.5): their menus and home screen list the collections they edit, lists show the entries their grants cover, and Redirects appear only with the whole site. A folder grant's page tree shows its branches and the pages above them, which open but don't change. Viewers see everything, read-only.** Reordering a page needs its parent's folder too, since the order file lives there. A page move by someone with a folder grant is refused, because a move rewrites the site's redirects file, which needs the whole site (Jeremy kept this on 2026-10-21, below).

### 2026-10-20: The studio is tested against a fake cloud that keeps the contract

**`scripts/cloud-fake.mjs` answers the studio as the cloud does, publishing through `GitHubStorage` to the fake GitHub over real git, and passes `runCloudContract` from `@vesper/core/cloud-testing`, which the real cloud runs too.** The studio's unit tests (jsdom) and the `cloud` e2e project (Chromium, a built site on the plain static server, ports 4406 and 4407) never touch the private repository. The browser tests found two bugs the jsdom tests didn't: the kept copy cleared before its restore, and a review's confirmation vanishing with it.

### 2026-10-21: Page moves stay with whole-site editors

**Jeremy chose on 2026-10-21 to keep refusing a page move by someone whose grant is a folder.** A move writes a redirect for every page that moved into `vesper.redirects.yaml`, a file of the whole site. Rejected: the API checking each redirect a move adds against the grant. That needs every page's URL on the server, and a function-form `url` from `vesper.config.ts` can't run there. Revisit if an agency's folder editors need to move their own pages.

### 2026-10-21: A publish credits every draft's author

**Jeremy chose on 2026-10-21: when one publish carries several people's drafts, its commit names each of them in its own `Co-authored-by` trailer, not only the person who published.** GitHub shows every co-author on the commit, and history then says who wrote what.

**Built here the same day. A draft keeps `authors`: everyone who saved it, each once by ID, in the order they first did, and a save that joins drafts keeps all of theirs. Core's `publishChangeSet` takes the publisher and the no-reply domain and writes the credit itself: the publisher first, then each draft's authors in the order the drafts are published, each person once, with their IDs in `Vesper-Editor` in the same order. A trailer's value can be a list (`CommitTrailers`), written one line per value.**
- The publisher comes first, so a publish by the one person who wrote it is byte for byte what it was, and the first `Vesper-Editor` always says who published, which history can use.
- The credit is built in core, so the fake and the real cloud can't drift, and a draft's own `Vesper-Editor` or `Co-authored-by` trailers are dropped: only the cloud names people. A name goes on one line, without a `<` or `>` that could end its address early, and the address is the member's ID at the no-reply domain, never an email.
- Trailers merge by name, each value once, so a publish across collections names each `Vesper-Collection`; before, the last draft's won. A name with one value stays a string, as the studio sends it and as drafts already stored hold it.
- Rejected: crediting each draft's `updatedBy`. Drafts belong to the site, so a second editor's small fix would have erased the first author.
- The cloud's half went to production on 2026-10-22 (vesper-cloud b900e99, its DECISIONS.md). Drafts saved before it load with whoever saved them last as their only author: the cloud didn't keep more.

`runCloudContract` checks it: each draft lists its authors, and a publish of several people's drafts names each once, in that order, at an address made from their ID, never their email. The cloud's half (its submodule, storing `authors`, passing the publisher) is in PLAN.md, "Phase 4: progress".

## Scheduling

Phase 4.5's design is in PLAN.md. Jeremy took every recommendation on 2026-10-21: calls 1 to 11, and the smaller defaults. None of it is built yet; building waits for Phase 4. The platform facts the design marks "to check" are checked at the start of the phase and added here with their sources.

### 2026-10-21: Scheduled collections are filtered in `vesper:content`, by one instant per build

**In builds, `vesper:content` will wrap `getCollection`, `getEntry` and `getEntries` for scheduled collections only, leaving out entries outside their window (`isPublished`). Every check in one build uses one instant, read at `astro:config:setup`, which `VESPER_BUILD_TIME` sets.** This is D18. The site helpers read through `getCollection`, so they follow. Other collections and `render` stay untouched, and nothing is recorded at build. CLAUDE.md's "Production `vesper:content` stays a plain re-export" changes to this when it's built.
- **One instant** means one build can't disagree with itself. A page built a second after the time can't show an entry that another page of the same build left out.
- **Sites that read `astro:content` directly** aren't filtered. The build warns about them through the URL tracing the accessibility check already uses.
- **In dev,** scheduled entries stay in, so editors can work on them.

Rejected: removing entries in the content loader. That would reach `astro:content` as well, but it means wrapping the site's own loaders, and dev must keep the entries.

### 2026-10-21: An unpublish redirect comes from the entry's own field

**Once an entry is past its `unpublishAt`, the build adds a temporary (302) redirect from its URL to its `unpublishRedirect` field. It goes through the same cleaning and host rules as `vesper.redirects.yaml`, and nothing is written into that file (call 1; spec §6.17 changed).**
- One place holds it, and an entry that comes back has nothing to undo.
- It's temporary because an event can come back, and a browser would keep a 301.
- Vercel reads `vercel.json` before the build, so there it's Astro's HTML redirect page.

Rejected: writing it into the redirects file at publish, with the time it starts (§6.17's first version). The file would hold redirects that aren't active yet. Its "the page wins" cleanup would have to skip them while the page is live. And `vercel.json` can't hold a redirect that starts later.

### 2026-10-21: A free site rebuilds on a schedule only when something is due

**Every build writes `dist/_vesper/schedule.json` with the next time the site changes, never what changes. The workflows' scheduled run fetches it from the live site and rebuilds only once that time has passed, or when the file can't be read. `rebuildEvery` (minutes) in `vesper.config.ts` tells the studio how often the run comes, so its line can say "This site rebuilds every hour" (calls 2 and 5; spec §6.17 changed).**
- An hourly rebuild regardless is about 720 builds a month: free plans' build counts and Actions minutes, spent mostly on builds that change nothing.
- The cloud reads the same file's `builtAt` to tell when a scheduled change is live, on any host.

Rejected:
- rebuilding on every run (§6.17's example);
- checking the repository's files in the workflow, which installs the site on every run;
- no `rebuildEvery`, where the studio could only say "the next time the site is built".

### 2026-10-21: `vesper deploy init` writes SFTP, FTP and build-hook workflows

**Phase 4.5 builds `vesper deploy init --target sftp|ftp|hook` (call 3; spec §6.16 changed). Each target writes one GitHub Actions workflow into the site's repository:**
- **`sftp` and `ftp`** build on push and upload. Their upload is `lftp` on the runner, mirroring `dist/` with deletions and uploading the whole site each time (call 4).
- **`hook`** is for git-connected hosts. They build on push already, so it only calls the host's build hook on the scheduled run.

**Every workflow listens for `repository_dispatch` (type `vesper-rebuild`), the cloud's trigger.** `s3` and `github-pages` stay with Phase 9.

Vesper never deploys a site itself. The workflows are plain YAML that run in the site owner's GitHub account with their own secrets, and they can read and change them. Jeremy asked about this, then chose the templates.
- **Deletions** are what make an expired page 404 on a host that keeps old files.
- **"Only changed files"** (§6.16) can follow with a state file if whole uploads prove slow.

Rejected:
- an upload command of Vesper's own, with a file of hashes kept on the server (two client dependencies in `@vesper/astro`);
- a third-party Action, which is someone else's code holding the host's password.

### 2026-10-21: The cloud learns the times from the files and fires at them with an alarm

**The cloud reads upcoming times from the site's files with core's `scheduledEvents`, after every publish through the cloud and on GitHub's push webhook, which VesperCMS turns on for this. Each site's Durable Object keeps one alarm, set for the earliest time. When it fires, the cloud calls the site's deploy hook or sends `repository_dispatch` (call 6).** A time set in local mode, or in a developer's commit, gets its exact rebuild too. This supersedes "The app is VesperCMS, with no webhooks yet" for push events.

Cloudflare's docs, checked on 2026-10-21 (developers.cloudflare.com/durable-objects/api/alarms/):
- an object has one alarm at a time, and `setAlarm()` replaces it;
- alarms have "guaranteed at-least-once execution";
- a handler that throws is retried up to 6 times, with exponential backoff from 2 seconds.

How close to the set time an alarm fires isn't documented, so the real-world check measures it against §11's 2 minutes. Firing more than once is harmless: a rebuild is triggered once per instant, and a held draft is published once.

Rejected:
- only what the studio schedules through the cloud: a developer's scheduled commit would wait for the next build;
- an hourly sweep instead of the webhook: it can miss a time set less than an hour after the commit.

### 2026-10-21: Scheduled drafts are held only when a site admin asks

**`holdScheduledDrafts` is off unless a site admin turns it on in the dashboard. In a public repository, the Schedule dialog says the content can be read there before it goes live, and connected to the cloud it adds that drafts can be held (call 7).** Committing at once is what makes D18 safe when the cloud is down at the time. Holding trades that for privacy, which the site admin chooses. Rejected: holding by default in public repositories, where a post would go out late whenever the cloud was down at its time.

### 2026-10-21: Only an entry that isn't live yet gets a publish time

**For an entry that's already live, Schedule… sets only when it comes down (call 8).** Under D18 a page's file holds one version, so a future version can't sit beside the live one in git. A future publish time on a live page would take the page down until then. Scheduled changes to live pages could come later as a paid feature: the cloud would hold any scheduled draft, not only in public repositories.

### 2026-10-21: Cancelling a scheduled publish makes the entry a draft again, in the cloud

**In the cloud, cancelling a scheduled publish takes the entry's file out of the site in one publish and keeps its content as a draft. A held draft simply stops waiting. Local and GitHub mode have no drafts, so they offer Reschedule only, and the entry's own Delete stays where it is. Cancelling an unpublish removes its time and redirect in every mode (call 9).** A scheduled entry is already in the site's files, so "cancel" has to mean something about the file.

Rejected:
- deleting it in every mode;
- setting the collection's `draft` field, which works only on sites whose pages leave drafts out.

### 2026-10-21: Where scheduling lives in the studio

**Jeremy chose these on 2026-10-21 (calls 10 and 11, and the design's interface):**
- **Publish ▾.** In a scheduled collection, the editor's primary button is a split button, with Schedule… in its menu. It's still one primary button (§6.17). Its menu half is a chevron named "More ways to publish": an icon-only button, now on CLAUDE.md's list of exceptions to §10.4.
- **The schedule in Details** is text, with "Change schedule…" opening the Schedule dialog, in place of two raw date fields.
- **Status is words from core,** the same in the editor, the list and the toolbar: "Scheduled · Sat, Oct 31, 8:00 AM". The zone's short name is added only in the hour a DST change repeats.
- **The Scheduled view** is a screen at `#/scheduled`, reached from a line on Home and from each list's Scheduled filter. It's no navigation item, as was decided for Changes; it works in every mode, and the cloud's state shows only when connected.
- **The "Scheduled" marker in dev** has two parts:
  - Vesper's toolbar app shows each entry's status words, with the toolbar's dot;
  - the dev middleware adds a small fixed note on a scheduled entry's own page, so it's seen with the toolbar hidden.

Rejected:
- a sidebar item for the view, which isn't content;
- the view inside the Changes drawer, which is cloud only, while scheduling is free;
- the marker in the toolbar alone.

## GitHub mode

### 2026-10-19: GitHub mode runs core's services in the browser

**In GitHub mode the studio runs the same `ContentService`, `PageService` and `MediaService` that local mode's dev API runs in Node, over `GitHubStorage` (`@vesper/core`) in the browser (`packages/admin/src/github/api.ts`). Every screen, check and splice is the same code; only storage differs.** The dev API was already a thin shell over those services, and the storage interface was built for this from Phase 1: a file's version is its git blob SHA in every mode, a change set is applied whole or not at all, and a stale expected version is a conflict. The five inputs that lived only in Node reach the browser instead:
- the Zod schemas, as a separate bundle (below);
- the Markdoc config, as the manifest's (custom validators are the build's to check, 2026-10-19);
- MDX props and function-form URLs, from `vesper.config.ts`, which the studio already loads;
- the static routes, written into the studio at build.

`GitHubStorage` needs only `fetch`, so Phase 4's cloud can run it in a Worker with an installation token.

What GitHub's documentation and changelog said on 2026-10-19 (checked then; see the design in PLAN.md):
- `api.github.com` answers CORS from any origin (docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests);
- `github.com/login/oauth/access_token` doesn't, and needs `client_secret` even with PKCE (github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication; docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps);
- a GitHub App's user token reaches only repositories where the app is installed, intersected with the user's access, and lasts 8 hours (docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user);
- a ref update with `force: false` must be a fast-forward (docs.github.com/en/rest/git/refs).

### 2026-10-19: A GitHub App each site owner makes, through a relay that stores nothing

**Editors sign in through a GitHub App the site owner (or an agency, once) creates and installs on the repository, with Contents read and write and nothing else. The token exchange goes through `templates/oauth-relay`, a dependency-free Worker the owner deploys. Jeremy chose both on 2026-10-19 (calls 1 and 2).**
- **Why an app, not an OAuth App:** an OAuth App can't be narrowed to one repository; `repo` reaches every private repository the editor can, and new organizations block OAuth Apps until an owner approves them. Vesper's shared app, through the cloud's free relay, waits for the domain.
- **The flow** is a top-level redirect, as D14's cloud sign-in is: no popup and no third-party cookie.
  1. The studio keeps a random state and a PKCE verifier in `sessionStorage` and goes to the relay's `/authorize`.
  2. The relay checks the site's origin against `ALLOWED_ORIGINS` and sends the browser to GitHub with its callback.
  3. GitHub returns to the relay, which checks the site again and sends the code on to `/admin/?github=…&state=…`.
  4. The studio posts the code and verifier to `/token`, the only step that adds the secret.
- **Why it's safe without storage:** the verifier never leaves the tab, so a code seen in an address is useless to anyone else, and the relay needs no storage, signing key or session. It drops any refresh token GitHub sends.
- **Rejected:** the popup and `postMessage` hand-off Decap and Sveltia use (a second window, and a message channel to secure); a relay that keeps tokens; the device flow (it also needs a relay, and shows editors a code to type).

### 2026-10-19: GitHub mode keeps its token in sessionStorage

**Only the 8-hour access token is kept, in `sessionStorage`. It's gone when the tab closes, and signing in again is one redirect, since GitHub remembers the approval. Jeremy chose this on 2026-10-19 (call 4).** `/admin` shares its origin with the public site and whatever scripts it loads, so a long-lived refresh token in `localStorage` would sit where any of them could read it. Memory only was rejected because a reload would sign the editor out and break deep links. A token within five minutes of expiring counts as expired. When GitHub says it has expired, the editor's unsaved changes are kept in `sessionStorage` across the sign-in and put back, and the top bar's user menu becomes "Sign in again".

### 2026-10-19: GitHub mode validates with the real schemas

**At `astro build` with GitHub mode on, `content.config.ts` is built a second time, for the browser, into `_vesper/schemas.js`. Shims for `astro:content` and `astro/loaders` carry no Astro runtime, and `reference()` is Astro's own union without the lookup. The studio loads the file on first save, so saves are checked with the site's own Zod schemas, as spec §6.3.1 asks. Jeremy chose this on 2026-10-19 (call 3).**
- **When it can't be built:** a config that imports Node or another `astro:*` module fails that build alone. The site's own build is never affected, the log says why, and the studio falls back to `fieldModelIssues`.
- **The fallback** checks required values, choices, numbers and patterns from the manifest, never refusing what the schema accepts. The site's build is then the last check.
- **Measured** on the playground: 93 KB minified, and it catches the image field's own "Describe this image, or mark it decorative.", which the field model alone misses. The URL carries the manifest's hash, so a new build is fetched anew.
- **The schemas' code ships with `/admin`,** as `vesper.config.ts` already does; their shapes were already public in `_vesper/manifest.json`.

### 2026-10-19: Saves are one commit through the Git Data API, retried once over others' pushes

**`GitHubStorage.commit` makes one commit on the branch (spec §6.8): new bytes up as blobs, a tree on the head's tree, the commit, then the ref moved with `force: false`. If the ref won't fast-forward because someone else pushed, it reads the new head, and if none of its files changed there, builds the same changes on it once more; if they did, it's a conflict, reported as in local mode. Jeremy chose the Git Data API for every save on 2026-10-19 (call 8).** One path for text and a 20 MB upload alike. `createCommitOnBranch` would give Verified commits and a true compare-and-swap, but GraphQL requests stop at about 16 MB of base64, and two paths would need two sets of tests. A branch rule that refuses the push (pull requests or signed commits required) is said plainly; pull-request mode is Phase 9.
- **Reading.** The branch is read as one snapshot: the commit and its recursive tree, reused for 10 seconds and refreshed before every commit.
- **The cache.** Bytes are fetched by blob SHA and kept in IndexedDB, which never goes stale because a SHA always means the same bytes. Listing a folder prefetches its text files in GraphQL batches of 50, since the services read what they list one file at a time; every batch is checked against its SHA and refetched raw on a mismatch, so content stays byte-exact.
- **Truncated trees.** A tree GitHub truncates (over 100,000 entries) is read folder by folder.
- **Messages.** The editor is the commit's author. Messages are the change set's plain summary plus a `Vesper-Collection` trailer.

### 2026-10-19: An upload from a field waits for the publish

**Spec §6.8 makes an entry and its uploaded image one commit, but the studio uploads when a file is chosen. A change set can now be deferred (`ChangeSet.defer`). `GitHubStorage` holds its new files, shows them in `list` and `read` meanwhile (so previews and duplicate checks see them), and sends them with the next commit; one deleted first is simply forgotten.** The media picker, which fields and the body editor use, defers. The Media screen doesn't, since nothing else will be saved with it, and local mode writes every upload at once as before. A held file is lost if the tab closes before the publish; the unsaved-changes guard covers that, and no orphan file reaches the repository.

### 2026-10-19: Duplicate uploads are found by git blob SHA

**`MediaItem.hash` is the file's git blob SHA, which every storage mode already has, so listing Media reads no file. The studio hashes an upload the same way.** With SHA-256, listing Media in GitHub mode would have downloaded every image in the site.

### 2026-10-19: The studio asks for file URLs asynchronously

**`StudioApi.fileUrl` returns a promise. In local mode it's the dev API's `/file` URL; in GitHub mode an object URL for the blob, kept for the visit. A private repository's `src/assets` image has no address a browser can load without the token, and `raw.githubusercontent.com` refuses an `Authorization` header from a browser. `useFileUrl` and `FileImage` show a file once its URL is ready.**

### 2026-10-19: Publish, the user menu, and editors who can't push

**Jeremy chose these on 2026-10-19 (calls 5, 6 and 7):**
- **Publish.** In GitHub mode the editor's button reads Publish, because saving there commits to the default branch and the site rebuilds. After it, the status reads "Published just now" and a line says "Published. It will be live after the site is next built." (spec §6.16). Local mode keeps Save.
- **The user menu.** The signed-in editor's GitHub login is a quiet text button at the end of the top bar (`@login`), with "Sign out of GitHub" in it. It's the design system's user menu, where the cloud's account goes in Phase 4. The editor's own bar doesn't carry it.
- **Editors who can't push** see "Your GitHub account can't change this site", what to ask the owner, and Sign out of GitHub. There's no read-only studio; roles are a cloud feature (§4).

### 2026-10-19: GitHub mode is tested against a fake GitHub over real git

**`scripts/github-fake.mjs` answers the REST, GraphQL and OAuth calls GitHub mode makes, over a bare repository through the git CLI. Blob SHAs, trees, commits and fast-forward refusals are git's own. It signs any user in at once and answers CORS as GitHub does.**
- **Unit tests** run `GitHubStorage` through the shared storage contract on it, and the studio's GitHub mode in jsdom.
- **The relay's tests** sign in from end to end against it.
- **The e2e `github` project** builds a copy of the playground with `vesper({ github })` and serves the fake on 4403, the real relay on 4404 and the built site on the plain static server on 4405 (`scripts/github-site.mjs`).
- **Rejected:** recorded HTTP fixtures, which can't answer a commit with a real new SHA; and a hand-written model of git, which would only be as right as the model.

### 2026-10-19: Hosts that check commit authors

**In GitHub mode each editor is the author of their own commits. On private repositories, Vercel builds only commits by members of the team, and Netlify holds commits by unknown authors for approval (vercel.com/kb/guide/commits-not-triggering-deployments; docs.netlify.com/build/git-workflows/repo-permissions-linking).** No such rule was found for Cloudflare Pages or GitHub Actions. The relay's README and the integration's README say so. Committing as a bot would hide who changed what, so editors stay the authors.

## Studio design

### 2026-10-18: The design pass comes before 2.9, from Jeremy's own design system

**Jeremy moved the studio design pass ahead of Phase 2.9 (site search) and Phase 3 (GitHub mode), so GitHub mode and the Phase 4 dashboard build on its result instead of being restyled later. The direction is Vesper's design system, a claude.ai artifact Jeremy made (the Pine direction: warm sand neutrals, a pine-teal accent, Figtree, glass and glow). It stands in for the direction review the roadmap asked for.** It keeps the repo's fourteen colour token names and roles from `tokens.css`, so the pass changes values, not names. It's design input, not a spec: where it disagrees with the spec, the entries below record what Jeremy decided. Features it shows that the studio doesn't have (the ⌘K palette, a Preview toggle, history) aren't built in this pass; PLAN.md lists them.

### 2026-10-18: The accent is Pine, and fixed

**Every studio uses the Pine accent. The design system's eight accent presets and its hue formula may live in the token code for later, but nothing lets anyone choose one: no picker, no setting, no config key.** Choosing an accent is white-label, which spec §2 puts in the higher paid tier, and it belongs to Phase 9. Neutrals, `danger`, `focus` and `warning` don't move with the accent in any case.

### 2026-10-18: Four named glows, and glass on what floats (an exception to spec §10.2)

**Spec §10.2 allows shadows only on overlays. The studio also uses exactly four named effects, each only in its named place:**
- `glow-accent`: the primary button on hover and focus, and one pulse after a successful save, dropped under `prefers-reduced-motion`. Never at rest, never on two elements at once.
- `glow-selected`: the current item in the outline, a menu or a list, on top of `accent-subtle`.
- `glow-focus`: a halo outside the solid 2px focus ring, never in its place. The ring carries the 3:1 contrast; the halo only adds warmth.
- `glass-edge`: the lit edge of the sticky top bar, and the rim of glass overlays beside `shadow-overlay`.

**Glass (a translucent fill over a blurred backdrop) is only for surfaces that float: the top bar, menus, popovers, the Details drawer, dialogs and the modal scrim.** The fill is at least 88% of the solid surface, which keeps every text pair at 4.5:1 even over a solid `content`-coloured backdrop; the contrast check computes those pairs. Without `backdrop-filter`, under `prefers-reduced-transparency` and in forced colours, the surfaces are solid. The glows are mixed from the accent with `color-mix(in oklch, var(--color-accent) N%, transparent)`, so they follow it, and raw hex and rgba stay out of class names. `packages/admin/src/budget.test.ts` allows these tokens and no other shadow.

Why: Jeremy chose glass and glow as part of the direction. Vesper is named for the evening star, so its depth is light. Each effect is a reward or a locator, never the only way something is shown, and the text carries every meaning.

### 2026-10-18: The studio self-hosts Figtree (a departure from spec §10.5)

**The studio is set in Figtree at 400 and 600, from the `@fontsource/figtree` npm package (OFL-1.1), latin subset, compiled into `@vesper/admin`'s `dist/studio.css`. `/admin` never requests anything from Google or any CDN. Code, slugs and URLs use the system monospace stack, and the system UI stack stays the fallback.** Spec §10.5 says "the system UI stack by default". Jeremy chose Figtree for the direction's warmth. Self-hosting means no third-party request and a studio that works offline, and two weights keep to the §10.4 budget. The design system also names JetBrains Mono for code; it isn't added, because the system monospace stack does the job without another download. The first-load cost is measured in PLAN.md, "Studio design pass: outcome". (Narrowed 2026-10-25 to fonts, scripts and styles: "GitHub mode loads the editor's picture from GitHub", below.)

### 2026-10-18: Overlays are 93% glass; the check composites over black and white

**The top bar's glass is 88% of `surface`, the design system's floor. Menus, popovers, dialogs and drawers are 93% of `surface-raised`.** `npm run a11y:contrast` composites each text pair on glass the way a browser does (in gamma-encoded sRGB) over pure black and pure white, the extremes of anything that can sit beneath, and the pair must pass over both. At 88% the dark theme's error text on an overlay is 4.18:1 and an input's boundary 2.57:1 over a white backdrop; at 93% they're 4.93:1 and 3.03:1. The top bar's pairs pass at 88%. Both fills are read from `tokens.css`, so the check follows the CSS. The afterglow is checked at its brightest point: `accent-subtle` in light, 22% of the accent over `surface` in dark. Confirmed by Jeremy, 2026-10-19.

### 2026-10-18: One type scale replaces Tailwind's sizes, and the budget test holds it

**`tokens.css` resets Tailwind's text sizes, radii and animations as it already reset colours, weights and shadows. The studio uses the design system's names: `text-title`, `text-heading-1` to `-3`, `text-body`, `text-label`, `text-small`, `text-caption`; radii `sm` (6px), `md` (10px), `lg` (16px) and `full`.** A size or radius outside the scale doesn't exist, so it can't creep back. `budget.test.ts` also rejects arbitrary sizes, radii and colours in class names, spacing off the 4px steps (1, 2, 3, 4, 6, 8, 12, 16, plus 0.5 to nudge inside a control and 10 to clear one), any ring but the focus halo, and each named glow outside its own file. Buttons are set in `label` (15px, 600), as the brand book says; the component sheet draws them at 16px. Code, slugs, URLs, entry ids and file facts are mono.

### 2026-10-18: Details is a drawer on wide screens

**At 1100px and wider (`(min-width: 68.75rem)`, the design system's breakpoint), a quiet "Details" button in the editor's top bar opens the secondary fields in the glass drawer. Narrower, including at 200% zoom on a laptop, Details stays the closing section of the column, as before.** Jeremy approved it at the checkpoint. Spec §10.3 allows either ("or a toggleable right drawer on wide screens"). One open state serves both, so resizing keeps it open or closed. The drawer is modal, so focus goes in and comes back to the button. A failed save doesn't open it, since it would take focus from the error summary. Instead the button counts its problems in words ("Details (1 problem)"), and the summary's links open the drawer before focusing a field in it. Go to field in the notes drawer opens it the same way.

### 2026-10-18: Transitions never touch focus

**Hover colours ease over 120ms. Focus rings, the focus halo and chevrons change at once, the primary's glow eases only on hover, and under `prefers-reduced-motion` there are no transitions at all (`transition-property: none`, not a near-zero duration).** When a click comes from a screen reader or from code (React Aria's "virtual" modality), React Aria moves focus only after every running CSS transition on the page has ended, and focus sits on the page meanwhile. Found by the outline's e2e tests: Shift+F10 clicks the row's "…" button in code, the outline colour of the row and the button and the chevron's rotation were transitioning, and the menu got focus about 100ms later, so the next arrow keys went nowhere. With reduced motion, the 0.01ms transitions left focus on the page for good. The design system's 180ms chevron rotation is dropped for this reason.

### 2026-10-18: Body headings stay headings, inside a region named "Body"

**The body editor's headings are real `h1`–`h6` elements, so they join the studio page's heading outline (the Phase 2.8 follow-up). They stay that way, and the body is now a landmark named "Body", so a screen reader says where a heading belongs when heading navigation lands on one.** They're the body's own structure, and people editing it move through them. On a body that follows its collection's `headingStart` they sit under the entry's title, which is the page's `h1`, as they will on the site; a body that doesn't gets an accessibility note. Rejected: plain paragraphs styled as headings (editors would lose the structure they're writing), `role="heading"` with shifted levels (people would hear a level other than the one they chose), and a separate document such as an iframe, which takes them out of the outline but isn't cheap: the editor, its styles and focus handling would all have to cross the frame. Confirmed by Jeremy, 2026-10-19.

### 2026-10-18: Every focus outline is drawn solid

**Each `X:outline-2` in the studio sits beside `X:outline-solid`, and the budget test fails any that doesn't.** Tailwind 4's `outline-none` sets `--tw-outline-style: none`, and `outline-2` draws `outline-style: var(--tw-outline-style)`. The kit's shared focus ring and field style paired the two, so from Phase 2 until this pass the solid focus outline on buttons, inputs, selects, menus, tree rows and table rows had a width and no style, and wasn't drawn. Keyboard focus was visible only where a native style applied. Found by this pass's keyboard walkthrough, which logs each focused element's computed outline; axe doesn't check focus visibility. Menu items and list options now also draw the ring inside themselves, so focus there never rests on a faint fill alone.

### 2026-10-18: Vesper's mark is "Launch", as the favicon and before the site's name

**Jeremy chose the refined "Launch" mark from the design system's Logo card: one rounded V stroke, a long fall and a short rise, with the evening star to the right on the rise's line. Its earlier shortlist sketch, with a shorter rise, was the other candidate. At 24px and below it uses the small cut (a heavier stroke and a bigger star with no halo); larger, the star has a 20% halo. It appears in two places only: as `/admin`'s favicon, and at 20px before the site's name in the top bar, inside the home link.**
- Under 640px the top bar leaves the mark out, as the editor's bar leaves out the entry's title: at 360px it pushed Save onto a second row.
- In the top bar the mark is decorative (`aria-hidden`). The link's accessible name stays the site's name, which is the visible text (WCAG 2.5.3) and says where the link goes. Announcing "Vesper logo" on every screen would add nothing.
- It's drawn inline from the tokens (`VesperMark` in `@vesper/ui`): the stroke is `currentColor` (`content`), the star `accent`, and both follow the theme. In forced colours the star takes `CanvasText`.
- The favicon is an inline `data:image/svg+xml` in the injected `/admin` page, so it costs no request and needs no file in the site. A favicon can't read CSS variables, so it carries Pine's `content` and `accent` values for each theme and switches with `prefers-color-scheme` inside the SVG.
- The site's own pages keep their own favicon; only `/admin` gets this one. (Vesper's own site, vespercms.com, uses the small cut as its logo and favicon too: "Vesper's own site" below.)
- White-label (the higher paid tier, Phase 9) replaces both. Keeping the mark in one component and one favicon makes that a single swap.

### 2026-10-18: Icons are Lucide's, beside words; the body's formatting tools are icons alone (an exception to spec §10.4)

**Jeremy chose, after the design pass: the body editor's formatting tools (and the compact Markdown field's) are icons alone, each with an accessible name, `aria-keyshortcuts` where it has a shortcut, and a tooltip with its name and shortcut. Insert keeps its word. Everywhere else an icon sits beside its words: action buttons, the "…" menus' items, back links, the warning mark on accessibility notes, the error mark on the error summary, search fields, and file types in Media and the picker.**
- Spec §10.4 allows icon-only buttons only for close, overflow ("…") and drag handles, and DECISIONS added the outline's expand toggle. The formatting tools are the fifth exception. Rich-text toolbars are where icons are the convention, the words wrapped the toolbar onto several rows, and the tooltip and accessible name carry the words. "The body editor's keyboard and toolbar" (2026-10-17) chose words; this replaces that part of it.
- The icons are Lucide's (ISC), drawn by the kit's one `Icon` component at the design system's weight: 1.75px strokes at any size, round caps and joins, `currentColor`. Close, "…", the drag handle, chevrons and the select's tick moved to Lucide too, so the studio has one drawing style. The kit imports only the icons it uses, and `@vesper/admin` bundles them at publish, so sites install nothing for them.
- An accessibility note now starts with the warning mark instead of a warning hairline on its left, as the design system's InlineStatus shows a field warning. The words still say what it is.

### 2026-10-18: A collection's icon is named in vesper.config.ts and resolved at build

**`collections.<name>.icon` names a Lucide icon in kebab case, as lucide.dev lists them (`'newspaper'`, `'calendar-days'`). When the site's manifest is built, `@vesper/astro` loads `lucide` from the site's own install, looks the name up and puts that one drawing into the manifest (`presentation.icon`). The studio shows it beside the collection's name on Home, in the Content menu and in the collection's heading. Collections without one get a default: a page for collections, an outline for tree collections, sliders for singletons.**
- Jeremy asked for icons per collection. Resolving at build means the studio never carries the whole icon set: `lucide-react` would have shipped every icon to `/admin`, or a separate file per icon.
- `lucide` is an optional peer dependency of `@vesper/astro`, as `sharp` is. It's 22 MB installed, so a site that names no icon doesn't pay for it. A site that names one without `lucide` installed gets a plain warning saying to install it, and the default icon.
- An unknown name warns once ("collections.blog.icon: \"newspapr\" isn't a Lucide icon name…") and falls back to the default.
- The kit draws a manifest icon only from Lucide's shapes and geometry attributes (`path`, `circle`, `rect`, `line`, `polyline`, `polygon`, `ellipse`), so manifest data can't put anything else into the page.
- Free, like every other `vesper.config.ts` presentation setting: it isn't the studio's branding, which is white-label's.

### 2026-10-19: A site's name shows as written; only Vesper's own is lowercase

**The top bar shows the site's name exactly as the site writes it. Only Vesper's own name, shown when a site gives none, is set lowercase, as its wordmark.** The design pass lowercased every name with CSS, so screen readers still read it as written, but it showed "Highlands College" as "highlands college": a customer's own name, changed in their own studio. Jeremy chose this on 2026-10-19. The integration always passes a name (the site's host, its package name, or "Your site"), so in practice the lowercase wordmark appears only where the studio is mounted without one.

### 2026-10-25: The entry list sits beside the editor on wide screens (an exception to spec §10.3 and §10.2)

**At 80rem (1280px) and wider, the editor screen shows its collection's list in an 18rem pane on its left:**
- a search field and the entries;
- for a tree, the outline, read-only;
- no pane for a singleton.

**It's shown until someone hides it with the quiet "List" button beside the back link, and that choice is kept per viewer (calls L1 (b) and L2 (a)). Narrower, including at 200% zoom on a laptop, the editor is the single column, as before. Phase 7's preview takes the pane's place while it's on.**

Why: Jeremy found the studio stark, with a lot of clicking back and forth. Every move between entries was a full screen each way, and the editor's bar has no Content menu.

Spec §10.3 asks for "a single centered column" and "no permanent left sidebar", and §10.2 says everything but the document is "not permanently visible". This is the exception, and the spec's §10.2 and §10.3 now say so. What holds:
- The 720px writing column stays.
- The pane is the editor screen's only navigation, so §10.4's two levels hold.
- The current entry uses `glow-selected`, in that glow's named place.
- The pane is a `nav` landmark before `<main>`, and its entries are one Tab stop. Opening one moves focus to the editor's heading, as every navigation does.

Rejected:
- Sanity's columns (collections, entries, the entry, a nested item). They break the single column and the two-level rule, and the editor gets narrow by the third column. At 320px or 200% zoom they'd fall back to one column anyway.
- No pane, only the palette with previous and next, which doesn't change how the studio feels.

### 2026-10-25: GitHub mode loads the editor's picture from GitHub (a narrowing of "The studio self-hosts Figtree")

**In GitHub mode the user menu's picture loads from GitHub's image host (`avatars.githubusercontent.com`), at 64px, with no referrer (call A2). The rule from "The studio self-hosts Figtree" becomes: `/admin` loads no font, script or style from Google or a CDN. CLAUDE.md's wording changes in the commit that adds the pictures.**

Why: in GitHub mode the studio already talks to GitHub for every read and save, so a picture tells GitHub nothing new. The rule was about the studio's own assets: a studio that loads with no third party in the way, and no font host seeing who opens it. The map's tiles (OpenFreeMap) and GitHub's API were already requests from `/admin` to other hosts.

Rejected: initials only in GitHub mode, which would keep the rule's wording for no gain in privacy.

---

## Vesper's own site

### 2026-10-21: vespercms.com is a plain Astro site edited with Vesper, not Starlight

**Jeremy chose on 2026-10-21: the marketing site and the docs are one Astro site, `apps/site` in this repository, built on Vesper's own features rather than Starlight, for the apex of vespercms.com (the cloud is on `app.` and `api.`). This replaces spec §5's `apps/docs` "Starlight docs site" (Phase 9), and starts it ahead of the phase order because Jeremy asked for it now.**
- The docs menu is the `docs` collection's page tree (`tree: true`, `_order.yaml`, `maxDepth: 2`), read with `getTree`, so reordering or moving a page in the studio reorders the menu, and a move writes its redirects. Search is `<Search>`, callouts are a Markdoc tag with hints in `vesper.config.ts`, and the home page is a `pages` entry whose sections are fields. Every part is edited in `/admin`, so the site is also the product's demo and a real site to test it on.
- Rejected: Starlight. Its sidebar comes from `astro.config` or `sidebar` frontmatter, not the studio's tree; its own Pagefind index would have to be turned off for Vesper's; and `docsSchema()`'s unions (`hero`, `prev`, `next`, `sidebar`, `banner`, `head`) show as raw YAML fields in the studio. Starlight 0.42 does support Astro 7, so this was a choice, not a constraint.
- The schemas avoid unions, so every field gets a real control. At first the home page's inline Markdown fields avoided code formatting, which the studio's compact Markdown editor didn't offer (a code span vanished from the field, text and all; "The compact Markdown editor checks marked's tokens before the round trip"). It has code since 2026-10-21 ("One-line Markdown fields have code").
- The colours are the studio's Pine tokens, copied into `site.css` as plain custom properties so the site needs no Tailwind. Figtree comes from the same `@fontsource/figtree` the studio bundles, self-hosted. The mark's small cut is the site's logo and favicon.
- At first `/admin` wasn't deployed (`studio: { deploy: false }`), and the site was edited locally. Since 2026-10-21 the build names its cloud project (`site_3hfhzj0qma9p27ygk422`) and `/admin` deploys with it, so editing vespercms.com becomes a real-world use of the cloud, beside `vesper-github-test`. The site is hosted on Cloudflare Pages, built from this repository's root (`npm run build -w @vesper/site`, output `apps/site/dist`).
- Connecting its repository found a cloud bug: Connect repository needed a first install of the GitHub App, so an account that already had it never came back from GitHub. The fix, a second way in for an installed app ("Choose a repository VesperCMS can reach"), went to production the same day (vesper-cloud 3606146), and the site connects through it, with the folder `apps/site`.
- e2e: the built site on the plain static host (port 4409; previews of the site use 4408), axe on every page in both colour schemes, the docs menu by keyboard at phone width, and every llms.txt link.

### 2026-10-21: `vesper agents` writes agent instructions from the manifest

**Jeremy chose generated instructions over a static block on 2026-10-21. `vesper agents` (in `@vesper/astro`'s new `vesper` bin) turns the manifest into a Markdown guide for coding agents and writes it between `<!-- vesper:agents:start -->` and `<!-- vesper:agents:end -->` in the site's `AGENTS.md` (or `--file`), leaving the rest of the file alone. `--check` writes nothing and fails when the file is stale, for CI. Free, like the rest of the integration.**
- The guide is the rules that keep the studio and the build working (the schema is `content.config.ts`, splice don't reformat, raw values not parsed ones, check with `astro build`), then sections that appear only when the site has them (images, page trees, redirects, Markdoc tags, declared MDX components, `blockPublishOn`), then every collection: its files, URL pattern and each field's type, presence, default and help text. The same manifest builds the studio, so the agent and the editor see one schema.
- It's deterministic (no dates, the manifest's own order), so `--check` can compare bytes. A file's CRLF line endings are kept.
- `AGENTS.md` because most coding agents read it; Claude Code reads `CLAUDE.md`, which imports it with an `@AGENTS.md` line (`apps/site/CLAUDE.md` does exactly that), or `--file CLAUDE.md` writes there directly.
- Scheduling isn't described: build-time filtering arrives in Phase 4.5, and the guide must not promise it.
- This isn't the "AI writing" spec addendum §9 rejects: nothing changes in the studio or the cloud, and nothing writes content. It's documentation for a developer's own tools.
- Rejected: a copy-paste block in the docs only (the agent would still have to read the schema itself, and nothing keeps it current); writing the file automatically in `astro dev` (it would change a file in the site's repository without being asked); an MCP server (content is already files an agent can edit, and a server would be a new free-or-paid question).
- `check:dist` now runs each package's bin with `--help` from `dist/`.

### 2026-10-21: The docs are Markdown too

**Every docs page has a Markdown copy at its address with `.md` in place of the trailing slash (`/docs.md` for the root), `/llms.txt` lists them in menu order with each page's summary, and `/llms-full.txt` is all of them in one file.** They're static endpoints built from the same tree as the menu, so they follow every move. Each page links to its copy, and `<head>` names `llms.txt`. The copies are the Markdoc source with the title and summary on top: callouts read fine as tags, and no conversion can drift from the page.

### 2026-10-25: CI skips pushes that only change the site's content

**Jeremy chose on 2026-10-25: CI doesn't run for a push or pull request whose every changed file is under `apps/site/src/content/` (`paths-ignore` in `.github/workflows/ci.yml`). A push that changes anything else as well runs all of it.** Every publish from vespercms.com's studio is such a push, and since the repository moved to the organization, which is on GitHub's free plan, its private-repository minutes are 2,000 a month. One full run is about 22 Linux minutes and 12 Windows minutes, which count double: about 46 billed minutes, so roughly 40 runs a month, spent on one-line edits.
- What a content-only push still gets: Cloudflare Pages builds it, Astro checks every entry against its schema there, and a content error fails that build. The build also writes the accessibility report, which only reports.
- What it no longer gets: the site's e2e (axe on every page in both colour schemes) for that change alone. The next push that touches code runs it on the content as it then is.
- If the repository goes public with required status checks, a skipped run leaves its checks waiting on a content-only pull request. Required checks would then need a path-aware alternative, such as a job that always runs and passes for content.
- Rejected: skipping only the Windows job for content (still about 22 minutes a publish), and `[skip ci]` in the cloud's commit messages (the cloud serves every site, and a customer's CI is theirs to decide).
