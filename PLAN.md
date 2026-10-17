# PLAN.md

The working plan: where each phase stands, the design of the next phase, and the roadmap. Scope and decisions come from `vesper-spec.md`. This file records how we intend to build them, and it changes as phases land. Reasons for choices live in `DECISIONS.md`.

## Phase status

| Phase | Status |
|---|---|
| 0 Scaffold | Done (2026-10-17). CI green on GitHub (run 39054499051). |
| 1 Core | Done (2026-10-17). CI green on GitHub (run 39060134100). See "Phase 1: outcome" below. |
| 2 Integration and local mode | Done (2026-10-17). CI green on GitHub (run 39072815810). See "Phase 2: outcome" below. |
| 2.5 Markdoc tags and MDX components | In progress. See "Phase 2.5 (design)" below. |
| 2.6 onward | Roadmap below |

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

## Phase 2.5: Markdoc tags and MDX components (design)

Scope is spec §6.5.1, §6.5.2 and the §11 Phase 2.5 entry. §13.6 is decided: an MDX component is editable only when `vesper.config.ts` declares it with a Zod props schema. Rendering real components inside the editor is v2 and stays out.

**What was found first** (measured on the playground and the jazzy-astro5 corpus):
- Markdoc nodes record line ranges only, never character offsets. Inline tags, variables and annotations have to be located in the text by Vesper's own scanner, and each scan is checked against Markdoc's tree.
- Astro parses Markdoc with its own tokenizer options: `allowComments` always, plus `html` and `allowIndentation` when the integration has `allowHTML` (or `allowIndentation` alone with `ignoreIndentation`). Phase 2 parsed with Markdoc's defaults, so in jazzy the four `{% comment %}` tags inside `<!-- -->` looked like real (undefined) tags, and the playground's inline HTML looked like text. The options live only in the integration's closure, so they are read by loading `astro.config` with `@astrojs/markdoc` wrapped to record them.
- Astro's build fails on any Markdoc error at `error` or `critical` level, except `variable-undefined` and "Partial … not found" (it resolves partial files itself and fails when one is missing).
- Markdoc strings are double-quoted, with only `\"`, `\\`, `\n`, `\r` and `\t` as escapes.
- mdast records positions for MDX JSX elements and for each attribute.
- jazzy uses `affiliateLink` 69 times, almost always inline inside paragraphs and list items, and `faq` with multi-line array attributes. Inline tags matter as much as block tags.

**Module layout.**
- `packages/core/src/body/` (the Phase 2 `files/body.ts` moves here):
  - `blocks.ts`: `parseBody` and `assembleBody`. Blocks can now be containers (a tag or component with content): an opening, child blocks, a closing. A container item keeps or replaces its opening and assembles its children with the same spacing rules as the body, recursively.
  - `markdoc.ts`: parsing with Astro's tokenizer options, top-level and nested tag structure, inline chips.
  - `markdoc-tag.ts`: a scanner for one tag's text (`{% name key=value … %}`) that records each attribute's span; Markdoc value serialization; editing an opening tag in place; new tags in house style.
  - `mdx.ts`: JSX flow elements as containers, inline JSX and expressions as chips, attribute editing from mdast's positions, a JS-literal reader for `{…}` values.
  - `inline.ts`: chips inside a Markdown block (offsets relative to the block), shared by both syntaxes.
  - `validate.ts`: Markdoc validation with Astro's filter, mapped to plain-language messages and lines; MDX props validation through an injected function.
