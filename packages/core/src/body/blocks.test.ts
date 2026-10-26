import { describe, expect, it } from 'vitest';
import { assembleBody, keepAll, parseBody } from './blocks.ts';
import type { BodyItem } from './types.ts';

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

  it('treats MDX imports and expressions as source, JSX as tags, inline expressions as chips', () => {
    const mdx =
      "\nimport X from './x.astro';\n\nHello {name}.\n\n<X a={1} />\n\n{1 + 1}\n\nPlain.\n";
    const { blocks } = parseBody(mdx, 'mdx');
    expect(blocks.map((b) => [b.type, b.kind])).toEqual([
      ['mdxjsEsm', 'source'],
      ['paragraph', 'markdown'],
      ['mdxJsxFlowElement', 'tag'],
      ['mdxFlowExpression', 'source'],
      ['paragraph', 'markdown'],
    ]);
    expect(blocks[1]?.chips?.map((c) => mdx.slice(c.start, c.end))).toEqual(['{name}']);
  });

  it('treats Markdoc tags as tags, and variables and annotations as chips', () => {
    const mdoc =
      '\nPlain.\n\n{% callout %}\nIn.\n{% /callout %}\n\nHi {% $name %}.\n\nLead. {% .lead %}\n';
    const { blocks } = parseBody(mdoc, 'mdoc');
    expect(blocks.map((b) => [b.type, b.kind])).toEqual([
      ['paragraph', 'markdown'],
      ['tag', 'tag'],
      ['paragraph', 'markdown'],
      ['paragraph', 'markdown'],
    ]);
    expect(mdoc.slice(blocks[1]?.start, blocks[1]?.end)).toBe('{% callout %}\nIn.\n{% /callout %}');
    expect(blocks[2]?.chips?.map((c) => [mdoc.slice(c.start, c.end), c.kind])).toEqual([
      ['{% $name %}', 'variable'],
    ]);
    expect(blocks[3]?.chips?.map((c) => [mdoc.slice(c.start, c.end), c.kind])).toEqual([
      ['{% .lead %}', 'annotation'],
    ]);
  });

  it('protects what the writing view would change: HTML in tables, task items, footnotes, titles, reference links', () => {
    const text = [
      '| a | b |\n| - | - |\n| 1<br>2 | 3 |',
      '- [ ] todo',
      'Note[^1].',
      '[^1]: The note.',
      'A [link](https://example.com "Title").',
      'A [reference][ref].',
      'Plain **bold**, *em*, `code`, ~~gone~~ and a [link](/x) with ![alt](./a.jpg).',
      '[ref]: https://example.com',
    ].join('\n\n');
    expect(parseBody(text, 'md').blocks.map((b) => b.kind)).toEqual([
      'source',
      'source',
      'source',
      'source',
      'source',
      'source',
      'markdown',
      'source',
    ]);
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

describe('assembleBody with containers', () => {
  const body =
    '\nIntro.\n\n{% callout type="tip" %}\nFirst.\n\nSecond.\n{% /callout %}\n\nOutro.\n';
  const parsed = parseBody(body, 'mdoc');
  const at = (index: number, item: BodyItem) =>
    keepAll(parsed).map((kept, i) => (i === index ? item : kept));

  it('splices one child and keeps the opening, the closing and the other children', () => {
    const items = at(1, {
      replaces: 1,
      children: [{ keep: 0 }, { text: 'Changed.', replaces: 1 }],
    });
    expect(assembleBody(parsed, items)).toBe(body.replace('Second.', 'Changed.'));
  });

  it('replaces only the opening', () => {
    const items = at(1, {
      replaces: 1,
      open: '{% callout type="warning" %}',
      children: [{ keep: 0 }, { keep: 1 }],
    });
    expect(assembleBody(parsed, items)).toBe(body.replace('type="tip"', 'type="warning"'));
  });

  it('moves, removes and adds children inside the container', () => {
    const swap = at(1, { replaces: 1, children: [{ keep: 1 }, { keep: 0 }] });
    expect(assembleBody(parsed, swap)).toBe(body.replace('First.\n\nSecond.', 'Second.\n\nFirst.'));
    expect(assembleBody(parsed, at(1, { replaces: 1, children: [] }))).toBe(
      '\nIntro.\n\n{% callout type="tip" %}\n{% /callout %}\n\nOutro.\n',
    );
    const added = at(1, {
      replaces: 1,
      children: [{ keep: 0 }, { keep: 1 }, { text: '- a\n- b' }],
    });
    expect(assembleBody(parsed, added)).toBe(body.replace('Second.\n', 'Second.\n\n- a\n- b\n'));
  });

  it('fills an empty container', () => {
    const empty = parseBody('{% callout %}\n{% /callout %}\n', 'mdoc');
    expect(empty.blocks[0]?.tag?.children).toEqual([]);
    expect(assembleBody(empty, [{ replaces: 0, children: [{ text: 'Now.' }] }])).toBe(
      '{% callout %}\nNow.\n{% /callout %}\n',
    );
  });

  it('writes a new container in house style', () => {
    const items: BodyItem[] = [
      ...keepAll(parsed),
      {
        open: '{% callout %}',
        close: '{% /callout %}',
        children: [{ text: 'One.' }, { text: 'Two.' }],
      },
    ];
    expect(assembleBody(parsed, items)).toBe(
      `${body}\n{% callout %}\nOne.\n\nTwo.\n{% /callout %}\n`,
    );
  });

  it('indents new and changed children like the original content, in the body’s line endings', () => {
    const mdx = '<Callout>\r\n  Tours leave at 10.\r\n\r\n  Bring water.\r\n</Callout>\r\n';
    const jsx = parseBody(mdx, 'mdx');
    expect(jsx.blocks[0]?.tag?.indent).toBe('  ');
    const items: BodyItem[] = [
      {
        replaces: 0,
        children: [
          { text: 'Tours leave\nat 10 and 2.', replaces: 0 },
          { keep: 1 },
          { text: 'New.' },
        ],
      },
    ];
    expect(assembleBody(jsx, items)).toBe(
      '<Callout>\r\n  Tours leave\r\n  at 10 and 2.\r\n\r\n  Bring water.\r\n\r\n  New.\r\n</Callout>\r\n',
    );
  });
});
