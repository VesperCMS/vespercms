---
'vespercms': patch
'@vespercms/core': patch
'@vespercms/admin': patch
---

Fields for real schedules: `.meta({ showWhen: { field, equals } })` shows a field only while a sibling holds a value (hidden, it keeps its value); `fields.time()` is a time of day, stored as 24-hour `"18:00"`, with the browser's time picker; a list's `summary` can name several fields (`['date', 'start', 'title']`), joined with " · ", and rows show dates and times in words. Also: list columns show a select's label, `listSort` sets a list's first sort, `getSingleton()` in `vesper:content`, and a `url` function may return `undefined` for an entry with no page.
