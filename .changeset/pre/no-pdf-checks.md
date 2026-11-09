---
'vespercms': patch
'@vespercms/core': patch
'@vespercms/admin': patch
---

The studio no longer checks PDFs: the `pdf-untagged`, `pdf-no-title` and `pdf-no-language` rules, `pdfNotes` and `pdfjs-dist` are gone, which takes about 68 MB off a site's install. PDFs still upload through `fields.file()` and the Media screen.
