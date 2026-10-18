import { describe, expect, it } from 'vitest';
import type { DataValue } from '../equal.ts';
import { SerializationError } from '../errors.ts';
import { readYaml } from './read.ts';
import { writeYaml } from './write.ts';

/** Reads `raw`, lets `edit` change the value, writes it back. */
function edit(
  raw: string,
  change: (value: Record<string, DataValue>) => void,
  expect: 'map' | 'any' = 'map',
) {
  const read = readYaml(raw, expect);
  if (!read.editable) throw new Error('fixture is not editable');
  const value = structuredClone(read.value) as Record<string, DataValue>;
  change(value);
  return writeYaml(raw, value, { expect });
}

const text = (raw: string, change: (value: Record<string, DataValue>) => void) => {
  const result = edit(raw, change);
  expect(result.reformatted).toBe(false);
  return result.text;
};

describe('writeYaml: scalars', () => {
  it('replaces only the changed value', () => {
    expect(text('\ntitle: Old\nother: 1\n', (v) => (v.title = 'New'))).toBe(
      '\ntitle: New\nother: 1\n',
    );
  });

  it('keeps a trailing comment', () => {
    expect(text('\ntitle: Old # note\n', (v) => (v.title = 'New'))).toBe('\ntitle: New # note\n');
  });

  it('keeps the quote style the value already had', () => {
    expect(text('\ntitle: "Old"\n', (v) => (v.title = 'New'))).toBe('\ntitle: "New"\n');
    expect(text("\ntitle: 'Old'\n", (v) => (v.title = "It's new"))).toBe("\ntitle: 'It''s new'\n");
  });

  it('quotes a plain value only when it must, in the file’s quote style', () => {
    expect(text('\ntitle: Old\n', (v) => (v.title = 'New: with colon'))).toBe(
      '\ntitle: "New: with colon"\n',
    );
    expect(text("\na: 'x'\ntitle: Old\n", (v) => (v.title = 'yes: no'))).toBe(
      "\na: 'x'\ntitle: 'yes: no'\n",
    );
    expect(text('\ntitle: Old\n', (v) => (v.title = '2026-10-17'))).toBe('\ntitle: "2026-10-17"\n');
    expect(text('\ntitle: Old\n', (v) => (v.title = 'true'))).toBe('\ntitle: "true"\n');
  });

  it('writes numbers, booleans and null plainly', () => {
    expect(
      text('\nn: 1\nb: true\nx: 1\n', (v) => {
        v.n = 2.5;
        v.b = false;
        v.x = null;
      }),
    ).toBe('\nn: 2.5\nb: false\nx: null\n');
  });

  it('keeps a block scalar block', () => {
    expect(
      text('\nsummary: >-\n  Old text\n  here.\nnext: 1\n', (v) => (v.summary = 'New text.')),
    ).toBe('\nsummary: >-\n  New text.\nnext: 1\n');
  });

  it('keeps the shape of a date', () => {
    expect(text('\nd: 2026-10-17\n', (v) => (v.d = new Date('2026-10-20')))).toBe(
      '\nd: 2026-10-20\n',
    );
    expect(
      text('\nd: 2026-10-17T14:30:00Z\n', (v) => (v.d = new Date('2026-10-17T15:00:00Z'))),
    ).toBe('\nd: 2026-10-17T15:00:00Z\n');
    expect(
      text('\nd: 2026-10-24T10:00:00-04:00\n', (v) => (v.d = new Date('2026-10-24T15:30:00Z'))),
    ).toBe('\nd: 2026-10-24T11:30:00-04:00\n');
  });

  it('escapes a multi-line string into a plain field', () => {
    const result = text('\ntitle: Old\n', (v) => (v.title = 'Line one\nLine two'));
    expect(readYaml(result).value).toEqual({ title: 'Line one\nLine two' });
  });
});

