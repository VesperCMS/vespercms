# PLAN.md

The working plan: where each phase stands, the design of the next phase, and the roadmap. Scope and decisions come from `vesper-spec.md`. This file records how we intend to build them, and it changes as phases land. Reasons for choices live in `DECISIONS.md`.

## Phase status

| Phase | Status |
|---|---|
| 0 Scaffold | Done (2026-10-17). CI green on GitHub (run 39054499051). |
| 1 Core | Done (2026-10-17). CI green on GitHub (run 39060134100). See "Phase 1: outcome" below. |
| 2 Integration and local mode | Done (2026-10-17). CI green on GitHub (run 39072815810). See "Phase 2: outcome" below. |
| 2.5 Markdoc tags and MDX components | Done (2026-10-17). CI green on GitHub (run 39085788652). See "Phase 2.5: outcome" below. |
| 2.6 URLs, hierarchy and redirects | In progress. See "Phase 2.6 (design)" below. |
| 2.7 onward | Roadmap below |

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

