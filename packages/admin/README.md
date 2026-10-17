# @vesper/admin

The Vesper studio: the editor served at `/admin`. One bundle for every storage mode. `@vesper/astro` injects the page that mounts it, so sites never import this package themselves.

**Status:** Phase 2, in progress. The shell (top bar, hash routes, the Home screen) and the local-mode API client are in place; the entry list, editor, widgets and media browser come next.

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

## Accessibility

Every screen renders through `Screen`: a skip link, a `header` with the top bar, `main` with exactly one `h1`, and focus moved to that heading after each in-app navigation. Tests in `src/**/*.test.tsx` run axe and keyboard checks in jsdom.
