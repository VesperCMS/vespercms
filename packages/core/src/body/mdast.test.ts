import { describe, expect, it } from 'vitest';
import { assembleBody, keepAll, parseBody } from './blocks.ts';
import type { BodyItem } from './types.ts';

describe('MDX blocks', () => {
  const body = [
    "import Gallery from './Gallery.astro';",
    '',
    'Intro with <Abbr title="x">CMS</Abbr> and {count} things.',
    '',
    '<Callout type="tip" title=\'Visiting?\'>',
    '  Tours leave at 10.',
    '',
    '  - one',
    '</Callout>',
    '',
    '<YouTube id="a" title="b" />',
    '',
    '<>',
    'fragment',
    '</>',
    '',
  ].join('\n');
  const { blocks } = parseBody(body, 'mdx');

  it('makes JSX elements tags, with children when laid out on their own lines', () => {
    expect(blocks.map((b) => [b.type, b.kind, b.tag?.name, b.tag?.selfClosing])).toEqual([
      ['mdxjsEsm', 'source', undefined, undefined],
      ['paragraph', 'markdown', undefined, undefined],
      ['mdxJsxFlowElement', 'tag', 'Callout', false],
      ['mdxJsxFlowElement', 'tag', 'YouTube', true],
      ['mdxJsxFlowElement', 'source', undefined, undefined],
    ]);
    const callout = blocks[2];
    expect(body.slice(callout?.start, callout?.tag?.openEnd)).toBe(
      '<Callout type="tip" title=\'Visiting?\'>',
    );
    expect(body.slice(callout?.tag?.closeStart, callout?.end)).toBe('</Callout>');
    expect(callout?.tag?.indent).toBe('  ');
    expect(callout?.tag?.children?.map((c) => body.slice(c.start, c.end))).toEqual([
      'Tours leave at 10.',
      '- one',
    ]);
  });

  it('finds inline JSX and expressions as chips', () => {
    expect(blocks[1]?.chips?.map((c) => [body.slice(c.start, c.end), c.kind, c.name])).toEqual([
      ['<Abbr title="x">CMS</Abbr>', 'component', 'Abbr'],
      ['{count}', 'expression', undefined],
    ]);
  });

  it('reproduces every byte, and splices one child', () => {
    const parsed = parseBody(body, 'mdx');
    expect(assembleBody(parsed, keepAll(parsed))).toBe(body);
    const items = keepAll(parsed).map((item, i): BodyItem =>
      i === 2
        ? { replaces: 2, children: [{ keep: 0 }, { text: '- one\n- two', replaces: 1 }] }
        : item,
    );
    expect(assembleBody(parsed, items)).toBe(body.replace('  - one', '  - one\n  - two'));
  });
});
