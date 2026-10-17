import { describe, expect, it } from 'vitest';
import { assembleBody, keepAll, parseBody, type BodyFormat } from '../src/files/body.ts';
import { splitFrontmatter } from '../src/files/frontmatter.ts';
import { decodeUtf8 } from '../src/files/text.ts';
import { allFiles } from './helpers/corpus.ts';

/*
 * Block splicing over every real and synthetic body:
 * - Every non-whitespace character belongs to a block, so no edit can
 *   silently drop text the parser skipped.
 * - Keeping every block reproduces the body exactly.
 * - Replacing or deleting one block changes nothing outside it.
 */

const bodies = allFiles().flatMap((file) => {
  const format = /\.(md|mdx|mdoc)$/.exec(file.name)?.[1] as BodyFormat | undefined;
  const text = decodeUtf8(file.bytes);
  if (!format || text === null) return [];
  return [{ file, format, body: splitFrontmatter(text).body }];
});

describe('body blocks over the corpus', () => {
  for (const { file, format, body } of bodies) {
    const label = `${file.source}/${file.name}`;
    const parsed = parseBody(body, format);

    it(`${label}: blocks cover every non-whitespace character`, () => {
      let cursor = 0;
      const outside: string[] = [];
      for (const block of parsed.blocks) {
        outside.push(body.slice(cursor, block.start));
        cursor = block.end;
      }
      outside.push(body.slice(cursor));
      expect(outside.filter((gap) => /\S/.test(gap))).toEqual([]);
    });

    it(`${label}: keeping every block reproduces the body`, () => {
      expect(assembleBody(parsed, keepAll(parsed))).toBe(body);
    });

    it(`${label}: replacing or deleting a block changes nothing outside it`, () => {
      parsed.blocks.slice(0, 12).forEach((block, k) => {
        const replaced = assembleBody(
          parsed,
          keepAll(parsed).map((item, i) =>
            i === k ? { text: 'Edited block.', replaces: k } : item,
          ),
        );
        expect(replaced, `replace block ${String(k)}`).toBe(
          body.slice(0, block.start) + 'Edited block.' + body.slice(block.end),
        );

        const deleted = assembleBody(
          parsed,
          keepAll(parsed).filter((_, i) => i !== k),
        );
        const previous = parsed.blocks[k - 1];
        const next = parsed.blocks[k + 1];
        if (previous && next) {
          expect(deleted, `delete block ${String(k)}`).toBe(
            body.slice(0, previous.end) + body.slice(block.end),
          );
        } else if (next) {
          expect(deleted.endsWith(body.slice(next.start))).toBe(true);
        } else if (previous) {
          expect(deleted.startsWith(body.slice(0, previous.end))).toBe(true);
        }
      });
    });
  }
});
