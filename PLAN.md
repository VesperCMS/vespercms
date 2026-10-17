# PLAN.md

The working plan: where each phase stands, the design of the next phase, and the roadmap. Scope and decisions come from `vesper-spec.md`. This file records how we intend to build them, and it changes as phases land. Reasons for choices live in `DECISIONS.md`.

## Phase status

| Phase | Status |
|---|---|
| 0 Scaffold | Done (2026-10-17). CI green on GitHub (run 39054499051). |
| 1 Core | Done (2026-10-17). CI green on GitHub (run 39060134100). See "Phase 1: outcome" below. |
| 2 Integration and local mode | Done (2026-10-17). CI green on GitHub (run 39072815810). See "Phase 2: outcome" below. |
| 2.5 onward | Roadmap below |

## Phase 0: Scaffold

The deliverables are listed in spec §11 Phase 0, plus addendum §7's playground additions. Phase 0 is done when:

- CI is green.
- The playground builds as static output with no adapter.
- The contrast check and the Playwright and axe e2e suite pass.
- `npm run dev` serves the playground.
- Typecheck, lint and tests pass.
- Each package has a README.
- `CLAUDE.md` and `DECISIONS.md` are current.

Two parts of the playground wait for their phase:

- `<Form>` arrives in Phase 6. `src/forms.config.ts` holds the contact form's definition in raw Zod until then.
- `<Search />` arrives in Phase 2.9. The header reserves its slot until then.

## Phase 1: outcome

All five "Done when" criteria are met and tested:

| Criterion | Evidence |
|---|---|
| Every playground collection produces a correct manifest | `packages/astro/test/manifest.integration.test.ts`: a snapshot, assertions for each collection, no diagnostics, determinism, and entry IDs and file paths equal to Astro's own `.astro/data-store.json` |
| No unrelated diffs across at least 30 real files | 165 real files from four sites plus 18 CRLF and mixed-EOL variants. The YAML and entry corpus tests apply the definition in DECISIONS.md |
| Unmappable schema parts fall back to the raw field | `schema/walk.test.ts` (union, discriminated union, transform, record, tuple, intersection, any, numeric enum, recursion, a throwing schema). The playground's `series` field |
| Meta before or after `.optional()` / `.default()` resolves identically | `schema/walk.test.ts`: every wrapper and every wrapper order |
| An unknown widget name falls back with a warning | `widgets/resolve.test.ts` and the edge-site integration test |

**Changes from the design:**
- Astro 7.4 parses YAML with `yaml`, not js-yaml, so js-yaml is the parity check rather than the reader.
- The `astro/loaders` shim is wired through a Vite alias (see DECISIONS.md).
- Sequences of entries with ids are diffed by id.

**Deferred:**
- The Astro 6 fixture site and its CI job move to Phase 2, with the integration. Astro 6's `reference()` shape is already covered by a unit test.
- Loading `markdoc.config.mjs` moves to Phase 2.5, which uses it.

## Phase 2: outcome

The spec's three "Done when" criteria, with evidence:

| Criterion | Evidence |
|---|---|
| A fresh Astro 7 site goes from `npx astro add` to editing content in under two minutes, with zero config | `vesper()` needs no options and no `vesper.config.ts`: `fixtures/astro6-site` uses exactly what `astro add` writes, and builds with `/admin` and the manifest (CI job `astro6`). From `astro dev` starting to a working `/admin` and a successful save on that site took 4.2 seconds. The package has the `astro-integration` keyword and a default export, which `astro add` requires. **Not yet measured:** the `npx astro add` install itself, which needs the packages on npm. Check it at the first publish. |
| Every §10.4 rule holds on every screen | One primary action per screen (Home none, list "New entry", editor "Save", media "Upload"). Status is always words. The toolbar uses words. The only icon-only buttons are close, the "…" menu and the map pin (a drag handle), all named. `packages/admin/src/budget.test.ts` fails on thick borders, extra font weights, ad hoc shadows or raw colours in the studio's source, and `tokens.css` removes off-budget utilities. Contrast is checked by `npm run a11y:contrast`. |
| Each built-in widget meets its §6.3.2 accessibility requirements; colour and geo can be set by keyboard alone and with a screen reader | The colour hex field is the primary control, and palettes are named radio swatches (`widgets.test.tsx`). Latitude and longitude are always-visible number fields. The map pin moves with the arrow keys and announces each move (checked in Chromium). axe runs in jsdom per widget, and in Chromium on every screen (`e2e/studio`). |

