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
| Studio design pass | Done (2026-10-18), ahead of 2.9. CI green on GitHub (run 39169607328). See "Studio design pass: outcome" below. |
| 2.9 Site search | Done (2026-10-19). CI green on GitHub (run 39264241554); Jeremy's screen reader pass is open. See "Phase 2.9: outcome" below. |
| 3 GitHub mode | Done (2026-10-19). CI green on GitHub (run 39287685831), and the real-world check passed on GitHub and Cloudflare Pages; Jeremy's screen reader pass is open. See "Phase 3: outcome" below. |
| 4 onward | Roadmap below |

## Calls of 2026-10-19

Jeremy took the recommendation on every open item on 2026-10-19: the earlier phases' "Open, for Jeremy" lists, the Phase 2.9 calls and spec §13. The spec's §13 records the product calls, and DECISIONS.md the reasons. What changes in the code:

| Item | Call | Work |
|---|---|---|
| Unknown Markdoc tags (2.5) | Block in the dev API, which has the site's whole config; keep warning in the browser | Changed |
| Publish gate in local mode (2.8) | Refuse, with "Save anyway" in local mode only | Changed |
| Lowercase site name (design pass) | Lowercase only Vesper's own wordmark; a site's name shows as written | Changed |
| React 18 sites (2) | Require React 19, with a plain message at build when the site has 18 | Changed |
| Internal-link build check (2.6) | Not built | None |
| HEIC outside Safari (2) | Kept for launch; `heic-to` as a separate chunk only if editors ask | None |
| Vercel redirects, the outline's toggle, `role="application"`, `sharp` as a peer, jsdom, heading start, PDF.js legacy, empty alt, colours, layer 2 on, 93% glass, body headings | As built | None |
| Custom Markdoc validators in GitHub mode (2.5) | The site's build is the last check | Phase 3 |
| Free OAuth relay | The cloud runs one, and the template stays | Phase 3, needs the domain |
| Phase 2.9 calls 1 to 10 and the smaller defaults | All (a), as recommended | Phase 2.9 |
| Filing the audit's findings with Pagefind | Yes, once Jeremy's screen reader Part A confirms findings 1 and 2; posted only with his OK | Drafted in 2.9 |

Still Jeremy's: claim the `@vesper` npm org, register the domain, and the screen reader passes (2.6, 2.7, 2.8, the design pass, 2.9's Part B, then 3).

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

**Open, for Jeremy** (decided 2026-10-19; see "Calls of 2026-10-19"):
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

**Open, for Jeremy** (decided 2026-10-19; see "Calls of 2026-10-19"):
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

**Open, for Jeremy** (decided 2026-10-19; see "Calls of 2026-10-19"):
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

**Open, for Jeremy** (decided 2026-10-19; see "Calls of 2026-10-19"):
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

**Open, for Jeremy** (each built with the recommendation; decided 2026-10-19, see "Calls of 2026-10-19"):
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

## Studio design pass: outcome

Every studio screen now follows Vesper's design system (Pine) in both themes. Jeremy's three calls are in DECISIONS.md, "Studio design": the accent is Pine and fixed, four named glows and glass on what floats, and Figtree self-hosted. At the checkpoint he approved the Details drawer for wide screens.

| Criterion | Evidence |
|---|---|
| Every studio screen follows the design system, light and dark | Before and after screenshots at 1280px, light and dark, on the 4402 preview: Home, the entry list, the page outline, the blog editor, a Markdoc body with blocks, the accessibility fixture, a location (map, colour, switch, custom widget), an event (date-times, link picker), site settings (palette, repeater), the media browser, Redirects, NotFound, the Content menu, the delete, leave, link and crop dialogs, the media picker, the notes drawer and the Details drawer; Home and the editor at 360px too. The checkpoint comparison is a private Artifact for Jeremy. Tokens, the kit and every screen use the type scale, radii, glass, glows and afterglow; Unavailable gets the afterglow without the top bar. |
| Contrast, both themes | `npm run a11y:contrast`: 39 pairs in each theme. New pairs cover text on the top bar's glass and on overlays' glass, composited over black and over white, and on the afterglow at its brightest. The overlays' fill went from 88% to 93% for that (DECISIONS.md). Script tests cover the compositing. |
| The budget test, with the new allowances only | `budget.test.ts`: shadows are `overlay`, `glow-accent`, `glow-selected`, `glass-edge` and `glass-overlay`, each only in its named file; `tokens.css` declares exactly those; rings only as the focus halo; no arbitrary colours, sizes or radii; spacing only from the scale; every `outline-2` drawn solid. |
| Typecheck, lint, format, unit tests | All pass. Vitest: 4,081 tests in 93 files (unit, corpus and integration). New unit tests: the Details drawer on a wide screen (opens from the bar, axe, focus back on Escape; the problem count; a summary link opens it at the field). |
| `npm run e2e`, axe on every screen | 90 passed, static and studio (88 before this pass). New: axe over Home, the list, the outline, the editor, Media and Redirects in the dark theme; Details as a drawer by keyboard (axe with it open, Escape returns focus) and, at 800px, as the closing disclosure. No selectors changed: the markup kept its roles and names. |
| `check:dist`, with the font in `dist/studio.css` | 11 entry points load from `dist/`. `dist/studio.css` holds both Figtree files as `data:font/woff2` URLs; the only address in it is Tailwind's licence comment, so `/admin` requests nothing from Google or a CDN. |
| `astro check` | The playground: 0 errors, 0 warnings, 0 hints. |
| CI | Green on GitHub (run 39169607328): every job, the Windows tests and the Astro 6 fixture included. |
| 200% zoom, 320px, forced colours, keyboard | See below. |

