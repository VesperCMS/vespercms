---
'vespercms': patch
'@vespercms/core': patch
'@vespercms/admin': patch
---

Unpublish an entry by hand: in a collection with a true-or-false `draft` field, the studio's "…" menu has Unpublish… and Make it live, and `vesper:content` and the search index leave drafts out of the build.
