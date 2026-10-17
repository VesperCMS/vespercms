import { describe, expect, it } from 'vitest';
import { readYaml } from './read.ts';

describe('readYaml', () => {
  it('reads values the way Astro 7.4 does, dates included', () => {
    const read = readYaml('\ntitle: Hi\npublished: 2026-10-17\ntags: [a, b]\n');
    expect(read.editable).toBe(true);
    expect(read.value).toEqual({
      title: 'Hi',
      published: new Date('2026-10-17T00:00:00Z'),
      tags: ['a', 'b'],
    });
  });

  it('treats an empty block as an empty map', () => {
    expect(readYaml('\n')).toMatchObject({ editable: true, value: {} });
    expect(readYaml('\n# only a comment\n')).toMatchObject({ editable: true, value: {} });
  });

  it('resolves merge keys like Astro (merge: true)', () => {
    const read = readYaml('\nbase: &b { a: 1 }\nchild:\n  <<: *b\n  c: 2\n');
    expect(read.value).toEqual({ base: { a: 1 }, child: { a: 1, c: 2 } });
  });

  it('is source-only when yaml rejects the block', () => {
    const read = readYaml('\ntitle: [unclosed\n');
    expect(read).toMatchObject({ editable: false, reason: 'yaml-error' });
  });

  it('is source-only when js-yaml accepts what yaml rejects', () => {
    const read = readYaml("\nsvg: '<svg>\n<path/>\n</svg>'\n");
    expect(read).toMatchObject({ editable: false, reason: 'yaml-error' });
    // The display value still comes from the parser that accepted it.
    expect(read.value).toEqual({ svg: '<svg> <path/> </svg>' });
  });

  it('is source-only when the two parsers read different values', () => {
    expect(readYaml('\nratio: !!float 1\n')).toMatchObject({
      editable: false,
      reason: 'parsers-disagree',
    });
  });

  it('is source-only for duplicate keys, which both parsers reject', () => {
    expect(readYaml('\na: 1\na: 2\n')).toMatchObject({ editable: false, reason: 'yaml-error' });
  });

  it('requires frontmatter to be a map, but allows top-level sequences in data files', () => {
    expect(readYaml('- a\n- b\n')).toMatchObject({ editable: false, reason: 'not-a-map' });
    expect(readYaml('- a\n- b\n', 'any')).toMatchObject({ editable: true, value: ['a', 'b'] });
  });
});
