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

Rejected:
- `tsc --watch` beside dev: a second process, and still racy.
- Shipping TypeScript source to npm, as Taproot's Astro packages do: Node refuses to strip types under `node_modules`, and Astro imports integrations through Node.

### 2026-10-17: TypeScript 6.0, not 7

**Pin `typescript` to 6.0.3.** TypeScript 7.0 is out, but typescript-eslint 8.71 supports `>=4.8.4 <6.1.0`, and `@astrojs/check` supports `^5 || ^6`. Revisit when both support 7.

### 2026-10-17: `@vesper/core` builds without `@types/node`

**Core's tsconfig sets `lib: ["ES2023", "DOM"]` and `types: []`.** `DOM` provides the platform APIs shared by browsers, Workers and Node (`TextDecoder`, `crypto.subtle`, `URL`). With no Node types, any use of `process`, `Buffer` or `node:*` fails typecheck, which enforces spec §12's "runs in Node, Workers and the browser" before review has to. Tests use a separate `tsconfig.test.json` that adds Node types, since they read fixtures from disk.

## Schema introspection

### 2026-10-17: Walk the Zod schema; don't build the manifest from Astro's JSON Schemas

**The manifest comes from walking the site's Zod 4 schemas directly, not from `.astro/collections/*.schema.json`.** Spec §6.2 asked us to check the JSON Schema route first. Astro 7.3's `generateJSONSchema` uses `z.toJSONSchema(…, { io: 'input' })`, and `.meta()` keys do survive it. But `image()` comes out as a plain string, and `reference()` as an anonymous union with the collection name gone (it lives only in a closure). Both have to be special-cased (spec §6.2), so the JSON Schema route can't produce a correct manifest on its own. Phase 2 may still cross-check collection names against those files.

### 2026-10-17: Detect `reference()` by behavior, not shape

**A schema counts as an Astro reference when it is a pipe from a string-or-object union into a transform, and a probe parse of a string returns `{ id, collection }`.** Astro 6.4's union has three options; 7.x adds a number option. Matching the exact shape would break between majors, but the probe works on both.

## Content files

### 2026-10-17: Saves splice edits into the original text

**A save changes only the bytes of the values that changed. Whole-block re-stringifying is a flagged fallback for constructs we can't splice (anchors, aliases, tags).** Measured on 988 real YAML frontmatter blocks from seven local sites: `yaml`'s `parseDocument(…).toString({ lineWidth: 0 })` changed 73 of them (unfolded `>-` strings, re-spaced flow sequences, re-quoting). The `yaml` CST round-tripped all 988 byte-for-byte. Spec §6.5 names the Document API, but its acceptance criterion is "no unrelated diffs," and only splicing meets it.

### 2026-10-17: Values are read with js-yaml, Astro's own parser

**The editor reads frontmatter values with js-yaml, exactly as Astro does. `yaml` is used only to locate and edit nodes, and only when its values deep-equal js-yaml's.** Two real files (multi-line single-quoted inline SVG at column 0) parse in js-yaml and fail in `yaml`. If the editor saw different values than the site does, a save could change content nobody touched. When the two parsers disagree, the block is source-only and edited as raw YAML.

### 2026-10-17: Line endings are pinned to LF, and fixtures are byte-exact

**`.gitattributes` sets `* text=auto eol=lf` and marks fixture folders `-text`.** Git for Windows ships `core.autocrlf=true`, which rewrites every working-tree file as CRLF. Real sites contain CRLF and mixed-EOL files (domsys has 56 files committed as CRLF), and the serializer must preserve whatever it finds. So test data has to reach the tests exactly as committed, on Windows and Linux alike.
