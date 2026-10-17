import { describe, expect, it } from 'vitest';
import { assembleBody, keepAll, parseBody } from '../src/body/blocks.ts';
import type { BodyBlock, BodyFormat, BodyItem, ParsedBody } from '../src/body/types.ts';
import { splitFrontmatter } from '../src/files/frontmatter.ts';
import { decodeUtf8 } from '../src/files/text.ts';
import { allFiles } from './helpers/corpus.ts';

/*
 * Block splicing over every real and synthetic body:
 * - Every non-whitespace character belongs to a block, at every level of
 *   nesting, so no edit can silently drop text the parser skipped.
 * - Chips lie inside their block, in order, without overlapping.
 * - Keeping every block reproduces the body exactly.
 * - Replacing or deleting one block, or one child of a container, changes
 *   nothing outside it.
 */

const bodies = allFiles().flatMap((file) => {
  const format = /\.(md|mdx|mdoc)$/.exec(file.name)?.[1] as BodyFormat | undefined;
  const text = decodeUtf8(file.bytes);
  if (!format || text === null) return [];
  return [{ file, format, body: splitFrontmatter(text).body }];
});

/** Text between `from` and `to` that no block covers. */
function uncovered(body: string, blocks: readonly BodyBlock[], from: number, to: number): string[] {
  let cursor = from;
  const outside: string[] = [];
  for (const block of blocks) {
    outside.push(body.slice(cursor, block.start));
    cursor = block.end;
    const tag = block.tag;
    if (tag?.children && tag.closeStart !== undefined) {
      outside.push(...uncovered(body, tag.children, tag.openEnd, tag.closeStart));
    }
  }
  outside.push(body.slice(cursor, to));
  return outside.filter((gap) => /\S/.test(gap));
}

function* allBlocks(blocks: readonly BodyBlock[]): Generator<BodyBlock> {
  for (const block of blocks) {
    yield block;
    if (block.tag?.children) yield* allBlocks(block.tag.children);
  }
}

/** Every container's children replaced one at a time, through the top-level item that holds it. */
function childEdits(parsed: ParsedBody): { items: BodyItem[]; expected: string }[] {
  const { text } = parsed;
  const edits: { items: BodyItem[]; expected: string }[] = [];
  parsed.blocks.slice(0, 12).forEach((block, index) => {
    const children = block.tag?.children;
    if (!children || block.tag?.closeStart === undefined) return;
    children.slice(0, 6).forEach((child, k) => {
      const inner = children.map((_, i): BodyItem =>
        i === k ? { text: 'Edited child.', replaces: k } : { keep: i },
      );
      edits.push({
        items: keepAll(parsed).map((item, i) =>
          i === index ? { replaces: index, children: inner } : item,
        ),
        expected: text.slice(0, child.start) + 'Edited child.' + text.slice(child.end),
      });
    });
  });
  return edits;
}

describe('body blocks over the corpus', () => {
  for (const { file, format, body } of bodies) {
    const label = `${file.source}/${file.name}`;
    const parsed = parseBody(body, format);

    it(`${label}: blocks cover every non-whitespace character, at every level`, () => {
      expect(uncovered(body, parsed.blocks, 0, body.length)).toEqual([]);
    });

    it(`${label}: chips lie inside their blocks, in order`, () => {
      for (const block of allBlocks(parsed.blocks)) {
        let cursor = block.start;
        for (const chip of block.chips ?? []) {
          expect(chip.start).toBeGreaterThanOrEqual(cursor);
          expect(chip.end).toBeLessThanOrEqual(block.end);
          cursor = chip.end;
        }
      }
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

    it(`${label}: replacing one child of a container changes only that child`, () => {
      for (const { items, expected } of childEdits(parsed)) {
        expect(assembleBody(parsed, items)).toBe(expected);
      }
    });
  }
});
