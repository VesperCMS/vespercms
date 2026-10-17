import { extractFrontmatter, parseFrontmatter } from '@astrojs/internal-helpers/frontmatter';
import { describe, expect, it } from 'vitest';
import { joinFrontmatter, splitFrontmatter } from '../src/files/frontmatter.ts';
import { decodeUtf8 } from '../src/files/text.ts';
import { allFiles } from './helpers/corpus.ts';

const textFiles = allFiles()
  .filter((file) => /\.(md|mdx|mdoc)$/.test(file.name))
  .map((file) => ({ ...file, text: decodeUtf8(file.bytes) }));

describe('frontmatter split over the corpus', () => {
  it('has enough real-world files to mean something', () => {
    expect(textFiles.filter((f) => f.source !== 'fixtures').length).toBeGreaterThanOrEqual(30);
  });

  for (const file of textFiles) {
    const { text } = file;
    if (text === null) continue;

    it(`${file.source}/${file.name}: joins back to the same bytes and matches Astro`, () => {
      const split = splitFrontmatter(text);
      expect(joinFrontmatter(split)).toBe(text);
      // Same frontmatter text Astro hands its YAML parser…
      expect(split.raw).toBe(extractFrontmatter(text) ?? '');
      // …and the same body Astro renders (Astro keeps the prefix in its content).
      if (split.format === 'yaml' && !text.includes('\u0000')) {
        let astroContent: string | undefined;
        try {
          astroContent = parseFrontmatter(text).content;
        } catch {
          // Astro fails to parse this frontmatter; the split must still round-trip.
        }
        if (astroContent !== undefined) expect(split.prefix + split.body).toBe(astroContent);
      }
    });
  }
});
