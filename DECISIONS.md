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
- **§13.9, geocoding: OpenCage, proxied and cached by the cloud,** once its current terms and price are checked before Phase 4. Coordinates are saved into the site's files, which is permanent storage, so the provider's terms must allow keeping results. Rejected: Nominatim's public server (its usage policy forbids autocomplete) and geocoders whose terms limit storing results.
- **§13.10, machine-suggested alt text: not for now.** It sits close to "AI writing" on the not-adopted list, and D19's posture favours human judgement. Revisit after launch.
- **§13.11, cloud-rendered previews: after launch,** as D17 already says.
- **§13.12, conditional form fields: not adopted.** Forms stay static and routing covers the cases. Show/hide logic would need its own accessibility work (announcing fields that appear) for little gain.
- **§13.13, the scan engine: measure Cloudflare Browser Rendering first** (it fits D7), and set page caps from that cost in Phase 8.5.
- **§13.14, custom sending domains: Agency and Institution.** The Site plan sends from Vesper's domain, with reply-to set to the site owner. A sending domain means DNS records (SPF, DKIM) per customer, which is support work.
- **Still Jeremy's to do (§13.1):** claim the `@vesper` org on npmjs.com, and register the cloud domain before Phase 3. On October 19, 2026 no package was published under `@vesper`; whether the scope itself is held couldn't be checked from here.

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

**JPEG, PNG and WebP uploads lose their EXIF, XMP, IPTC, text and comment data by dropping those segments or chunks, so the image data is byte-for-byte the original. They're re-encoded through a canvas only when the pixels must change: a photo whose EXIF orientation isn't upright, or one larger than `maxUploadEdge` (3000px by default).** Re-encoding drops all metadata too. Colour profiles (JPEG APP2) are kept. SVG is sanitized with DOMPurify's SVG profile, plus `foreignObject`, `set` or `animate` that rewrite links or handlers, and `javascript:`/`data:` links. Files are typed by their bytes, not their names. Duplicates are found by SHA-256 against the site's files, and the editor chooses between reusing the existing file and uploading a copy. Over 5 MB asks first; over 20 MB is refused (the dev API enforces the hard limit too).

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

**The studio is set in Figtree at 400 and 600, from the `@fontsource/figtree` npm package (OFL-1.1), latin subset, compiled into `@vesper/admin`'s `dist/studio.css`. `/admin` never requests anything from Google or any CDN. Code, slugs and URLs use the system monospace stack, and the system UI stack stays the fallback.** Spec §10.5 says "the system UI stack by default". Jeremy chose Figtree for the direction's warmth. Self-hosting means no third-party request and a studio that works offline, and two weights keep to the §10.4 budget. The design system also names JetBrains Mono for code; it isn't added, because the system monospace stack does the job without another download. The first-load cost is measured in PLAN.md, "Studio design pass: outcome".

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
- The site's own pages keep their own favicon; only `/admin` gets this one.
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
