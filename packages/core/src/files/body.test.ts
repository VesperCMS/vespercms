import { describe, expect, it } from 'vitest';
import { assembleBody, keepAll, parseBody } from './body.ts';

const md =
  '\nIntro *text*.\n\n- one\n* two\n\n## Heading\n\n<div>raw</div>\n\n[ref]: https://example.com\n';

describe('parseBody', () => {
  it('splits Markdown into top-level blocks and marks what the writing view can’t show', () => {
    const { blocks } = parseBody(md, 'md');
    expect(blocks.map((b) => [b.type, b.kind])).toEqual([
      ['paragraph', 'markdown'],
      ['list', 'markdown'],
      ['list', 'markdown'],
      ['heading', 'markdown'],
      ['html', 'source'],
      ['definition', 'source'],
    ]);
    expect(md.slice(blocks[0]?.start, blocks[0]?.end)).toBe('Intro *text*.');
  });

  it('treats MDX imports, JSX and expressions as source blocks', () => {
    const mdx = "\nimport X from './x.astro';\n\nHello {name}.\n\n<X a={1} />\n\nPlain.\n";
    expect(parseBody(mdx, 'mdx').blocks.map((b) => [b.type, b.kind])).toEqual([
      ['mdxjsEsm', 'source'],
      ['paragraph', 'source'],
      ['mdxJsxFlowElement', 'source'],
      ['paragraph', 'markdown'],
    ]);
  });

  it('treats Markdoc tags and paragraphs with variables or annotations as source blocks', () => {
    const mdoc =
      '\nPlain.\n\n{% callout %}\nIn.\n{% /callout %}\n\nHi {% $name %}.\n\nLead. {% .lead %}\n';
    const { blocks } = parseBody(mdoc, 'mdoc');
    expect(blocks.map((b) => [b.type, b.kind])).toEqual([
      ['paragraph', 'markdown'],
      ['tag', 'source'],
      ['paragraph', 'source'],
      ['paragraph', 'source'],
    ]);
    expect(mdoc.slice(blocks[1]?.start, blocks[1]?.end)).toBe('{% callout %}\nIn.\n{% /callout %}');
  });

  it('keeps block ranges exact with CRLF', () => {
    const text = '\r\nOne.\r\n\r\nTwo.\r\n';
    for (const format of ['md', 'mdoc'] as const) {
      const { blocks } = parseBody(text, format);
      expect(blocks.map((b) => text.slice(b.start, b.end))).toEqual(['One.', 'Two.']);
    }
  });
});

describe('assembleBody', () => {
  it('reproduces the input exactly when every block is kept', () => {
    const parsed = parseBody(md, 'md');
    expect(assembleBody(parsed, keepAll(parsed))).toBe(md);
  });

  it('replaces one block and leaves every other byte alone', () => {
    const parsed = parseBody(md, 'md');
    const items = keepAll(parsed).map((item, i) =>
      i === 3 ? { text: '## New heading', replaces: 3 } : item,
    );
    expect(assembleBody(parsed, items)).toBe(md.replace('## Heading', '## New heading'));
  });

  it('inserts and removes blocks with blank-line separators in the body’s own line endings', () => {
    const text = '\r\nOne.\r\n\r\nTwo.\r\n';
    const parsed = parseBody(text, 'md');
    expect(assembleBody(parsed, [{ keep: 0 }, { text: 'Middle.\n' }, { keep: 1 }])).toBe(
      '\r\nOne.\r\n\r\nMiddle.\r\n\r\nTwo.\r\n',
    );
    expect(assembleBody(parsed, [{ keep: 1 }])).toBe('\r\nTwo.\r\n');
    expect(assembleBody(parsed, [{ keep: 1 }, { keep: 0 }])).toBe('\r\nTwo.\r\n\r\nOne.\r\n');
  });

  it('fills an empty body', () => {
    const parsed = parseBody('\n', 'md');
    expect(assembleBody(parsed, [{ text: 'First words.' }])).toBe('\nFirst words.\n');
    expect(assembleBody(parsed, [])).toBe('\n');
  });
});
