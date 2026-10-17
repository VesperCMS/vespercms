# @vesper/core test data

Two kinds of byte-exact test data for the serializers. Both folders are marked `-text` in `.gitattributes` and ignored by Prettier, ESLint and `.editorconfig`, so git, editors and formatters never change a byte. **Don't edit these files by hand.**

## `corpus/`: real-world files

Content files copied from Jeremy's own Astro and Hugo sites, at a recorded commit:

| Site | Files | Notes |
|---|---|---|
| `jazzy-astro5` | Markdoc (`.mdoc`) | Custom tags with multi-line array attributes, undefined `{% comment %}` tags, double-quoted frontmatter |
| `jazzycabbages` | Markdown (`.md`) | The same site's Hugo predecessor: page bundles (`index.md`), ISO datetimes, commented-out keys |
| `thosegeeks-astro` | MDX, YAML | Folded `>-` strings, single quotes, commented-out first keys |
| `cookingnerdy-astro` | MDX, YAML | `- text: >-` inside lists, empty flow sequences |

`corpus/sources.json` records each file's site, commit, source path, variant and SHA-256.

- **`committed`** variants are the bytes in git (all LF).
- **`_worktree/crlf`** and **`_worktree/mixed`** hold working-tree copies taken from Windows checkouts. Those have CRLF or mixed line endings that never reach git, but real editors save them.

Rebuild with `node scripts/corpus-import.mjs`. It expects the sites checked out next to this repository; set `VESPER_CORPUS_SOURCES` to point elsewhere.

**Client sites are never committed.** `node scripts/corpus-import.mjs --private <dir>` writes them to a directory outside the repo. Tests include that directory when `VESPER_PRIVATE_CORPUS=<dir>` is set, so it runs locally only, never in CI.

## `fixtures/`: synthetic edge cases

Written by `scripts/fixtures-generate.mjs`. They cover what the real corpus lacks:

- **`frontmatter/`:**
  - CRLF, mixed line endings, BOM, no trailing newline, blank lines before the fence;
  - empty and missing frontmatter, `---` inside the body, TOML (`+++`);
  - comments everywhere, anchors, aliases and merge keys, explicit tags;
  - every block and multi-line scalar style, flow collections with odd spacing;
  - every date shape, type-sensitive scalars, four-space indentation, Unicode;
  - duplicate keys, invalid YAML, Latin-1 bytes;
  - a block that js-yaml accepts and `yaml` rejects;
  - MDX `import`/`export` lines and a Markdoc body.
- **`data/`:**
  - JSON with 2-space, 4-space and tab indentation, plus CRLF, minified and no-trailing-newline variants;
  - a `$schema` key, `file()` loader arrays and id-keyed objects, duplicate keys;
  - YAML data files: a `glob()` entry, `file()` arrays and maps, CRLF;
  - TOML.
