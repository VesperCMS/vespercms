import { describe, expect, it } from 'vitest';
import { assembleBody, keepAll, parseBody } from './blocks.ts';
import type { BodyBlock, BodyItem } from './types.ts';

const text = (body: string, b: BodyBlock | undefined) => (b ? body.slice(b.start, b.end) : '');

describe('Markdoc blocks', () => {
  it('parses like Astro: tags inside HTML comments are comments', () => {
    const body = 'One.\n\n<!-- later {% comment %}x{% /comment %} -->\n\nTwo.\n';
    expect(parseBody(body, 'mdoc').blocks.map((b) => [b.type, b.kind])).toEqual([
      ['paragraph', 'markdown'],
      ['comment', 'source'],
      ['paragraph', 'markdown'],
    ]);
  });

  it('treats inline HTML as HTML only when the site allows it', () => {
    const body = '<a href="/x">Contact</a> us.\n\n<table>\n  <tr><td>1</td></tr>\n</table>\n';
    expect(parseBody(body, 'mdoc').blocks.map((b) => b.kind)).toEqual(['markdown', 'markdown']);
    const html = parseBody(body, 'mdoc', { markdoc: { allowHTML: true } }).blocks;
    expect(html.map((b) => [b.type, b.kind])).toEqual([
      ['paragraph', 'source'],
      ['html_block', 'source'],
    ]);
  });

  it('gives a container its opening, closing and children', () => {
    const body =
      '{% callout type="tip"\n   title="Before you start" %}\nYou’ll need:\n\n- Astro 6 or 7\n{% /callout %}\n';
    const [block] = parseBody(body, 'mdoc').blocks;
    expect(block?.kind).toBe('tag');
    expect(block?.tag).toMatchObject({ syntax: 'markdoc', name: 'callout', selfClosing: false });
    expect(body.slice(block?.start, block?.tag?.openEnd)).toBe(
      '{% callout type="tip"\n   title="Before you start" %}',
    );
    expect(body.slice(block?.tag?.closeStart, block?.end)).toBe('{% /callout %}');
    expect(block?.tag?.children?.map((c) => [c.type, text(body, c)])).toEqual([
      ['paragraph', 'You’ll need:'],
      ['list', '- Astro 6 or 7'],
    ]);
  });

  it('nests: if with else, and a callout inside', () => {
    const body =
      '{% if $beta %}\nBeta.\n{% callout %}\nIn.\n{% /callout %}\n{% else /%}\nStable.\n{% /if %}\n';
    const [block] = parseBody(body, 'mdoc').blocks;
    const children = block?.tag?.children ?? [];
    expect(children.map((c) => [c.kind, text(body, c)])).toEqual([
      ['markdown', 'Beta.'],
      ['tag', '{% callout %}\nIn.\n{% /callout %}'],
      ['tag', '{% else /%}'],
      ['markdown', 'Stable.'],
    ]);
    expect(children[1]?.tag?.children?.map((c) => text(body, c))).toEqual(['In.']);
    expect(children[2]?.tag).toMatchObject({ name: 'else', selfClosing: true });
  });

  it('keeps a tag whose closing shares a line with content whole, with an editable opening', () => {
    const body = '{% callout %}\nFirst\nsecond{% /callout %}\n';
    const [block] = parseBody(body, 'mdoc').blocks;
    expect(block?.kind).toBe('tag');
    expect(block?.tag?.children).toBeUndefined();
    expect(body.slice(block?.start, block?.tag?.openEnd)).toBe('{% callout %}');
    // On one line, Markdoc reads it as an inline tag in a paragraph.
    const inline = parseBody('{% callout %}Inline{% /callout %}\n', 'mdoc').blocks[0];
    expect([inline?.type, inline?.kind, inline?.chips?.length]).toEqual([
      'paragraph',
      'markdown',
      1,
    ]);
    // An unbalanced tag in a paragraph is kept as written.
    expect(parseBody('{% callout %}First\nsecond\n{% /callout %}\n', 'mdoc').blocks[0]?.kind).toBe(
      'source',
    );
  });

  it('finds inline tags, variables and annotations as chips, skipping code spans', () => {
    const body =
      'The {% abbr title="a %} b" %}CMS{% /abbr %} by {% $product.name %}, a {% x /%} and `{% code %}`. {% .lead %}\n';
    const [block] = parseBody(body, 'mdoc').blocks;
    expect(block?.kind).toBe('markdown');
    expect(block?.chips?.map((c) => [body.slice(c.start, c.end), c.kind, c.name])).toEqual([
      ['{% abbr title="a %} b" %}CMS{% /abbr %}', 'tag', 'abbr'],
      ['{% $product.name %}', 'variable', undefined],
      ['{% x /%}', 'tag', 'x'],
      ['{% .lead %}', 'annotation', undefined],
    ]);
  });

  it('finds chips in headings and list items', () => {
    const body =
      '## Calculator {% #calc %}\n\n1. Lay a {% affiliateLink slug="towel" /%} down.\n2. Two.\n';
    const blocks = parseBody(body, 'mdoc').blocks;
    expect(blocks.map((b) => b.chips?.map((c) => body.slice(c.start, c.end)))).toEqual([
      ['{% #calc %}'],
      ['{% affiliateLink slug="towel" /%}'],
    ]);
  });

  it('keeps blocks as written when a tag sits in a fence', () => {
    const body = '```\n{% $x %}\n```\n\n- item\n\n  ```\n  {% y %}\n  ```\n';
    expect(parseBody(body, 'mdoc').blocks.map((b) => b.kind)).toEqual(['source', 'source']);
  });

  it('reproduces every byte, and replacing a child changes only that child', () => {
    const body =
      '\r\nIntro {% $v %}.\r\n\r\n{% callout %}\r\nA.\r\n\r\nB.\r\n{% /callout %}\r\n\r\n{% youtube id="x" /%}\r\n';
    const parsed = parseBody(body, 'mdoc');
    expect(assembleBody(parsed, keepAll(parsed))).toBe(body);
    const items = keepAll(parsed).map((item, i): BodyItem =>
      i === 1
        ? { replaces: 1, children: [{ text: 'A, edited.', replaces: 0 }, { keep: 1 }] }
        : item,
    );
    expect(assembleBody(parsed, items)).toBe(body.replace('A.', 'A, edited.'));
  });
});