describe('writeYaml: maps', () => {
  it('adds a key at the end of the root map', () => {
    expect(text('\na: 1\n', (v) => (v.b = 2))).toBe('\na: 1\nb: 2\n');
  });

  it('adds a key to a nested map at its indentation', () => {
    expect(
      text(
        '\nnav:\n  label: x\nz: 1\n',
        (v) => ((v.nav as Record<string, DataValue>).hidden = true),
      ),
    ).toBe('\nnav:\n  label: x\n  hidden: true\nz: 1\n');
  });

  it('adds a key with a collection value as a block', () => {
    expect(text('\na: 1\n', (v) => (v.tags = ['x', 'y']))).toBe('\na: 1\ntags:\n  - x\n  - y\n');
    expect(text('\na: 1\n', (v) => (v.geo = { lat: 1, lng: 2 }))).toBe(
      '\na: 1\ngeo:\n  lat: 1\n  lng: 2\n',
    );
  });

  it('quotes a new key that needs it', () => {
    expect(text('\na: 1\n', (v) => (v['key: odd'] = 1))).toBe('\na: 1\n"key: odd": 1\n');
  });

  it('adds keys to an empty block', () => {
    expect(text('\n', (v) => (v.title = 'Hi'))).toBe('\ntitle: Hi\n');
  });

  it('deletes a key with its comment and line', () => {
    expect(text('\na: 1\nb: 2 # gone\nc: 3\n', (v) => delete v.b)).toBe('\na: 1\nc: 3\n');
  });

  it('deletes a key with a block value', () => {
    expect(text('\na:\n  - x\n  - y\nb: 1\n', (v) => delete v.a)).toBe('\nb: 1\n');
  });

  it('writes {} when every key of a nested map is removed', () => {
    expect(text('\nnav:\n  label: x\nz: 1\n', (v) => (v.nav = {}))).toBe('\nnav: {}\nz: 1\n');
  });

  it('replaces all of a nested map’s keys in one go', () => {
    expect(text('\nnav:\n  label: x\nz: 1\n', (v) => (v.nav = { title: 'y' }))).toBe(
      '\nnav:\n  title: y\nz: 1\n',
    );
  });

  it('turns a scalar into a block map and back', () => {
    expect(text('\nseries: Intro\nz: 1\n', (v) => (v.series = { name: 'Intro', part: 2 }))).toBe(
      '\nseries:\n  name: Intro\n  part: 2\nz: 1\n',
    );
    expect(text('\nseries:\n  name: Intro\n  part: 2\nz: 1\n', (v) => (v.series = 'Intro'))).toBe(
      '\nseries: Intro\nz: 1\n',
    );
  });
});

describe('writeYaml: flow collections', () => {
  it('edits inside a flow map', () => {
    expect(
      text('\ngeo: { lat: 1, lng: 2 }\n', (v) => ((v.geo as Record<string, DataValue>).lat = 3)),
    ).toBe('\ngeo: { lat: 3, lng: 2 }\n');
    expect(text('\ngeo: {lat: 1}\n', (v) => ((v.geo as Record<string, DataValue>).lng = 2))).toBe(
      '\ngeo: {lat: 1, lng: 2}\n',
    );
  });

  it('pushes to and deletes from a flow sequence', () => {
    expect(text('\ntags: [a, b]\n', (v) => (v.tags as DataValue[]).push('c'))).toBe(
      '\ntags: [a, b, c]\n',
    );
    expect(text('\ntags: [a, b, c]\n', (v) => (v.tags = ['a', 'c']))).toBe('\ntags: [a, c]\n');
    expect(text('\ntags: [a, b, c]\n', (v) => (v.tags = ['a', 'b']))).toBe('\ntags: [a, b]\n');
  });

  it('fills an empty flow sequence', () => {
    expect(text('\ntags: []\n', (v) => (v.tags = ['a']))).toBe('\ntags: [ a ]\n');
  });
});

