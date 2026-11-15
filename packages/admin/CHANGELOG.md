# @vespercms/admin

## 0.1.0-next.3

### Patch Changes

- 2a1602b: Forms (Phase 6a): define a form in `src/forms.config.ts` with `defineForm` from `vespercms/forms`, and put it on a page with `<Form name="…" />` from `vespercms/components`. It works without JavaScript, posting to Vesper Cloud, which sends the browser back to the page's thanks message or shows the form again with the answers kept; with JavaScript, Vesper's own 5 KB script checks answers, posts without leaving the page and moves focus to the error summary or the thanks message. Fields can be text (`tel` is new), numbers, dates and times, choices, lists of choices (`checkboxes`), yes or no (`checkbox`) and groups. The build refuses what a form can't take and warns that a `.refine()` never runs on a submission; without a cloud project each form says it isn't connected yet. In `astro dev` posts are kept in `.vesper/forms/` and nothing is sent. `@vespercms/core/forms` has the reading, routing, confirmation and drawing the cloud shares, and `runCloudContract` a forms section. File uploads come in Phase 6b.
- 448d685: Each package includes its `CHANGELOG.md`, so `node_modules/vespercms/CHANGELOG.md` says what changed before you update.
- Updated dependencies [2a1602b]
- Updated dependencies [448d685]
  - @vespercms/core@0.1.0-next.3

## 0.1.0-next.2

### Patch Changes

- b23d2bc: The studio no longer checks PDFs: the `pdf-untagged`, `pdf-no-title` and `pdf-no-language` rules, `pdfNotes` and `pdfjs-dist` are gone, which takes about 68 MB off a site's install. PDFs still upload through `fields.file()` and the Media screen.
- 9d818e6: Discard changes from an entry's "…" menu without leaving it; the Link tool lights up with the caret in a link; and a list's rows show the pointer over their words.
- b4123f1: Unpublish an entry by hand: in a collection with a true-or-false `draft` field, the studio's "…" menu has Unpublish… and Make it live, and `vesper:content` and the search index leave drafts out of the build.
- 0231a5e: The body and tags: a line break is written as a backslash, so two in a row no longer split a paragraph; `fields.image()` with no helper and `fields.reference()` give a Markdoc tag's settings an image picker (stored as a path from the site's root, which `<Img>` resolves) and an entry picker; and `links()` from `vespercms/markdoc` opens links to other sites in a new tab, saying so to screen readers.
- 94e5547: Fields for real schedules: `.meta({ showWhen: { field, equals } })` shows a field only while a sibling holds a value (hidden, it keeps its value); `fields.time()` is a time of day, stored as 24-hour `"18:00"`, with the browser's time picker; a list's `summary` can name several fields (`['date', 'start', 'title']`), joined with " · ", and rows show dates and times in words. Also: list columns show a select's label, `listSort` sets a list's first sort, `getSingleton()` in `vesper:content`, and a `url` function may return `undefined` for an entry with no page.
- Updated dependencies [b23d2bc]
- Updated dependencies [b4123f1]
- Updated dependencies [0231a5e]
- Updated dependencies [94e5547]
  - @vespercms/core@0.1.0-next.2

## 0.1.0-next.1

### Patch Changes

- GitHub mode says the site's GitHub App may not be installed when GitHub can't find the repository, instead of telling the editor to ask for write access.
- 475a434: The studio colours an entry's state word (Live, Scheduled, Draft), pulses the status dot while a save runs, and leaves an empty date field blank in Safari until it's used.
- Updated dependencies [475a434]
  - @vespercms/core@0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- The first prerelease on npm, under the `next` tag: `npx astro add vespercms@next`.

### Patch Changes

- Updated dependencies
  - @vespercms/core@0.1.0-next.0
