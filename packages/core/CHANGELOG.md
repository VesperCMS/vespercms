# @vespercms/core

## 0.1.0-next.2

### Patch Changes

- b23d2bc: The studio no longer checks PDFs: the `pdf-untagged`, `pdf-no-title` and `pdf-no-language` rules, `pdfNotes` and `pdfjs-dist` are gone, which takes about 68 MB off a site's install. PDFs still upload through `fields.file()` and the Media screen.
- b4123f1: Unpublish an entry by hand: in a collection with a true-or-false `draft` field, the studio's "…" menu has Unpublish… and Make it live, and `vesper:content` and the search index leave drafts out of the build.
- 0231a5e: The body and tags: a line break is written as a backslash, so two in a row no longer split a paragraph; `fields.image()` with no helper and `fields.reference()` give a Markdoc tag's settings an image picker (stored as a path from the site's root, which `<Img>` resolves) and an entry picker; and `links()` from `vespercms/markdoc` opens links to other sites in a new tab, saying so to screen readers.
- 94e5547: Fields for real schedules: `.meta({ showWhen: { field, equals } })` shows a field only while a sibling holds a value (hidden, it keeps its value); `fields.time()` is a time of day, stored as 24-hour `"18:00"`, with the browser's time picker; a list's `summary` can name several fields (`['date', 'start', 'title']`), joined with " · ", and rows show dates and times in words. Also: list columns show a select's label, `listSort` sets a list's first sort, `getSingleton()` in `vesper:content`, and a `url` function may return `undefined` for an entry with no page.

## 0.1.0-next.1

### Patch Changes

- 475a434: The studio colours an entry's state word (Live, Scheduled, Draft), pulses the status dot while a save runs, and leaves an empty date field blank in Safari until it's used.

## 0.1.0-next.0

### Minor Changes

- The first prerelease on npm, under the `next` tag: `npx astro add vespercms@next`.