**Standing criteria:**
- `npm run dev` serves the playground with `/admin`.
- Typecheck, lint and 2,600-odd unit, corpus and integration tests pass.
- axe passes on every studio screen in Chromium.
- READMEs, `DECISIONS.md` and `CLAUDE.md` are current.
- Keyboard passes done by hand:
  - list row → editor with Enter;
  - Ctrl+S;
  - Escape out of the body editor to its toolbar;
  - the map pin's arrow keys;
  - every dialog (focus in, Escape, focus back);
  - the unsaved-changes guard.

**Also delivered in Phase 2:**
- Studio screens:
  - Home;
  - the entry list (search, status filter, sortable columns);
  - the editor (title as heading, Details, validation summary, conflict handling, delete);
  - the media browser.
- Every built-in widget:
  - colour, geo with an optional MapLibre map, slug, URL, email;
  - date-time in the site's time zone, keeping DST offsets;
  - select and radio, tags, the repeater, references;
  - image (required alt or decorative), file;
  - compact Markdown;
  - the raw YAML fallback.
- The body editor:
  - Tiptap writing view, splicing only changed blocks;
  - protected source blocks;
  - source view;
  - link and image dialogs.
- Upload hygiene, run in the browser:
  - lossless metadata stripping;
  - upright re-encoding;
  - SVG sanitizing;
  - duplicate detection;
  - size limits.
- Custom widgets, compiled as React by the integration, with the playground's `store-hours` example.
- `vesper:content`, and the dev toolbar's "Edit this page".
- The local dev API:
  - localhost only;
  - same-origin only;
  - the `X-Vesper` header required;
  - validated with the site's own schemas.
- Studio e2e tests on `astro dev` over a throwaway copy of the playground.
- The Astro 6 fixture, its CI job, and the `astro:content` shim contract test for both majors.

