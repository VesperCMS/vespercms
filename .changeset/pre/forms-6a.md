---
'vespercms': patch
'@vespercms/core': patch
'@vespercms/admin': patch
---

Forms (Phase 6a): define a form in `src/forms.config.ts` with `defineForm` from `vespercms/forms`, and put it on a page with `<Form name="…" />` from `vespercms/components`. It works without JavaScript, posting to Vesper Cloud, which sends the browser back to the page's thanks message or shows the form again with the answers kept; with JavaScript, Vesper's own 5 KB script checks answers, posts without leaving the page and moves focus to the error summary or the thanks message. Fields can be text (`tel` is new), numbers, dates and times, choices, lists of choices (`checkboxes`), yes or no (`checkbox`) and groups. The build refuses what a form can't take and warns that a `.refine()` never runs on a submission; without a cloud project each form says it isn't connected yet. In `astro dev` posts are kept in `.vesper/forms/` and nothing is sent. `@vespercms/core/forms` has the reading, routing, confirmation and drawing the cloud shares, and `runCloudContract` a forms section. File uploads come in Phase 6b.
