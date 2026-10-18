# PLAN.md

The working plan: where each phase stands, the design of the next phase, and the roadmap. Scope and decisions come from `vesper-spec.md`. This file records how we intend to build them, and it changes as phases land. Reasons for choices live in `DECISIONS.md`.

## Phase status

| Phase | Status |
|---|---|
| 0 Scaffold | Done (2026-10-17). CI green on GitHub (run 39054499051). |
| 1 Core | Done (2026-10-17). CI green on GitHub (run 39060134100). See "Phase 1: outcome" below. |
| 2 Integration and local mode | Done (2026-10-17). CI green on GitHub (run 39072815810). See "Phase 2: outcome" below. |
| 2.5 Markdoc tags and MDX components | Done (2026-10-17). CI green on GitHub (run 39085788652). See "Phase 2.5: outcome" below. |
| 2.6 URLs, hierarchy and redirects | Done (2026-10-18). CI green on GitHub (run 39134480284). See "Phase 2.6: outcome" below. |
| 2.7 Focal points, crops and `<Img>` | Done (2026-10-18). CI green on GitHub (run 39141980527). See "Phase 2.7: outcome" below. |
| 2.8 Accessibility checks, studio and build | Done (2026-10-18). CI green on GitHub (run 39152989394). See "Phase 2.8: outcome" below. |
| 2.9 onward | Roadmap below |

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

## Phase 2.5: outcome

The spec's five "Done when" criteria, with evidence:

| Criterion | Evidence |
|---|---|
| Every tag in the playground's Markdoc collection can be inserted, configured, moved and removed by keyboard alone | `e2e/studio/markdoc.spec.ts`, in Chromium, keys only, with the file checked byte for byte after every save. **Callout:** inserted with "/", type set with the arrow keys, title typed, moved with Alt+↑, removed with Delete. **YouTube video:** inserted from the toolbar's Insert menu, settings reopened with Enter, the captions switch, Alt+↑ and Alt+↓, Delete. **Abbreviation:** inserted inline, configured, moved with cut and paste, Delete. **Partial:** points at the nearest partial file, Alt+↑, Delete. axe passes with the "/" list, the Insert menu and each dialog open. `packages/admin/src/body/blocks.test.tsx` covers the same commands in jsdom. Manual keyboard pass below. |
| Editing one tag changes only that tag's text in the file (snapshot tests) | `packages/core/test/tag-edits.snapshot.test.ts` records one attribute edit per tag in every playground Markdoc file (`__snapshots__/tag-edits.md`), and each edit's only changed bytes are that tag's. `markdoc-tag.test.ts` and `jsx-tag.test.ts` cover each kind of edit: changed, removed, added in schema order, set back to its default, quoting. `document.test.ts` checks the same through Tiptap: an attribute change rewrites only the opening, typing in a callout only that paragraph, and an inline tag's change only that tag. |
| Variables, conditionals, functions and annotations survive any edit byte-identical | `packages/admin/src/body/fidelity.test.ts` (206 tests) opens every Markdoc file in the playground and the jazzy corpus in the real editor. It types into each editable block in turn, at any depth, and checks that every byte outside that block is unchanged and that the block still holds its chips, byte for byte, in order. Opening and saving with no edit changes nothing. `document.test.ts` checks variables, conditions and annotations beside edited neighbours. |
| A missing required attribute shows inline and blocks publish | `blocks.test.tsx`: the message shows on the card and in the error summary, and the save is never sent. `dev-api.test.ts`: the dev API refuses the body too, checked with the site's real Markdoc config. In Chromium (`markdoc.spec.ts`): a YouTube video with no ID or title shows both messages on its card, Ctrl+S is refused, the summary takes focus and the file is unchanged. In local mode, publishing is Save. GitHub and cloud modes go through the same check. |
| A real Markdoc site's content passes the round-trip suite (Jazzy Cabbages) | `packages/core/test/markdoc.corpus.test.ts` (433 tests) runs over jazzy-astro5's 108 Markdoc files, with jazzy's own tag definitions (`test/helpers/jazzy-markdoc.ts`, from jazzy commit ea28ab6). For each file: keeping everything reproduces it; every tag Markdoc finds is a block or a chip (inside tables, which stay protected, excepted); validation blocks nothing in content the site builds; editing each tag's first attribute changes only that tag's opening. The suite found two bugs, both fixed in their own commits: a rewritten block dropped its trailing whitespace (seven files), and an inline tag's edit re-serialized its whole paragraph. |

**Standing criteria:**
- `npm run dev` serves the playground with `/admin`. Every Markdoc tag and the declared MDX `Callout` are blocks there.
- Typecheck, lint, the format check, and 3,721 unit, corpus and integration tests pass. `check:dist` loads all seven entry points from `dist/`. `astro check` on the playground reports 0 errors, 0 warnings and 0 hints. The Astro 6 contract test and fixture build pass.
- `npm run e2e`: 52 passed, static and studio. The Markdoc spec passed 24 of 24 in four repeated serial runs.
- axe passes in Chromium with the "/" list, the Insert menu, each settings dialog and the refused-save summary on screen, and in jsdom for each kind of block.
- Manual keyboard pass in Chromium, on the playground's writing-callouts guide:
  - Escape inside a callout selects the frame and announces it;
  - Enter opens its settings, with focus on the chosen type; the arrow keys change it, and Tab moves through the fields;
  - Escape closes the settings, and the block stays selected;
  - Tab from inside a frame reaches only that frame's Settings button, and Shift+Tab goes back;
  - Escape on a selected block moves to the toolbar, whose arrow keys reach Insert;
  - "/" turns the text into a combobox with a filtered list, and Enter inserts;
  - a save with a missing required attribute is refused, and the summary takes focus.
- READMEs, `DECISIONS.md` and `CLAUDE.md` are current.

**Changes from the design:**
- Modules. `mdx.ts` became `mdast.ts` (structure) and `jsx-tag.ts` (attributes). `inline.ts` folded into `markdoc.ts` and `mdast.ts`. The admin's `issues.ts` became `useBlockIssues` in `body/ui.ts`, plus `body/checks.ts`. `body/catalog.ts`, `body/chips.ts` and `body/commands.ts` are new.
- Frames have no "…" menu. The Settings dialog holds every action (DECISIONS.md).
- Body checks and `vesper.config.ts` load on first use. Loaded eagerly, they took `/admin`'s first load to 1,480 KB; it's now 846 KB, against 843 KB after Phase 2.
- Commits. The design's twelve became 25: fixes found by the corpus, fidelity and e2e suites landed as their own commits.
- Found by the e2e suite on Windows: a save's rename could fail with `EPERM` while the dev server's watcher read the file. It's now retried briefly, as graceful-fs does (DECISIONS.md).

**Open, for Jeremy:**
- **Unknown Markdoc tags warn instead of blocking a save.** That follows the spec's table ("a validation warning"), but Markdoc rates them critical, so Astro's build fails on them. The studio never inserts one; one can only come from the source view or an existing file. Options:
  - keep the warning;
  - block in the dev API only, which has the site's complete config, and keep warning in the browser;
  - block everywhere, which would refuse saves whenever the studio's copy of the config is incomplete.
- **Custom attribute types and `validate` functions run only in the dev API.** They're code, so the browser can't run them. In GitHub mode (Phase 3) the site's build is the last check for them. Decide in Phase 3 whether that's enough.
- Still open from Phase 2: HEIC conversion licensing, React 18 sites, and timing `npx astro add` at the first npm publish.

**Follow-ups noted, not blocking:**
- Tables stay protected source blocks, edited as text.
- Vite warns about three lazy chunks over 500 KB: the map (1,018 KB), the body checks (513 KB) and the body editor (512 KB). None is in the first load.

## Phase 2.6: outcome

The spec's five "Done when" criteria, with evidence:

