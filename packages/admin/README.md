# @vespercms/admin

The Vesper studio: the editor served at `/admin`. One bundle for every storage mode. `vespercms` injects the page that mounts it, so sites never import this package themselves.

**Status:** Phases 2 to 3 complete, and Phase 4's half in this repository: the cloud's sign-in, drafts, Changes and review (see "The cloud" below). In place: the shell, Home, the entry list (search, status filter, sortable columns), and the editor (title as heading, fields in schema order, Details, the body in a writing view that splices changed blocks into the original text (plus a source view), save with validation and conflict handling, delete, unsaved-changes guard). Every built-in widget works, including image and file uploads with hygiene, the media browser, the reference pickers, color, geo with an optional map, slug and date-time in the site's time zone. Markdoc tags and declared MDX components are blocks in the body editor, with settings, a "/" insert list, and live validation that stops a save the site couldn't build. Tree collections open as an outline of pages with moves, order, child and section pages; the Redirects screen edits redirects and imports them from CSV; and links can be picked from the site's pages. A `fields.image()` field sets its focal point and crops behind a "Focal point & crops" disclosure. Accessibility notes sit beside the fields they concern, with a count in the top bar that opens a drawer of every note. Since the studio design pass, every screen follows Vesper's design system (Pine), and on wide screens Details opens as a drawer from the top bar.


## How it's built

The studio ships as compiled JavaScript and CSS (DECISIONS.md, "Studio"):

- `dist/studio.js`: ES module. React, React DOM, React Aria Components and `@vespercms/core` stay external, so the site's Vite bundles **one** React for the studio and the site's custom widgets.
- `dist/studio.css`: Tailwind 4 plus the `@vespercms/ui` tokens, compiled at publish time, with Figtree 400 and 600 (latin, from `@fontsource/figtree`) inlined, so `/admin` requests no font from Google or a CDN. Sites need no Tailwind of their own.
- `@vespercms/ui` is private and is bundled in.

`npm run build -w @vespercms/admin` runs `vite build` (library mode, entry `src/build.ts`) and then `tsc -p tsconfig.build.json` for type declarations. The root `npm run build` includes it. In this workspace, the `@vesper/source` condition points both exports at `src/`, so dev and tests never read `dist/`.

## Mounting

```ts
import { createLocalApi, mountStudio } from '@vespercms/admin';
import '@vespercms/admin/studio.css';

mountStudio(document.getElementById('vesper-studio')!, {
  manifest,                              // from virtual:vesper/manifest
  api: createLocalApi('/_vesper/api'),   // null on a build with no back end yet
  widgets,                               // custom widgets from vesper.config.ts
  loadMdxProps,                          // loads declared MDX components' Zod props schemas
  siteName: 'Playground',
});
```

With `api: null` and `github` set (a built site in GitHub mode), the studio signs the editor in with GitHub first, through the site's relay, and then saves to the repository: `github: { owner, repo, branch, root, relay, apiUrl?, schemas }`, plus `routes` (the site's static routes) and `loadUrlFunctions`. `vespercms` writes all of it into the page.

## GitHub mode (spec §6.8)

- `github/session.ts`: the sign-in. The studio keeps a state and a PKCE verifier in `sessionStorage`, goes to the relay's `/authorize`, and on the way back posts the code and verifier to `/token`. Only the 8-hour access token is kept, in `sessionStorage`.
- `github/GitHubGate.tsx`: before the studio. It finishes a sign-in, checks the editor can push, and shows "Sign in with GitHub", "Your GitHub account can't change this site", "GitHub can't find this site's repository" (a 404, most often the app not yet installed there) or "GitHub couldn't be reached".
- `github/api.ts`: `createGitHubApi`, the same core services local mode's dev API runs, over `GitHubStorage`. It validates with the site's schemas built for the browser (`_vesper/schemas.js`), or the field model's checks when those can't load. Files come back as object URLs, and GitHub's errors are put in plain words.
- `github/cache.ts`: file bytes by git blob SHA in IndexedDB, so a later visit reads only what changed.
- Signed in, the top bar has the user menu (`@login`, Sign out of GitHub). The editor's button reads Publish, and an expired sign-in keeps the open entry's unsaved changes across the sign-in.

## The cloud (spec §6.9, §7.4)

