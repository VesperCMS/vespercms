import { describe, expect, it } from 'vitest';
import { defaultEntryId, entryKindOf, globMatcher, patternExtensions } from './entries.ts';

describe('defaultEntryId (Astro’s glob loader IDs)', () => {
  it.each([
    ['welcome.md', 'welcome'],
    ['2026/winter-market/index.md', '2026/winter-market'],
    ['academics/nursing/index.md', 'academics/nursing'],
    ['index.md', 'index'],
    ['Folder With Spaces/My Post.md', 'folder-with-spaces/my-post'],
    ['site.yaml', 'site'],
    ['notes.v2.md', 'notesv2'],
    ['campus-life.mdx', 'campus-life'],
  ])('%s → %s', (path, id) => {
    expect(defaultEntryId(path)).toBe(id);
  });

  it('lets a slug in the data win', () => {
    expect(defaultEntryId('a/b.md', { slug: 'custom/slug' })).toBe('custom/slug');
    expect(defaultEntryId('a/b.md', { slug: 42 })).toBe('42');
  });
});

describe('globMatcher', () => {
  it('matches like Astro, skipping _-prefixed files with [^_]', () => {
    const matches = globMatcher('**/[^_]*.{md,mdx}');
    expect(
      ['a.md', 'x/y/z.mdx', 'academics/_order.yaml', 'academics/_draft.md', 'b.mdoc'].filter(
        matches,
      ),
    ).toEqual(['a.md', 'x/y/z.mdx']);
  });

  it('subtracts negated patterns', () => {
    const matches = globMatcher(['**/*.md', '!drafts/**']);
    expect(['a.md', 'drafts/b.md'].filter(matches)).toEqual(['a.md']);
  });

  it('ignores dotfiles and paths outside the base', () => {
    const matches = globMatcher('**/*.md');
    expect(['.hidden.md', '../x.md', 'ok.md'].filter(matches)).toEqual(['ok.md']);
  });
});

describe('patternExtensions and entryKindOf', () => {
  it('reads the extensions a pattern spells out', () => {
    expect(patternExtensions('**/[^_]*.{md,mdx}')).toEqual(['md', 'mdx']);
    expect(patternExtensions(['site.yaml', '!x.json'])).toEqual(['yaml']);
  });

  it('calls Markdown-family collections content and the rest data', () => {
    expect(entryKindOf(['md', 'mdx'])).toBe('content');
    expect(entryKindOf(['yaml'])).toBe('data');
  });
});
