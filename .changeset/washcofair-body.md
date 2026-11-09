---
'vespercms': patch
'@vespercms/core': patch
'@vespercms/admin': patch
---

The body and tags: a line break is written as a backslash, so two in a row no longer split a paragraph; `fields.image()` with no helper and `fields.reference()` give a Markdoc tag's settings an image picker (stored as a path from the site's root, which `<Img>` resolves) and an entry picker; and `links()` from `vespercms/markdoc` opens links to other sites in a new tab, saying so to screen readers.
