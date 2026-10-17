import Markdoc from '@markdoc/markdoc';
import { describe, expect, it } from 'vitest';
import {
  editMarkdocTag,
  markdocClosing,
  markdocOpening,
  markdocTagLayout,
  markdocTags,
  markdocValue,
} from './markdoc-tag.ts';

const attributesOf = (tagText: string) => markdocTags(tagText)[0]?.attributes;

describe('markdocTagLayout', () => {
  it('finds each attribute’s span, including multi-line values and shorthand', () => {
    const tag = '{% faq .wide #top items=[\n  { q: "A %}?", a: "B" }\n] n=3 on=true v=$x.y /%}';
    const layout = markdocTagLayout(tag);
    expect(layout?.selfClosing).toBe(true);
    expect(layout?.attributes.map((a) => [a.key, tag.slice(a.valueStart, a.valueEnd)])).toEqual([
      ['class', 'wide'],
      ['id', 'top'],
      ['items', '[\n  { q: "A %}?", a: "B" }\n]'],
      ['n', '3'],
      ['on', 'true'],
      ['v', '$x.y'],
    ]);
  });

  it('reads primary values and function calls', () => {
    const layout = markdocTagLayout('{% if equals($tier, "free") %}');
    expect(layout?.attributes).toMatchObject([{ key: 'primary', kind: 'primary' }]);
  });

  it('refuses closings, variables and text it can’t account for', () => {
    expect(markdocTagLayout('{% /callout %}')).toBeNull();
    expect(markdocTagLayout('{% $x %}')).toBeNull();
    expect(markdocTagLayout('{% callout %} trailing')).toBeNull();
  });
});

describe('markdocValue', () => {
  it('writes values Markdoc reads back exactly', () => {
    const values = [
      'plain',
      'with "quotes", a \\ backslash,\na newline and a\ttab',
      'é ✓ 😀 %} {%',
      0,
      -12.5,
      true,
      false,
      null,
      ['a', 1, [true]],
      { question: 'Q?', 'odd key': 'x', nested: { n: 1 } },
    ];
    for (const value of values) {
      const tag = `{% x v=${markdocValue(value)} /%}`;
      expect(attributesOf(tag), tag).toEqual([{ type: 'attribute', name: 'v', value }]);
    }
  });

  it('refuses numbers Markdoc can’t write', () => {
    expect(() => markdocValue(1e21)).toThrow();
    expect(() => markdocValue(Number.NaN)).toThrow();
  });
});

describe('new tags in house style', () => {
  it('writes attributes in the order given and leaves out undefined ones', () => {
    expect(
      markdocOpening(
        'youtube',
        [
          ['id', 'abc'],
          ['title', undefined],
          ['captions', true],
        ],
        true,
      ),
    ).toBe('{% youtube id="abc" captions=true /%}');
    expect(`${markdocOpening('callout', [], false)}\n${markdocClosing('callout')}`).toBe(
      '{% callout %}\n{% /callout %}',
    );
  });
});

describe('editMarkdocTag', () => {
  it('changes one value and nothing else', () => {
    const original = '{% callout type="tip"  title="Before you start" .wide %}';
    expect(editMarkdocTag(original, [['title', 'After']])).toBe(
      '{% callout type="tip"  title="After" .wide %}',
    );
  });

  it('removes an attribute with the whitespace before it', () => {
    expect(editMarkdocTag('{% callout type="tip"  title="T" %}', [['type', undefined]])).toBe(
      '{% callout  title="T" %}',
    );
    expect(editMarkdocTag('{% youtube id="x"\n  title="T" /%}', [['title', undefined]])).toBe(
      '{% youtube id="x" /%}',
    );
  });

  it('adds an attribute in schema order', () => {
    const order = ['type', 'title', 'icon'];
    expect(editMarkdocTag('{% callout title="T" %}', [['type', 'tip']], order)).toBe(
      '{% callout type="tip" title="T" %}',
    );
    expect(editMarkdocTag('{% callout type="tip" icon="i" %}', [['title', 'T']], order)).toBe(
      '{% callout type="tip" title="T" icon="i" %}',
    );
    expect(editMarkdocTag('{% callout %}', [['title', 'T']], order)).toBe(
      '{% callout title="T" %}',
    );
    expect(editMarkdocTag('{% youtube id="x" /%}', [['captions', true]], ['id'])).toBe(
      '{% youtube id="x" captions=true /%}',
    );
  });

  it('keeps a multi-line array exactly when another attribute changes', () => {
    const faq = '{% faq items=[\n  { question: "Q", answer: "A" }\n] title="Old" /%}';
    const edited = editMarkdocTag(faq, [['title', 'New']]);
    expect(edited).toBe(faq.replace('"Old"', '"New"'));
    expect(Markdoc.parse(edited ?? '').children[0]?.attributes).toEqual({
      items: [{ question: 'Q', answer: 'A' }],
      title: 'New',
    });
  });

  it('refuses tags it can’t read', () => {
    expect(editMarkdocTag("{% callout title='x' %}", [['title', 'y']])).toBeNull();
  });
});
