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
- Blocks the writing view can't represent faithfully (JSX, Markdoc tags until Phase 2.5, raw HTML, front-loaded imports) are protected source blocks, edited as raw text.

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

Open risk, tested with a fixture site: a site that already depends on React 18 must not make the studio load the wrong React.

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

**After any content file changes, Astro tells every open page to reload. The studio page skips that one reload (a `full-reload` with path `*` and no `triggeredBy`) through Vite's `vite:beforeFullReload` hook, because the studio made the change and reloading would throw away its state.** Code changes and manifest changes still reload it. This relies on Vite's client reading the payload after its listeners run (true in Vite 5 to 8). If that ever changes, the studio simply reloads after a save, as it did before. A file changed by someone else while it's open is caught at save time as a conflict.

### 2026-10-17: Times are entered in the site's time zone and written with that day's offset

**`vesper.config.ts` takes a `timeZone` (an IANA name, checked when the config loads). Date-time fields show and accept wall time in that zone, name the zone in text ("Times are in Eastern Time, the site's time zone."), and fall back to the editor's own zone, saying so, when none is set.** A value carries the offset the editor meant: the studio sends `{ "$date": "2026-11-07T10:00:00-05:00" }`, core keeps the offset as a hidden property on the Date, and the YAML writer uses it in place of the old value's offset. So a time moved across a DST change is written `-05:00`, not October's `-04:00`. A file that stores UTC (`Z`) keeps UTC. Plain `Intl`, no time zone library.

### 2026-10-17: The geo field's map loads only when asked for

**Latitude and longitude are two always-visible number fields, the real controls (spec §6.3.2). "Show on a map" loads MapLibre and OpenFreeMap tiles on demand.** The map is about 1 MB of code and fetches tiles from the internet, so it shouldn't load for every location entry, and the studio works offline without it. The pin is a real button: arrow keys move it (Shift for ten times as far) and each move is announced. MapLibre's worker is passed in with `setWorkerUrl` and a Vite `?url` import, so it works in dev and in a site's build.

### 2026-10-17: References keep their stored shape, and lists of them keep their order

**A reference field stores an entry ID, and a value already stored as `{ collection, id }` keeps that shape. A list of references is an ordered list with Move up, Move down and Remove buttons and a search box to add more,** because order usually matters (related posts) and must not depend on drag-and-drop. An entry is never offered as a reference to itself.

### 2026-10-17: Upload hygiene strips metadata losslessly unless the pixels must change

**JPEG, PNG and WebP uploads lose their EXIF, XMP, IPTC, text and comment data by dropping those segments or chunks, so the image data is byte-for-byte the original. They're re-encoded through a canvas only when the pixels must change: a photo whose EXIF orientation isn't upright, or one larger than `maxUploadEdge` (3000px by default).** Re-encoding drops all metadata too. Colour profiles (JPEG APP2) are kept. SVG is sanitized with DOMPurify's SVG profile, plus `foreignObject`, `set` or `animate` that rewrite links or handlers, and `javascript:`/`data:` links. Files are typed by their bytes, not their names. Duplicates are found by SHA-256 against the site's files, and the editor chooses between reusing the existing file and uploading a copy. Over 5 MB asks first; over 20 MB is refused (the dev API enforces the hard limit too).

### 2026-10-17: HEIC converts only where the browser can decode it, for now

**HEIC photos are converted to JPEG when the browser can decode them (Safari). Elsewhere the studio says plainly to export a JPEG first or to use Safari.** The browser libraries that decode HEIC everywhere (libheif-js, heic-to) are LGPL-3.0. Whether that suits the studio bundle is Jeremy's call, raised at the end of Phase 2.

### 2026-10-17: Images go beside their siblings; other files go to `public/files`

**A new image goes into the folder of the image it replaces, else `<srcDir>/assets/<collection>/`, and the entry stores a path relative to its own file, so Astro's `image()` processes it. A file field (PDFs and so on) uploads to `public/files/` and stores `/files/name.pdf`,** because a file to link to must be served as is, and files under `src/assets` aren't. The media service lists `<srcDir>/assets` and `public`, and computes "Used on" by looking in every entry's file for each of the ways Astro resolves a path to that file.

### 2026-10-17: Secondary fields go to Details by rule, and authors can override

**The editor puts slugs, dates, tags, ordering, SEO and scheduling fields in the Details section (spec §10.3). Everything else stays in the main column, in schema order.** A field's `placement` overrides the rule, set either with `.meta({ placement: 'details' })` or in `vesper.config.ts` as `collections.blog.placement: { summary: 'details' }`.

### 2026-10-17: In this workspace, the integration compiles the studio's CSS from source

**When `@vesper/admin/studio.css` resolves to `src/` (the `@vesper/source` condition), the integration adds `@tailwindcss/vite` to the site's Vite. Installed from npm, it resolves to the precompiled `dist/studio.css` and Tailwind never loads.** So the playground stays a zero-config site, and the dev loop still never builds `dist/`. `@tailwindcss/vite` is a devDependency of `@vesper/astro` for this reason only.

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

### 2026-10-17: Line endings are pinned to LF, and fixtures are byte-exact

**`.gitattributes` sets `* text=auto eol=lf` and marks fixture folders `-text`.** Git for Windows ships `core.autocrlf=true`, which rewrites every working-tree file as CRLF. Real sites contain CRLF and mixed-EOL files (domsys has 56 files committed as CRLF), and the serializer must preserve whatever it finds. So test data has to reach the tests exactly as committed, on Windows and Linux alike.
