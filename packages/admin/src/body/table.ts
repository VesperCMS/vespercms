import type { JSONContent } from '@tiptap/core';
import type { MarkdownManager } from '@tiptap/markdown';
import {
  escapePipes,
  tableValue,
  unescapePipes,
  type BodyTable,
  type TableAlign,
  type TableValue,
} from '@vesper/core';
import { restoreChips, withPlaceholders } from './chips.ts';

/*
 * A table as the writing view holds it (DECISIONS.md, "Tables are edited as
 * a grid, and a save splices cells"): core's `TableValue`, with each cell's
 * chips as placeholders, so a cell is parsed, shown and edited like a line
 * of the body. Every change to a table goes through these functions, so
 * rows and columns keep the index they were loaded at.
 */

/** Inline nodes a cell may hold, beside text with its marks. */
const CELL_NODES = new Set(['text', 'image', 'vesperInline']);

/**
 * A named character reference Tiptap doesn't decode (any but `&lt;`, `&gt;`,
 * `&quot;` and `&amp;`): it shows as written, and an edit would save it as
 * `&amp;nbsp;` (DECISIONS.md, "The compact Markdown editor checks marked's
 * tokens before the round trip").
 */
const UNDECODED = /&(?!(?:lt|gt|quot|amp);)[A-Za-z][A-Za-z0-9]*;/;

/**
 * A cell parsed on its own would start a block where it starts with a
 * block's marker (`2. Second`, `# 1`, `- none`); in a table it's text.
 */
function asInline(text: string): string {
  const ordered = /^(\d{1,9})[.)](\s|$)/.exec(text);
  if (ordered?.[1]) return `${ordered[1]}\\${text.slice(ordered[1].length)}`;
  return /^(#{1,6}(\s|$)|[-+*](\s|$)|>|([-*_][ \t]*){3,}$|`{3}|~{3})/.test(text)
    ? `\\${text}`
    : text;
}

/** A cell's inline nodes, from its text as written (pipes escaped, chips as placeholders). */
export function parseCell(markdown: MarkdownManager, text: string): JSONContent[] | null {
  try {
    const nodes = markdown.parse(asInline(unescapePipes(text))).content ?? [];
    if (nodes.length === 0) return [];
    const [paragraph] = nodes;
    if (nodes.length !== 1 || paragraph?.type !== 'paragraph') return null;
    const inline = paragraph.content ?? [];
    return inline.every((node) => CELL_NODES.has(node.type ?? '')) ? inline : null;
  } catch {
    return null;
  }
}

/** Inline nodes as a cell's text: one line, every pipe escaped. */
export function cellText(markdown: MarkdownManager, inline: readonly JSONContent[]): string {
  if (inline.length === 0) return '';
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [...inline] }] };
  return escapePipes(markdown.serialize(doc).trim());
}

/**
 * The cell's inline nodes when the writing view can own it: one line of
 * inline Markdown that reads back the same once written. Null otherwise.
 */
export function cellFits(markdown: MarkdownManager, text: string): JSONContent[] | null {
  const inline = parseCell(markdown, text);
  if (!inline) return null;
  if (inline.some((node) => node.type === 'text' && UNDECODED.test(node.text ?? ''))) return null;
  const again = parseCell(markdown, cellText(markdown, inline));
  return JSON.stringify(again) === JSON.stringify(inline) ? inline : null;
}

/** The table as loaded, each cell with its chips as placeholders. */
export function editorValue(text: string, table: BodyTable): TableValue {
  const value = tableValue(text, table);
  const lines = [table.header, ...table.rows];
  return {
    ...value,
    rows: value.rows.map((row, r) => ({
      ...row,
      cells: row.cells.map((content, c) => {
        const cell = lines[r]?.cells[c];
        const base = cell?.contentStart ?? 0;
        const chips = (cell?.chips ?? []).map((chip) => ({
          start: chip.start - base,
          end: chip.end - base,
        }));
        return withPlaceholders(content, chips);
      }),
    })),
  };
}

/** The table with every chip's text back in place, for core's writer. */
export function savedValue(value: TableValue): TableValue {
  return {
    ...value,
    rows: value.rows.map((row) => ({ ...row, cells: row.cells.map(restoreChips) })),
  };
}

/** A new table: a header row and one row, two columns, all empty. */
export function newTableValue(): TableValue {
  return {
    align: [null, null],
    columns: [null, null],
    rows: [
      { from: null, cells: ['', ''] },
      { from: null, cells: ['', ''] },
    ],
  };
}

export function setCell(value: TableValue, row: number, column: number, text: string): TableValue {
  return {
    ...value,
    rows: value.rows.map((r, i) =>
      i === row ? { ...r, cells: r.cells.map((c, j) => (j === column ? text : c)) } : r,
    ),
  };
}

/** A new empty row at `at` (1 or more: the header stays first). */
export function insertRow(value: TableValue, at: number): TableValue {
  const rows = [...value.rows];
  rows.splice(Math.max(1, at), 0, { from: null, cells: value.columns.map(() => '') });
  return { ...value, rows };
}

/** A new empty column at `at`. */
export function insertColumn(value: TableValue, at: number): TableValue {
  const splice = <T>(list: readonly T[], item: T) => [
    ...list.slice(0, at),
    item,
    ...list.slice(at),
  ];
  return {
    align: splice(value.align, null),
    columns: splice(value.columns, null),
    rows: value.rows.map((row) => ({ ...row, cells: splice(row.cells, '') })),
  };
}

/** Moves a row below the header to `to` (also below the header). */
export function moveRow(value: TableValue, from: number, to: number): TableValue {
  if (from < 1 || to < 1 || to >= value.rows.length || from >= value.rows.length) return value;
  const rows = [...value.rows];
  const [moved] = rows.splice(from, 1);
  if (moved) rows.splice(to, 0, moved);
  return { ...value, rows };
}

export function moveColumn(value: TableValue, from: number, to: number): TableValue {
  const count = value.columns.length;
  if (from < 0 || to < 0 || from >= count || to >= count) return value;
  const move = <T>(list: readonly T[]) => {
    const out = [...list];
    const [moved] = out.splice(from, 1);
    if (moved !== undefined) out.splice(to, 0, moved);
    return out;
  };
  return {
    align: move(value.align),
    columns: move(value.columns),
    rows: value.rows.map((row) => ({ ...row, cells: move(row.cells) })),
  };
}

/** Deletes a row below the header. */
export function deleteRow(value: TableValue, row: number): TableValue {
  if (row < 1) return value;
  return { ...value, rows: value.rows.filter((_, i) => i !== row) };
}

/** Deletes a column, unless it's the only one. */
export function deleteColumn(value: TableValue, column: number): TableValue {
  if (value.columns.length <= 1) return value;
  const without = <T>(list: readonly T[]) => list.filter((_, i) => i !== column);
  return {
    align: without(value.align),
    columns: without(value.columns),
    rows: value.rows.map((row) => ({ ...row, cells: without(row.cells) })),
  };
}

export function alignColumn(value: TableValue, column: number, align: TableAlign): TableValue {
  return { ...value, align: value.align.map((a, i) => (i === column ? align : a)) };
}