**Open, for Jeremy:**
- **HEIC conversion.** Converting HEIC outside Safari needs an LGPL-3.0 library (libheif-js or heic-to). Until that's decided, the studio converts where the browser can and otherwise explains what to do (DECISIONS.md).
- **React 18 sites.** The studio needs React 19 (a peer dependency). A site already on React 18, through `@astrojs/react`, would get a peer conflict. Not tested yet: decide whether to support it (load the studio's own React) or document React 19.

**Follow-ups noted, not blocking:**
- The body editor and the compact Markdown field (Tiptap) now load on first use, like the map. The `/admin` script went from 1,818 KB to 843 KB minified in the playground build. Vite still warns that the two lazy chunks (the body editor, 972 KB, and the map, 1,018 KB) are over 500 KB. That no longer affects the first load.
- `fields.image()` with focal points and crops is Phase 2.7. The image field keeps those values untouched until then.

## Phase 1: Core (design)

**Module layout.**
- `packages/core/src`:
  - `schema/`: the Zod 4 walker (structural, no zod import).
  - `widgets/`: inference and resolution.
  - `manifest/`: types, a pure builder, and a SHA-256 hash via Web Crypto.
  - `collections/`: glob matching and Astro-identical IDs.
  - `files/`: text codec, frontmatter split, value diff to patches, YAML read/locate/edit, JSON edit, write verification.
  - `storage/`: the interface, git blob SHA, a memory adapter, and a contract suite that takes the test framework as a parameter.
- `packages/astro/src`:
  - `fields/`: the nine helpers, importing only `astro/zod`. `fields.image` waits for Phase 2.7.
  - `config/`: `defineConfig`, which accepts the documented keys including addendum ones such as `schedule` and `search`, and warns on unknown keys.
  - `node/`: config loading, introspection, manifest writing and the local fs adapter.
  - `cli.ts`: `vesper manifest`.

**Loading the site's configs.**
- Use the site's own Vite, in an isolated `createServer`, and import through `environments.ssr.runner.import()`.
- A pre-enforced shim plugin handles the Astro modules:
  - `astro:content` re-exports Astro's real `defineCollection` and `createReference` from `astro/content/runtime`, plus `z`. Runtime-only functions throw.
  - `astro/loaders` is wrapped so the real `glob()` and `file()` still run, with their options attached under a symbol.
  - Any other `astro:*` module makes the collection read-only with a plain message.
- Function schemas are called with a marked `image`.
- A contract test per Astro major checks that the shim's exports are a superset of `templates/content/module.mjs`. It runs against Astro 7 at the root and against `fixtures/astro6-site`.
- The same loader later reads `vesper.config.ts`, `markdoc.config.mjs` and `forms.config.ts`.
- Validation always uses the user's real Zod objects.

**The walker.**
- Peel `optional`, `nullable`, `default`, `prefault`, `catch`, `readonly` and `lazy`, merging `.meta()` from inner to outer so the outermost layer wins.
- Detect image by its marker. Detect `reference` with a behavioural probe (`safeParse('x')` returns `{id, collection}`), which works on Astro 6 and 7 even though their union shapes differ.
- Map types per the §6.2 table and extract constraints.
- Refinements keep their base kind (in Zod 4 they are checks). Transforms, unions, records and tuples become `unknown`, shown as raw YAML.
- It never throws: each field is wrapped in try/catch and failures become diagnostics.

**Widget resolution.**
- Runs at manifest build, in Node, where the `match` and `accepts` functions from `vesper.config.ts` can be called.
- The manifest stores both the resolved and the inferred widget, plus warnings. The browser only looks components up by name.

**Manifest.**
- Versioned and deterministic: POSIX paths, no timestamps.
- Includes collections (source, editable or read-only with a reason, fields, presentation), forms, and diagnostics.
- Phase 1 emits it from the CLI. Phase 2 adds `astro sync` and `dist/_vesper/manifest.json`.

**Serializers.**
- Split frontmatter with Astro's exact regex, keeping BOM and EOL.
- Read values with js-yaml.
- Locate nodes with `yaml` (`keepSourceTokens`), but only when it parses with no errors and its values deep-equal js-yaml's. Otherwise the block is source-only.
- **Splice minimal edits into the original text:**
  - scalars keep their style;
  - dates keep their shape and offset;
  - added and deleted keys are line-based;
  - each line keeps its own line ending.
- The Document API is a flagged fallback, used only for anchors, aliases and tags.
- Every write is re-read and deep-compared before it is stored.
- JSON is edited with `jsonc-parser` `modify`/`applyEdits`.
- `file()` entries are located by id at write time.
- A no-op save returns the original bytes. TOML is read-only in v1.

**Storage adapter.**
- Methods: `head`, `list`, `read`, and `commit(ChangeSet)`, where a ChangeSet holds `put`, `delete` and `move` changes with `expectedVersion`.
- `version` is the git blob SHA-1, so memory, local, GitHub and cloud adapters all agree, and Phase 4's `base_sha` works unchanged.

**Dependencies, each with its reason:**
- `js-yaml`: Astro's own parser.
- `yaml`: the lossless CST.
- `jsonc-parser`: formatting-preserving JSON edits.
- `github-slugger`: ID parity with Astro.
- `picomatch`: the matcher Astro uses.

**Tests mapped to the "Done when" criteria:**
- **Manifest snapshots** for every playground collection and the Astro 6 fixture, cross-checked against `.astro/data-store.json`.
- **Corpus:** `sources.json` records repo, commit and path for files from Jeremy's three own sites, about 120 in total (well over 30), plus synthetic gaps: JSON indents, anchors, BOM, TOML, MDX imports, CRLF and mixed EOL. `VESPER_PRIVATE_CORPUS` adds the client sites, locally only.
- **"No unrelated diff"** has two parts:
  - a no-op save is byte-identical;
  - editing path P changes only P's byte range, keeps untouched lines' EOLs, and re-reads to the expected value.
- **Raw-field fallbacks:** a table of unmappable schema types, each expected to fall back.
- **Meta placement:** every wrapper order and every meta position produces the same field model.
- **Widgets:** an unknown widget, or one whose `accepts` rejects the field, falls back with a warning that names the field and the widget.

**Commits, in order:**
1. Corpus and import script.
2. Text codec and frontmatter split.
3. YAML reader and locator with the parity gate.
4. Value diff to patches.
5. YAML splice editor.
6. YAML Document fallback and write verification.
7. JSON editor.
8. Entry and data-file serializers.
9. Storage interface, memory adapter and contract suite.
10. Walker.
11. Image and reference detection.
12. Widgets.
13. Glob matching and IDs.
14. Manifest.
15. `@vesper/astro` with the `fields` helpers.
16. Isolated Vite loader with shims and fixtures.
17. `defineConfig`.
18. Manifest CLI and snapshots.
19. Local fs adapter.
20. Playground adopts the helpers and `vesper.config.ts`.

---

## Roadmap after Phase 1 (milestones, plus what to confirm first)

| Phase | Confirm before starting | Milestones |
|---|---|---|
| 2 Integration + local mode | §13.2 Radix vs React Aria; body-editor fidelity (whether Tiptap markdown output must be spliced per block); map tiles for `fields.geo` in free modes (§13.9 is needed this early); whether `/admin` is built by the site's Vite | integration and manifest virtual module; localhost-only dev middleware; ui kit (~15 components with axe and keyboard tests); shell, list and editor with Details; widgets; upload hygiene and media browser; references and repeater; body editor; custom widgets; dev toolbar; fresh-site `astro add` in under 2 minutes; Astro 6 CI job |
| 2.5 Markdoc/MDX | §13.6 | tag blocks, "/" menu, settings forms, source chips, live validation, tag-level splicing |
| 2.6 URLs/tree/redirects | redirects file at the site root; default `maxDepth` | URL patterns, route check, tree, `_order.yaml`, subtree moves as one ChangeSet, redirect cleanup and per-host output, link rewriting, site helpers |
| 2.7 Images | Start by verifying how Astro forwards `position`/`fit` | `fields.image`, focal point and crops, `<Img>`, Sharp wrapper |
| **2.8 A11y checks** (new) | — | layer-1 studio rules and notes drawer; publish gate; layer-2 axe at `astro:build:done` writing `.vesper/a11y-report.json`, never into `dist` |
| **2.9 Search** (new) | Pagefind Component UI accessibility audit | Pagefind Node API index into `dist/_vesper/search/`; `<Search>`; `/search`; `opensearch.xml`; wasm MIME type on the static test host |
| 3 GitHub mode | whether a free cloud relay exists (needs the §13.1 domain) | GitHub adapter passing the storage contract suite; OAuth relay template |
| 4 Cloud foundation | D13, D15, §13.1 domain, §13.3 license (decides whether `apps/cloud-*` can live in this MIT repo) | D1 control plane, auth (reusing Taproot's session and throttle ideas), GitHub App, SiteDO drafts, PKCE studio connection, roles and grants, dashboard v1 |
| **4.5 Scheduling** (new) | — | build-time filtering, scheduled-rebuild templates, DO alarms with deploy hooks or `repository_dispatch`, Schedule dialog |
| 5 Billing + ops | §13.4 (addendum prices are placeholders); §13.7 | Stripe, entitlement keys from addendum §8, operator console |
| 6 Forms (expanded) | — | routing rules, private R2 uploads (D21), confirmation emails with the D20 protections |
| **6.5 Integrations** (new) | — | event and delivery system, Queues with DLQ, five destinations |
| 7 Previews · 8 Comments | accounts on at least two SSR hosts | per spec |
| **8.5 A11y history** (new) | scan engine and caps (new §13 item 13) | report uploads, scans, exports |
| 9 Polish | §13.5 | per spec |

## Risks and early spikes
- **S0:** the source-condition dev loop on Windows (Phase 0). Fallback: tsc watch.
- **Astro internals drift.** Mitigation: use only public exports, plus a shim contract test per major.
- **The `@vesper` npm scope may be taken (§13.1).** Packages stay private and unpublished through Phase 1, so a rename then is cheap. Check availability before the first publish.
- **Sample-file licensing.** Only CC0, public-domain or MIT-compatible files, with provenance recorded in the README.

