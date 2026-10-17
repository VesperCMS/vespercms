# @vesper/admin

The Vesper studio: the editor served at `/admin`. One bundle for every storage mode. `@vesper/astro` injects the page that mounts it, so sites never import this package themselves.

**Status:** Phase 2, in progress. In place: the shell, Home, the entry list (search, status filter, sortable columns), and the editor (title as heading, fields in schema order, Details, the body in a writing view that splices changed blocks into the original text (plus a source view), save with validation and conflict handling, delete, unsaved-changes guard). Every built-in widget works, including image and file uploads with hygiene, the media browser, the reference pickers, color, geo with an optional map, slug and date-time in the site's time zone.

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

`body/document.ts` turns a body into editor nodes (one per writable block, tagged with its index) and protected source blocks, and back into text with `assembleBody`, so only changed blocks are rewritten. `body/BodyEditor.tsx` is the toolbar, the writing view, the source view, and the link and image dialogs.

## Media

- `media/formats.ts` reads JPEG, PNG and WebP structure (size, EXIF orientation, location) and strips metadata without decoding. `media/hygiene.ts` decides what each upload needs: a lossless strip, a canvas re-encode (to turn a photo upright or scale it down), HEIC conversion where the browser can decode it, or SVG sanitizing with DOMPurify.
- `media/upload.ts` checks for a duplicate by SHA-256 before uploading. The picker and the media browser share it.

## Accessibility

Every screen renders through `Screen`: a skip link, a `header` with the top bar, `main` with exactly one `h1`, and focus moved to that heading after each in-app navigation. Tests in `src/**/*.test.tsx` run axe and keyboard checks in jsdom.
