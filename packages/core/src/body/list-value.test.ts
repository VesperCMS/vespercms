import { describe, expect, it } from 'vitest';
import { editJsxTag } from './jsx-tag.ts';
import { listLayout, sameValue, spliceList } from './list-value.ts';
import { editMarkdocTag, markdocValue } from './markdoc-tag.ts';

const faq = [
  '{% faq items=[',
  '  { question: "How accurate is it?", answer: "It\'s an estimate." },',
  '  { question: "Why weaker?", answer: "Incomplete decarb." },',
  '  { question: "Concentrate?", answer: "Enter its weight." }',
  '] /%}',
].join('\n');

const items = [
  { question: 'How accurate is it?', answer: "It's an estimate." },
  { question: 'Why weaker?', answer: 'Incomplete decarb.' },
  { question: 'Concentrate?', answer: 'Enter its weight.' },
];

/** The lines of `after` that aren't in `before`, and the reverse. */
function diff(before: string, after: string): { added: string[]; removed: string[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  return {
    added: b.filter((line) => !a.includes(line)),
    removed: a.filter((line) => !b.includes(line)),
  };
}

describe('a list attribute written one item per line', () => {
  it('reads its layout, and refuses anything else', () => {
    const value = faq.slice(faq.indexOf('['), faq.lastIndexOf(']') + 1);
    expect(listLayout(value)).toMatchObject({
      indent: '  ',
      closingIndent: '',
      trailingComma: false,
    });
    expect(listLayout(value)?.items).toHaveLength(3);
    expect(listLayout('[1, 2, 3]')).toBeNull();
    expect(listLayout('[\n  1, 2,\n  3\n]')).toBeNull();
    expect(listLayout('[{ a: 1 },\n  { b: 2 }\n]')).toBeNull();
    expect(listLayout('[\n  { a: 1 },\n  { b: 2 }]')).toBeNull();
    expect(listLayout('[\n  "a, b",\n  "c"\n]')?.items).toEqual(['"a, b"', '"c"']);
  });

  it('changes only the changed key’s line in a list written one key per line', () => {
    const tag = [
      '{% faq items=[',
      '  {',
      '    question: "Is it hard?",',
      '    answer: "It has a learning curve."',
      '  },',
      '  {',
      '    question: "What does it cost?",',
      '    answer: "Less than you think."',
      '  }',
      '] /%}',
    ].join('\n');
    const next = [
      { question: 'Is it hard?', answer: 'It has a learning curve.' },
      { question: 'What does it cost?', answer: 'About $200.' },
    ];
    expect(editMarkdocTag(tag, [['items', next]])).toBe(
      tag.replace('"Less than you think."', '"About $200."'),
    );
    // A new item is written in the same layout.
    const added = editMarkdocTag(tag, [
      ['items', [...next.slice(0, 1), { question: 'New?', answer: 'Yes.' }]],
    ]);
    expect(added).toBe(
      tag.replace('"What does it cost?"', '"New?"').replace('"Less than you think."', '"Yes."'),
    );
  });

  it('changes one item’s line, and nothing else', () => {
    const next = items.map((item, index) =>
      index === 1 ? { ...item, answer: 'Low temperature.' } : item,
    );
    const edited = editMarkdocTag(faq, [['items', next]]);
    expect(diff(faq, edited ?? '')).toEqual({
      added: ['  {question: "Why weaker?", answer: "Low temperature."},'],
      removed: ['  { question: "Why weaker?", answer: "Incomplete decarb." },'],
    });
  });

  it('adds a line after the last, removes one with its line, and moves lines as they are', () => {
    const added = editMarkdocTag(faq, [
      ['items', [...items, { question: 'New?', answer: 'Yes.' }]],
    ]);
    expect(added).toBe(
      faq.replace(
        '"Enter its weight." }\n',
        '"Enter its weight." },\n  {question: "New?", answer: "Yes."}\n',
      ),
    );
    const removed = editMarkdocTag(faq, [['items', [items[0], items[2]]]]);
    expect(removed).toBe(
      faq.replace('  { question: "Why weaker?", answer: "Incomplete decarb." },\n', ''),
    );
    const moved = editMarkdocTag(faq, [['items', [items[1], items[0], items[2]]]]);
    const lines = faq.split('\n');
    expect(moved?.split('\n')).toEqual([lines[0], lines[2], lines[1], lines[3], lines[4]]);
  });

  it('writes a list on one line whole, as before', () => {
    const tag = '{% faq items=[{ question: "A", answer: "B" }] /%}';
    expect(editMarkdocTag(tag, [['items', [{ question: 'A', answer: 'C' }]]])).toBe(
      `{% faq items=${markdocValue([{ question: 'A', answer: 'C' }])} /%}`,
    );
  });

  it('changes an MDX array prop item by item too', () => {
    const tag = [
      '<Faq items={[',
      '  {"q": "A", "a": "B"},',
      '  {"q": "C", "a": "D"}',
      ']} />',
    ].join('\n');
    const edited = editJsxTag(tag, [
      [
        'items',
        [
          { q: 'A', a: 'B' },
          { q: 'C', a: 'E' },
        ],
      ],
    ]);
    expect(edited).toBe(tag.replace('{"q": "C", "a": "D"}', '{"q":"C","a":"E"}'));
  });

  it('keeps items the same whatever order their keys are in', () => {
    expect(sameValue({ a: 1, b: [2, { c: 3 }] }, { b: [2, { c: 3 }], a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(spliceList('[\n  1,\n  2\n]', [1, 2], [2, 1], String)).toBe('[\n  2,\n  1\n]');
    expect(spliceList('[\n  1,\n  2\n]', [1, 2], [], String)).toBe('[]');
  });
});