describe('writeYaml: block sequences', () => {
  it('pushes an item at the sequence’s indentation', () => {
    expect(text('\ntags:\n  - a\nz: 1\n', (v) => (v.tags as DataValue[]).push('b'))).toBe(
      '\ntags:\n  - a\n  - b\nz: 1\n',
    );
    expect(text('\ntags:\n- a\n', (v) => (v.tags as DataValue[]).push('b'))).toBe(
      '\ntags:\n- a\n- b\n',
    );
  });

  it('pushes a map item with its keys aligned', () => {
    expect(
      text('\nsocial:\n  - network: a\n    url: u\n', (v) =>
        (v.social as DataValue[]).push({ network: 'b', url: 'v' }),
      ),
    ).toBe('\nsocial:\n  - network: a\n    url: u\n  - network: b\n    url: v\n');
  });

  it('edits a field inside a map item', () => {
    expect(
      text('\nsocial:\n  - network: a\n    url: u\n', (v) => {
        ((v.social as DataValue[])[0] as Record<string, DataValue>).url = 'w';
      }),
    ).toBe('\nsocial:\n  - network: a\n    url: w\n');
  });

  it('deletes a map item', () => {
    expect(
      text(
        '\nitems:\n  - name: a\n    v: 1\n  - name: b\n    v: 2\n',
        (v) => (v.items = (v.items as DataValue[]).slice(1)),
      ),
    ).toBe('\nitems:\n  - name: b\n    v: 2\n');
  });

  it('reorders and grows a root list of names without losing its comment (_order.yaml)', () => {
    const raw = '# Page order\n- about\n- academics\n- admissions\n';
    const reorder = (names: string[]) => (value: Record<string, DataValue>) => {
      const list = value as unknown as string[];
      list.splice(0, list.length, ...names);
    };
    expect(edit(raw, reorder(['academics', 'about', 'nursing', 'admissions']), 'any').text).toBe(
      '# Page order\n- academics\n- about\n- nursing\n- admissions\n',
    );
    expect(edit(raw, reorder(['admissions', 'about']), 'any').text).toBe(
      '# Page order\n- admissions\n- about\n',
    );
  });

  it('pushes a one-line flow map after items written that way (vesper.redirects.yaml)', () => {
    const raw = '# Redirects\n- { from: /a, to: /b, status: 301 }\n- {from: /c, to: /d}\n';
    expect(
      edit(
        raw,
        (v) => {
          (v as unknown as DataValue[]).push({ from: '/e', to: '/f', status: 302 });
        },
        'any',
      ).text,
    ).toBe(`${raw}- { from: /e, to: /f, status: 302 }\n`);
  });

  it('adds a key as a one-line flow map beside values written that way (an image’s crops)', () => {
    const raw =
      '\nhero:\n  crops:\n    square: { x: 0.40, y: 0.10, w: 0.45, h: 0.675 }\ntitle: x\n';
    expect(
      text(raw, (v) => {
        const hero = v.hero as { crops: Record<string, DataValue> };
        hero.crops.wide = { x: 0.07, y: 0.0703, w: 0.9, h: 0.7594 };
      }),
    ).toBe(
      '\nhero:\n  crops:\n    square: { x: 0.40, y: 0.10, w: 0.45, h: 0.675 }\n    wide: { x: 0.07, y: 0.0703, w: 0.9, h: 0.7594 }\ntitle: x\n',
    );
    // Beside block maps, a new one stays a block map.
    expect(
      text('\na:\n  b:\n    c: 1\n', (v) => ((v.a as Record<string, DataValue>).d = { e: 2 })),
    ).toBe('\na:\n  b:\n    c: 1\n  d:\n    e: 2\n');
  });

  it('writes [] when every item is removed', () => {
    expect(text('\ntags:\n  - a\nz: 1\n', (v) => (v.tags = []))).toBe('\ntags: []\nz: 1\n');
  });
});

describe('writeYaml: whole files', () => {
  it('returns the input untouched when nothing changed', () => {
    const raw = '\n# comment\ntitle:   "odd spacing"   # c\nlist: [ a,b ]\n';
    const result = edit(raw, () => undefined);
    expect(result).toEqual({ text: raw, changed: false, reformatted: false });
  });

  it('keeps CRLF line endings on edited and added lines', () => {
    expect(
      text('\r\na: 1\r\nb: 2\r\n', (v) => {
        v.a = 9;
        v.c = 3;
      }),
    ).toBe('\r\na: 9\r\nb: 2\r\nc: 3\r\n');
  });

  it('edits a file() data file whose root is a sequence', () => {
    const raw = '- id: one\n  name: First\n- id: two\n  name: "Second"\n';
    const result = edit(
      raw,
      (v) => {
        const list = v as unknown as Record<string, DataValue>[];
        (list[1] as Record<string, DataValue>).name = 'Zwei';
        list.push({ id: 'three', name: 'Third' });
      },
      'any',
    );
    expect(result.text).toBe(
      '- id: one\n  name: First\n- id: two\n  name: "Zwei"\n- id: three\n  name: Third\n',
    );
  });

  it('deletes the first key of a map that starts on a dash line', () => {
    const result = edit(
      '- name: a\n  v: 1\n',
      (v) => {
        delete ((v as unknown as Record<string, DataValue>[])[0] as Record<string, DataValue>).name;
      },
      'any',
    );
    expect(result.text).toBe('- v: 1\n');
  });

  it('falls back to re-rendering for anchors, and says so', () => {
    const result = edit('\nbase: &b { a: 1 }\nref: *b\ntitle: x\n', (v) => (v.base = { a: 2 }));
    expect(result.reformatted).toBe(true);
    expect(readYaml(result.text).value).toEqual({ base: { a: 2 }, ref: { a: 1 }, title: 'x' });
  });

  it('refuses to write a source-only block', () => {
    expect(() => writeYaml('\na: [unclosed\n', { a: 1 })).toThrow(SerializationError);
  });
});
