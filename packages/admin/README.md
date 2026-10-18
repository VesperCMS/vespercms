# @vesper/admin

The Vesper studio: the editor served at `/admin`. One bundle for every storage mode. `@vesper/astro` injects the page that mounts it, so sites never import this package themselves.

**Status:** Phases 2 and 2.5 complete. In place: the shell, Home, the entry list (search, status filter, sortable columns), and the editor (title as heading, fields in schema order, Details, the body in a writing view that splices changed blocks into the original text (plus a source view), save with validation and conflict handling, delete, unsaved-changes guard). Every built-in widget works, including image and file uploads with hygiene, the media browser, the reference pickers, color, geo with an optional map, slug and date-time in the site's time zone. Markdoc tags and declared MDX components are blocks in the body editor, with settings, a "/" insert list, and live validation that stops a save the site couldn't build.

## How it's built

The studio ships as compiled JavaScript and CSS (DECISIONS.md, "Studio"):

- `dist/studio.js`: ES module. React, React DOM, React Aria Components and `@vesper/core` stay external, so the site's Vite bundles **one** React for the studio and the site's custom widgets.
- `dist/studio.css`: Tailwind 4 plus the `@vesper/ui` tokens, compiled at publish time. Sites need no Tailwind of their own.
- `@vesper/ui` is private and is bundled in.

`npm run build -w @vesper/admin` runs `vite build` (library mode, entry `src/build.ts`) and then `tsc -p tsconfig.build.json` for type declarations. The root `npm run build` includes it. In this workspace, the `@vesper/source` condition points both exports at `src/`, so dev and tests never read `dist/`.

## Mounting

```ts
import { createLocalApi, mountStudio } from '@vesper/admin';
import '@vesper/admin/studio.css';

mountStudio(document.getElementById('vesper-studio')!, {
  manifest,                              // from virtual:vesper/manifest
  api: createLocalApi('/_vesper/api'),   // null on a build with no back end yet
  widgets,                               // custom widgets from vesper.config.ts
  loadMdxProps,                          // loads declared MDX components' Zod props schemas
  siteName: 'Playground',
});
```

## Routes

Hash routes, so deep links and reloads work on any static host without rewrite rules (D16):

| Route | Screen |
|---|---|
| `#/` | Home: collections and singletons, with entry counts and last edits |
| `#/c/:collection` | Entry list |
| `#/c/:collection/new` | New entry |
| `#/c/:collection/e/:id` | Editor (the id is one encoded segment, even when it contains `/`) |
| `#/media` | Media browser |

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

Keys in the writing view: arrow onto a block to select it, Enter opens its settings, Alt+↑ and Alt+↓ move it, Delete removes it; Escape inside a frame selects the frame, and Escape again moves to the toolbar.

## Media

- `media/formats.ts` reads JPEG, PNG and WebP structure (size, EXIF orientation, location) and strips metadata without decoding. `media/hygiene.ts` decides what each upload needs: a lossless strip, a canvas re-encode (to turn a photo upright or scale it down), HEIC conversion where the browser can decode it, or SVG sanitizing with DOMPurify.
- `media/upload.ts` checks for a duplicate by SHA-256 before uploading. The picker and the media browser share it.

## Accessibility

Every screen renders through `Screen`: a skip link, a `header` with the top bar, `main` with exactly one `h1`, and focus moved to that heading after each in-app navigation. Tests in `src/**/*.test.tsx` run axe and keyboard checks in jsdom.
