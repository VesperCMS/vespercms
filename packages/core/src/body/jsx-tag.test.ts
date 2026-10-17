import { describe, expect, it } from 'vitest';
import { parseMdast } from './mdast.ts';
import {
  editJsxTag,
  jsxAttribute,
  jsxClosing,
  jsxOpening,
  jsxTagLayout,
  readJsLiteral,
} from './jsx-tag.ts';

describe('jsxTagLayout', () => {
  it('reads every kind of attribute with its span', () => {
    const open =
      '<Callout type="tip" title=\'Visiting?\' open count={3} items={["a", {b: 1}]} on={fn()} {...rest}>';
    const layout = jsxTagLayout(open);
    expect(layout).toMatchObject({ name: 'Callout', selfClosing: false, openEnd: open.length });
    expect(
      layout?.attributes.map((a) => [
        a.name,
        a.kind,
        a.readable,
        a.value,
        open.slice(a.start, a.end),
      ]),
    ).toEqual([
      ['type', 'string', true, 'tip', 'type="tip"'],
      ['title', 'string', true, 'Visiting?', "title='Visiting?'"],
      ['open', 'shorthand', true, true, 'open'],
      ['count', 'expression', true, 3, 'count={3}'],
      ['items', 'expression', true, ['a', { b: 1 }], 'items={["a", {b: 1}]}'],
      ['on', 'expression', false, undefined, 'on={fn()}'],
      ['', 'spread', false, undefined, '{...rest}'],
    ]);
  });

  it('reads a self-closing tag, a whole element and an inline one', () => {
    expect(jsxTagLayout('<YouTube id="a" />')).toMatchObject({ selfClosing: true, openEnd: 18 });
    expect(jsxTagLayout('<Abbr title="x">CMS</Abbr>')).toMatchObject({ openEnd: 16 });
    expect(jsxTagLayout('not jsx')).toBeNull();
  });
});

describe('writing props', () => {
  it('quotes strings when that reads back exactly, and uses braces otherwise', () => {
    const cases: [unknown, string][] = [
      ['plain', 'v="plain"'],
      ['say "hi"', 'v=\'say "hi"\''],
      [`both ' and "`, 'v={"both \' and \\""}'],
      ['A &amp; B', 'v={"A &amp; B"}'],
      [3, 'v={3}'],
      [true, 'v={true}'],
      [null, 'v={null}'],
      [['a', { b: 1 }], 'v={["a",{"b":1}]}'],
    ];
    for (const [value, written] of cases) {
      expect(jsxAttribute('v', value)).toBe(written);
      const layout = jsxTagLayout(`<X ${written} />`);
      expect(layout?.attributes[0]?.value, written).toEqual(value);
    }
  });

  it('writes new tags in house style', () => {
    expect(
      jsxOpening(
        'YouTube',
        [
          ['id', 'a'],
          ['title', undefined],
        ],
        true,
      ),
    ).toBe('<YouTube id="a" />');
    expect(`${jsxOpening('Callout', [['type', 'tip']], false)}${jsxClosing('Callout')}`).toBe(
      '<Callout type="tip"></Callout>',
    );
  });
});

describe('editJsxTag', () => {
  it('changes, removes and adds props without touching the rest', () => {
    const open = '<Callout  type="tip"   title=\'Visiting?\' {...rest}>';
    expect(editJsxTag(open, [['title', 'Hello']])).toBe(
      '<Callout  type="tip"   title="Hello" {...rest}>',
    );
    expect(editJsxTag(open, [['type', undefined]])).toBe("<Callout   title='Visiting?' {...rest}>");
    expect(editJsxTag('<YouTube id="a" />', [['title', 'T']], ['id', 'title'])).toBe(
      '<YouTube id="a" title="T" />',
    );
    expect(editJsxTag('<YouTube title="T" />', [['id', 'a']], ['id', 'title'])).toBe(
      '<YouTube id="a" title="T" />',
    );
  });

  it('never edits a prop that holds code', () => {
    expect(editJsxTag('<X on={fn()} />', [['on', 'x']])).toBeNull();
  });

  it('edits an inline element’s opening and keeps its content', () => {
    const edited = editJsxTag('<Abbr title="x">CMS</Abbr>', [['title', 'content system']]);
    expect(edited).toBe('<Abbr title="content system">CMS</Abbr>');
    expect(() => parseMdast(edited ?? '', true)).not.toThrow();
  });
});

describe('readJsLiteral', () => {
  it('reads literals and refuses code', () => {
    expect(
      readJsLiteral(" ['a', \"b\", `c`, -1.5e2, true, null, { k: 'v', 'q': [1,], 2: 3 }] "),
    ).toEqual({
      ok: true,
      value: ['a', 'b', 'c', -150, true, null, { k: 'v', q: [1], 2: 3 }],
    });
    for (const code of ['fn()', 'a + 1', '`${x}`', '{ __proto__: 1 }', 'undefined', "'open"]) {
      expect(readJsLiteral(code).ok, code).toBe(false);
    }
  });
});
