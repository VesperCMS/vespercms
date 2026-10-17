// Writes the synthetic serializer fixtures (packages/core/test/fixtures/)
// with exact bytes: CRLF, BOMs, Latin-1 and parser edge cases that an editor
// would silently "fix". Rerun after changing a fixture here, never edit the
// fixture files by hand.
// Usage: node scripts/fixtures-generate.mjs packages/core/test/fixtures
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const out = process.argv[2];
rmSync(out, { recursive: true, force: true });

const files = {
  // ---------------------------------------------------------------- frontmatter
  'frontmatter/crlf.md':
    '---\r\ntitle: Line endings\r\ntags: [a, b]\r\n---\r\n\r\nEvery line ends with CRLF.\r\n',
  'frontmatter/mixed-eol.md':
    '---\r\ntitle: Mixed endings\nsummary: Some lines CRLF, some LF\r\ncount: 3\n---\n\nBody line one.\r\nBody line two.\n',
  'frontmatter/bom.md':
    '\uFEFF---\ntitle: Starts with a byte-order mark\n---\n\nThe BOM must survive a save.\n',
  'frontmatter/no-trailing-newline.md':
    '---\ntitle: No final newline\n---\n\nThe file ends without a newline.',
  'frontmatter/leading-blank-lines.md':
    '\n\n---\ntitle: Blank lines before the fence\n---\n\nAstro accepts whitespace-only lines before the opening fence.\n',
  'frontmatter/empty.md': '---\n---\n\nAn empty frontmatter block.\n',
  'frontmatter/none.md': '# No frontmatter\n\nThis file has a body only.\n',
  'frontmatter/dashes-in-body.md':
    '---\ntitle: Horizontal rules\n---\n\nAbove the rule.\n\n---\n\nBelow the rule.\n\n---\nnot: frontmatter\n---\n',
  'frontmatter/toml.md':
    '+++\ntitle = "TOML frontmatter"\ntags = ["a", "b"]\n+++\n\nTOML is read-only in v1.\n',
  'frontmatter/comments.md': [
    '---',
    '# A leading comment',
    'title: Comments everywhere # trailing comment',
    '',
    '# A comment between keys, after a blank line',
    'summary: >-',
    '  A folded summary that continues',
    '  onto a second line.',
    'tags:',
    '  - one # first',
    '  # a comment inside the sequence',
    '  - two',
    '# A closing comment',
    '---',
    '',
    'Body.',
    '',
  ].join('\n'),
  'frontmatter/anchors.md': [
    '---',
    'defaults: &defaults',
    '  layout: post',
    '  comments: true',
    'post:',
    '  <<: *defaults',
    '  title: Uses a merge key',
    'alias: *defaults',
    '---',
    '',
    'Anchors, aliases and merge keys take the reformatting fallback path.',
    '',
  ].join('\n'),
  'frontmatter/tags.md':
    '---\ntitle: Explicit tags\nzip: !!str 01234\nratio: !!float 1\n---\n\nExplicit YAML tags.\n',
  'frontmatter/block-scalars.md': [
    '---',
    'literal: |',
    '  Line one',
    '    indented line',
    '  Line three',
    'folded: >',
    '  Folded text',
    '  joins lines.',
    'strip: >-',
    '  No trailing newline.',
    'keep: |+',
    '  Keeps trailing newlines.',
    '',
    'indicator: |2',
    '    Explicit indentation indicator.',
    "single: 'It''s quoted",
    "  across lines'",
    'double: "Escapes \\t and \\u00e9',
    '  continue here"',
    '---',
    '',
    'Block and multi-line flow scalars.',
    '',
  ].join('\n'),
  'frontmatter/flow.md': [
    '---',
    'tight: {a: 1,b: 2}',
    'padded: { a: 1, b: 2 }',
    'list: [ one,two , three ]',
    'nested: {point: {x: 1, y: 2}, tags: [x, y]}',
    'multiline: [',
    '  first,',
    '  second,',
    ']',
    '---',
    '',
    'Flow collections with inconsistent spacing.',
    '',
  ].join('\n'),
  'frontmatter/dates.md': [
    '---',
    'dateOnly: 2026-10-17',
    'utc: 2026-10-17T14:30:00Z',
    'offset: 2026-11-01T01:30:00-04:00',
    'fractional: 2026-10-17T14:30:00.123Z',
    'spaced: 2026-10-17 14:30:00',
    'quoted: "2026-10-17"',
    '---',
    '',
    'Every date shape YAML allows.',
    '',
  ].join('\n'),
  'frontmatter/scalars.md': [
    '---',
    'plainNumber: 42',
    'negative: -3.5',
    'hex: 0x1F',
    'octal: 0o17',
    'exponent: 1.5e3',
    'nothing: null',
    'tilde: ~',
    'empty:',
    'yes: yes',
    'booleanish: "true"',
    'trueValue: true',
    'versionString: 1.10',
    'colon: "a: b"',
    'hashInside: "#not-a-comment"',
    'url: https://example.com/a?b=c#d',
    'emoji: 🍃 leaves',
    'cjk: 日本語のテキスト',
    'rtl: שלום',
    '---',
    '',
    'Scalars whose type depends on quoting.',
    '',
  ].join('\n'),
  'frontmatter/indent-4.md':
    '---\ntitle: Four-space indentation\nnav:\n    label: Home\n    order: 1\nitems:\n    -   name: a\n        value: 1\n    -   name: b\n        value: 2\n---\n\nIndented with four spaces.\n',
  'frontmatter/duplicate-keys.md':
    '---\ntitle: First\ntitle: Second\n---\n\nDuplicate keys are an error in both parsers: source-only.\n',
  'frontmatter/invalid-yaml.md':
    '---\ntitle: [unclosed\nsummary: broken\n---\n\nUnparseable frontmatter: source-only.\n',
  'frontmatter/parser-disagreement.md': [
    '---',
    'svg: \'<svg viewBox="0 0 10 10">',
    '<path d="M0 0h10v10z"/>',
    "</svg>'",
    'title: Multi-line single quotes at column 0',
    '---',
    '',
    'js-yaml accepts this; yaml rejects it. The block is source-only.',
    '',
  ].join('\n'),
  'frontmatter/not-utf8.md': Buffer.concat([
    Buffer.from('---\ntitle: Caf'),
    Buffer.from([0xe9]),
    Buffer.from('\n---\n\nLatin-1, not UTF-8: read-only.\n'),
  ]),
  'frontmatter/imports.mdx': [
    '---',
    'title: MDX with imports',
    '---',
    "import Chart from '../components/Chart.astro';",
    'export const meta = { wide: true };',
    '',
    '# {frontmatter.title}',
    '',
    '<Chart data={[1, 2, 3]} />',
    '',
    'Some text with an {meta.wide ? "expression" : "other"} inside.',
    '',
  ].join('\n'),
  'frontmatter/markdoc.mdoc': [
    '---',
    'title: Markdoc body',
    '---',
    '',
    '{% callout type="note" %}',
    'A tag the frontmatter split must leave untouched.',
    '{% /callout %}',
    '',
    '{% $variable %} and {% if $flag %}conditional{% /if %}.',
    '',
  ].join('\n'),

  // ---------------------------------------------------------------- data files
  'data/indent-2.json':
    '{\n  "title": "Two spaces",\n  "count": 2,\n  "tags": ["a", "b"],\n  "nested": {\n    "on": true\n  }\n}\n',
  'data/indent-4.json': '{\n    "title": "Four spaces",\n    "count": 4\n}\n',
  'data/tabs.json': '{\n\t"title": "Tabs",\n\t"list": [\n\t\t1,\n\t\t2\n\t]\n}\n',
  'data/crlf.json': '{\r\n  "title": "CRLF",\r\n  "count": 1\r\n}\r\n',
  'data/no-trailing-newline.json': '{\n  "title": "No final newline"\n}',
  'data/minified.json': '{"title":"Minified","tags":["a","b"],"count":3}\n',
  'data/schema-key.json':
    '{\n  "$schema": "../schemas/settings.json",\n  "title": "Has a $schema key"\n}\n',
  'data/file-loader-array.json':
    '[\n  { "id": "ada", "name": "Ada" },\n  {\n    "id": "sam",\n    "name": "Sam",\n    "role": "Writer"\n  }\n]\n',
  'data/file-loader-object.json':
    '{\n  "$schema": "./authors.schema.json",\n  "ada": { "name": "Ada" },\n  "sam": {\n    "name": "Sam"\n  }\n}\n',
  'data/duplicate-keys.json': '{\n  "title": "First",\n  "title": "Second"\n}\n',
  'data/settings.yaml':
    '# A glob() data entry\nsiteName: Example\nsocial:\n  - network: mastodon\n    url: https://example.com/@a\n',
  'data/file-loader-array.yaml':
    '- id: one\n  name: First\n  geo: { lat: 1, lng: 2 }\n- id: two\n  name: "Second"\n  geo:\n    lat: 3\n    lng: 4\n',
  'data/file-loader-map.yaml': 'one:\n  name: First\ntwo:\n  name: Second\n',
  'data/crlf.yaml': 'title: CRLF data\r\nitems:\r\n  - a\r\n  - b\r\n',
  'data/data.toml': 'title = "TOML data"\n',
};

for (const [path, content] of Object.entries(files)) {
  const target = join(out, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
console.log(`wrote ${Object.keys(files).length} fixtures`);
