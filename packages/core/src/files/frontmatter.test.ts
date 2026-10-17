import { describe, expect, it } from 'vitest';
import { joinFrontmatter, splitFrontmatter, withBody, withRaw } from './frontmatter.ts';

describe('splitFrontmatter', () => {
  it('splits a plain file into fences, raw YAML and body', () => {
    const text = '---\ntitle: Hi\n---\n\nBody\n';
    const split = splitFrontmatter(text);
    expect(split).toMatchObject({
      prefix: '',
      open: '---',
      raw: '\ntitle: Hi\n',
      close: '---',
      body: '\n\nBody\n',
      format: 'yaml',
      rawOffset: 3,
      bodyOffset: 17,
    });
    expect(text.slice(split.rawOffset, split.rawOffset + split.raw.length)).toBe(split.raw);
    expect(text.slice(split.bodyOffset)).toBe(split.body);
  });

  it('keeps a BOM and leading blank lines in the prefix', () => {
    expect(splitFrontmatter('\uFEFF---\na: 1\n---\n').prefix).toBe('\uFEFF');
    expect(splitFrontmatter('\n \n---\na: 1\n---\n').prefix).toBe('\n \n');
  });

  it('keeps CRLF inside raw and body', () => {
    const split = splitFrontmatter('---\r\na: 1\r\n---\r\nBody\r\n');
    expect(split.raw).toBe('\r\na: 1\r\n');
    expect(split.body).toBe('\r\nBody\r\n');
  });

  it('decides the format from the opening fence, as Astro does', () => {
    expect(splitFrontmatter('+++\na = 1\n+++\n').format).toBe('toml');
  });

  it('stops at the first closing fence, so later rules stay in the body', () => {
    const split = splitFrontmatter('---\na: 1\n---\nx\n\n---\n\ny\n');
    expect(split.raw).toBe('\na: 1\n');
    expect(split.body).toBe('\nx\n\n---\n\ny\n');
  });

  it('returns the whole text as body when there is no frontmatter', () => {
    const split = splitFrontmatter('# Title\n\n---\n');
    expect(split).toMatchObject({ open: '', raw: '', body: '# Title\n\n---\n', format: null });
  });

  it('accepts an empty block', () => {
    expect(splitFrontmatter('---\n---\nx').raw).toBe('\n');
  });
});

describe('joinFrontmatter', () => {
  it.each([
    '---\na: 1\n---\nbody',
    '\uFEFF\n---\r\na: 1\r\n---\r\n',
    'no frontmatter at all',
    '+++\na = 1\n+++\n',
    '',
  ])('reverses splitFrontmatter exactly for %j', (text) => {
    expect(joinFrontmatter(splitFrontmatter(text))).toBe(text);
  });

  it('replaces only the raw block or only the body', () => {
    const split = splitFrontmatter('\uFEFF---\r\na: 1\r\n---\r\nBody');
    expect(withRaw(split, '\r\na: 2\r\n')).toBe('\uFEFF---\r\na: 2\r\n---\r\nBody');
    expect(withBody(split, '\r\nNew')).toBe('\uFEFF---\r\na: 1\r\n---\r\nNew');
  });
});
