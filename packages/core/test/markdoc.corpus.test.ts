import { describe, expect, it } from 'vitest';
import { assembleBody, keepAll, parseBody } from '../src/body/blocks.ts';
import { parseMarkdoc } from '../src/body/markdoc.ts';
import { editMarkdocTag, markdocTags } from '../src/body/markdoc-tag.ts';
import type { BodyBlock, BodyItem, ParsedBody } from '../src/body/types.ts';
import { validateMarkdocBody } from '../src/body/validate.ts';
import { splitFrontmatter } from '../src/files/frontmatter.ts';
import { decodeUtf8 } from '../src/files/text.ts';
import { markdocConfigFromManifest } from '../src/markdoc/config.ts';
import { allFiles } from './helpers/corpus.ts';
import { JAZZY_MARKDOC } from './helpers/jazzy-markdoc.ts';

/*
 * Phase 2.5's "a real Markdoc site's content passes the round-trip suite":
 * every Markdoc file from jazzy-astro5 (108 files, with their CRLF and
 * mixed-EOL working-tree copies), read with that site's own tag definitions.
 *
 * - Keeping everything reproduces each file.
 * - Every tag Markdoc finds is a tag block or a chip the editor can open:
 *   the inline scanner agrees with Markdoc's tree.
 * - The site builds this content, so validation finds nothing blocking.
 * - Editing a tag's first attribute changes only that tag's opening, and
 *   the result still reads back with the new value.
 */

const config = markdocConfigFromManifest(JAZZY_MARKDOC);
const files = allFiles().flatMap((file) => {
  if (!/(^|\/)jazzy-astro5\/.*\.mdoc$/.test(file.name)) return [];
  const text = decodeUtf8(file.bytes);
  return text === null ? [] : [{ name: file.name, body: splitFrontmatter(text).body }];
});

type Node = { type: string; tag?: string; children: Node[] };
/** Tags in Markdoc's tree, outside tables. */
const astTags = (node: Node): number =>
  node.type === 'table'
    ? 0
    : (node.type === 'tag' ? 1 : 0) + node.children.reduce((n, child) => n + astTags(child), 0);

type TagSpan = { start: number; end: number; block: number[] };

/** Every tag's opening in the parsed body: tag blocks at any depth, and tag chips. */
function tagsOf(text: string, blocks: readonly BodyBlock[], path: number[] = []): TagSpan[] {
  return blocks.flatMap((block, i): TagSpan[] => {
    const here = [...path, i];
    const spans: TagSpan[] = [];
    if (block.kind === 'tag' && block.tag) {
      spans.push({ start: block.start, end: block.tag.openEnd, block: here });
      if (block.tag.children) spans.push(...tagsOf(text, block.tag.children, here));
    }
    for (const chip of block.chips ?? []) {
      if (chip.kind !== 'tag') continue;
      const [opening] = markdocTags(text.slice(chip.start, chip.end));
      spans.push({ start: chip.start, end: chip.start + (opening?.end ?? 0), block: here });
    }
    return spans;
  });
}

/** The items that replace one top-level block with new text and keep the rest. */
function replacing(parsed: ParsedBody, index: number, text: string): BodyItem[] {
  return keepAll(parsed).map((item, i) => (i === index ? { text, replaces: index } : item));
}

/** A different value of the same kind, for an edit. */
function edited(value: unknown): unknown {
  if (typeof value === 'string') return `${value}-edited`;
  if (Array.isArray(value))
    return [...(value as unknown[]), { question: 'Edited?', answer: 'Yes.' }];
  return undefined;
}

describe('jazzy-astro5 Markdoc corpus, with the site’s own tags', () => {
  it('has the files', () => {
    expect(files.length).toBeGreaterThanOrEqual(108);
  });

  for (const { name, body } of files) {
    const parsed = parseBody(body, 'mdoc');
    const tags = tagsOf(body, parsed.blocks);

    it(`${name}: keeping everything reproduces the file`, () => {
      expect(assembleBody(parsed, keepAll(parsed))).toBe(body);
    });

    it(`${name}: every tag Markdoc finds is a tag block or a chip, except inside tables`, () => {
      // Tables are protected in v1 (kept as written), tags and all. Text that
      // only looks like a tag inside an HTML comment isn't one.
      expect(tags.length).toBe(astTags(parseMarkdoc(body) as unknown as Node));
      const protectedWithTags = parsed.blocks.filter((b) => {
        const text = body.slice(b.start, b.end);
        return b.kind === 'source' && text.includes('{%') && !text.includes('<!--');
      });
      expect(protectedWithTags.map((b) => b.type).filter((type) => type !== 'table')).toEqual([]);
    });

    it(`${name}: the site builds it, so nothing blocks saving`, () => {
      const issues = validateMarkdocBody(body, { config, tags: JAZZY_MARKDOC.tags });
      expect(issues.filter((issue) => issue.level === 'error')).toEqual([]);
    });

    it(`${name}: editing each tag’s first attribute changes only that tag’s opening`, () => {
      for (const tag of tags) {
        const opening = body.slice(tag.start, tag.end);
        const [token] = markdocTags(opening);
        const first = token?.attributes.find((a) => a.type === 'attribute');
        const value = first ? edited(first.value) : undefined;
        if (!token || !first || value === undefined) continue;
        const order = JAZZY_MARKDOC.tags
          .find((t) => t.name === token.name)
          ?.attributes.map((a) => a.name);
        const changed = editMarkdocTag(opening, [[first.name, value]], order);
        expect(changed, opening).not.toBeNull();
        const expected = body.slice(0, tag.start) + (changed ?? '') + body.slice(tag.end);

        // Through the splice: the block holding the tag is replaced with its edited text.
        const top = tag.block[0] ?? 0;
        const block = parsed.blocks[top];
        if (block && tag.block.length === 1) {
          const text = expected.slice(block.start, block.end + (expected.length - body.length));
          expect(assembleBody(parsed, replacing(parsed, top, text))).toBe(expected);
        }
        // It reads back with the new value, and the site would still build it.
        const reread = markdocTags(changed ?? '')[0]?.attributes.find((a) => a.name === first.name);
        expect(reread?.value).toEqual(value);
        const issues = validateMarkdocBody(expected, { config, tags: JAZZY_MARKDOC.tags });
        expect(issues.filter((i) => i.level === 'error')).toEqual([]);
      }
    });
  }
});