- `cloud/session.ts`: the sign-in. A top-level redirect to the app's `/authorize` with PKCE, back to `/admin/#/callback` with a one-time code, exchanged for tokens bound to a non-extractable key (DPoP). The key and tokens are kept together in IndexedDB, so a reload stays signed in; renewals run one tab at a time (a Web Lock), since a rotated refresh token used twice ends the sign-in.
- `cloud/CloudGate.tsx`: before the studio. "Sign in with Vesper", with "Sign in with GitHub" too when the site has GitHub mode, and "Vesper couldn't be reached" with Try again.
- `cloud/storage.ts`: `CloudStorage`, the site as its drafts show it, read through the cloud's git proxy, with bytes checked against their blob SHA and cached by it. Every save is a draft. It keeps the storage contract.
- `cloud/connection.ts`: the back end over it (`app/browser-api.ts`, shared with GitHub mode), the drafts store screens subscribe to, and what the member may do (`access`, `draftAccess`).
- `cloud/editor.tsx`, in the editor: a draft saves itself a moment after typing stops, after the same checks as a save; Publish (or Request review, for those who don't publish) sends it on, with the publish gate applying there; a conflict shows both versions side by side; deploy status follows a publish; unsaved changes are kept in IndexedDB until the cloud has them.
- `cloud/changes.tsx`: Changes, a top-bar button with its count in words, opening a drawer with the site's drafts, "Publish 3 changes" and the reviews waiting for an approver. Home says how many drafts wait.
- `cloud/access.ts`: what a member sees: the collections and entries they can edit (viewers see all), a folder grant's branches in a page tree, and Redirects only with the whole site.
- `schedule/cloud.ts`, with the drafts store's `hold`, `release` and `backToDraft`: scheduling connected (spec §6.17). On a site that holds scheduled drafts, Publish holds a draft whose time is still to come. Cancel schedule releases a held draft, or takes a published entry still to come back to a draft. The Scheduled view says where each change stands, and Changes leaves held drafts out of its Publish.

None of it shows unless the studio is connected (spec §6.9). The tests run against `scripts/cloud-fake.mjs`, never the cloud's own code.

## Routes

Hash routes, so deep links and reloads work on any static host without rewrite rules (D16):

| Route | Screen |
|---|---|
| `#/` | Home: collections and singletons, with entry counts and last edits |
| `#/c/:collection` | Entry list, or the page outline for a `tree: true` collection |
| `#/c/:collection/new` | New entry |
| `#/c/:collection/new/:parent` | New page under a parent in the tree (the parent's path, one encoded segment) |
| `#/c/:collection/e/:id` | Editor (the id is one encoded segment, even when it contains `/`) |
| `#/media` | Media browser |
| `#/redirects` | Redirects (from the top bar's Site menu) |

## Pages, moves and redirects (spec §6.15)

- **The outline** (`screens/PageTree.tsx`) replaces the entry list for `tree: true` collections. It's the kit's `Tree`, a treegrid: one row per page with its title, its address in muted text and its status in words ("No section page", "Draft"), collapsed beyond the first level. Enter opens a page. Each row's "…" menu (reached with the right arrow, or Shift+F10) adds a child page, moves it, moves it up or down, creates a missing section page, or deletes it. Alt+↑/↓ move the focused page. Drag and drop (React Aria's, keyboard mode included) is offered on top: a drop between pages reorders, a drop onto a page opens the move dialog. Every change is announced politely.
- **Moving** asks the dev API for a dry run first, and confirms in words: "This moves “Nursing” and its 3 pages to the top level. Its address becomes /nursing/. 8 links on other pages will be updated. Visitors to the old addresses will be sent to the new ones." Refusals (a static route's address, a duplicate, `maxDepth`) show in the dialog.
- **The Redirects screen** (`screens/Redirects.tsx`) lists every redirect with its kind in words, what needs a look (from the same cleanup as the build), one "Add redirect" button, edit and delete in each row's menu, and CSV import with a preview of what's added, replaced and skipped.
- **The link picker** (`editor/PagePicker.tsx`): the body editor's link dialog searches pages by title and writes the page's address, and URL fields get "Choose a page…". A field whose schema takes only full URLs gets the site's address in front, or no picker when Astro's `site` isn't set.

## Widget contract

Custom widgets receive `WidgetProps` (spec §6.3.3): `{ value, onChange, field, id, describedBy, invalid, disabled }`. The editor renders the label, help and error text. A widget labels its control through `id`, forwards `describedBy` and `invalid`, is keyboard operable, and never validates.

## Editor

- Fields render through `Field` (label, help, error) and a widget from `widgets/registry.ts`, falling back from the resolved widget to the inferred one, then to the raw YAML field.
- Saves send the whole value set; the server diffs it against the file, so untouched keys never change. The body is sent only when it changed, with its original line endings and leading line breaks restored.
- Validation errors from the site's schema appear under the deepest field on screen and in an error summary that takes focus. Details opens when an error is inside it.

## Body editor

- `body/document.ts` turns a body into editor nodes, each tagged with its block's path (`3`, or `3.1` inside a frame), and back into items for `assembleBody`, so only what changed is rewritten: a frame's opening only when its attributes change, its children block by block, and a paragraph whose only change is in its chips by splicing the chips into its original text.
- `body/catalog.ts` lists the blocks the site has: its Markdoc tags, Markdoc's `partial` and `if`, and declared MDX components. `body/nodes.ts` makes the editor's node types from it: one frame type per tag with content (its content expression comes from Markdoc's `children`, so only allowed node types fit), a card, an inline chip, and the protected source block.
- `body/views.tsx` draws them: each frame and card is a group named after its tag, with a Settings button and its own validation messages.
- `body/settings.tsx` is the settings dialog: fields from the manifest rendered with the frontmatter widgets, a file picker for partials, a condition field for `if`, raw text for protected constructs, and Move up, Move down and Remove.
- `body/insert.tsx` is the "/" list (the text becomes a combobox while it's open) and the toolbar's Insert menu, both limited to what fits at the cursor.
- `body/BodyEditor.tsx` is the toolbar, the writing view, the source view, the keys, and the link and image dialogs.

Keys in the writing view: arrow onto a block to select it, Enter opens its settings, Alt+↑ and Alt+↓ move it, Delete removes it; Escape inside a frame selects the frame, and Escape again moves to the toolbar. Ctrl+Home and Ctrl+End (⌘↑ and ⌘↓ on a Mac) go to the text's ends, selecting a block that starts or ends the body. The body opens with the caret in its first text.

## Media

- `media/formats.ts` reads JPEG, PNG and WebP structure (size, EXIF orientation, location) and strips metadata without decoding. `media/hygiene.ts` decides what each upload needs: a lossless strip, a canvas re-encode (to turn a photo upright or scale it down), HEIC conversion where the browser can decode it, or SVG sanitizing with DOMPurify.
- `media/upload.ts` checks for a duplicate by git blob SHA (`MediaItem.hash`) before uploading. The picker and the media browser share it, and both scale uploads to the site's `images.maxUploadEdge`. The picker's uploads wait for the entry's publish in GitHub mode, so the two are one commit.
- `fileUrl` is asynchronous: `useFileUrl` and `FileImage` show a site file once its URL is ready.

## Focal point and crops (spec §6.6.4)

- `widgets/focal-point.tsx`: the image is one button. A click or tap sets the focal point and the marker drags; with focus on it, the arrow keys move the point 1% (Shift, 10%). "Across (%)" and "Down (%)" number fields set it without seeing or pointing, and each move is announced politely.
- `widgets/crops.tsx`: a preview per ratio the field lists (or every site ratio), cropped by CSS from the same `cropForRatio` the site's `<Img>` uses, captioned "Wide · 16:9" and "Custom crop" when overridden. "Adjust crop" opens a wide dialog with a fixed-ratio box (`role="application"`): drag it or a corner, or use the arrow keys (Shift resizes); Enter applies, Escape cancels, "Reset to focal point" removes the override. Each change is announced.
- Both only change the entry. Focal points are stored with two decimals, crops with four; the image file is never written.

## Accessibility notes (spec §6.18, layer 1)

- `a11y/useNotes.ts` runs `entryChecker` from `@vespercms/core` a moment after typing stops (the same 300 ms as body validation). The checks read bodies with micromark and Markdoc, so `a11y/run.ts` loads on first use, like the body checks.
- PDFs (file fields, and site PDFs linked from the body) are read once per session with PDF.js (`a11y/pdf.ts`, `pdfjs-dist`'s legacy build, its worker through a Vite `?url` import). It stays external in `dist/` and loads only when a PDF is checked.
- Notes render under their field (`a11y/FieldNotes.tsx`) and join the control's description; an image's alt-text notes sit beside the alt text box. The body's notes are listed under the body editor, each with Show (`body/reveal.ts` finds the block by parsing the current text again).
- The count in the top bar opens `a11y/NotesDrawer.tsx`: every note grouped by field in form order, with Go to field. With `a11y.blockPublishOn`, a listed rule's note refuses the save the way a body the build would fail on is refused, and the error summary links to the field.
- Text only: the one colour is a hairline warning border, and the words say "Accessibility note". Vesper reports problems; it never claims compliance (D19).

## Accessibility

Every screen renders through `Screen`: a skip link, a `header` with the top bar, `main` with exactly one `h1`, and focus moved to that heading after each in-app navigation. Tests in `src/**/*.test.tsx` run axe and keyboard checks in jsdom.