**Manual checks**, in Chromium (Playwright) against the 4402 preview, over eleven screens:
- **320px wide:** no screen scrolls sideways. The check found the entry list (393px) and Redirects (677px) did; each table now scrolls inside its own container.
- **200% zoom** (a 640px viewport at twice the scale): no screen scrolls sideways; Details is the closing section, as on any screen under 1100px.
- **Forced colours** (Chromium's emulation): overlays and the top bar fall back to Canvas with a CanvasText border; every button keeps an edge through a transparent hairline; focus outlines show; the switch's thumb and the radio's dot take a system colour. Found by this check: primary, quiet and danger buttons read as plain text before.
- **Keyboard**, real key presses with each focused element's computed outline logged: the top bar's Content and Site menus (Enter, arrows, Escape back to the trigger, Enter to navigate), the list's controls and grid, the editor's fields, the Details drawer (Enter opens it with focus inside, Escape returns to the button), the body (the frame rings while the text has focus; Escape moves to the toolbar; arrows move along it), and the notes drawer (Enter, Tab to Close and Go to field, Escape back to the count). Every focused control draws the 2px focus outline with the halo outside it; menu items and list options draw it inside. The app's browser pane started focus partway down the page, so the walkthrough was recorded with Playwright instead.

**Found while building, each fixed in its own commit:**
- **The focus outline wasn't drawn on kit controls** (since Phase 2). Tailwind 4's `outline-none` sets the style variable `outline-2` reuses, so the ring had a width and no style. Found by the keyboard walkthrough; axe doesn't check it. Every `outline-2` now has `outline-solid`, and the budget test holds it (DECISIONS.md).
- **Transitions held back focus.** After Shift+F10 (a click from code, which React Aria treats like a screen reader's), React Aria waited for running transitions before focusing the menu, and with reduced motion it never did. Found by the outline's e2e tests. Focus rings and chevrons no longer transition, and reduced motion turns transitions off (DECISIONS.md).
- A select showed its option's tick inside the closed field; tables overflowed at 320px; buttons had no edge in forced colours; an editor with no title field set its heading outside the column; and the secondary button briefly lost its border to the forced-colours hairline (two border colours on one element resolve by Tailwind's order, not the class string's).

**Size.** For a site installing `@vesper/admin` from npm, `dist/studio.css` goes from 30,484 to 83,096 bytes (6,665 to 32,518 gzipped): the two latin Figtree files, 22,928 bytes as woff2, are inlined as base64, and the rest is the new styles. In this workspace's playground build the fonts are separate files (11,384 and 11,544 bytes, fetched once, from the site), and the admin CSS goes from 29,470 to 49,115 bytes (6,601 to 8,866 gzipped). The studio's JavaScript grows only by the drawer, the media query and the save pulse: `studio.js` from 71,548 to 74,254 bytes.

**Vesper's mark.** After the checkpoint Jeremy chose the refined "Launch" mark (DECISIONS.md): it's `/admin`'s favicon, an inline SVG with a dark variant, and sits at 20px before the site's name in the top bar, hidden from screen readers so the home link keeps the site's name. Tests: the kit draws the small cut at 24px and below, the home link's name is the site's alone, and the static build's `/admin` carries the inline favicon.

**The 2.8 follow-up (body headings in the page's outline):** they stay real headings, and the body is now a landmark named "Body", so screen readers say where a heading belongs (DECISIONS.md, with the rejected alternatives).

**Commits:** twenty-one, from the decisions (5398cf6) to Vesper's mark, its record and its narrow-screen fix. The checkpoint's batch came first (tokens and kit, the font, the screens, the budget test), then the drawer, each remaining group of screens, the fixes above and the tests.

**Open, for Jeremy** (decided 2026-10-19; see "Calls of 2026-10-19"):
- **The lowercase site name.** Built as asked, with CSS, so screen readers read the name as written. It also lowercases a site that names itself ("Highlands College" shows as "highlands college"). Keep, or lowercase only Vesper's own wordmark?
- **93% glass on overlays** instead of the design system's 88% (above).
- **Body headings:** confirm keeping them as headings in a "Body" region, or prefer isolating the editor (an iframe; not cheap).
- **A screen reader pass** of the Details drawer, the menus' inset focus and the "Body" region, with the earlier phases' items.
- The 2.8 product calls are untouched and still open, including the publish gate's "Save anyway"; the editor's bar has room for it beside Save.

**Not built** (the design system shows them; listed in "Studio design pass (plan)"): the ⌘K palette, site switcher and user menu; the Preview toggle; history, duplicate and copy link; a studio light/dark switch; the home greeting and sign-in; shortcuts in menus; choosing an accent. Also not done: the toolbar's "More" menu for overflow (it wraps instead), a spinner on a pending button, tags inside the combobox's field, and the 180ms chevron rotation (dropped, see above).

**Follow-ups noted, not blocking:**
- ~~In `astro dev` (React's development build) the first Tab on a fresh load starts after the screen's heading.~~ Fixed (de40775): the navigation count ignores StrictMode's second run, with a test in StrictMode.
- The overlays' 93% fill makes the glass subtler than the design system's previews; if Jeremy wants it lighter, the contrast check shows exactly what fails below 93%.

### Icons (after the design pass, 2026-10-18)

Jeremy asked for icons, the body editor's toolbar first. His calls are in DECISIONS.md: Lucide's icons beside words; the body's formatting tools as icons alone, with tooltips (an exception to spec §10.4); and an icon per collection, named in `vesper.config.ts`.

- **Kit:** `Icon` draws the kit's 41 Lucide icons by name, or a drawing from the manifest, at 1.75px at every size and always `aria-hidden`. `Button`, `ButtonLink`, `Link`, `FileButton`, `TextField` and `Menu` items take an `icon`. `Tooltip` is React Aria's. A toolbar tool given `icon`, `label` and `shortcut` is icon-only: the label is its name, the tooltip shows the label and shortcut on hover and keyboard focus, and `aria-keyshortcuts` carries the shortcut (Mac-aware).
- **Studio:** the body's and the Markdown widget's formatting tools are icons; primary and secondary actions, menu items, back links, search fields, the Insert menu and the notes' warning mark carry an icon beside their words; non-image files in Media and the picker show a file-type icon.
- **Collection icons:** `collections.<name>.icon` (`'newspaper'`) is resolved at build from the site's own `lucide`, an optional peer of `@vesper/astro`, and only that drawing goes into the manifest (`presentation.icon`). Home, the Content menu and the collection's heading show it; without one, a collection shows a page, a tree an outline and a singleton sliders. A missing `lucide` or an unknown name warns, and the default stays.
- **Checks:** typecheck, lint, format and Vitest (4,090 tests) pass; new tests cover the drawing whitelist, the tooltip and `aria-keyshortcuts` by keyboard, the manifest's icon and its own-key lookup, the config's name check, and the icons on Home, in the Content menu and in a collection's heading. The playground manifest snapshot gained the seven icons. `npm run e2e`: 90 passed, static and studio. `check:dist` passes, with `lucide` bundled into the studio, not imported. CI green on GitHub (run 39230773589): every job, the Windows tests and the Astro 6 fixture included. Contrast adds the warning mark on the notes drawer's glass (3.20:1 light, 6.88:1 dark). Screens checked at 1280px and 320px, light and dark.
- **Size:** the kit's 41 drawings are 6,839 bytes of data, in the studio's shared chunk. `studio.js` goes from 74,254 to 75,761 bytes.

**Found while building:**
- **Shift+F10 in the outline could leave focus on the menu, not its first item.** The outline opened the row's menu with a click from code. React Aria treats that like a screen reader's: it moves focus a frame later, both to the menu and then to the first item, and the second move is dropped when the first has already landed. The icons shifted the timing, and two e2e tests failed on this machine (the same tests passed on a checkout of HEAD). The outline now presses Enter on the button, as the keyboard does, so focus moves at once. Earlier the same path waited on transitions (above); now it doesn't depend on timing at all.
- **React Aria closes a tooltip when the page scrolls,** so a tooltip shown as focus scrolls a toolbar into view can vanish at once. That's React Aria's behaviour, kept; the screenshot script settles the scroll first.

**Commits:** the decisions (6acbf46), the kit (13e20f3), the formatting tools (057f787), icons beside words (95a9978), the Shift+F10 fix (1c21e3f), collection icons (b09ddb9) and this note. The first-Tab fix (de40775) came just before.

## Phase 3: outcome

Built 2026-10-19 on the design below, with every call as recommended (Jeremy, 2026-10-19). CI is green on GitHub (run 39287685831). The first run (39284180201) failed only in the GitHub-mode e2e tests: the sign-in helper waited for the user menu, which an editor's own bar doesn't have, so it passed only while the entry was still loading. The helper now waits for the signed-in studio, and the github project doesn't retry, since a serial file reruns against a repository its first attempt already changed (2509206).

| Criterion (spec §11) | How it's met |
|---|---|
| An editor with a GitHub account can edit and publish, with an image, from a deployed static site | `e2e/github/github.spec.ts`: a GitHub-mode build of the playground on the plain static server signs in through the real relay (`templates/oauth-relay`) against a fake GitHub whose repository is real git. It edits a post, uploads a new image through the field, and publishes. The bare repository then has exactly one new commit, by the editor, with the post changed and the image added, and every other file's bytes unchanged. The same project covers a deep link across a reload, a conflict with a change published elsewhere, a reorder as one commit, and axe on the sign-in screen, Home and the user menu. **And on real GitHub and a real host** (below). |
| GitHub adapter passing the storage contract suite (roadmap) | `packages/astro/test/storage-github.test.ts`: `GitHubStorage` passes `runStorageContract` against the fake, plus a push from elsewhere mid-save (built on once, or a conflict), branch rules, an expired sign-in, rate limits, a truncated tree, a monorepo's subfolder, byte exactness (CRLF, a BOM, non-UTF-8), batched reads with a warm cache, and held uploads. |
| OAuth relay template (roadmap) | `templates/oauth-relay`: one dependency-free Worker, a `wrangler.toml` and a README. Its tests sign in from end to end against the fake, and refuse unknown sites, missing state or challenge, wrong verifiers and forged callbacks. |

Measured: the playground's schemas for the browser are 93 KB minified, loaded on the first save. A warm visit reads from GitHub only files whose blob SHA changed.

**Built as designed, with these differences:**
- **An upload from a field waits for the publish** (`ChangeSet.defer`). The design missed that the studio uploads when a file is chosen, which would have made an entry and its image two commits (spec §6.8 says one). The Media screen still publishes an upload at once (DECISIONS.md).
- **Entry saves carry a `Vesper-Collection` trailer** in every mode; adapters without history ignore it.
- **The user menu is in the top bar of every screen but the editor**, whose bar holds the entry's own controls.
- **The field model's fallback checks** (`fieldModelIssues`) are new in core; nothing had them before.
- **The Details focus test waits for the field** (a479c50): it raced on a fast run, before this phase and after.

**The real-world check** (2026-10-19). The setup:
- a private copy of this repository, `jeremybise/vesper-github-test`, with GitHub Actions off;
- a GitHub App, "Vesper (test)", installed on that copy only;
- the relay as a Worker on Jeremy's Cloudflare account;
- the playground on Cloudflare Pages at `vesper-github-test.pages.dev`, with only `github: { relay }` added to its config.

Jeremy signed in and published a title change and a new image on Harbor at dawn. GitHub has one commit for it (3f0894d), by him, with the `Vesper-Collection: blog` trailer. The post changed by two lines (the title and `hero.src`), with its line endings kept, and the image was added beside the others in `apps/playground/src/assets/blog/`. Pages rebuilt within three minutes, and the live post shows both. The build read the repository, `main` and the site's folder from git on Cloudflare's builder, with no settings.

The copy, the app, the relay and the Pages site are still up. Delete them when they're no longer useful.

**Open, for Jeremy:**
- **Replacing an image keeps the old one's alt text, focal point and crops.** This happens in every mode: the image field's `setSrc` changes only `src`. On the test site the new picture went live with the old one's description. No check catches it, because the alt text isn't empty. Options:
  - (a) Clear the focal point and crops, keep the alt text, and show a note beside it asking whether it still describes the new image. Recommended.
  - (b) Clear all three, so the missing-alt check asks for new words.
  - (c) Leave it as built.

  **Decided 2026-10-19: (a), and built.** A different image from the picker, chosen or uploaded, drops `focus` and `crops` and keeps `alt` and `decorative`. A note beside the alt text, or beside the decorative option when that's set, says "You replaced the image. Check that the alt text still describes it." It is part of that control's description, never in the live status, and goes once the editor changes either one. A first image, the same image again and a plain `image()` path change nothing. Tests: `packages/admin/src/widgets/image.test.tsx`. Reasons: DECISIONS.md, "Replacing an image clears its geometry, not its words".
- **Publishes are unsigned commits.** The Git Data API doesn't sign them, so GitHub doesn't mark them as verified, and a branch rule that requires signed commits would refuse every publish (not tried). GraphQL's `createCommitOnBranch` makes commits that GitHub signs, with the expected head built in. But it takes the whole change in one request, which limits image size, and it would replace the retry path. Options:
  - (a) Leave it as built, and say so in the deployment notes. Recommended for now.
  - (b) Switch to `createCommitOnBranch`.
  - (c) Use `createCommitOnBranch` for small changes and the Git Data API for large ones.
- **Cloudflare's Create button now makes a Worker, not Pages.** A Worker's default deploy command, `npx wrangler deploy`, fails at a workspace root ("application detection … root of a workspace"). Pages is a link on the same screen. A Worker also works with `npx wrangler deploy --assets ./apps/playground/dist --name … --compatibility-date …`: a dry run read the built site. This is for the deployment notes (Phase 9's docs).
- **A screen reader pass** of the sign-in screen, the user menu and Publish, with the earlier phases' passes.

**Not built** (as planned): pull-request mode (Phase 9), deploy status (cloud), the cloud's free relay (when the domain exists), a read-only studio, GitLab and Bitbucket.

## Phase 3: GitHub mode (design)

Scope is spec §6.8 (GitHub mode), the GitHub half of §6.9 (signing in), §6.16 (how a published change reaches the site) and the §11 Phase 3 entry: "an editor with a GitHub account can edit and publish, with an image, from a deployed static site." Two calls are already made (2026-10-19): the cloud will run a free relay, and in GitHub mode the site's build is the last check for custom Markdoc validators. Nothing here touches the cloud, and GitHub mode is free (§4).

**What was found first.** In the code:
- **The storage interface was built for this.** A file's version is its git blob SHA in every mode, a `ChangeSet` is applied whole or not at all, a stale `expectedVersion` is a conflict, and `runStorageContract` is the suite every adapter must pass.
- **The dev API is a thin shell over core.** `ContentService`, `PageService` and `MediaService` do the work, over a storage adapter. GitHub mode can run the same services in the browser over a GitHub adapter, so every screen, check and splice stays the same code. Only five inputs are Node-only today: the collections' Zod schemas, the real Markdoc config, declared MDX props, function-form URLs and the site's static routes.
- **The studio already ships `vesper.config.ts` to the browser** (custom widgets, MDX props), so function-form URLs and MDX props are available there. Static routes can be written into the studio at build.
- **Two things would be slow over the API.** `MediaService.list` reads every media file to hash it, which would download every image, and the studio's `fileUrl()` is synchronous, while a private repo's `src/assets` image has no URL a browser can load without a token.

From GitHub's docs and changelog, checked on 2026-10-19 (sources in DECISIONS.md once confirmed):
- **CORS.** `api.github.com` (REST and GraphQL) answers cross-origin requests with an `Authorization` header from any origin. `github.com/login/oauth/access_token` and the device-flow endpoints don't, so **a relay is needed for any sign-in.**
- **PKCE** (S256) works for OAuth Apps and GitHub Apps since July 2025, but the token endpoint **still requires `client_secret`** for the web flow, so **the relay must hold the secret**.
- **An OAuth App can't be limited to one repository.** Writing to a private repo needs the `repo` scope, which reaches every private repo the editor can reach. New organizations also block OAuth Apps until an owner approves them, which colleges will hit.
- **A GitHub App's user token reaches only the repositories the app is installed on, intersected with the editor's own access.** It needs only Contents (read and write) and Metadata (read), and no webhook or server beyond the relay. Tokens last 8 hours; refresh tokens last 6 months, rotate, and need the secret. An app can list 10 callback URLs.
- **Commits.** The Git Data API (blobs, tree, commit, then a ref update with `force: false`) refuses a ref update that isn't a fast-forward, so a race is caught. Text can go inline in the tree; each binary needs its own blob request. `createCommitOnBranch` (GraphQL) is one request with a true compare-and-swap and Verified commits, but its practical request limit is about 16 MB of base64, and a 20 MB upload is about 27 MB.
- **Reading.** One recursive tree call lists every path and blob SHA (up to 100,000 entries). Batched GraphQL `object(expression:)` queries read many text files in one request. `raw.githubusercontent.com` can't be read from a browser for a private repo; the Contents API's raw media type can.
- **Limits.** 5,000 REST requests an hour per editor, and content-creating requests are capped at 80 a minute and 500 an hour.
- **Hosts.** A commit through the API is a push: GitHub Actions and git-connected hosts build on it. But on private repos **Vercel builds only for commit authors on the team, and Netlify holds unknown authors for approval**, and in GitHub mode each editor is the author. No such rule was found for Cloudflare Pages.
- Decap, Sveltia and Keystatic do much the same. Sveltia is closest to this design: browser-only, with a one-file Worker relay holding an OAuth App's secret.

### How it works

**Turning it on.**
- `vesper({ github: { relay: 'https://vesper-auth.example.workers.dev' } })` in `astro.config`, plus optional `repo: 'owner/name'`, `branch` and `apiUrl` (GitHub Enterprise Server, and the tests' fake GitHub).
- Without `repo`, the build reads it from git: `origin`'s URL, the default branch, and the site's folder inside the repository (`git rev-parse --show-prefix`), so a monorepo's site saves to the right paths. With none, the build says so in one line and `/admin` is the "Editing isn't available here yet" screen it is today.
- `astro dev` stays local mode. GitHub mode runs in built sites only, which is also how the tests run it.

**Signing in** (a top-level redirect, no popup, no third-party cookies, as D14 does for the cloud):
1. "Sign in with GitHub" saves a random `state` and a PKCE verifier in `sessionStorage` and goes to the relay's `/authorize`, with the site's origin, the state and the code challenge.
2. The relay checks the origin against its allowlist and sends the browser to GitHub with its own client ID and its `/callback`.
3. GitHub returns to the relay, which sends the browser back to `<site>/admin/?github=<code>&state=…`. The code is useless without the verifier, which never left the studio's tab.
4. The studio checks the state and posts the code and verifier to the relay's `/token`. The relay adds the secret, asks GitHub, and answers with the token (CORS for allowlisted origins only). The studio removes the code from the address with `history.replaceState`.
5. The studio reads the repository's permissions. An editor who can't push sees "Your GitHub account can't change this site. Ask its owner to add you." and Sign out.

**Reading.** `GitHubStorage` implements `StorageAdapter`:
- `head()` is the branch's commit SHA. `list()` comes from one recursive tree at that head.
- `read()` goes through an IndexedDB cache keyed by blob SHA. A SHA always means the same bytes, so the cache never goes stale, and only changed files are fetched again. Misses are fetched in batches, text through GraphQL and binaries one at a time through the Contents API's raw media type.
- A tree GitHub truncates (over 100,000 entries) falls back to one tree per collection folder.

**Saving.** `commit(changeSet)` is one commit on the branch, by the Git Data API (spec §6.8):
- It reads the head's tree and checks every `expectedVersion` against it. A file someone else changed is a conflict, reported as local mode reports it.
- Binaries go up as blobs, one request each. Text goes inline in a tree built on the head's tree. Then it makes the commit and moves the branch with `force: false`.
- If the branch moved in between (GitHub answers 422), it reads the new head, checks the same files again and retries once if none of them changed.
- The editor is the commit's author. The message is plain, from the change set's summary ("Update “Harbor at dawn” in Blog posts"), with its trailers.
- A branch rule that refuses the push (pull requests required, signed commits required, status checks) is said plainly: "This site's GitHub settings don't allow publishing straight to main." Pull-request mode is Phase 9 (§13.5).
- After a publish, the status reads "Published. It will be live after the site is next built." (spec §6.16). Deploy status is cloud-only (§6.16).

**Checks in the browser.**
- **Schemas.** Validation runs the real Zod schemas in GitHub mode too (spec §6.3.1), shipped as a separate bundle (call 3).
- **Bodies.** Markdoc is checked with the manifest's config, as the studio does now; custom attribute types and `validate` functions are left to the site's build (decided 2026-10-19). MDX props use the declared schemas from `vesper.config.ts`, which the studio already loads.
- **Pages.** Moves, route collisions and link rewriting use `PageService` as in local mode. Static routes are written into the studio at build, and function-form URLs come from the bundled `vesper.config.ts`.

**Files in the studio.** `fileUrl(path)` becomes asynchronous, `fileUrl(path): Promise<string>`. In GitHub mode it's an object URL for the blob, cached by SHA and revoked when the screen closes; in local mode it stays the dev API's `/file` URL. Media de-duplication compares git blob SHAs instead of SHA-256, so listing Media reads the tree and downloads nothing.

**Expiry and failures.**
- A token lasts 8 hours and is kept in `sessionStorage` (call 4).
- On a 401 the studio keeps the open entry's unsaved changes in `sessionStorage`, says "Your GitHub sign-in has expired. Sign in again to publish; your changes are kept.", and puts them back after the redirect.
- Rate limits and network failures are said in plain words, with the time to try again.

**The relay** is `templates/oauth-relay/` (spec §5): one dependency-free Worker file, a `wrangler.toml` and a README.
- **Secrets:** `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `ALLOWED_ORIGINS`.
- **Endpoints:** `GET /authorize`, `GET /callback` and `POST /token`.
- **It never stores anything.** The README walks through creating the GitHub App, installing it on the repository and running `wrangler deploy`. A `workers.dev` address works, so no domain is needed.
- **The cloud's free relay** is this same Worker, deployed by Vesper once the §13.1 domain exists. Its own rules (which sites may use it) are a call for then.

**In the interface (spec §10.4).**
- The sign-in screen has one primary button, "Sign in with GitHub", and one line on what that means: "You'll publish to owner/name on GitHub. Changes go live after the site rebuilds."
- Signed in, the top bar gains the design system's user menu (call 6).
- In GitHub mode the editor's main button reads Publish instead of Save (call 5). Nothing else changes, and cloud-only features stay absent (§6.9).

### Tests, mapped to "Done when"

- **The adapter:** `GitHubStorage` passes `runStorageContract` against a fake GitHub: `scripts/github-fake.mjs`, a small server for the endpoints Vesper uses, backed by a real bare git repository through the `git` CLI, so blob SHAs, trees, fast-forward refusals and conflicts are git's own. Unit tests cover the race retry, truncated trees, branch-rule refusals, 401 and rate limits.
- **The relay:** unit tests for the allowlist, state, PKCE pass-through and CORS, with GitHub's token endpoint faked.
- **The studio:** a new e2e project, `github`, serves a GitHub-mode build of the playground on `scripts/static-server.mjs` with the fake GitHub and a fake relay. It signs in, edits a post, uploads an image and publishes, then checks the bare repository for one commit with both files and nothing else changed (byte-for-byte, as local mode's tests do). It also covers a conflict, a move, axe on the sign-in screen and the user menu, and a keyboard pass.
- **The real thing** (the criterion's "deployed static site"): a checklist in the outcome, run once with a real GitHub App, a deployed relay, a test repository and a host. Jeremy signs in to GitHub himself; the rest can be driven from the browser pane.

**Commits, in order:**
1. `docs`: this design.
2. `feat(core)`: blob-SHA media de-duplication, async file reads for the studio, and the change-set message format.
3. `feat(admin)`: GitHub storage, cache and API client (`createGitHubApi`), with the contract suite against the fake.
4. `feat(astro)`: `github` options, repo detection, routes and the schema bundle at build.
5. `feat(admin)`: sign-in, the user menu, Publish, expiry and errors.
6. `feat(templates)`: the OAuth relay.
7. `test`: the fake GitHub, the e2e project and CI.
8. `docs`: decisions, READMEs, deployment notes and the Phase 3 outcome.

### The calls (confirmed 2026-10-19)

Jeremy confirmed every recommendation on 2026-10-19: 1a to 9 as recommended, and the smaller defaults.

1. **GitHub App or OAuth App.**
   - (a) A GitHub App, recommended. Its tokens reach only the repositories it's installed on, it asks for nothing but Contents and Metadata, and organizations install it like any app.
   - (b) An OAuth App, as Decap and Sveltia use. Simpler to create, but `repo` reaches every private repository the editor can, and new organizations block it until an owner approves.
2. **Who makes the app, for self-hosted relays.**
   - (a) Each site owner, or an agency once for all its sites, creates its own GitHub App, deploys the relay, and installs the app on each repository. Recommended: no shared secret, and the consent screen shows the owner's name.
   - (b) Only Vesper's shared app, through the free relay. That needs the domain first, so Phase 3 couldn't ship without it.
3. **Validating with the real schemas in the browser.**
   - (a) A separate build of `content.config.ts` for the browser at `astro build`, with client shims for `astro:content` and `astro/loaders`, written to `_vesper/` and loaded on first save. Recommended. If that build fails (a config that imports Node-only code), the site still builds, the log says why, and the studio falls back to (b).
   - (b) Checks from the manifest's field model only (required, types, patterns, options, lengths), with the site's build as the last check, as for custom Markdoc validators. Simpler, but misses refinements such as the image field's "Describe this image, or mark it decorative."
   - Either way the schemas' code ships with `/admin`, as `vesper.config.ts` already does. Their shapes are already public in `_vesper/manifest.json`.
4. **Where the token is kept.**
   - (a) `sessionStorage`, only the 8-hour access token, recommended. It's gone when the tab closes; signing in again is one redirect, since GitHub remembers the approval. No refresh token is kept, so the relay needs no `/refresh`.
   - (b) `localStorage` with the refresh token, so editors stay signed in for months. Any script on the site's origin could read a long-lived token, and `/admin` shares its origin with the public site and whatever scripts the site loads.
   - (c) Memory only. The safest, but a reload signs the editor out, which breaks deep links after a reload (CLAUDE.md).
5. **The editor's button in GitHub mode.**
   - (a) "Publish", recommended. Saving is publishing here: it commits to the default branch and the site rebuilds. Local mode keeps "Save".
   - (b) "Save" everywhere, with "Published" in the status after it.
6. **Where signed-in state and Sign out live.**
   - (a) The design system's user menu at the right of the top bar: a quiet button with the editor's GitHub login, opening "Signed in to GitHub as @login" and "Sign out". Recommended; it's where the cloud's account will go in Phase 4.
   - (b) Two items at the end of the Site menu. No new control, but signing out sits among site settings.
7. **Editors who can't push.**
   - (a) A plain message and Sign out, recommended.
   - (b) A read-only studio. More to build and test, and roles and review are cloud features (§4).
8. **Commit method.**
   - (a) The Git Data API for every save, as spec §6.8 says, recommended: one path for text and 20 MB uploads alike, with the race retry above.
   - (b) `createCommitOnBranch` for text-only saves (Verified commits, a true compare-and-swap) and the Git Data API when a save carries an upload. Two paths to test. It would matter for repositories that require signed commits, which (a) can't publish to.
9. **The real-world check.** Recommended:
   - a private test repository holding a copy of the playground;
   - a "Vesper (test)" GitHub App you create;
   - the relay on your Cloudflare account at a `workers.dev` address;
   - the site on **Cloudflare Pages**, the one git-connected host with no commit-author rule found.

   Vercel's and Netlify's author rules go in the deployment notes.

**Smaller defaults, built as written unless you say otherwise:**
- Saves go to the repository's default branch; `github.branch` overrides it.
- The editor is the commit author; commit messages are plain and end with a `Vesper-Collection` trailer.
- The relay's allowlist holds whole origins (`https://example.edu`), and preview hosts can be added one by one.
- GitHub Enterprise Server works through `github.apiUrl`.
- Tier: nothing is unclear. GitHub mode is free (§4), and so are the relay template and the free relay.

**Not in this phase:** pull-request mode (Phase 9); deploy status and build logs (cloud, §6.16); cloud sign-in and drafts (Phase 4); the free relay's deployment and rules (when the domain exists); a read-only studio; GitLab or Bitbucket.

## Phase 2.9: outcome

Built 2026-10-19 on the design below, with every call as recommended (Jeremy, 2026-10-19). CI green on GitHub (run 39264241554). The first run (39262767962) failed twice: on Windows, sharp kept the first build's thumbnail open, so the search test's second build couldn't empty `dist/`; and the move test's announcement now counts the new top-level page. Both were test fixes (e955539, 60e6fd8).

| Criterion (spec §11) | How it's met |
|---|---|
| Searching the playground finds pages from every searchable collection, and filtering by collection and tag works | `packages/astro/test/search.integration.test.ts` builds a copy of the playground and reads the index back: blog, pages, docs and events, each with its title, Section, tags, date and a 128px square thumbnail. `e2e/static-search.spec.ts`: a query per collection finds its page; ticking Events, then a tag, narrows the results and the count is announced. |
| Hidden, draft and scheduled entries never appear | The integration test: the hidden `contact-thanks` page, an event scheduled for 2099, the expired `summer-orientation`, the fixtures collection (`search: false`), a `noindex` page, `/search`, `/admin` and `404` are absent; draft files (`_unpublished-idea.md`) are never built. The e2e checks hidden, unpublished and unsearched entries. The playground's own scheduled events go live as the dates pass, so only the 2099 event tests scheduling. |
| Search works from `dist/` on the plain static test host | The e2e runs on `scripts/static-server.mjs` with its default MIME types (DECISIONS.md, "Pagefind needs no MIME type"). The integration test builds again with `base: '/sub/'` and a `site`: every result, thumbnail and the bundle carry the base, the injected `/search` page appears, and so does `opensearch.xml`. |
| The audit is recorded in `DECISIONS.md`, and the shipped UI passes the standing accessibility criteria with keyboard and screen readers | DECISIONS.md, "Site search". axe passes with the dialog closed, open with results, filtered, in dark mode and on `/search`; keys alone open (Ctrl/⌘+K and Enter), type, ArrowDown and Tab through results, close with Escape and return focus; the live region is inside the dialog; matches stay visible in forced colours; nothing scrolls sideways at 640×400 or 320×640; without JavaScript the button is a link and `/search` explains. Manual keyboard pass in the browser pane: the same path, plus a filter ticked by keyboard keeping its focus and "Show more results" moving focus to result 11. **Not done: a pass with a real screen reader** (checklist Part B, below). |

Measured on the playground: "Search: indexed 29 pages in 1 language, 19 KB of index. A first search loads 164 KB." `<Search>`'s own script is 9.9 KB minified (3.7 KB gzipped), so a first search is about 174 KB uncompressed, under the 300 KB budget.

**Built as designed, with these differences:**
- The thumbnail travels as Vesper's own `thumbnail` meta, not Pagefind's `image`, which Pagefind fills from a page's first `<img>`. A `datetime` meta gives `<time>` its machine-readable date.
- Filter counts are Pagefind's `totalFilters` (the query's counts, ignoring filters), so labels don't change under a ticked box, and the filters are drawn again only for a new query. Pagefind returns no counts until its filter index is loaded, so the script calls `filters()` once after `init()`. A filter appears only when it narrows the results.
- `<Search>` takes `lang` and `id` props as well, for a page's language and a second instance. A click on the backdrop closes the dialog.
- Words in other languages come only from `search.strings`; seeding them from Pagefind's translations wasn't done (DECISIONS.md).
- In the studio, the switch is left out where the collection isn't searched when the field is at the top level; a `fields.hideFromSearch()` nested inside an object still shows there.
- `scripts/studio-site.mjs` now passes `--ignore-lock`: under an AI agent on macOS and Linux, Astro 7 backgrounds `astro dev` and Playwright read that as the server exiting (DECISIONS.md).

**Also in this stretch (the calls of 2026-10-19):** unknown Markdoc tags block in the dev API; "Save anyway" past the publish gate in local mode; a site's name shows as written; React 19 is required with a plain message.

**Open, for Jeremy:**
- **A screen reader pass** with NVDA and VoiceOver: checklist Part B below. Part A first, if you want to confirm the audit's findings 1 and 2 before the issues go to Pagefind (the audit pages are on the Windows machine, in `C:\tmp\vesper-pagefind-audit`).
- **Filing the audit's findings with Pagefind/pagefind**, drafted below. They're posted only with your OK.
- **Two studio e2e tests fail on this Mac** for macOS keyboard reasons, not this phase's code: `markdoc.spec.ts` (the abbreviation test presses `End`, which doesn't move the caret on macOS) and `pages.spec.ts` (moving Nursing presses `Control+a`, which doesn't select all there). CI runs on Linux and Jeremy on Windows. A follow-up could use `ControlOrMeta` and platform-aware caret keys.

**Drafted for Pagefind/pagefind** (one issue each; reproduction: the audit pages, with axe-core 4.14 in Chromium):
1. *Component UI modal: result counts are never announced.* The announcer's live regions are appended to `<body>`; `showModal()` makes everything outside the `<dialog>` inert, so they're removed from the accessibility tree while it's open. Rendering the live region inside the dialog fixes it (WCAG 4.1.3).
2. *Results are `aria-hidden` until scrolled into view.* Each result is a hidden placeholder until an IntersectionObserver sees it, so screen readers announce N results but reach only the few on screen (WCAG 1.3.1).
3. *Filter group name contrast.* `#767676` on `#eeeeee` is 3.91:1 at 11px; 4.5:1 is needed (WCAG 1.4.3).
4. *Matches vanish in dark forced-colours themes.* `mark { background: transparent }` lets forced colours draw MarkText on Canvas; the search field also loses its border.
5. *Trigger name doesn't contain its visible text.* The button is named "search" while showing "search Ctrl K"; axe `label-content-name-mismatch` (WCAG 2.5.3). The dialog is also named "search" and the mobile close button "close".
6. *Searchbox and filter dropdown variants fail axe.* The searchbox field has only a placeholder; its options are links with `role="option"`; the dropdowns fail `label-content-name-mismatch` and one trigger `button-name`.
7. *Sub-result link names start with "#",* from a CSS `::before`.
8. *Thumbnails repeat the title as alt text;* a result thumbnail beside its title link should be decorative.
9. *No close button above 640px,* so a touch screen reader user on a tablet has no control to close the modal.

**Not built** (as planned): search insights (do-not-build list), search in the studio's ⌘K palette, ranking controls beyond headings, custom result templates, anything in the cloud.

## Phase 2.9: Site search (design)

Scope is spec §6.19 (D23) and the §11 Phase 2.9 entry. Search is free and lives in the open-source integration (D23, §13.4). Nothing here touches the cloud. Search insights stays on the do-not-build list.

**What was found first.** Pagefind 1.5.2 (the current release, MIT) was installed in a scratch folder, not the repo, and measured on a copy of the playground's static build (33 pages):
- **The Node API works as the spec describes:** `createIndex()`, then `addHTMLFile({ url, content })` for each page, then `writeFiles({ outputPath })`. With the service start, 33 pages take 0.1–0.2 s. `addHTMLFile` takes the HTML as a string, so the annotated copy never touches disk and the deployed file is never written.
- **`data-pagefind-body` drops pages silently, as documented.** With the attribute on one page, the index held 1 page of 33. `addHTMLFile` returned no error or warning for the 32 it would leave out, so Vesper has to look for the attribute itself to warn.
- **Without that attribute, Pagefind indexes all of `<body>` except `<nav>` and `<footer>`.** The header stays in, so every playground result began "Skip to contentVesper playground…". With `data-pagefind-body` on `<main>`, results hold only the page's content.
- **`<meta>` tags in the head can carry the annotations.** `<meta data-pagefind-meta="title[content]" content="…">` sets a result's title, date or image. The same form with `data-pagefind-filter` and `data-pagefind-sort` sets filters and sort keys. Values may contain commas, and two tags with one filter name give two values. Without them, Pagefind uses the first `<h1>` as the title and the page's first `<img>` as the image, which gave the blog listing one post's picture.
- **Headings already outrank body text.** For "harbor", the post titled "Harbor at dawn" scored 15.4 and the next page 5.3. When the title is the page's `<h1>` inside `<main>`, no extra weighting is needed.
- **Languages need nothing from Vesper.** Pagefind writes one index per `<html lang>`: a docs page set to `es` got its own `es` index and wasm. The browser loads the index for the page's language.
- **Sorting drops pages that lack the sort key.** "campus" found 10 pages by relevance and 5 sorted by date: the 5 pages without a date were left out.
- **The WebAssembly needs no MIME type.** Pagefind's files are `wasm.<lang>.pagefind`, `*.pf_meta`, `*.pf_index`, `*.pf_fragment` and `*.pf_filter`. Its script fetches each as bytes, gunzips it itself and instantiates the wasm from memory, so `WebAssembly.instantiateStreaming`, the only path that needs `application/wasm`, is never taken. `scripts/static-server.mjs` serves these files as `application/octet-stream`, as a host with no MIME settings would, and search worked. No `.wasm` file exists to map.
- **Size.** The index of 33 pages is 22 KB; the rest is fixed cost. From a page using Component UI, a first query loaded 389 KB uncompressed (about 155 KB with gzip):
  - 219 KB of Component UI's JS and CSS, on every page load, before anyone searches;
  - then `pagefind.js` (46 KB), its worker (41 KB), the English wasm (72 KB, already gzipped), an 8 KB index chunk and the fragments.
  - Without Component UI, Pagefind's part of a first query is about 170 KB uncompressed.
- **Install size.** `pagefind` is 37 KB, plus a 58 MB binary for the build machine's platform (an optional dependency such as `@pagefind/linux-x64`). `writeFiles` also writes Pagefind's three bundled UIs and its highlighter into the output: about 420 KB that a site using none of them doesn't need.

### Audit of Pagefind's Component UI (the gate)

The audit ran in Chromium through Playwright, with axe-core 4.14 on WCAG 2.0–2.2 A and AA plus best practice. It covered:
- **sizes:** 1280×800; 200% zoom (640×400 CSS pixels); 320×640 and 320×256;
- **modes:** light, dark, forced colours and reduced motion;
- **five pages:** the default modal, the modal with a filter pane and images, the searchbox (combobox) variant, an inline search page, and the filter dropdowns.

Screen readers are Jeremy's (checklist at the end of this section). The audit pages are in `C:\tmp\vesper-pagefind-audit` and the scripts and log in `C:\tmp\vesper-pagefind-audit-scripts`.

What it does well:
- **The modal is a native `<dialog>` opened with `showModal()`.** The page behind is inert, Tab stays inside, Escape closes it from anywhere and focus returns to the trigger. The trigger has `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`, and Ctrl/⌘+K opens the dialog (`aria-keyshortcuts`).
- **The field is properly labelled.** It's `type="search"`, with a real but visually hidden `<label>` ("Search this site"), inside a `search` landmark and described by "Results will appear as you type".
- **Results are a real list.** They're a `<ul>` named "Search results", the title is each link's text, and sub-results are a nested list.
- **Filters are checkboxes in a `<fieldset>` with a legend,** inside a `<details>` disclosure. Each label includes its count.
- **On the inline page the count is announced,** politely ("10 results for nursing"); "No results for …" is announced assertively.
- **Focus is visible everywhere:** a 2px ring on result cards through `:focus-within`, and a CanvasText outline in forced colours.
- **Nothing scrolls sideways at 200% or 320px.** Below 640px the modal fills the screen and gains a close button.

Where it falls short:

| # | Finding | Where | Measure |
|---|---|---|---|
| 1 | **The modal never announces result counts.** The announcer's live regions are appended to `<body>`, outside the `<dialog>`, and `showModal()` makes them inert. Chromium's accessibility tree has four status regions while the modal is closed and none while it's open. Filter changes in the modal go unannounced too. | The modal, which is what `<Search />` opens | WCAG 4.1.3 (AA); the spec's "polite live announcement of the result count" |
| 2 | **Screen readers can't reach most results until they scroll into view.** Each result is an `aria-hidden` placeholder until an IntersectionObserver sees it. For "the", 27 results were announced and 20 of the 27 list items were hidden, so the list a screen reader reports doesn't match the count. | Results, every variant | WCAG 1.3.1 (A) (to confirm with the checklist) |
| 3 | The filter group's name fails contrast: #767676 on #eeeeee is 3.91:1, at 11px (4.5:1 is needed). | Filter pane | WCAG 1.4.3 (AA) |
| 4 | **In dark high-contrast themes, matched words vanish from excerpts.** `mark` has `background: transparent`, and forced colours then draw its text in MarkText, the same colour as the Canvas. The search field loses its border too. | Excerpts, every variant | No WCAG criterion; a real barrier with Windows contrast themes |
| 5 | The trigger is named "search" in lower case (from the shortcut hints' strings), and axe fails it on `label-content-name-mismatch` (serious) because the visible text is "search Ctrl K". The dialog is also named "search", and the mobile close button "close". | Trigger, modal | WCAG 2.5.3 (A), per axe |
| 6 | **The other two variants fail axe.** The searchbox's field has only a placeholder for a label. Its options are links with `role="option"`, so screen readers no longer treat them as links, and axe fails every one on `label-content-name-mismatch`. The filter dropdowns fail that rule on every option, and `button-name` (critical) on one trigger. | Searchbox, dropdowns | WCAG 1.3.1, 2.5.3, 4.1.2 |
| 7 | Sub-result links' names start with "#", which comes from a CSS `::before` ("#In this section"). | Sub-results | Quality |
| 8 | Thumbnails repeat the page's alt text, or the title when it's empty, right beside the title link. A result thumbnail should be decorative. | Results with images | Quality |
| 9 | Above 640px the modal has no close button, only Escape or a click on the backdrop. A touch screen reader user on a tablet has no control to close it. | Modal | Quality (the spec only asks for Escape) |
| 10 | Smaller issues. The hint says "esc clear" while Escape closes the dialog. A query of spaces announces "No results for" assertively. Focus-ring transitions still run under reduced motion. Excerpts are cut to one line at every width: about four words at 320px, though screen readers get the whole excerpt. The theme ignores `prefers-color-scheme`; dark needs `data-pf-theme="dark"`. | Various | Quality |

**Findings 1 to 3 fail the criteria the spec sets for search.** Findings 1 and 2 sit in Pagefind's own code: where the announcer is placed, and how results load. They're not in its CSS or templates, so a site can't fix them from outside without depending on Pagefind's internals.

**Recommendation: build `<Search>` on Pagefind's JS API, as the gate prescribes,** and file findings 1 to 9 upstream at Pagefind/pagefind. Filing is outward-facing: the issues get drafted with the audit page as a reproduction, and they're posted only with Jeremy's OK. Which UI to build is the first call below.

### What gets indexed

Indexing lives in `packages/astro/src/integration/search.ts` and runs in `astro:build:done`, after the accessibility check.

**Pages.** The indexer walks the same HTML files as the build's accessibility check (`builtPages`). It leaves out:
- Astro's redirect pages, `/admin`, `404.html` and Vesper's `/search` page;
- pages with `<meta name="robots" content="noindex">` (a default below);
- URL patterns in `vesper({ search: { exclude: ['/tags/**'] } })`;
- entry pages, traced through the collection's `url` exactly as the accessibility report does (`PageService.pageEntries`, `urlKey`), when:
  - the collection has `search: false`; or
  - the entry is hidden from search; or
  - the entry is outside its publish window. Until Phase 4.5 filters the build itself, this check keeps scheduled and unpublished entries out (a call below).

Static pages in `src/pages` are indexed (spec §6.19).

**When indexing is skipped.** With no built page using `<Search>` (the component renders a `data-vesper-search` marker), the integration skips indexing and logs one line saying so. `vesper({ search: false })` turns search off.

**The annotated copy.** It's what Vesper hands `addHTMLFile`; the file in `dist/` is never written.
- **Content area.**
  - If no page in the build has `data-pagefind-body`, the copy adds it to each page's first `<main>`, or to `<body>` for a page with no `<main>`. One build note lists those pages.
  - If any page has the attribute, the site's own markup rules. The build then warns when that leaves out pages Vesper would otherwise index: "Search: /landing/ uses data-pagefind-body, so Pagefind leaves out the 31 pages without it: /about/, /blog/welcome/ and 29 more. Add data-pagefind-body to their layout, or leave pages out with search: { exclude }."
  - `data-pagefind-ignore` is Pagefind's and works as documented.
- **Meta, in `<head>`.**
  - `title` is the entry's title (`titleOf`); a static page gets Pagefind's own default, its first `<h1>`.
  - `date` is the entry's first `search.sort` field, or else its first date field. It's formatted in the page's language and the site's `timeZone`.
  - `image` is the search thumbnail, with `image_alt` empty. The UI renders thumbnails with `alt=""`.
- **Filters.**
  - `Section` is always set to the collection's label.
  - Then each field in `search.filters[collection]`:
    - strings and lists of strings as they are;
    - `fields.select` values by their labels;
    - references by the referenced entry's title.
  - Other kinds warn once and are skipped.
- **Sort keys.** Each field in `search.sort[collection]` becomes a key of the same name, written as an ISO date and time so the keys sort correctly as text.
- **Thumbnails.**
  - Each comes from the entry's first `fields.image()` value, cut with the **square** crop through `cropForRatio` and `pixelRect`: the stored crop when there is one, otherwise the focal crop. That's how focal points carry through.
  - Sharp writes it as a 128px WebP (shown at 64px) to `dist/_vesper/search/images/<hash>.webp`. The hash covers the source file and the rectangle, so unchanged images keep their names across builds.
  - Without Sharp there are no thumbnails, and one log line says why.

**Output.**
- `writeFiles` writes into `dist/_vesper/search/`. Pagefind's bundled UIs and highlighter are then removed.
- The build logs one line, for example: "Search: indexed 31 pages in 2 languages, 48 KB of index. A first search loads 214 KB."
- It warns above the 300 KB first-query budget. That's measured as the uncompressed bytes of the script, the worker, the largest language's wasm, its meta and its largest index chunk.

### `<Search>` and the pages around it

**`<Search>`** ships in `@vesper/astro/components` as source `.astro`, like `<Img>`. It comes with a small, framework-free script (the design for call 1a).
- **`<Search />`** renders a "Search" button.
  - Without JavaScript, the button is a link to `/search/`.
  - With JavaScript, it opens a native `<dialog>` with `showModal()`.
- **The dialog** holds, in order: a visible close button "Close"; a labelled `type="search"` field ("Search this site"); the filters; and the results.
  - Its polite live region sits **inside the dialog**. It says "12 results for “nursing”" or "No results for “nursing”" once typing pauses, never on every keystroke.
  - Escape closes it from anywhere and returns focus to the button; the query is kept for the next opening. There are no keyboard traps.
- **Results** are a `<ul>` of links: the title as the link's text, a `<time>` with the date, the excerpt with `<mark>`, and the thumbnail with `alt=""`.
  - The first 10 results are real list items. "Show more results" adds 10 more and moves focus to the first new one; nothing is `aria-hidden`.
  - ArrowDown from the field moves to the first result, and Tab goes through the results in order.
  - `mark` keeps the system's Mark colours in forced colours.
- **Filters** are a `<fieldset>` with a legend per filter ("Section", "Tags"). They're checkboxes whose labels hold their counts ("Events (5)"), and each change re-announces the count.
- **Sort** is a `<select>` named "Sort", offered once a section with a sort field is chosen (a default below).
- **`<Search variant="inline" />`** puts the same field, filters and results in the page, with no dialog.
- **Look.** The UI inherits the site's font and colours (`font: inherit`, `currentColor` borders, `Canvas` and `CanvasText` fallbacks, so dark sites stay dark). A few custom properties cover the rest: `--vesper-search-accent`, `-surface`, `-border` and `-radius`. The README shows the lines that theme it.
- **Loading.** Pagefind's `pagefind.js` loads only when the dialog first opens or the inline field first gets focus, from `<base>_vesper/search/`.
- **In `astro dev`**, Vesper's dev middleware serves the last build's `dist/_vesper/search/`. With no build yet, the dialog says "Search works after `astro build`."
- **Strings.** English is built in. Other languages come from `vesper({ search: { strings: { fr: {…} } } })`, keyed by the page's `lang` and seeded from Pagefind's MIT-licensed translations where the messages match, with credit.

**`/search`** is injected with `injectRoute` and prerendered, respecting `base`, `trailingSlash` and `build.format`. It holds `<Search variant="inline" />`, reads `?q=` and runs the query on load. A site's own `src/pages/search.astro` wins (call 7).

**`opensearch.xml`** goes at the site root. Its template URL must be absolute, so it needs Astro's `site`; without one it's skipped with one log line. `<SearchHead />` goes in the layout's `<head>` and emits the `<link rel="search">`, because that link type isn't allowed in `<body>`.

**Without JavaScript,** `/search` is a plain form that submits `?q=` to itself, and a `<noscript>` explains that search needs JavaScript (call 8). `search: { noJsFallback: 'duckduckgo' }` makes the form's action DuckDuckGo, with `sites=<host>` (which needs `site`). The script takes the form over when it runs, so only visitors without JavaScript send their queries to DuckDuckGo.

**Static hosts (D16).**
- The static e2e runs search against `scripts/static-server.mjs`, which already serves `.pagefind` files as `application/octet-stream`.
- `static-server.test.mjs` pins that.
- No `.htaccess` line is added, because Pagefind needs no MIME type. DECISIONS.md records why, so nobody adds one later.

### Hide from site search, and the studio

**The studio's only search control is a "Hide from site search" switch in Details.**
- Its description: "The page stays on the site. It just won't show up in the site's own search."
- It's the existing switch widget over a boolean field (call 4). The manifest gains `presentation.searchHidden` with the field's path.
- The switch is absent, not disabled, when the collection has no `url`, has `search: false`, or has no such field.

Nothing else: no search screen, no index status, no badge, and the one primary button is still Save. The spec's ⌘K palette (§10.3) is a different feature and isn't built here.

### Config, playground and dependency

**Config:**

```js
vesper({
  search: {
    filters: { blog: ['tags', 'author'] },
    sort: { blog: ['publishedAt'] },
    exclude: ['/tags/**'],
    noJsFallback: 'duckduckgo',
  },
});
```

- `search: false` turns it all off.
- Unknown collections and fields warn at build.
- `collections.<name>.search: false` in `vesper.config.ts` already exists (Phase 1), and the playground's fixtures use it.

**Playground:**
- `<Search />` replaces the header's reserved slot.
- Search settings:
  - `filters.blog: ['tags']`, which addendum §7 asks for;
  - `sort.blog: ['publishedAt']` and `sort.events: ['startsAt']`.
- The hide field goes on blog and pages, with one new page hidden as a fixture.
- The playground gets its own `src/pages/search.astro` in `BaseLayout`. The injected page is tested on a copy without it.

**Dependency:** `pagefind` (MIT) in `@vesper/astro`, since it's the indexer D23 names. It's imported only inside `astro:build:done`. Call 9 covers its install size.

### Tests, mapped to the "Done when" criteria

**Searching the playground finds pages from every searchable collection, and filtering by collection and tag works:**
- unit tests for the annotations (each field kind as a filter, sort keys, meta, the content-area choice, every exclusion rule), thumbnails (the cut rectangle equals `cropForRatio`'s), and result URLs under `base`, both `trailingSlash` settings and `build.format: 'file'`;
- `packages/astro/test/search.integration.test.ts`, which builds a copy of the playground and reads the index back (Pagefind's fragments are gzipped JSON). It checks the pages from blog, pages, docs and events, each with its title, Section, tags and thumbnail;
- `e2e/static-search.spec.ts` on the static server: a query for each collection finds its page, and the Section and Tags filters narrow the results.

**Hidden, draft and scheduled entries never appear:** the integration test and the e2e both check that these are absent:
- the hidden fixture page;
- `_unpublished-idea.md` (never built);
- `harvest-concert` (publishes on 31 October);
- `summer-orientation` (unpublished in July);
- the fixtures collection (`search: false`).

**Search works from `dist/` on the plain static test host:** the e2e above runs on `scripts/static-server.mjs` with its default MIME types. The integration test also builds once with `base: '/sub/'` and checks that the bundle path and every result URL carry it.

**The audit is recorded in `DECISIONS.md`, and the shipped UI passes the standing accessibility criteria with keyboard and screen readers:**
- The `DECISIONS.md` entry, once Jeremy confirms.
- In `e2e/static-search.spec.ts`:
  - axe on the dialog closed, open with results, and with a filter checked, plus the `/search` page;
  - keys only: open, type, ArrowDown, Tab through results and filters, Escape, and focus back on the button;
  - the count's text in the dialog's own live region;
  - 640×400 and 320×640 with no sideways scrolling;
  - `/search/?q=nursing` running on load;
  - JavaScript off showing the form and the message.
- A manual keyboard pass, noted.
- Jeremy's pass with NVDA and VoiceOver, using Part B of the checklist.

**Also tested:** the `data-pagefind-body` warning, skipping indexing when no page uses `<Search>`, the size warning, and the dev note.

**Commits, in order:**
1. `docs`: this design and the audit.
2. `feat(core)`: search annotations from an entry and its manifest (meta, filters, sort keys), and the publish-window check that Phase 4.5 will share.
3. `feat(astro)`: the `search` options, the hide field and the manifest's `searchHidden`.
4. `feat(astro)`: the Pagefind index at build, with thumbnails, warnings and the size line.
5. `feat(astro)`: `<Search>`, `<SearchHead>`, the `/search` page, `opensearch.xml` and the no-JavaScript fallback.
6. `feat(astro)`: the last build's index in `astro dev`.
7. `feat(admin)`: "Hide from site search" in Details.
8. `feat(playground)`: search in the header, filters and sort, a hidden page, and its own `/search` page.
9. `test`: the integration test and the static e2e.
10. `docs`: decisions (the audit), READMEs, the drafted upstream issues and the Phase 2.9 outcome.

### The calls (confirmed 2026-10-19)

Jeremy confirmed every recommendation on 2026-10-19: 1a to 10a, and the smaller defaults.

1. **The search UI (the audit's result).**
   - (a) Vesper's own small script on Pagefind's JS API, recommended: a native `<dialog>`, a list of links, fieldsets and a live region inside the dialog. It would be about 8 KB gzipped (an estimate), and every behaviour is tested here. A first query would be about 200 KB uncompressed, 170 KB of it Pagefind's.
   - (b) The ui kit's React Aria Dialog, ComboBox and ListBox, compiled into a bundle loaded on first open. That brings the studio's tested behaviour, but puts React on public pages. Measured, React 19.3 alone is 75 KB gzipped and 149 KB with those components, about 600 KB uncompressed. That alone breaks the 300 KB budget on a host without compression.
   - (c) Component UI, themed, with Vesper's workarounds for findings 1 to 3 and custom templates for 7 and 8. It's the least code now, but the fixes for 1 and 2 reach into Pagefind's internals and could break with any release.
2. **A list of links, or a combobox.** The spec asks for "results as a real list of links", and for the fallback "the combobox/listbox pattern". The two conflict, because a listbox's options can't be links.
   - (a) A labelled search field and a list of links, with ArrowDown from the field to the first result. Recommended.
   - (b) A combobox whose options are links with `role="option"`, as Pagefind's searchbox does. Screen readers then don't treat them as links, so they leave the links list and lose "open in new tab".
3. **The "/" shortcut.** WCAG 2.1.4 (A) requires that a visitor can turn a one-character shortcut off, remap it, or have it work only on focus. A setting the site's developer controls doesn't count.
   - (a) Ctrl/⌘+K, recommended. It has a modifier, so 2.1.4 doesn't apply. It's in the button's `aria-keyshortcuts` and description, and `<Search shortcut={false}>` turns it off. No "/" in v1.
   - (b) "/" as the spec says, plus a "Use / to open search" switch in the dialog, remembered in the visitor's browser.
   - (c) Both, with (b)'s switch for "/".
4. **Where "Hide from site search" is stored.**
   - (a) In a field the schema declares, recommended: `fields.hideFromSearch()` (a boolean, default false), or a boolean SEO field named `noindex` (at the top level or under `seo`), found by name. Astro validates it, and the site's layout can use the same value for `<meta name="robots">`. With neither field, there's no switch.
   - (b) In a key Vesper writes into the frontmatter without a schema field. That needs no setup, but Zod strips unknown keys, so the site's code never sees it, and `.strict()` schemas fail the build.
   - (c) In a list of hidden entries in a file of Vesper's. That needs no schema change, but it's a second place to keep in step when entries move.
5. **Scheduled entries before Phase 4.5.** Builds still produce them today: the playground's `harvest-concert` publishes on 31 October and showed up in the probe's results.
   - (a) The indexer leaves out entries outside their publish window, using a check in core that 4.5's filtering will reuse. Recommended.
   - (b) Bring 4.5's build-time filtering forward into this phase.
   - (c) Move "scheduled entries never appear" to 4.5's criteria.
6. **`data-pagefind-body` on some pages.**
   - (a) Respect Pagefind's rule, and warn with the pages it leaves out. Recommended: it's Pagefind's documented behaviour, and some sites use it to choose their pages.
   - (b) Use the site's attribute where a page has it and `<main>` everywhere else, so no page drops. That's friendlier, but it differs from Pagefind's docs.
7. **The `/search` page.**
   - (a) Inject a plain page unless the site has `src/pages/search.astro`, which then wins. Recommended; the playground has its own page.
   - (b) Inject it inside a layout named in the config. The layout would have to take a `title` prop and a slot.
   - (c) Never inject it, and have the docs show the five-line page.
8. **Where `/search` sends visitors without JavaScript.** Generating a sitemap is on the do-not-build list.
   - (a) "Search needs JavaScript." with a link to the home page, or to a page the site names (`search: { noJsLink: '/site-map/' }`), plus `sitemap-index.xml` when the build has one. Recommended.
   - (b) Only the message, plus the DuckDuckGo option.
9. **Pagefind's install size:** a 58 MB binary for the build machine's platform.
   - (a) A dependency of `@vesper/astro`, as D23's "on by default" implies. Recommended; Starlight does the same.
   - (b) An optional peer, which the build asks for when a page uses `<Search>`.
10. **The first-query budget.**
    - (a) Count uncompressed bytes, what a host without compression sends, and warn above 300 KB. Recommended; call 1a comes to about 200 KB.
    - (b) Count gzip-estimated bytes.

**Smaller defaults, built as written unless you say otherwise:**
- The collection filter is called "Section" ("Blog posts", "Events", "Pages", "Docs"). Static pages have no section.
- Sorting is offered only once a section with a sort field is chosen, because Pagefind drops pages without the key.
- `filters` and `sort` live in `vesper({ search })` as the spec shows, not in `vesper.config.ts` beside `search: false`.
- Pages with `<meta name="robots" content="noindex">` are left out.
- A site's own `draft: true` field is just data: Vesper indexes what the build produces. The playground builds `notes-from-the-field` and shows "Draft" on it.
- Pagefind's unused bundled UIs (about 420 KB) are removed from the output.
- Tier: nothing is unclear. §13.4 lists site search as free, and search insights stays on the do-not-build list.

**Not in this phase:** search insights (do-not-build); search in the studio's ⌘K palette (§10.3); ranking controls beyond headings (`data-pagefind-weight` is Pagefind's and still works); custom result templates; anything in the cloud.

### Screen reader checklist (for Jeremy)

Use NVDA with Firefox and with Chrome on Windows, VoiceOver with Safari on macOS, and VoiceOver on an iPhone or iPad.

**Part A, now (optional):** confirms the audit's screen reader findings before you choose. Serve the audit pages from the repo root, then open `http://127.0.0.1:4412/pf-audit/modal/`:

```bash
npm exec -- node scripts/static-server.mjs C:/tmp/vesper-pagefind-audit --port 4412
```

1. **Tab to the header's search button.** Expected: "search, button, collapsed", in lower case. Note whether Ctrl+K is announced.
2. **Press Enter, type "nursing" and wait.** Finding 1 predicts that no count is announced; the page shows "10 results for nursing".
3. **Go to the results list (NVDA: L; VoiceOver: the rotor's lists).** Note the item count. Then search for "the": the page says 27 results. Finding 2 predicts a list of about 7 that grows only as you move down, if at all.
4. **Open `/pf-audit/page/` and repeat step 2.** Here the count should be announced, since there's no dialog.
5. **Press Escape in the modal.** The dialog should close, with focus back on the button and the button announced.
6. **On an iPad in landscape (wider than 640px), with VoiceOver,** open the modal. Try to close it without a keyboard; finding 9 predicts no close button. Note whether the two-finger scrub closes it.

**Part B, once `<Search>` is built:** the phase's screen reader criterion. Expected announcements are approximate; what matters is the content and that each comes once.

1. **Tab to Search.** Expected: "Search, button, has pop-up dialog", with "Ctrl+K" (or ⌘K) in its description.
2. **Press Enter.** Expected: "Search this site, dialog", then the field: "Search this site, search edit".
3. **Type "nursing" and pause.** Expected: "10 results for “nursing”", announced once, not per keystroke. Type more letters and confirm it updates once each pause.
4. **ArrowDown, or Tab to the results.** Expected: "list, 10 items", "Nursing information session, link", then the date and the excerpt as text. Every result reachable in browse mode matches the count.
5. **Press "Show more results".** Expected: focus moves to result 11, and the list is now 20 items, or the rest.
6. **Filters: Tab to "Section, grouping", then "Events (5), checkbox, not checked".** Press Space. Expected: "checked", then "5 results for “nursing”".
7. **Press Escape from any result.** Expected: the dialog closes and "Search, button" is announced. Reopening keeps the query.
8. **Open `/search/?q=nursing` directly.** Expected: the heading, the search landmark, and the count once results load.
9. **At 200% zoom and on a phone:** the close button is reachable and named "Close", and the VoiceOver rotor lists the result links.
10. **In a Windows contrast theme (Night sky):** matched words stay visible in excerpts, and the focus ring shows on every control.

## Studio design pass (plan)

Jeremy moved this pass ahead of 2.9 on 2026-10-18 and made the direction himself: Vesper's design system (a claude.ai artifact, the Pine direction). His decisions on where it departs from the spec are in DECISIONS.md, "Studio design": the accent is Pine and fixed, four named glows and glass on what floats, and Figtree self-hosted.

**Scope:** one visual pass over every studio screen, light and dark, inside the §10.4 budget. Token names stay; values change.
- `tokens.css`: Pine's colours, radii 6/10/16/full, the type scale (title, heading 1–3, body 16/24, label, small, caption), the spacing steps, the glows, glass and the scrim. `npm run a11y:contrast` covers both themes, plus new pairs such as text on glass.
- Figtree 400 and 600 from `@fontsource/figtree`, latin subset, in `dist/studio.css`.
- The top bar (glass, sticky), Home and empty states (the afterglow wash), the entry list, the page outline, the editor column (720px) and Details, every widget, the body editor (protected blocks, toolbar), the map, the media browser and picker, the dialogs (link, crop, leave), the notes drawer, Redirects, NotFound and Unavailable.
- The 2.8 follow-up: headings inside the body editor join the studio page's heading outline.
- `budget.test.ts` allows the four named effects and no other shadow.

**Order:** tokens, fonts, the top bar, Home and the entry editor first, then a checkpoint with Jeremy (before and after, light and dark), then the remaining screens.

**Not built in this pass** (the design system shows them; the studio doesn't have them yet):
- the ⌘K search and command palette, the site switcher and the user menu in the top bar (spec §10.3);
- the Preview toggle (Phase 7), and history, duplicate and copy link in the editor's "…" menu;
- a light/dark override for the studio (it follows the system);
- the home screen's greeting and "drafts waiting" line, and a sign-in screen (cloud, Phase 4);
- keyboard shortcuts shown in menus;
- choosing an accent (white-label, Phase 9).

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

**Open, for Jeremy** (built with the recommendation, each easy to change; decided 2026-10-19, see "Calls of 2026-10-19"):
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
| **Studio design pass** (added 2026-10-18; moved ahead of 2.9; done 2026-10-18, CI green in run 39169607328) | Done: Jeremy made the direction himself, as Vesper's design system (Pine), and decided its conflicts with the spec (DECISIONS.md, "Studio design") | One visual pass over every studio screen, inside the §10.4 budget: type scale, spacing and density, empty and loading states, the top bar, lists, the editor column, dialogs, light and dark. Before 2.9 and Phase 3, so GitHub mode and the Phase 4 dashboard build on the result instead of being restyled later. Phase 9 keeps final polish. |
| **2.9 Search** (new) | Pagefind Component UI accessibility audit: done 2026-10-19, and it falls short (design above). Calls confirmed 2026-10-19 | Pagefind Node API index into `dist/_vesper/search/`; `<Search>`; `/search`; `opensearch.xml`; wasm MIME type on the static test host |
| 3 GitHub mode | Decided 2026-10-19: the cloud runs a free relay (needs the §13.1 domain), and the site's build is the last check for custom Markdoc validators. Design and outcome above (2026-10-19) | GitHub adapter passing the storage contract suite; OAuth relay template |
| 4 Cloud foundation | D13 and D15 confirmed; §13.3 decided 2026-10-19 (closed, so `cloud-api` and `cloud-app` live in a separate private repository); the §13.1 domain; check OpenCage's terms and price (§13.9) | D1 control plane, auth (reusing Taproot's session and throttle ideas), GitHub App, SiteDO drafts, PKCE studio connection, roles and grants, dashboard v1 |
| **4.5 Scheduling** (new) | — | build-time filtering, scheduled-rebuild templates, DO alarms with deploy hooks or `repository_dispatch`, Schedule dialog |
| 5 Billing + ops | §13.4: final numbers from measured cost (the addendum's are placeholders); §13.7 decided 2026-10-19 (no Git Gateway API) | Stripe, entitlement keys from addendum §8, operator console |
| 6 Forms (expanded) | — | routing rules, private R2 uploads (D21), confirmation emails with the D20 protections |
| **6.5 Integrations** (new) | — | event and delivery system, Queues with DLQ, five destinations |
| 7 Previews · 8 Comments | accounts on at least two SSR hosts | per spec |
| **8.5 A11y history** (new) | §13.13: measure Cloudflare Browser Rendering first, then set caps | report uploads, scans, exports |
| 9 Polish | §13.5 decided 2026-10-19 (pull-request mode here, unless a paying agency asks sooner) | per spec |

## Risks and early spikes
- **S0:** the source-condition dev loop on Windows (Phase 0). Fallback: tsc watch.
- **Astro internals drift.** Mitigation: use only public exports, plus a shim contract test per major.
- **The `@vesper` npm scope may be taken (§13.1).** Packages stay private and unpublished through Phase 1, so a rename then is cheap. On 2026-10-19 no package was published under `@vesper`; Jeremy claims the org.
- **Sample-file licensing.** Only CC0, public-domain or MIT-compatible files, with provenance recorded in the README.