- `packages/core/src/markdoc/`: the manifest's `markdoc` section (types), `extractMarkdocSchema(config)` (structural: reads constructors and classes by name, never imports Astro), `markdocConfigFromManifest()` for validating in the browser, and tag attributes as `FieldModel`s for the settings form.
- `packages/core/src/manifest/`: optional `markdoc` and `mdx` sections. `mdx.components[]` carries field models from `walkSchema(props)`.
- `packages/core/src/studio/`: `ContentService.listPartials()`, and body validation on save (`BodyValidator`, injected like `Validator`), returning `bodyIssues`.
- `packages/astro/src/node/load-site.ts`: loads `markdoc.config.*` (Astro's four names) through the isolated server, merges it the way Astro does (`setupConfig` from `@astrojs/markdoc/runtime`), and reads the integration's options from `astro.config`. `vesper.config.ts` gains checked `markdoc.tags` hints and `mdx.components`.
- `packages/astro/src/integration/`: the dev API validates bodies on save with the site's real Markdoc config and real Zod props schemas, and serves `GET partials`. `virtual:vesper/widgets` also exports the declared components' props schemas, so the studio validates MDX props with the real Zod schema in every mode.
- `packages/admin/src/body/`:
  - `nodes.ts`: Tiptap node types made from the manifest: one container type per tag or component with content (its content expression comes from Markdoc's `children`, so only allowed node types fit), one block card type for tags without content, one inline chip type, and the existing source block.
  - `document.ts`: builds the editor document from the nested blocks and writes it back as nested items. Inline chips become private-use placeholders (`U+E000`, hex of the source, `U+E001`) for the Markdown parser and serializer, so marks can span chips and nothing escapes them.
  - `views.tsx`: the frame, card and chip node views, each a labelled group with a Settings button.
  - `settings.tsx`: the settings dialog, built from field models and rendered with the frontmatter widgets (`Field` gets an id prefix so ids can't collide with the entry's own fields). It also has Move up, Move down and Remove, so one dialog reaches every action.
  - `insert.tsx`: the toolbar's Insert menu and the "/" plugin and listbox.
  - `issues.ts`: per-block validation for inline errors.

**How each construct appears** (the §6.5.1 table, made concrete):

| Construct | Writing view | Saved as |
|---|---|---|
| Declared tag with content, opening and closing on their own lines (callout) | Frame: "Callout · Tip", Settings, "…" menu; content editable, limited to its `children` | Opening re-written only if attributes changed; children spliced block by block; closing kept |
| Tag without content, or content on the opening's line (youtube) | Card with a one-line summary | The tag's text, attributes spliced |
| Inline tag (abbr, jazzy's affiliateLink) | Chip inside the paragraph; its text content (if plain) is a field in Settings | The paragraph is re-serialized only if it changed; each chip writes its own source |
| `{% partial file /%}` | Card with a file picker (`.mdoc` files whose name starts with `_` or that sit in a `partials` folder), stored relative to the entry | As a card |
| `{% if %}` | Frame "Shown when …", condition edited as raw text; content editable | As a container |
| `{% else /%}`, variables, functions, annotations, `{% table %}`, unknown tags, undeclared components, expressions, imports | Protected chips, block or inline, each editable as raw text in a small dialog | Byte-identical unless that chip's text is edited |
| Declared MDX component | Frame (with `children: true`) or card; props from the Zod schema; spreads and non-literal expressions kept verbatim and shown read-only | Attributes spliced from mdast positions |

**House style for new tags:** attributes in schema order, defaults and empty values omitted. Markdoc: `{% name a="x" /%}`, or `{% name a="x" %}` / content / `{% /name %}` on separate lines. MDX: `<Name a="x" />` or an opening and closing on their own lines. JSX strings use `"…"`, then `'…'`, then `{"…"}` when the value contains both quotes; other values are `{…}`.

**Editing an existing tag:** a changed attribute replaces its value's span; an attribute set back to its default or cleared is removed with its leading space; a new attribute is inserted after the nearest earlier attribute in schema order (or before the first later one). Everything else in the tag, including quoting, spacing, attribute order and multi-line values, stays byte-identical.

**Keyboard** (spec §6.5.1 accessibility):
- Arrow keys move through content as ProseMirror does: into and out of a frame's content, and onto a card or chip as a node selection, which is announced ("YouTube video selected. Press Enter for settings.").
- Escape inside a frame selects the frame; Escape on a selected block moves to the toolbar (Phase 2's way out).
- On a selected tag: Enter opens Settings, Alt+↑/↓ move it, Delete removes it. Settings has the same actions as buttons.
- Tab from inside a frame reaches that frame's Settings button only (the others are `tabIndex=-1`), so 69 chips never become 69 Tab stops.
- "/" at the start of a line or after a space opens a listbox of what fits at the cursor (combobox pattern: the editor gets `role=combobox`, `aria-expanded`, `aria-controls` and `aria-activedescendant` while it's open). The toolbar's Insert button offers the same list as a menu.
- A new tag with attributes opens its Settings straight away.

**Validation:**
- In the browser: `Markdoc.validate()` with a config rebuilt from the manifest (types, `matches`, `required`, `children`, `selfClosing`, `inline`, partial names), on the whole body (debounced, for the summary and the save gate) and on each block's own text (for its inline message). MDX props go through the real Zod schema from `virtual:vesper/widgets`.
- On save, the dev API validates again with the site's real Markdoc config, so custom attribute classes and `validate` functions run, and refuses to write a body with blocking issues.
- Blocking, as Astro's build does: Markdoc `error` and `critical`, except `variable-undefined` (Astro ignores it), Markdoc's own partial check (replaced by a check that the file exists relative to the entry), and `tag-undefined` / `function-undefined`, which are warnings because the studio may know less of the config than the build does (spec: "unknown tags: … a validation warning"). Zod props issues block.
- Messages are plain language and name the block: "YouTube video: add a title. It's required."

**Dependencies:** none new. Markdoc, mdast, Tiptap and React Aria are already in. The "/" menu is a small ProseMirror plugin, not `@tiptap/suggestion`.

**Tests mapped to the "Done when" criteria:**
- **Insert, configure, move and remove every playground tag by keyboard alone:** `e2e/studio/markdoc.spec.ts` drives callout, youtube, abbr and partial with the keyboard only (insert via "/" and via the Insert menu, Settings, Alt+↑/↓, Delete, cut and paste for the inline chip) and checks the file after each save. Unit tests in `packages/admin/src/body/*.test.tsx` cover the same commands in jsdom. axe runs with the menu and the dialog open.
- **Editing one tag changes only that tag's text (snapshot tests):** core unit tests per edit kind (attribute changed, removed, added, default restored, content edited, moved, removed, inserted) assert the exact output; `body/markdoc.snapshot.test.ts` snapshots one edit per tag in the playground's docs; the admin document tests do the same through Tiptap.
- **Variables, conditionals, functions and annotations survive any edit byte-identical:** for every playground and corpus `.mdoc`, every block is edited in turn (text appended, or an attribute changed), and every protected chip's bytes must appear unchanged, at the same relative place, in the result.
- **A missing required attribute shows inline and blocks publish:** admin tests (inline message on the card, the error summary, `saveEntry` never called), a dev API test (the server refuses the body too) and an e2e test (insert a YouTube video, skip its title, Save is refused, add the title, Save works).
- **A real Markdoc site's content passes the round-trip suite:** `packages/core/test/markdoc.corpus.test.ts` over jazzy-astro5's 108 files (committed and CRLF/mixed variants) with jazzy's tag definitions (copied, with their commit, into `test/helpers/jazzy-markdoc.ts`): keeping everything reproduces each file; replacing any block or chip changes nothing else; editing each tag's first attribute changes only that tag's opening; the inline scanner agrees with Markdoc's tree in every block; and validation finds no blocking issue in content the real site builds.

**Commits, in order:**
1. `docs`: this design.
2. `refactor(core)`: move body parsing to `body/`; parse Markdoc with Astro's tokenizer options.
3. `feat(core)`: Markdoc tag scanner, value serializer and in-place attribute edits.
4. `feat(core)`: nested tag blocks and inline chips; containers in `assembleBody`.
5. `feat(core)`: MDX components as nested blocks with attribute splicing.
6. `feat(core)`: the manifest's `markdoc` and `mdx` sections, schema extraction and body validation.
7. `feat(astro)`: load `markdoc.config` and the Markdoc options; declared MDX components; validate bodies on save; list partials.
8. `feat(admin)`: tag and component blocks in the writing view.
9. `feat(admin)`: settings forms and the Insert and "/" menus.
10. `feat(admin)`: live body validation that blocks saving.
11. `test`: the jazzy Markdoc corpus suite and the e2e keyboard specs.
12. `docs`: decisions, READMEs and the Phase 2.5 outcome.

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

