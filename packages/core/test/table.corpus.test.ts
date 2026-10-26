import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleBody, keepAll, parseBody } from '../src/body/blocks.ts';
import { editTable, tableValue } from '../src/body/table-edit.ts';
import type {
  BodyBlock,
  BodyFormat,
  BodyItem,
  MarkdocParseOptions,
  ParsedBody,
} from '../src/body/types.ts';
import { splitFrontmatter } from '../src/files/frontmatter.ts';
import { decodeUtf8 } from '../src/files/text.ts';
import { corpusFiles } from './helpers/corpus.ts';

/*
 * Tables in real content (PLAN.md, "Tables in the writing view"):
 * vespercms.com's docs, the playground and the committed corpus. Each table
 * is either writable or kept as written. Editing a writable table's first
 * cell changes only that cell, and opening and saving it with no edit
 * changes nothing. The count of tables kept as written is printed, to see
 * what real content needs.
 */

const repo = fileURLToPath(new URL('../../../', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(md|mdx|mdoc)$/.test(name) ? [path] : [];
    });
}

type Source = { name: string; format: BodyFormat; body: string; markdoc: MarkdocParseOptions };

const formatOf = (name: string) => /\.(md|mdx|mdoc)$/.exec(name)?.[1] as BodyFormat | undefined;

/** Each site's own Markdoc options: the playground allows HTML, the others parse with Astro's defaults. */
const sources: Source[] = [
  ...files(join(repo, 'apps/site/src/content')).map((path) => ({ path, markdoc: {} })),
  ...files(join(repo, 'apps/playground/src/content')).map((path) => ({
    path,
    markdoc: { allowHTML: true },
  })),
].flatMap(({ path, markdoc }) => {
  const format = formatOf(path);
  if (!format) return [];
  const { body } = splitFrontmatter(readFileSync(path, 'utf8'));
  return [{ name: relative(repo, path), format, body, markdoc }];
});
for (const file of corpusFiles()) {
  const format = formatOf(file.name);
  const text = decodeUtf8(file.bytes);
  if (format && text !== null && !file.name.startsWith('_worktree/')) {
    sources.push({ name: file.name, format, body: splitFrontmatter(text).body, markdoc: {} });
  }
}

/** Every table at any depth, with the path of indexes to it and its container's indentation. */
function tables(
  blocks: readonly BodyBlock[],
  path: number[] = [],
  indent = '',
): { block: BodyBlock; path: number[]; indent: string }[] {
  return blocks.flatMap((block, i) => [
    ...(block.type === 'table' ? [{ block, path: [...path, i], indent }] : []),
    ...tables(block.tag?.children ?? [], [...path, i], block.tag?.indent ?? ''),
  ]);
}

/** Items that keep everything but replace the block at `path` with `text`. */
function itemsReplacing(parsed: ParsedBody, path: readonly number[], text: string): BodyItem[] {
  const level = (blocks: readonly BodyBlock[], depth: number): BodyItem[] =>
    blocks.map((block, i): BodyItem => {
      if (i !== path[depth]) return { keep: i };
      if (depth === path.length - 1) return { text, replaces: i };
      return { replaces: i, children: level(block.tag?.children ?? [], depth + 1) };
    });
  return level(parsed.blocks, 0);
}

const found = sources.flatMap((source) => {
  const parsed = parseBody(source.body, source.format, { markdoc: source.markdoc });
  return tables(parsed.blocks).map((t) => ({ ...source, parsed, ...t }));
});

describe('tables in real content', () => {
  it('finds them, and most are writable', () => {
    const writable = found.filter((t) => t.block.kind === 'table');
    const kept = found.filter((t) => t.block.kind !== 'table');
    console.info(
      `Tables: ${String(found.length)}, writable ${String(writable.length)}, kept as written ${String(kept.length)}` +
        kept.map((t) => `\n  kept: ${t.name}`).join(''),
    );
    expect(found.length).toBeGreaterThan(40);
    expect(writable.length).toBeGreaterThan(found.length / 2);
  });

  it('saves an unedited table byte for byte, and an edited first cell as only that cell', () => {
    for (const t of found) {
      const table = t.block.table;
      if (!table) continue;
      const options = { format: t.format, markdoc: t.markdoc };
      const source = { text: t.body, table, indent: t.indent };
      const same = editTable(source, tableValue(t.body, table), options);
      if (!same.ok) throw new Error(`${t.name}: ${same.reason}`);
      expect(assembleBody(t.parsed, itemsReplacing(t.parsed, t.path, same.text)), t.name).toBe(
        assembleBody(t.parsed, keepAll(t.parsed)),
      );

      const value = tableValue(t.body, table);
      const first = table.header.cells[0];
      if (!first || !value.rows[0]) continue;
      value.rows[0].cells[0] = 'Edited';
      const edited = editTable(source, value, options);
      if (!edited.ok) throw new Error(`${t.name}: ${edited.reason}`);
      const saved = assembleBody(t.parsed, itemsReplacing(t.parsed, t.path, edited.text));
      // Only the text between the cell's pipes changes: its content, and its
      // padding when it was empty or the table is aligned.
      const before = t.body.slice(0, first.start);
      const after = t.body.slice(first.end);
      expect(saved.startsWith(before), t.name).toBe(true);
      expect(saved.endsWith(after), t.name).toBe(true);
      expect(saved.slice(before.length, saved.length - after.length).trim(), t.name).toBe('Edited');
    }
  });
});
