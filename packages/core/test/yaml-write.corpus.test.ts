import { isMap, isScalar, isSeq, type Document, type Node, type Pair } from 'yaml';
import { describe, expect, it } from 'vitest';
import { isPlainObject, type DataValue } from '../src/files/equal.ts';
import { splitFrontmatter } from '../src/files/frontmatter.ts';
import type { Path } from '../src/files/patch.ts';
import { decodeUtf8 } from '../src/files/text.ts';
import { readYaml } from '../src/files/yaml/read.ts';
import { writeYaml } from '../src/files/yaml/write.ts';
import { allFiles, type CorpusFile } from './helpers/corpus.ts';

/*
 * The Phase 1 round-trip criterion, over every YAML block in the corpus and
 * fixtures. A save has no unrelated diffs when:
 *   (a) saving an unchanged value returns the input bytes exactly, and
 *   (b) editing one field changes only bytes inside that field's own lines,
 *       so every other key, comment, quote, line ending and the body stay
 *       byte-identical.
 */

type Block = { file: CorpusFile; raw: string; expect: 'map' | 'any' };

function blocks(): Block[] {
  return allFiles().flatMap((file): Block[] => {
    const text = decodeUtf8(file.bytes);
    if (text === null) return [];
    if (/\.ya?ml$/.test(file.name)) return [{ file, raw: text, expect: 'any' }];
    if (!/\.(md|mdx|mdoc)$/.test(file.name)) return [];
    const split = splitFrontmatter(text);
    return split.format === 'yaml' ? [{ file, raw: split.raw, expect: 'map' }] : [];
  });
}

/** A type-appropriate change to a leaf value. */
function edited(value: DataValue): DataValue {
  if (typeof value === 'string')
    return value.includes('\n') ? `${value}Edited line\n` : `${value} (edited)`;
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  if (value instanceof Date) return new Date(value.getTime() + 86_400_000);
  if (value === null) return 'now set';
  return value;
}

/** One edit per top-level key: the key itself if it's a leaf, otherwise its first leaf or an append. */
function editsFor(value: DataValue): { path: Path; next: (root: DataValue) => DataValue }[] {
  const root = value;
  const list: { path: Path; next: (root: DataValue) => DataValue }[] = [];
  const entries: [string | number, DataValue][] = Array.isArray(root)
    ? root.map((item, i) => [i, item])
    : isPlainObject(root)
      ? Object.entries(root)
      : [];
  for (const [key, child] of entries) {
    const path: (string | number)[] = [key];
    let node: DataValue = child;
    while (
      isPlainObject(node) ||
      (Array.isArray(node) && node.length > 0 && !node.every((x) => typeof x === 'string'))
    ) {
      const next: [string | number, DataValue] | undefined = Array.isArray(node)
        ? [0, node[0]]
        : Object.entries(node).find(([, v]) => v !== undefined);
      if (!next) break;
      path.push(next[0]);
      node = next[1];
    }
    const isStringList = Array.isArray(node) && node.every((x) => typeof x === 'string');
    list.push({
      path,
      next: (current) => {
        const copy = structuredClone(current);
        let parent: DataValue = copy;
        for (const segment of path.slice(0, -1)) {
          parent = (parent as Record<string | number, DataValue>)[segment];
        }
        const last = path.at(-1) as string | number;
        const container = parent as Record<string | number, DataValue>;
        const old = container[last];
        container[last] = isStringList ? [...(old as string[]), 'added'] : edited(old);
        return copy;
      },
    });
  }
  return list;
}

/** Offsets [start, end) of the lines that hold the value at `path`, key included. */
function allowedRange(doc: Document.Parsed, raw: string, path: Path): [number, number] | null {
  let node: unknown = doc.contents;
  let owner: Pair | Node | null = null;
  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === segment);
      if (!pair) return null;
      owner = pair;
      node = pair.value;
    } else if (isSeq(node)) {
      node = node.items[segment as number];
      owner = node as Node;
    } else {
      return null;
    }
  }
  const startNode = owner && 'key' in owner ? (owner.key as Node) : owner;
  const start = startNode?.range?.[0];
  const end =
    (node as Node | null)?.range?.[2] ??
    (owner && 'key' in owner ? (owner.key as Node).range?.[2] : undefined);
  if (start === undefined || end === undefined) return null;
  const lineStart = raw.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = raw.indexOf('\n', Math.max(end - 1, start));
  return [lineStart, lineEnd === -1 ? raw.length : lineEnd + 1];
}

/** Original-text range that differs between `before` and `after`, after trimming the common prefix and suffix. */
function changedRange(before: string, after: string): [number, number] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  return [prefix, before.length - suffix];
}

const REFORMAT_EXPECTED = new Set(['frontmatter/anchors.md']);

describe('YAML saves over the corpus: no unrelated diffs', () => {
  const all = blocks();

  it('covers at least 30 real-world files', () => {
    expect(
      new Set(all.filter((b) => b.file.source !== 'fixtures').map((b) => b.file.name)).size,
    ).toBeGreaterThanOrEqual(30);
  });

  for (const block of all) {
    const read = readYaml(block.raw, block.expect);
    if (!read.editable) continue;
    const label = `${block.file.source}/${block.file.name}`;

    it(`${label}: an unchanged save returns identical bytes`, () => {
      const result = writeYaml(block.raw, structuredClone(read.value), { expect: block.expect });
      expect(result.changed).toBe(false);
      expect(result.text).toBe(block.raw);
    });

    it(`${label}: each edit changes only its own field`, () => {
      for (const { path, next } of editsFor(read.value)) {
        const target = next(read.value);
        const result = writeYaml(block.raw, target, { expect: block.expect });
        const reread = readYaml(result.text, block.expect);
        expect(reread.editable, `${path.join('.')} re-reads`).toBe(true);
        expect(reread.value, `${path.join('.')} value`).toEqual(target);
        if (REFORMAT_EXPECTED.has(block.file.name)) continue;

        expect(result.reformatted, `${path.join('.')} was spliced, not re-rendered`).toBe(false);
        const allowed = allowedRange(read.doc, block.raw, path);
        expect(allowed, `${path.join('.')} located`).not.toBeNull();
        const [start, end] = changedRange(block.raw, result.text);
        const [from, to] = allowed ?? [0, 0];
        expect(
          start >= from && end <= to,
          `${path.join('.')}: changed ${String(start)}–${String(end)} outside its lines ${String(from)}–${String(to)}`,
        ).toBe(true);
      }
    });
  }
});