| Criterion | Evidence |
|---|---|
| Moving a playground section with descendants produces one commit (or one set of disk renames), with the moved files, the updated `_order.yaml` files, a redirect for every old URL and every internal link updated | `packages/core/src/studio/pages.test.ts` moves Nursing (four pages) over a memory copy of the playground and asserts exactly one change set and its contents: five file moves, both `_order.yaml` files (comment kept), the redirects file byte for byte (four new redirects, and the old chain now ending at `/nursing`), and eight rewritten links in Markdown, MDX, a Markdoc partial that isn't an entry, and an event's URL field. A second test checks each linking file changes only that address. `e2e/studio/pages.spec.ts` does the same move by keyboard in Chromium and checks every file on disk. `links.test.ts` covers every link form, relative paths included. |
| The built site serves every old URL as a redirect to the new one, with no chains | `packages/astro/test/redirects.integration.test.ts` copies the playground, moves Nursing through `PageService` over `LocalStorage` exactly as the studio does, runs `astro build`, and serves `dist/` with `scripts/static-server.mjs`. All seven old URLs (the four moved pages and the file's own chain) land on a real page in one Vesper hop, and the moved section's links point at the new address. The static e2e suite checks the committed playground's redirects the same way, from `_vesper/redirects.json`, and in a real browser. |
| The tree can be fully operated by keyboard and screen reader: expand, collapse, move, reorder, add a child | `e2e/studio/pages.spec.ts`, keys only: Tab into the outline, arrows to move and expand, Left back to the parent and to collapse, Alt+↑/↓ to reorder (announced, and checked in `_order.yaml`), Shift+F10 to the "…" menu, "Move to…" through the combobox and the confirmation, "Add child page" then Ctrl+S, "Create section page", and drag and drop in React Aria's keyboard mode. axe passes with the outline, the menu, both move dialogs, the Redirects screen and its dialogs on screen. `PageTree.test.tsx` covers the same in jsdom. The outline is a treegrid with `aria-level`, `aria-expanded`, named row buttons and a polite live region. **Not done: a pass with a real screen reader** (see below). |
| A path colliding with a static route in `src/pages` is blocked with a plain-language message | Refused before anything is written, for moves, renames and new pages: "/contact/ is already a page on this site that isn't edited here (src/pages/contact.astro). Choose a different address." `pages.test.ts` (move, rename, create), `dev-api-pages.test.ts` (over HTTP, file untouched), `routes.test.ts` (static routes from `astro:routes:resolved` and from `src/pages`), and in Chromium (`pages.spec.ts`). |
| `getTree()`, `getChildren()`, `getBreadcrumbs()` and `getUrl()` return identical results in dev and in a production build | `/site-tree.json` (the playground prints every helper's output there) is fetched from the static build and from `astro dev` in one e2e test and must be equal. `helpers.test.ts` unit-tests the runtime. The static suite checks the four-level breadcrumbs and the section list in `_order.yaml` order. Parity with live previews is Phase 7. |

**Standing criteria:**
- `npm run dev` serves the playground with `/admin`; Pages opens as the outline, and the Redirects screen is in the Site menu.
- Lint, the format check, typecheck and the contrast check pass. Vitest: 3,845 tests in 75 files (unit, corpus and integration; the integration project's 29 include the Astro 6 contract test, with the fixture installed locally).
- `npm run e2e`: 66 passed, static and studio. The new studio spec passed 24 of 24 in three repeated runs on one worker.
- `check:dist` loads all eight entry points from `dist/`, `@vesper/core/urls` included. `astro check` on the playground: 0 errors, 0 warnings, 0 hints. The Astro 6 fixture builds with the new hooks.
- READMEs, `DECISIONS.md` and `CLAUDE.md` are current.
- Keyboard pass: every flow above was driven by key presses in Chromium (Playwright). In the app's browser pane, expanding a row with the arrow keys worked. The pane couldn't take key presses after that because the window was hidden, so no hand-driven pass was possible this session.

**Changes from the design:**
- `ReorderRequest` also takes a target index, so a drop several places away lands there, not one step along.
- React Aria's rows keep their key events, so the outline reads Alt+arrows and Shift+F10 in the capture phase from the focused row.
- The kit gained `SuggestField` (the link picker) and `FileButton` (CSV import) besides `Tree`.
- The route check lives in `integration/site-check.ts`. The link picker for URL fields is a "Choose a page…" button, since the widget contract has the editor own the field's label.
- The YAML writer fix grew: lists edited and resized at once now change item by item in general, and a new item after one-line flow maps is written as one. The corpus suites pass unchanged.
- `src/lib/pages.ts` in the playground is gone; its pages use the helpers.
- Commits: the design's sixteen became 23. One ordering slip: the outline's commit (477c05b) imports the Redirects screen, which lands in the next commit, so that one commit doesn't build on its own. The branch builds at every later commit.

**Open, for Jeremy:**
- **A screen reader pass.** The outline, the dialogs and the Redirects screen were checked with axe and driven by keyboard, but not heard. Worth ten minutes with NVDA in Chrome: reading rows (title, address, status), expanding, the menu, a move and its announcement.
- **The internal-link build check** (spec §6.15.6, "optional build check") wasn't built. It overlaps "weekly broken-link checks" on the do-not-build list.
- **Vercel's redirects** go into the site's `vercel.json` when the studio writes them, because Vercel reads it before the build (DECISIONS.md). Confirm that's acceptable, or prefer HTML redirect pages only on Vercel.
- **The outline is a treegrid, and its expand toggle is an icon-only button** (DECISIONS.md, with the §10.4 budget note). Confirm the exception.
- **Redirects aren't served by `astro dev`.** They work in every build.
- **Edit grants on both ends of a move** (spec §6.15.4) wait for cloud roles in Phase 4.
- Still open from earlier phases: HEIC conversion licensing, React 18 sites, and unknown Markdoc tags (warn or block).

**Follow-ups noted, not blocking:**
- A function-form `url` has no "View on site" in the studio (the studio's bundle doesn't run it); the link picker still lists those pages, from the dev API.
- In dev the playground logs a hint to set `tree: true` for `docs`, whose guides sit in a folder. It's the spec's suggestion working as meant.
- The S3 deploy template's redirect metadata is Phase 9; `_vesper/redirects.json` is its input.

## Phase 2.7: outcome

The spec's five "Done when" criteria, with evidence:

| Criterion | Evidence |
|---|---|
| The playground hero renders correct crops at every declared ratio. A manual crop overrides the focal point only for its own ratio. | `e2e/static-images.spec.ts`, on the plain static host. On `/images/`, both heroes at wide, square, portrait and og: every served file has its ratio's exact size and is compared pixel by pixel with the rectangle cut from the original by Sharp in the test. The expected rectangles are worked out in the spec, not with Vesper's geometry. All are within a mean difference of 2 in 255. Harbor's square matches its stored crop and is far from its focal square (over 10); every other ratio is the focal crop, and the winter market's (no focal point) the centre's. The og image and the blog list's thumbnails are checked the same way. Unit: `images/geometry.test.ts` (`cropForRatio`), `images/plan.test.ts`. |
| Art direction outputs a valid `<picture>` with per-breakpoint sources, and each source is correctly cropped. | The same spec on the post page: `<source media="(min-width: 48rem)" type="image/webp">` at 2400×1350, then the base `<source>` at 1080×1080, then the `<img>` with its alt text. Every `srcset` entry's file has its stated width and its source's ratio, and matches that source's crop pixel by pixel. At 375 pixels wide Chromium loads a square file, at 1280 a wide one (`currentSrc` and the natural size). `plan.test.ts` covers the order, the formats and the fallback format. |
| The focal point and crop box can be set fully by keyboard, with values announced to screen readers. | `e2e/studio/images.spec.ts` in Chromium, keys only: Enter opens the disclosure; Tab reaches the focal point; arrows and Shift+arrows move it, announced ("Focal point 65% across, 45% down."); Tab to "Adjust crop for Wide", Enter; the box has focus; Shift+← ten times and → twice, announced ("Crop 7% from the left, 7% from the top, 90% of the width."); Enter applies and focus returns to the button; Ctrl+S; Tab to "Adjust crop for Square", Enter, Tab to "Reset to focal point", Enter; Ctrl+S. axe passes with the disclosure open and with the dialog open. jsdom: `focal-point.test.tsx` and `crops.test.tsx` cover every key, the number fields, clicks and corner drags, Escape, an untouched Apply, and axe. **Not done: a pass with a real screen reader** (below). |
| Original image files are byte-identical before and after any focal-point or crop edit. | The studio spec hashes every file under the site copy's `src/` before, and again after a focal-point move, a crop applied, a crop reset and two saves: only the entry differs, and it differs by exactly the expected bytes (two focal values, one added crop line, then the square crop's line gone). `images.integration.test.ts` hashes the playground copy's `src/` before and after a build with the crop step and one without. |
| Disabling the service wrapper leaves the site building, with crops falling back to Astro's own server crop plus focal `object-position`. | `images.integration.test.ts` builds a copy of the playground with `vesper({ imageService: false })`. It builds; every ratio's file is exactly what Sharp makes on its own for that size and anchor (top, right, right, top for wide, square, portrait, og); every `<img>` carries `object-position`; no `crop` reaches the page; and the manual square isn't applied. With the step back on, the same copy cuts the manual square. `register.test.ts`: the step replaces only Astro's Sharp service (the one service or either Astro 7.4 target), keeps its `config`, and leaves other services alone. |

**Standing criteria:**
- `npm run dev` serves the playground; the hero's "Focal point & crops" is in the blog editor, and `/images/` shows every crop.
- Lint, the format check, typecheck and the contrast check pass. Vitest: 3,942 tests in 83 files (unit, corpus and integration). The integration project includes the fallback build and the Astro 6 fixture's crop build, with the fixture installed locally.
- `npm run e2e`: 84 passed, static and studio (66 before this phase).
- `check:dist` loads all 11 entry points from `dist/`; the new ones are `@vesper/core/images`, `@vesper/astro/images` and `@vesper/astro/image-service`. `@vesper/astro/components` ships as source and is covered by the playground and fixture builds.
- `astro check` on the playground: 0 errors, 0 warnings, 0 hints. The Astro 6 fixture builds with the crop step and `<Img>`, and cuts its manual og crop and its focal square.
- READMEs, `DECISIONS.md` and `CLAUDE.md` are current.
- Keyboard pass: the flows above were driven by key presses in Chromium (Playwright). In the app's browser pane, by hand: arrows and Shift+arrows on the focal point (fields and announcement followed), Enter on "Adjust crop for Wide", focus on the box, Shift+← and arrows, Enter, focus back on the button and "Custom crop" on the preview. That pass found two bugs, both fixed before their commit: the previews took the figure's width instead of their ratio, and the box didn't have focus when the dialog opened.

**Changes from the design:**
- Commits: the design's twelve became fourteen. The finding was recorded in its own commit first, as the spec asked. `maxUploadEdge` for uploads got its own commit, and the focal point, the previews and the dialog landed together, since they share one disclosure. Found by the studio spec: a new crop beside one-line flow maps was written as a five-line block map, fixed in the YAML writer in its own commit (DECISIONS.md).
- `fields.image()` labels the focal point "Focal point"; otherwise the manifest is the same as the raw schema it replaced.
- Every dialog now scrolls inside itself on a short screen, not only the wide one.
- The Astro 6 fixture has no `vesper.config.ts` (it's the zero-config site), so its manual crop is on the built-in `og` ratio.

**Open, for Jeremy:**
- **A screen reader pass.** The focal point and the crop dialog were driven by keys and checked with axe, not heard. Worth ten minutes with NVDA in Chrome: the focal point's description and announcements, the number fields, the crop box (`role="application"`, so NVDA should switch to focus mode on it) and its announcements.
- **`role="application"` on the crop box** (DECISIONS.md) needs a lint exception. Confirm, or prefer number fields for the crop as well.
- **`sharp` as an optional peer dependency of `@vesper/astro`** (DECISIONS.md). Confirm before the first publish.
- **`<Img>` from an npm install** isn't tested: like the `/admin` page it ships as source, and only workspace builds load it. Check at the first publish, with the `npx astro add` timing.
- Still open from earlier phases: the 2.6 items (screen reader pass, Vercel redirects in `vercel.json`, the treegrid's icon-only toggle, the skipped internal-link build check), HEIC licensing, React 18 sites, and unknown Markdoc tags.

**Follow-ups noted, not blocking:**
- Body images keep Astro's own processing with no focal point or crops (§6.6.5: not in v1).
- R2 media (§6.6.1) is cloud work; `<Img>` treats a remote `src` as Astro does, with `object-position` only.
- In this workspace the Astro 6 fixture's crop step loads the root's Astro 7 Sharp service (DECISIONS.md). A published install loads the site's own.
- The redirects integration test still builds with Vitest's environment; the image tests don't (DECISIONS.md).

## Phase 2.8: outcome

The spec's four "Done when" criteria, with evidence:

| Criterion | Evidence |
|---|---|
| Every layer-1 rule fires on the playground's deliberately flawed fixtures, with the message shown beside the right field | `packages/core/src/a11y/playground.test.ts` runs the checks over the real fixture file with the playground's manifest: all seventeen rule IDs fire, 23 notes in all, each at its place: `color-contrast` on `textColor`, the three PDF rules on `brochure` and on the body link at line 29, and every body rule at its line (images 9–15, headings 17–21, links 25–27, the table 33, the typed list 40, the videos 47 and 49). The PDF facts come from PDF.js reading the same file in `packages/admin/src/a11y/pdf.test.ts` (untagged, no title, no language; a generated tagged PDF reads as tagged, titled and in `en-US`). In Chromium (`e2e/studio/a11y.spec.ts`): the colour field's description holds "Contrast 2.3:1 against Page, light is below 4.5:1.", the file field's holds the three PDF notes PDF.js found, and the body's list holds the other 19 notes in order, each naming its subject. Core unit tests cover each rule with cases that must and mustn't fire, in all three formats; admin jsdom tests cover notes beside a field (in its description), beside an image's alt text, under the body with Show, and PDF notes beside a file field. The real content gets one note, a question: the callouts guide's video doesn't say it has captions. |
| The layer-2 report maps issues to entries | `packages/astro/test/a11y.integration.test.ts` builds a copy of the playground plus one page no entry produces. The report lists the fixture page with its entry (`fixtures`, `accessibility-mistakes`, its file, `/admin/#/c/fixtures/e/accessibility-mistakes`) and its three issues (`image-alt` as an error, `empty-heading` and `heading-order` as warnings, in plain words), the extra page with `entry: null`, and nothing else; three redirect pages and the studio shell are skipped and counted. The static e2e suite reads the playground's own report and finds the fixture page mapped to its entry. Unit tests cover file-to-URL for both build formats and `base`, skipping, and axe's impact as error or warning. The Astro 6 fixture builds with the check too ("checked 1 page, no issues"). |
| No report file appears in `dist/` | The integration test walks `dist/` for anything named like a report or `.vesper`, and the static e2e suite does the same on the playground's build. CI's build job checks it again, and hands the report to the e2e job as its own artifact. The report sits in `.vesper/` with a `.gitignore`; a unit test checks it isn't written when the output folder would contain it. With `failBuildOn: 'error'` the second build fails, after writing the report, with "Accessibility: 2 errors at build, and vesper({ a11y: { failBuildOn: 'error' } }) fails the build on them." |
| The notes drawer can be fully operated by keyboard and screen reader | `e2e/studio/a11y.spec.ts`, keys only, in Chromium: Enter on "23 accessibility notes" opens the drawer with focus on it; Tab reaches Close, then the first "Go to field", described by its note; Enter closes the drawer and focuses the Text color field; reopened, ten Tabs reach the skipped heading's Go to field, and Enter puts the caret in that heading in the body editor; Escape closes it and focus returns to the count. axe passes with the drawer open and on the fixture's editor. jsdom tests cover Enter, Tab and Escape, both kinds of Go to field, and axe. Manual keyboard pass below. **Not done: a pass with a real screen reader** (below). |

**Standing criteria:**
- `npm run dev` serves the playground; the accessibility fixture's editor shows its notes and the count, and every build writes `apps/playground/.vesper/a11y-report.json`.
- Lint, the format check, typecheck and the contrast check pass. Vitest: 4,063 tests in 93 files (unit, corpus and integration; the integration project includes the new build test, two builds, and the Astro 6 fixture with it installed locally).
- `npm run e2e`: 88 passed, static and studio (84 before this phase).
- CI green on GitHub (run 39152989394): every job, the Windows tests and the Astro 6 fixture included.
- `check:dist` loads all 11 entry points from `dist/`. `astro check` on the playground: 0 errors, 0 warnings, 0 hints. The Astro 6 fixture builds, with the accessibility check.
- The first load grows by about 2 KB: the studio's own entry is 67.09 KB minified against 65.09 KB at 305daee, the rest unchanged. The checks (with micromark and Markdoc), the reveal code and PDF.js all load on first use.
- The build check takes about 4 seconds on the playground's 34 pages, most of it loading jsdom.
- READMEs, `DECISIONS.md` and `CLAUDE.md` are current.
- Keyboard pass by hand, in the app's browser pane, one key at a time: Enter on the count opened the drawer with focus on it; Tab reached Close, then the first Go to field with its note as description; Enter closed the drawer and focused the Text color field. Reopened: ten Tabs reached the skipped heading's Go to field, and Enter put the caret in that heading in the body editor. Escape closed the drawer; focus returning to the count couldn't be seen by hand, because the app's window was hidden and animation frames (which React Aria waits for) don't run there. Playwright confirmed it in Chromium. That pass found the bug fixed before its commit: Go to field moved focus in an animation frame, so in a hidden window focus fell to the page.

**Changes from the design:**
- Commits: the design's eleven became fifteen. Found while building, each in its own commit: two caption notes read the same (subjects now carry the block's summary value); the "Edit as text" button of a protected block didn't contain its visible words in its name (WCAG 2.5.3), found by the new spec's axe check on the first page tested with protected blocks on screen; the build log said "checked 1 pages" on the Astro 6 fixture; and one Phase 2.6 test read the Redirects table's rows before React Aria rendered them, which failed once under a full run's load.
- The image widget's own alt-text advice (Phase 2) is replaced by the shared rules, beside the alt text box.
- `PageService.pageEntries()` was added, so the build gets each entry's URL key and file from the same code as the link picker.
- The playground's fixtures collection got a URL pattern (`/fixtures/:id`): without one, a page can't be traced to its entry.
- The drawer's groups are `h3`: React Aria's dialog makes its title an `h2`.
- The report lists only pages with issues, with the counts of pages checked and skipped.

**Open, for Jeremy** (each built with the recommendation; DECISIONS.md has the detail):
- **The publish gate in local mode**, where the button is Save: refuse the save as built (one rule in every mode, and the gate is opt-in), warn only in local mode, or refuse with "Save anyway".
- **The DOM for axe at build**: jsdom as built (matched Chromium on every page, never runs the page's scripts, 25 MB, about 100 ms a page) or happy-dom (also matched, about 60 ms a page, 20 MB, but runs the page's inline scripts to load axe). linkedom can't run axe.
- **Where the heading start is set**: `collections.<name>.headingStart` as built (default 2), a site-wide `a11y.headingStart` with overrides, or a hint on the title field.
- **PDF.js**: lazy as built, legacy build (524 KB plus a 1,321 KB worker, minified); or the modern build if the studio may require Chrome 140, Firefox 133 or Safari 18.2; or a small reader of Vesper's own. Installed, `pdfjs-dist` is 35 MB, and npm adds its optional `@napi-rs/canvas` (37 MB on Windows) unless optional dependencies are skipped.
- **An empty alt in a body image**: decorative as built (HTML's rule, and what the studio's image dialog writes for "Decorative"), so only an `<img>` with no `alt` and image fields get `missing-alt`; or a note on every empty alt; or a decorative marker in the body syntax.
- **Which colours are text, and where backgrounds come from**: `fields.color({ contrast })` and `a11y.backgrounds` as built; or every colour at 3:1; or the site's CSS.
- **Layer 2 on by default**, as the spec reads: it adds jsdom (25 MB) and about 4 seconds on the playground. Alternatives: off by default, or jsdom as an optional peer the build asks for.
- **Docs links**: each rule has a docs slug, but no link is shown until the docs site (Phase 9) has a domain (§13.1).
- **A screen reader pass.** The notes, the drawer and Go to field were driven by keys and checked with axe, not heard. Worth ten minutes with NVDA in Chrome: a field's note read as its description, the count, the drawer's title and groups, each Go to field with its note, and where focus lands after it.
- Still open from earlier phases: the 2.7 items (screen reader pass, `role="application"` on the crop box, `sharp` as an optional peer, `<Img>` from an npm install), the 2.6 items (screen reader pass, Vercel redirects in `vercel.json`, the treegrid's icon-only toggle, the skipped internal-link build check), HEIC licensing, React 18 sites, and unknown Markdoc tags.

**Follow-ups noted, not blocking:**
- Headings inside the body editor's text are part of the studio page's heading outline (the fixture's body puts an `h1` and an `h4` there). It's been so since Phase 2; worth a look in the studio design pass.
- A collection with no `url` can't be traced to its pages in the report (`entry: null`); the docs should say so.
- Notes can't be dismissed; there's nowhere to keep that in local mode. Cloud drafts (Phase 4) could hold it.
- Layer 3 (report uploads, history, rendered scans with contrast, exports) is Phase 8.5.

## Phase 2.8: Accessibility checks (design)

Scope is spec §6.18 layers 1 and 2 and the §11 Phase 2.8 entry. Layer 3 (cloud history, full rendered scans, exports, the agency view) is paid and belongs to Phase 8.5: nothing of it is built here. Both layers report problems; neither claims compliance, and nothing is injected into the site (D19).

**What was found first** (measured on the playground's static build, 38 HTML files, before writing any code):
- axe-core 4.14 runs in **jsdom** 30 and **happy-dom** 21. Over the same 60 structure rules (below), both gave exactly the violations real Chromium gives on every one of the 38 pages. jsdom needs one shim: it has no `document.elementFromPoint`, and without it the page-level rules (`landmark-one-main`, `page-has-heading-one`) error out and land in "incomplete". **linkedom** 0.18 can't run axe at all (no `screen`, no `getComputedStyle`), not without shimming half a browser.
- Time per page: jsdom about 100 ms (construction 21 ms, loading axe 14 ms with one compiled `vm.Script`, the run 66 ms), happy-dom about 60 ms. Loading the module once: jsdom 2.7 s, happy-dom 1.1 s. Installed: jsdom 25 MB in 30 packages, happy-dom 20 MB in 7, axe-core 3.4 MB.
- jsdom with `runScripts: 'outside-only'` never runs the page's own scripts while still letting axe in. happy-dom needs JavaScript evaluation on to load axe the same way, which runs the page's inline scripts too.
- Astro's static redirect pages (a meta refresh, no `lang`, no `main`) fail `html-has-lang`, `landmark-one-main`, `page-has-heading-one` and `region`. That's Astro's template, not the site's content, so the build check skips them, as the e2e gate already does. The `/admin` shell fails the same landmark rules before its script runs; the studio has its own axe checks in e2e, so it's skipped too.
- Of the fixture page's mistakes, axe sees only `empty-heading` and `heading-order` at build (plus `color-contrast` in a real browser, which layer 2 doesn't check). The rest are content problems only the studio can see, which is why layer 1 exists.
- PDF.js 6.4 (`pdfjs-dist`, Apache-2.0) reads the fixture PDF in 76 ms: `getMarkInfo()` is null (untagged), `getMetadata()` has no `Title` and `Language: null`. Its modern build needs `Uint8Array.prototype.toHex` (Chrome 140, Firefox 133, Safari 18.2 and later); the legacy build doesn't. Minified, the legacy build is 524 KB plus a 1,321 KB worker.
- Markdoc with `allowHTML` gives inline and block HTML as `html_inline` / `html_block` nodes with line ranges and no content, so HTML is read from those lines of the source.

**Rules** (`packages/core/src/a11y/`, no dependencies, so the studio, the dev API and the cloud can share them). Each rule has an ID, a plain-language message, one sentence on why it matters, and a docs slug for the link the docs will hold (spec §6.18: "a link to a short explanation in the docs"). The spec's twelve rows become seventeen IDs, so `blockPublishOn` can name exactly what it blocks:

| ID | Fires on | Message (example) | Shown beside |
|---|---|---|---|
| `missing-alt` | An image field with no alt text and not `decorative`; an HTML or JSX `<img>` with no `alt` | "Describe this image, or mark it decorative." | The image field (Go to: its alt text), or the body |
| `alt-file-name` | Alt text that is a file name (`IMG_2041.jpg`, `DSC0042`, `photo-1.png`) | "Alt text looks like a file name." | Same |
| `alt-redundant` | Alt text starting "image of", "picture of", "photo of", "graphic of" | "Leave out “Image of”: screen readers already say it’s an image." | Same |
| `alt-too-long` | Alt text over 150 characters | "This alt text is 214 characters long. Keep it under 150 and put the rest in the text." | Same |
| `heading-skip` | A heading more than one level below the previous one, or a first heading below the start level | "Heading jumps from level 2 to level 4." | The body |
| `heading-extra-top` | A heading above the collection's start level (an `h1` when the title is the page's `h1`), or a second `h1` when the start is 1 | "The title is already the page’s main heading. Use level 2 here." | The body |
| `heading-empty` | A heading with no text | "This heading is empty." | The body |
| `link-vague` | Link text such as "click here", "here", "read more", "more", "learn more", "this link", or the bare address | "Link text should say where it goes." | The body, a Markdown field |
| `link-new-window` | `target="_blank"` with no "new tab" or "new window" in the link's text, `aria-label` or `title` | "Tell readers this opens in a new tab." | Same |
| `table-header` | An HTML or JSX table with no `<th>` (Markdown and Markdoc tables always have a header row in their syntax) | "Add a header row so screen readers can announce columns." | The body |
| `color-contrast` | A `fields.color({ contrast: 'text' })` value under 4.5:1 (`'large-text'` and `'graphic'`: 3:1) against any background the site declares | "Contrast 2.3:1 against Page, light is below 4.5:1." | The colour field |
| `tag-name-empty` | A Markdoc tag or declared MDX component whose required name attribute (`title`, `alt`, `label`, `aria-label`) is empty text. A missing one is already a validation error | "YouTube video needs a title." | The body |
| `fake-list` | A paragraph with two or more lines that start like list items (`-`, `*`, `•`, `1.`, `1)`, escaped or not) | "This looks like a list. Format it as one." | The body, a Markdown field |
| `pdf-untagged` | A PDF in a file field, or linked from the body, with no structure tags (`MarkInfo` / `StructTreeRoot`) | "This PDF isn’t tagged, so screen readers can’t read its structure. Consider an HTML page instead, or tag the PDF." | The file field, or the body |
| `pdf-no-title` | Such a PDF with no document title (Info or XMP) | "This PDF has no title, so screen readers announce its file name instead." | Same |
| `pdf-no-language` | Such a PDF with no language set | "This PDF doesn’t say what language it’s in." | Same |
| `video-captions` | A tag or component whose schema has a `captions` attribute, used without it or with it off | "Confirm this video has captions." | The body |

- Body checks read each format with the parser the site renders with: micromark (GFM, plus MDX) for `.md` and `.mdx`, Markdoc with Astro's tokenizer options for `.mdoc`. HTML (and lowercase JSX in MDX) is read with a small tag scanner over the block's own text. Each note carries the body offsets and line of what it's about, and a short subject ("Image “IMG_2041.jpg”", "Heading “A heading that skips level 3”").
- `fields.markdown()` values get the image, link and fake-list rules, not the heading rules.
- PDFs: core only turns facts (`tagged`, `title`, `language`) into notes. Reading the file is the studio's job, with PDF.js, loaded the first time an entry has a PDF to check, and its result cached per file version.
- Contrast is the WCAG 2.1 relative-luminance ratio, rounded down to one decimal for the message, so a value never reads as passing when it doesn't.

**Settings** (spec §6.18 names `a11y.blockPublishOn` a site setting):
- `vesper.config.ts`: `a11y: { blockPublishOn?: RuleId[]; backgrounds?: Record<string, string> }`. Unknown rule IDs warn when the config loads. With no backgrounds declared, contrast isn't checked, and the manifest warns once if a colour field asks for it.
- `collections.<name>.headingStart`: the level the body's top headings should have, 2 by default (the layout's `<h1>` is usually the title).
- `fields.color({ contrast: 'text' | 'large-text' | 'graphic' })` in `@vesper/astro/fields`; raw Zod: `.meta({ widget: 'color', widgetOptions: { contrast: 'text' } })`.
- The manifest gains `site.a11y` (`blockPublishOn`, `backgrounds`) and `presentation.headingStart`.

**Studio** (`packages/admin`):
- `a11y/useNotes.ts`: runs the core checks on the entry's values and body a moment after typing stops (the same 300 ms as body validation), then the PDF checks as their files load. Body checks load with the body checks' chunk; PDF.js loads on first use (`a11y/pdf.ts`, `pdfjs-dist/legacy`, worker through a Vite `?url` import, as the map's worker is).
- Beside each field: notes go under the field's help and error text, as "Accessibility note: …" in body text with a hairline warning border on the left, and are joined into the control's `aria-describedby`. A note inside a field (an image's alt text) shows under that field; Go to focuses the alt text.
- Beside the body: a list "Accessibility notes in the body" under the editor's help line. Each item names its subject and has a "Show" button that puts the cursor on that block in the writing view (or selects its text in the source view) and scrolls it into view.
- The top bar's status gains the count ("Draft · Saved just now", then a quiet text button "2 accessibility notes"). It opens the kit's `Drawer`, titled "Accessibility notes": one sentence that automated checks find some problems, not all (D19), then the notes in form order, grouped under their field's name, each with its message, why it matters, and "Go to field" (described by its note). Go to field closes the drawer and moves focus to the field, opening Details first when the field is there. The count sits outside the live status, so typing doesn't announce every change.
- **Publish gate.** With `blockPublishOn`, a note on a listed rule refuses the save the way a body the build would fail on is refused (Phase 2.5): Save stays focusable, the error summary takes focus and lists each blocking note with a link to its field, and the count reads "2 accessibility notes, 1 blocks saving". A disabled button would hide its own reason from keyboard users, and Ctrl+S would fail silently. The gate is checked in the studio; the dev API doesn't repeat it (the PDF rules need PDF.js, and the gate is a site policy rather than a file the build can't read).

**Build** (`packages/astro/src/integration/a11y.ts`):
- In `astro:build:done`, unless `vesper({ a11y: false })`: every HTML file in `dir` except Astro's redirect pages and `/admin` is loaded into jsdom (`runScripts: 'outside-only'`, the `elementFromPoint` shim), axe-core is run in it from one compiled script, and only the structure rules run: `lang` (`html-has-lang`, `html-lang-valid`, `valid-lang`, `html-xml-lang-mismatch`), `document-title`, landmarks (`landmark-*`, `region`, `bypass`), headings (`heading-order`, `page-has-heading-one`, `empty-heading`), images (`image-alt` and its relatives), form labels and names (`label`, `select-name`, `button-name`, `link-name`, `frame-title`, …), duplicate IDs (`duplicate-id`, `duplicate-id-aria`), basic ARIA (`aria-*` validity, required attributes, parents and children, hidden focus) and list and table structure. No colour or visual rules (layer 3). The full list is a constant, with the test that pins it.
- Each issue gets the same message style as layer 1 (a plain message and why for every rule in the list, in core), axe's impact as `error` (critical, serious) or `warning` (moderate, minor), the element's selector and a short HTML snippet.
- **Page to entry:** every built page's URL is matched to the entry whose URL pattern produces it, through `PageService` and `entryUrlKey`, the same code the studio's "View on site" and the redirects use (spec §6.15.1). Function-form URLs work because the build loads `vesper.config.ts`. Pages no entry produced (listings, the 404 page) are reported with `entry: null`. Each mapped page carries the entry's collection, id, file and its studio link (`<base>admin/#/c/<collection>/e/<id>`), for "fix in studio". This needs no runtime recording, so production `vesper:content` stays a plain re-export (spec §6.10, §6.11).
- `.vesper/a11y-report.json` in the project root, with a `.vesper/.gitignore` of `*` so it never reaches git by accident. It never goes into `dist/`: if `outDir` contains the project root's `.vesper` folder, the report isn't written and the build says why. No timestamps, so the same build writes the same bytes.
- The log says what was checked and found ("Accessibility: checked 35 pages, 2 issues on 1 page (1 error). Report: .vesper/a11y-report.json"). `vesper({ a11y: { failBuildOn: 'error' | 'warning' } })` fails the build when there's an issue at that level or above; off by default.

**Where each feature lives in the UI** (§10.4): notes sit under the field they're about, the body's under the body. The count is part of the top bar's status text, and the full list hides behind it, in a drawer. No new screen, no tabs, no coloured badges (the note's border is the warning token, the text says "Accessibility note"), no icon-only buttons, and the one primary button is still Save.

**Playground:**
- The fixture keeps every mistake it has, and gains what's missing: an HTML `<img>` with no `alt` (`missing-alt`; an empty Markdown alt is decorative, see the open questions), and `textColor` becomes `fields.color({ contrast: 'text' })`.
- `vesper.config.ts`: `a11y.backgrounds` with the site's two page backgrounds (`#ffffff` and `#12151f`).
- `.vesper/` joins `.gitignore`. The playground doesn't set `failBuildOn`, since its fixture page fails on purpose; the report lists it.

**Dependencies, each with its reason:**
- `axe-core` (MPL-2.0, used unmodified) in `@vesper/astro`: the rule engine the spec names, and the one the e2e suite already uses, so layer 2 and the browser checks agree.
- `jsdom` (MIT) in `@vesper/astro`: the DOM axe runs in at build, chosen above. Imported only inside `astro:build:done`.
- `pdfjs-dist` (Apache-2.0) in `@vesper/admin`: the PDF checks the spec names. Left external in the studio's build like MapLibre, and loaded only when a PDF is checked.

**Tests mapped to the "Done when" criteria:**
- **Every layer-1 rule fires on the playground's deliberately flawed fixtures, beside the right field:**
  - Core unit tests per rule, each with cases that must and must not fire, in all three formats.
  - A core test over the real fixture file and the playground's manifest: every one of the seventeen rule IDs fires, each on its field (`textColor`, `brochure`) or the body, at the right line. A real-content test runs the same checks over every other playground entry, which must have no notes (their pages already pass axe).
  - Admin jsdom tests: notes under the right field and joined to its control's description, the body list and Show, the count, the drawer and its Go to field, the refused save.
  - `e2e/studio/a11y.spec.ts` opens the fixture in Chromium and checks each rule's message beside its field, including both PDF notes from PDF.js.
- **The layer-2 report maps issues to entries:** unit tests for the page-to-entry mapping (directory and file formats, `base`, trailing slashes, unmapped pages, redirect pages); `packages/astro/test/a11y.integration.test.ts` builds a copy of the playground and checks the report: the fixture page's issues (`image-alt`, `heading-order`, `empty-heading`) under the `fixtures` entry with its file and studio link, a listing page with `entry: null`, no other issues; then builds again with `failBuildOn: 'error'` and expects the build to fail with the report written.
- **No report file appears in `dist/`:** the same test walks `dist/` for any `a11y-report` file or `.vesper` folder; the static e2e suite checks the playground build the same way and reads `apps/playground/.vesper/a11y-report.json`.
- **The notes drawer can be fully operated by keyboard and screen reader:** `a11y.spec.ts`, keys only: Tab to the count, Enter opens the drawer with focus inside, Tab through every Go to field, Enter on one lands focus on the field, Escape from a reopened drawer returns focus to the count; axe passes with the drawer open and with the refused-save summary. Manual keyboard pass in the browser pane. **A screen reader pass is Jeremy's**, as in earlier phases.

**Commits, in order:**
1. `docs`: this design, and Phase 2.6's CI run.
2. `feat(core)`: accessibility rules for entries: alt text, headings, links, tables, fake lists, tags, contrast and PDF facts.
3. `feat(core)`: the manifest's `site.a11y` and `headingStart`, and plain messages for the build's axe rules.
4. `feat(astro)`: `a11y` and `headingStart` in vesper.config.ts, and `fields.color({ contrast })`.
5. `feat(admin)`: accessibility notes beside each field and under the body.
6. `feat(admin)`: PDF checks with PDF.js, loaded on first use.
7. `feat(admin)`: the notes drawer from the top bar, and the publish gate.
8. `feat(astro)`: build checks with axe-core in jsdom, mapped to entries, into `.vesper/a11y-report.json`.
9. `feat(playground)`: fixture additions, declared backgrounds, `.vesper` ignored.
10. `test`: the build integration test and the e2e specs.
11. `docs`: decisions, READMEs and the Phase 2.8 outcome.

**Open, for Jeremy** (built with the recommendation, each easy to change):
- **What the publish gate does in local mode, where the button is Save.** (a) Refuse the save, as a body the build would fail on is refused (built: one rule in every mode, and the gate is opt-in); (b) warn only in local mode and block only where saving publishes (GitHub, cloud); (c) refuse with a "Save anyway" for local mode.
- **The DOM for axe at build.** (a) jsdom (built: matched Chromium on every page, never runs the page's scripts, axe's documented environment, already the repo's test DOM; 25 MB, about 100 ms a page); (b) happy-dom (also matched Chromium, about 60 ms a page and 1.6 s faster to load, 20 MB, but runs the page's inline scripts to load axe); (c) linkedom (can't run axe).
- **Where the per-collection heading start is set.** (a) `collections.<name>.headingStart` in vesper.config.ts, default 2 (built); (b) a site-wide `a11y.headingStart` with per-collection overrides; (c) a `.meta()` hint on the title field saying it's the page's `h1`.
- **PDF.js: lazy, and its weight.** (a) `pdfjs-dist`'s legacy build, loaded the first time a PDF is checked: 524 KB plus a 1,321 KB worker, minified, never in the first load (built); (b) the modern build (459 KB plus 1,264 KB) if the studio may require Chrome 140, Firefox 133 or Safari 18.2; (c) a small reader of Vesper's own for the three facts (a few KB, but a hand-written parser of an untrusted binary format, and the spec names PDF.js).
- **An empty alt in a body image.** Markdown has no "decorative" mark: `![](photo.jpg)` is `alt=""`, which is HTML's decorative image, and the studio's own image dialog writes exactly that for "Decorative image" (Phase 2). (a) Treat it as decorative, and flag images with no `alt` at all (HTML or JSX) and image fields (built); (b) note every empty alt, which also flags images marked decorative on purpose, with no way to clear the note; (c) add a decorative marker to the body syntax (only Markdoc and MDX could carry one).
- **Which colours are text, and where backgrounds are declared.** (a) `fields.color({ contrast })` per field and `a11y.backgrounds` in vesper.config.ts (built); (b) check every colour field at 3:1; (c) read the backgrounds from the site's CSS custom properties (fragile: values can be computed, themed or `light-dark()`).
- **Layer 2 runs by default.** The spec has the check run at every build, with only failing off by default. That adds jsdom (25 MB installed) and about 0.1 s a page (100 s for a thousand pages); `vesper({ a11y: false })` turns it off. Alternatives: off by default, or jsdom as an optional peer that the build asks for.
- **Docs links.** Each rule carries a docs slug, but no link is shown until the docs site exists (Phase 9) and has a domain (§13.1).
- Tier: none unclear. Spec §13.4 lists studio accessibility checks and build checks as free; layer 3 stays paid (Phase 8.5). Spec §13.10 (machine-suggested alt text) and §13.13 (scan engine) stay open and untouched.

**Not in this phase:**
- Layer 3: report uploads with `VESPER_BUILD_TOKEN`, history, full rendered scans, exports, the agency view (Phase 8.5).
- Dismissing a note: there's nowhere to store it in local mode yet. Notes go away when the content changes.
- Running the gate in the dev API, and layer 2 in `astro dev`.
- Broken-link checks of any kind (do-not-build list).

## Phase 2.7: Focal points, crops and `<Img>` (design)

Scope is spec §6.6.2 to §6.6.5 and the §11 Phase 2.7 entry. Body images keep Astro's own processing and get no focal point or crops in v1 (§6.6.5).

**What was found first** (DECISIONS.md, "Astro hands `position` to Sharp unchanged"), measured with real builds on Astro 7.4.0 and the fixture's 6.4.8, which agree:
- `position` and `fit` reach Sharp untouched, and Sharp takes only its own keywords. `"62% 35%"` and CSS-order `"top right"` fail the build (and are a 500 from `/_image` in dev). With `layout`, every `srcset` width sends `position` to Sharp.
- Astro's CSS for `data-astro-image-pos` covers keyword pairs only. An inline `object-position` style passes through and wins.
- A transform key Astro doesn't know (`crop`) reaches the service but isn't hashed, so two crops shared one file, and it leaked into the `<img>` as an attribute.
- Astro 7.4 can configure separate `build` and `runtime` services; `imageConfig.service` in `astro:assets` is the one for the current environment, on both majors.
- Sharp's `.rotate().extract()` rotates first, so a crop measured on the upright image (what browsers show) is cut correctly from an EXIF-rotated file.

**Geometry** (`packages/core/src/images/`, exported as `@vesper/core/images` and from the main entry; no dependencies, so the studio, the build and `<Img>` share it):
- Types: `FocalPoint { x, y }` and `CropRect { x, y, w, h }`, both 0–1 from the top left (§6.6.2); `ImageSize { width, height }`.
- `siteRatios(declared)`: the declared ratios plus the built-in `og` (1.91:1) unless the site redefines it. `ratioLabel(1.777…)` is "16:9" (the nearest fraction with a denominator up to 20, else "1.91:1").
- `focalCrop(size, ratio, focus)`: the largest rectangle of that ratio, centred on the focus (the centre when there's none), kept inside the image.
- `cropForRatio(value, name, ratio, size)` → `{ rect, custom }`: the stored crop for that ratio name, else the focal crop. A stored crop whose pixel shape no longer matches its ratio (the image was replaced) is trimmed to the ratio around its own centre.
- `pixelRect(rect, size)`: whole pixels, clamped, the one rounding rule the wrapper and the studio both use.
- `moveRect`, `scaleRect` (fixed ratio, around the centre or a corner), `clampRect`, `focusWithin(rect, focus)`, `objectPosition(focus)` ("62% 35%"), `sharpAnchor(rect)` (the nearest of Sharp's nine anchors, and the rectangle Sharp would cut there), `roundFocus` (two decimals: the 1% steps the control makes) and `roundRect` (four decimals).
- `imageValueOf(value)`: reads `focus` and `crops` defensively from an entry's value, ignoring anything malformed.

**Schema and config** (`packages/astro`, `packages/core`):
- `fields.image(image, { ratios? })` in `@vesper/astro/fields`, typed so `src` keeps Astro's `ImageMetadata`:
  `z.object({ src: image(), alt: z.string(), decorative: z.boolean().optional(), focus: z.object({ x, y }).optional(), crops: z.record(z.string(), rect).optional() })`, with the playground's existing refinement (alt text, or decorative with `alt: ""`), rectangles that stay inside the image, and `.meta({ widget: 'image', widgetOptions: { ratios } })`. The README shows the raw Zod.
- `vesper.config.ts` `images: { ratios, maxUploadEdge }` is checked when it loads: ratio names are words, values are positive numbers, `maxUploadEdge` is a whole number of pixels.
- The manifest gains `site.images` (`ratios` with `og` included, and `maxUploadEdge` when set), and a warning when an image field lists a ratio the site doesn't declare. The studio's upload hygiene starts using `maxUploadEdge` (it was fixed at 3000).

**The crop step** (`@vesper/astro/image-service`, `src/images/service.ts`): Astro's Sharp service with one more transform option, `crop` (a normalized rectangle):
- `propertiesToHash` adds `crop` to Astro's own list, so each crop gets its own file.
- `validateOptions` checks the rectangle (a plain-language error names the image) and drops it for SVG and GIF sources, which Sharp passes through or animates.
- `getURL` and `parseURL` carry it as `crop=x,y,w,h` on `/_image`, so dev crops too; `getHTMLAttributes` keeps it out of the page.
- `transform` cuts the rectangle out of the upright image (`rotate().extract()`), as a lossless PNG, then hands that to Astro's own Sharp transform for resizing and formats. Without `crop` it's Astro's transform, untouched.
- The integration registers it in `astro:config:setup` only where the site uses Astro's Sharp service (the flat form, or either target of Astro 7.4's `{ build, runtime }`), keeping the service's `config`. `vesper({ imageService: false })` turns it off. The build log says it's on and how to turn it off.
- `sharp` becomes an optional peer dependency of `@vesper/astro`: the wrapper loads the copy Astro already depends on, and a strict installer (pnpm) has to let it resolve.

**`<Img>`** (`@vesper/astro/components`: `components/Img.astro` and `getImg()`, shipped as source like the `/admin` page; the planning is `src/images/plan.ts`, exported as `@vesper/astro/images` so it's unit-tested and Node-loadable):
- `virtual:vesper/images` gives the site's ratios. Which service is active comes from `imageConfig.service.entrypoint`: Vesper's wrapper, Astro's Sharp, or anything else.
- `ratio` (a declared name or a number), or `width` and `height` together (a ratio of their own): the crop from `cropForRatio`. With the wrapper, Astro's `<Image>` (`<Picture>` when `formats` is given) gets the exact width and height plus `crop`. Without it, the same width and height (Astro's own server crop), `position` set to the nearest Sharp anchor when the service is Astro's Sharp, and nothing for other services. Either way the focal point, relative to what was cut, goes into `style` as `object-position`.
- Widths are capped at the crop's own pixel width, as Astro caps them at the original's, so a 720-pixel crop is never labelled 1440w. With a `layout` and no `widths`, the widths are worked out the way Astro does from its breakpoints, against the crop's width.
- No ratio and no fixed size (fluid layouts): the original, no server crop, the focal point as `object-position`.
- `art={{ base: 'square', '(min-width: 48rem)': 'wide' }}`: a `<picture>` built with `getImage()`. For each breakpoint in the order given, one `<source media>` per format (`formats`, default WebP) with that ratio's own crop, `srcset`, `sizes`, and its own `width` and `height`; then the base ratio's sources without `media`, then the `<img>` in the fallback format (the original's for JPEG and GIF, else PNG, as Astro's `<Picture>` chooses).
- Always: `alt` from the field, `alt=""` when `decorative`. Every other Astro prop passes through. A ratio name the site doesn't declare fails the build with the declared names listed.
- `getImg(props)`: the same crop for one image, returning Astro's `getImage()` result (for `og:image` and the like).

**Studio** (`packages/admin`, `packages/ui`):
- The image field shows its image, the alt text and one more control: a "Focal point & crops" disclosure (the kit's `Disclosure`), only for fields that store `focus` or `crops`, and only once an image is chosen (§6.6.4 "calm by default"). A plain `image()` field never shows it.
- Focal point (`widgets/focal-point.tsx`): the image is one button, named "Focal point" and described by its position ("62% across, 35% down") and how to move it. A click or tap sets the point, and the marker can be dragged. With focus on it, the arrow keys move the point 1%, Shift+arrows 10%. Beside it, "Across (%)" and "Down (%)" number fields (0–100) set it without seeing or pointing. Each keyboard or pointer move is announced in a polite live region: "Focal point 62% across, 35% down." "Use the center" removes `focus`.
- Crop previews (`widgets/crops.tsx`): a strip of small figures, one per ratio the field lists (or every site ratio), each the image cropped by CSS from the same `cropForRatio`, captioned with its name and ratio ("Wide · 16:9") and "Custom crop" in text when overridden. They follow the focal point live. Each has an "Adjust crop" button (named "Adjust crop for Wide").
- The crop dialog (the kit's `Dialog`, in a new wide size): the image with a fixed-ratio crop box over it, and the area outside dimmed. Drag the box to move it, drag a corner to resize it. The box is one focusable element (`role="application"`, named "Crop box for Wide (16:9)" and described by its keys), so screen readers pass the arrow keys through: arrows move it 1%, Shift+arrows resize it (Shift+→ and Shift+↓ grow, Shift+← and Shift+↑ shrink, around its centre), Enter applies, Escape cancels. Moves are announced: "Crop 40% from the left, 10% from the top, 45% of the width." Buttons: "Reset to focal point" (only when the ratio has a custom crop; it removes the override and closes), "Cancel", and "Apply crop" (the dialog's one primary). Applying an untouched box over a ratio with no override writes nothing.
- Values: focal points with two decimals, crops with four. Removing the last crop removes `crops`. Nothing but the entry is written: the image file is never touched.

**Where each feature lives in the UI** (§10.4): inside the image field, behind the "Focal point & crops" disclosure. The crop tools hide behind each preview's "Adjust crop" button, in a dialog. No new screens, panels or navigation.

**Playground:**
- `vesper.config.ts`: `images.ratios` `{ wide: 16/9, square: 1, portrait: 4/5 }` (plus the built-in `og`).
- The blog hero becomes `fields.image(image, { ratios: ['wide', 'square'] })`; its stored focal point and square crop stay as they are.
- A post's page shows the hero art-directed (`base: 'square'`, `wide` from 48rem), with `og:image` from `getImg({ ratio: 'og' })`. The blog list shows square thumbnails (`ratio`).
- `src/pages/images.astro` ("Image crops") shows every post's hero at every site ratio, art-directed and fluid, for the e2e checks and for people.

**Dependencies:** none new. `sharp` is already Astro's own (optional) dependency; it's declared as an optional peer for the reason above.

**Tests mapped to the "Done when" criteria:**
- **The playground hero renders correct crops at every declared ratio; a manual crop overrides the focal point only for its own ratio:**
  - `images/*.test.ts` in core: focal crops at every edge and ratio, trimming a stale crop, `cropForRatio` using the square crop for `square` only.
  - `plan.test.ts`: what `<Img>` asks Astro for in each mode.
  - The static e2e reads `/images/` from the built playground, and for every ratio compares the served file, pixel by pixel, with the same rectangle cut independently from the original by Sharp in the test; `square` must match the stored crop and differ from the focal one, every other ratio the focal crop.
- **Art direction outputs a valid `<picture>` with per-breakpoint sources, each correctly cropped:** `plan.test.ts` for the structure; the static e2e checks the post page's `<picture>` (each `<source>` has `media`, `type`, `srcset` and its ratio's `width` and `height`, `<img>` last with the alt text), compares every source's files with their crops, and loads the page at 375 and 1280 pixels wide to see the browser pick the square and the wide crop.
- **The focal point and crop box can be set fully by keyboard, with values announced:** jsdom tests (`focal-point.test.tsx`, `crops.test.tsx`) for every key, the number fields, the announcements and axe; `e2e/studio/images.spec.ts` does the whole flow with keys only in Chromium, saves, checks the file, and runs axe with the disclosure and the dialog open; a manual keyboard pass is noted.
- **Original image files are byte-identical before and after any focal-point or crop edit:** `images.spec.ts` hashes every file under the site's `src/assets` before and after setting a focal point, applying a crop and resetting one, and requires the entry to be the only file changed. The integration test hashes the playground's originals before and after a build.
- **Disabling the wrapper leaves the site building, with crops falling back to Astro's server crop plus focal `object-position`:** `packages/astro/test/images.integration.test.ts` builds a copy of the playground with `vesper({ imageService: false })`: the build passes, every ratio's file has the ratio's exact size and Sharp's anchored crop, each `<img>` carries the `object-position` style, and no `crop` reaches the page. `register.test.ts` covers when the wrapper is installed (Astro's Sharp in either form, not a custom or host service, not when turned off). The same test builds the Astro 6 fixture, which gains a hero image and `<Img>`, with the wrapper on.

**Commits, in order:**
1. `docs`: this design.
2. `feat(core)`: image ratios and crop geometry, as `@vesper/core/images`.
3. `feat(core)`: the manifest's `site.images`, and a warning for undeclared ratios.
4. `feat(astro)`: `fields.image()` and `images` in `vesper.config.ts`.
5. `feat(astro)`: the crop step around Astro's Sharp service, registered when the site uses it.
6. `feat(astro)`: `<Img>` and `getImg()`.
7. `feat(ui)`: a wide dialog.
8. `feat(admin)`: the focal point control, and `maxUploadEdge` for uploads.
9. `feat(admin)`: crop previews and the crop dialog.
10. `feat(playground)`: the blog hero on `fields.image()`, rendered with `<Img>`.
11. `test`: the fallback build, the Astro 6 fixture, and the e2e specs.
12. `docs`: decisions, READMEs and the Phase 2.7 outcome.

**Not in this phase:**
- Focal points and crops for body images (§6.6.5: not in v1).
- R2 media (cloud, §6.6.1). `<Img>` takes a remote `src` as Astro does, with `object-position` only.
- Manual crops through a host's image service: `<Img>` falls back as described, and the docs say so (§6.6.5).

## Phase 2.6: URLs, hierarchy and redirects (design)

Scope is spec §6.15 and the §11 Phase 2.6 entry. Confirmed before starting (DECISIONS.md, 2026-10-18): `vesper.redirects.yaml` sits at the site root, and `maxDepth` is optional with no default.

**What was found first** (measured on Astro 7.4, React Aria Components 1.22 and the playground):
- Astro's glob loader drops a trailing `/index` from IDs but keeps a top-level `index.md` as `index`. Vesper's `defaultEntryId` already matches, so `:path` only has to turn `index` into the root.
- `astro:routes:resolved` (Astro 6 and 7) gives every route with its `pattern`, `patternRegex`, `params`, `type`, `origin` and `entrypoint`, before the build starts and when dev starts. That's enough for the route check and the static-route collision check.
- Astro's static redirect page is a meta refresh (`redirectTemplate`): no delay for 301, two seconds for 302. On the plain static host, `/old` first gets the host's own slash redirect to `/old/`, then the meta refresh. So redirect targets must be written in the page's canonical form (`/academics/nursing/`), or every redirect gains a second hop.
- The YAML writer appends flow maps shaped like their neighbours and writes new dates date-only, so redirects can go through `writeDataFile`. Inserting into the middle of a scalar sequence (reordering `_order.yaml`) replaced the whole sequence and dropped the file's leading comment: fixed in the writer, not worked around.
- React Aria's `Tree` is a single-column `treegrid` with `aria-level`, `aria-expanded`, arrow keys, Home/End, type-ahead, rows with interactive content, and keyboard-accessible drag and drop. WAI-ARIA's own guidance is a treegrid when rows hold buttons (each page has a "…" menu), so that's what the outline is.
- Vercel reads `vercel.json` before the build runs, so redirects merged into it at build time would never apply. They're merged when the studio writes the redirects file instead.

**URLs** (`packages/core/src/urls/`, exported as `@vesper/core/urls`: no Markdoc, no YAML, small enough for a site's own pages):
- `pattern.ts`:
  - `UrlSettings` (`base`, `trailingSlash`, `buildFormat`, `timeZone`) come from Astro's config and `vesper.config.ts`, into the manifest's `site.urls`.
  - `expandUrlPattern(pattern, { id, data })` handles `:id`, `:path`, `:slug`, `:<field>` and `:<dateField>|yyyy|mm|dd`. Date parts are read in the site's time zone, else UTC, so the studio, dev and build agree.
  - `formatUrl(path, settings)` adds `base` and the trailing slash Astro's settings imply (`always` or `never`; `ignore` follows `build.format`). `urlKey(url, settings)` is the comparable form: no base, query, hash or trailing slash.
  - The function form `url: (entry) => string` runs where vesper.config.ts is loaded (dev API, build, `vesper:content`). In the studio's own bundle it loads lazily, as custom widgets do.
- `tree.ts`: `buildTree(entries, orders)`. Folders are the hierarchy and `foo/index` is foo's section page. A folder without one is still a node (no entry, no URL), so the studio can flag it. Children follow `_order.yaml` first, then unlisted ones by title (`Intl.Collator('en', { numeric: true })`, the same everywhere). Also `childrenOf`, `breadcrumbsOf` and `pathDepth`.
- `redirects.ts`: `cleanRedirects(list, pages)`, run every time the file is written and at every build:
  - loops are removed (self-redirects, cycles, and chains that run into a cycle);
  - chains collapse (A→B→C becomes A→C); the result is temporary if any hop was;
  - a redirect whose `from` is now a real page is dropped, with a warning: the page wins;
  - a repeated `from` keeps the later entry;
  - a `to` that's neither a page, a redirect nor an external URL is flagged (warning), never removed.
- `hosts.ts`: rules per host, as pure functions:
  - `_redirects` for Netlify (forced `301!`) and Cloudflare Pages;
  - `.htaccess` `RedirectMatch` lines between `# BEGIN vesper` / `# END vesper`;
  - nginx `location =` blocks;
  - Vercel `redirects` entries.
  - `mergeMarkedBlock` replaces Vesper's block and leaves the rest of the file alone.
- `csv.ts`: `parseRedirectsCsv(text)`. It reads `from,to[,status]` with or without a header, the WordPress Redirection plugin's export (`source,target,regex,code,…`) and Drupal's Redirect import (`source,destination,…,status_code`). It turns absolute old-site URLs into paths, skips regex rows with a reason, and reports each problem row in words.

**Content operations** (`packages/core/src/studio/`):
- `order.ts`: reads `_order.yaml` and writes it through `writeDataFile`, so comments survive.
- `links.ts`: `rewriteLinks(file, moves)` finds links to the old URLs and changes only those bytes:
  - Markdown links, images and reference definitions (micromark positions; `.mdoc` bodies use the same Markdown reader for links);
  - Markdoc tag attributes and MDX JSX attributes whose string value is an old URL (the tag scanners' spans, `editMarkdocTag` / `editJsxTag`);
  - frontmatter fields with `widget: 'url'`, through `writeEntryFile`.
  - Old URLs match with or without `base`, a trailing slash, `?query` or `#hash`. The replacement keeps the original's shape.
  - Moved files keep pointing at the same files: relative links, images and `{% partial file %}` paths to anything outside the moved folder are recomputed from the new location.
- `pages.ts`: `PageService`, beside `ContentService` (which gains `locateEntries`):
  - `pages()` lists every entry in a collection with a URL (`collection`, `id`, `title`, `url`), for the link picker and duplicate checks;
  - `tree(collection)`;
  - `planMove({ collection, id, parent, slug })` validates and returns the whole change set with a summary (pages, links, redirects);
  - `move` commits that plan with expected versions;
  - `reorder` writes the parent's `_order.yaml`;
  - `createSection(folder)` creates the missing section page;
  - `redirects()` / `saveRedirects()` read the file, and write it after cleanup.
- `ContentService` changes: creating an entry under a parent (a leaf parent becomes `parent/index.md` in the same change set, at the same URL), and deleting a page also removes its `_order.yaml` line.

**Validation before a move, create or rename**, each refused in words before anything is written:
- a valid slug;
- not onto its own subtree;
- no duplicate URL in any collection;
- no static route from `src/pages`, e.g. "/contact/ is already a page on this site that isn't edited here (src/pages/contact.astro). Choose a different address.";
- no reserved path (`/admin`, `/_vesper`);
- `maxDepth`;
- not a page whose frontmatter sets its own `slug` (its ID doesn't follow its file).

**One move is one change set:**
- a `move` for every file in the subtree (pages, `_order.yaml`, images, `_` files), with new bytes where links or relative paths changed;
- `put`s for the two parents' `_order.yaml`;
- `vesper.redirects.yaml` with a redirect for every page in the subtree, then cleanup;
- every other file whose links changed;
- `vercel.json` when the site has one.

**Integration** (`packages/astro`):
- `vesper.config.ts`:
  - `collections.<name>.maxDepth`;
  - top-level `redirects: { native?: ('netlify' | 'cloudflare' | 'vercel' | 'apache' | 'nginx')[] }`.
- The manifest gains `site.urls` and `presentation.maxDepth`. A warning when a collection's pattern would pick up `_order.yaml`.
- `integration/routes.ts`, from `astro:routes:resolved`:
  - the static routes (no params, from the project), for collisions;
  - for each collection with a URL, the route that renders its entries, recorded in the manifest (`route`), or a warning naming the URLs no route can produce;
  - a hint, logged in dev, when a flat collection has nested folders (spec: "suggests `tree: true`").
- `integration/redirects.ts`, at build:
  - reads the file, cleans it against every content URL and static route, and merges the result into Astro's `redirects` (without overriding the site's own);
  - native rules are on when detected (`NETLIFY`, `CF_PAGES`, `VERCEL`) or set in `redirects.native`. `astro:build:done` writes `_redirects`, `.htaccess` or `_vesper/nginx-redirects.conf` into `dist`. URLs a native rule covers get no HTML page; Vercel's are covered only when `vercel.json` already holds them;
  - `_vesper/redirects.json` (the cleaned list) is written for the S3 deploy template (Phase 9) and the e2e test;
  - warns about redirects to URLs that no longer exist.
- `vesper:content` gains `getTree`, `getChildren`, `getBreadcrumbs` and `getUrl` (`runtime/helpers.ts` over `@vesper/core/urls`). The module embeds the URL settings, each collection's pattern and its parsed `_order.yaml` files, and imports vesper.config.ts only for function-form URLs. In dev, a change to an `_order.yaml` invalidates the module and reloads site pages, not the studio. The same code runs in dev and build.
- Dev API:
  - `GET pages`, `GET tree`;
  - `POST move` (`dryRun` gives the plan for the confirmation), `POST reorder`, `POST section`;
  - `GET redirects`, `PUT redirects` (with the file's version);
  - `PUT entry` accepts `parent` for a new child page.

**Studio** (`packages/admin`, `packages/ui`):
- `ui`: `Tree`, a styled wrapper of React Aria's Tree, plus a file-picking button for CSV.
- `screens/PageTree.tsx` replaces the flat list for `tree: true` collections (spec §6.15.2, §10.3):
  - one row per page: title, muted path, status in words ("No section page", "Draft");
  - collapsed beyond the first level;
  - Enter opens the page; arrows, Home/End and type-ahead come from React Aria;
  - each row's "…" menu: Add child page, Move to…, Move up, Move down, Create section page (folders without one), Delete;
  - Alt+↑/↓ move the focused page, as blocks do in the body editor;
  - drag and drop (React Aria's, with its keyboard mode) is offered on top and never needed;
  - moves are announced politely: "Nursing moved under Academics, position 1 of 3."
- `MoveDialog`: a searchable parent picker (React Aria's ComboBox), the page's address, then a plain-language confirmation from the dry run: "Move Nursing and its 3 pages to the top level? 4 links on other pages will be updated, and visitors to the old addresses will be sent to the new ones." Refusals show in the dialog in words.
- `screens/Redirects.tsx`, reached from the top bar's Site menu (beside Media):
  - a table (From, To, Kind as words: Permanent or Temporary, Reason, Added) with one search box;
  - "Add redirect" is the one primary action; edit and delete sit in each row's "…" menu;
  - "Import from CSV…" opens a dialog that previews what will be added, replaced or skipped and why, before anything is written.
- Link picker: the body editor's link dialog and URL fields search pages by title (React Aria's ComboBox, custom values allowed) and insert the page's current path. A field whose schema requires a full URL (`z.url()`) gets the site's address in front when Astro's `site` is set, and no picker otherwise.
- "View on site" uses the shared URL code instead of the editor's own token replacement.

**Where each feature lives in the UI** (spec §10.4): the outline replaces the entry list for tree collections. Page actions hide behind each row's "…" menu. Redirects sit behind the Site menu. CSV import hides behind a secondary button on the Redirects screen. The link picker is inside the existing link dialog and URL fields.

**Playground:**
- `src/lib/pages.ts` gives way to the helpers. Section pages list their children with `getChildren`, and breadcrumbs come from `getBreadcrumbs`.
- `src/pages/site-tree.json.ts` prints the helpers' output for the parity test.
- Internal links are added so a move has something to rewrite: Markdown links in `.md`, `.mdx` and `.mdoc` bodies, and an event's `unpublishRedirect` (a URL field).

**Dependencies:** none new. React Aria (Tree, ComboBox, drag and drop), micromark/mdast, Markdoc, `yaml` and `jsonc-parser` are already in.

**Tests mapped to the "Done when" criteria:**
- **Moving a playground section with descendants produces one change set with the moved files, the updated `_order.yaml` files, a redirect for every old URL and every internal link updated:**
  - `pages.test.ts` moves Nursing (four pages) over a memory copy of the playground through a storage adapter that records commits. It asserts exactly one commit and its exact contents: each `move`, both `_order.yaml` files, the redirects file (four new entries and the old chain collapsed onto the new URL), and each rewritten link, byte for byte.
  - `links.test.ts` covers every link form.
  - `e2e/studio/tree.spec.ts` does the same move by keyboard and checks the files on disk.
- **The built site serves every old URL as a redirect to the new one, with no chains:**
  - `packages/astro/test/redirects.integration.test.ts` copies the playground, moves Nursing through `PageService` and `LocalStorage` as the studio does, runs `astro build`, and serves `dist/` with `scripts/static-server.mjs`. Every old URL (the four moved pages and the file's original chain) must reach its final page in one Vesper hop, and the target must be a real page, not another redirect page.
  - The static e2e suite checks the same for the committed playground's redirects, from `_vesper/redirects.json`.
  - Unit tests cover the cleanup and every host's rules.
- **The tree can be fully operated by keyboard and screen reader: expand, collapse, move, reorder, add a child:**
  - `tree.spec.ts` in Chromium, keys only: arrows to expand and collapse, type-ahead, the "…" menu, Move up/down and Alt+↑/↓ (with the live-region announcement), Move to… through the combobox, Add child page, Create section page.
  - axe runs with the outline, the menu and each dialog open.
  - `PageTree.test.tsx` covers the same in jsdom. A manual pass with a screen reader is noted.
- **A path colliding with a static route in `src/pages` is blocked with a plain-language message:**
  - `pages.test.ts`: moving, renaming or creating `contact` is refused with the message, and nothing is written;
  - `routes.test.ts` derives the static routes from `astro:routes:resolved` data;
  - `tree.spec.ts` tries to rename a page to "contact" in the studio and sees the message.
- **`getTree()`, `getChildren()`, `getBreadcrumbs()` and `getUrl()` return identical results in dev and in a production build:**
  - `helpers.test.ts` unit-tests the runtime;
  - an e2e test fetches `/site-tree.json` from the static build (port 4400) and from `astro dev` (port 4401) and requires identical JSON;
  - the static e2e also checks the rendered breadcrumbs on a four-level page.

**Commits, in order:**
1. `docs`: this design.
2. `fix(core)`: keep comments when a scalar sequence gains or loses items in the middle.
3. `feat(core)`: URL patterns and site URL settings, as `@vesper/core/urls`.
4. `feat(core)`: page trees and `_order.yaml`.
5. `feat(core)`: redirect cleanup, per-host rules and CSV import.
6. `feat(core)`: rewrite links to moved pages, and relative paths in moved files.
7. `feat(core)`: `PageService`: tree, reorder, child and section pages, moves as one change set, the redirects file.
8. `feat(astro)`: config, manifest URL settings, the route check and the page API.
9. `feat(astro)`: redirects at build, with native rules per host.
10. `feat(astro)`: `getTree`, `getChildren`, `getBreadcrumbs` and `getUrl`; the playground uses them.
11. `feat(ui)`: `Tree` and a file button.
12. `feat(admin)`: the page outline with moves, reordering, child and section pages.
13. `feat(admin)`: the Redirects screen with CSV import.
14. `feat(admin)`: the link picker.
15. `test`: the move-and-build integration test and the e2e specs.
16. `docs`: decisions, READMEs and the Phase 2.6 outcome.

**Not in this phase:**
- **Edit grants on both ends of a move** (spec §6.15.4) are cloud roles, Phase 4.
- **The S3 redirect metadata** is the deploy template's job (Phase 9). `_vesper/redirects.json` is its input.
- **The optional build check for internal links** (§6.15.6) overlaps "broken-link checks" on the do-not-build list. It isn't built: a question for Jeremy.
- **Redirects aren't served by `astro dev`.** Merging them into Astro's config there would restart the dev server on every move.

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
| 2.6 URLs/tree/redirects | Confirmed 2026-10-18: the redirects file at the site root; no default `maxDepth` (DECISIONS.md) | URL patterns, route check, tree, `_order.yaml`, subtree moves as one ChangeSet, redirect cleanup and per-host output, link rewriting, site helpers |
| 2.7 Images | Start by verifying how Astro forwards `position`/`fit` | `fields.image`, focal point and crops, `<Img>`, Sharp wrapper |
| **2.8 A11y checks** (new) | — (design above; its product calls are listed for Jeremy there) | layer-1 studio rules and notes drawer; publish gate; layer-2 axe at `astro:build:done` writing `.vesper/a11y-report.json`, never into `dist` |
| **2.9 Search** (new) | Pagefind Component UI accessibility audit | Pagefind Node API index into `dist/_vesper/search/`; `<Search>`; `/search`; `opensearch.xml`; wasm MIME type on the static test host |
| **Studio design pass** (added 2026-10-18) | Jeremy reviews the visual direction first (screens, references, what feels off) | One visual pass over every studio screen once local mode is complete, inside the §10.4 budget: type scale, spacing and density, empty and loading states, the top bar, lists, the editor column, dialogs, light and dark. Before Phase 3, so GitHub mode and the Phase 4 dashboard build on the result instead of being restyled later. Phase 9 keeps final polish. |
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

