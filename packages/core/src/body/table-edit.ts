import { lineEndings } from '../files/text.ts';
import { parseBody } from './blocks.ts';
import type {
  BodyFormat,
  BodyTable,
  MarkdocParseOptions,
  TableAlign,
  TableCell,
  TableLine,
} from './types.ts';
import { dedent } from './util.ts';

/*
 * Saving a table splices cells, not tables (DECISIONS.md, "Tables are edited
 * as a grid, and a save splices cells"). Rows and columns keep the index
 * they were loaded at, so a move can be told from an edit:
 * - an unchanged row keeps its bytes, line ending included;
 * - a changed cell rewrites only the text between its pipes;
 * - a moved row moves its line as it is, a new row is written in the
 *   table's style, and a deleted row goes with its line ending;
 * - a new, moved or deleted column changes each line by exactly that cell;
 * - an alignment change rewrites that column's cell in the delimiter row.
 * The result is read back with the site's parser, and refused unless it's
 * the table intended.
 */

/** A table as the editor holds it. The header is the first row, and can't move. */
export type TableValue = {
  align: TableAlign[];
  /** For each column, the index it was loaded at, or null for a new one. */
  columns: (number | null)[];
  /**
   * Each row's index when loaded (0 for the header, 1 for the first row
   * under it), or null for a new one, and its cells' content as written:
   * inline Markdown, with pipes escaped.
   */
  rows: { from: number | null; cells: string[] }[];
};

export type TableEdit = { ok: true; text: string } | { ok: false; reason: string };

/** The table as it was loaded: every row and column at its own index. */
export function tableValue(text: string, table: BodyTable): TableValue {
  return {
    align: [...table.align],
    columns: table.align.map((_, i) => i),
    rows: [table.header, ...table.rows].map((line, from) => ({
      from,
      cells: line.cells.map((cell) => text.slice(cell.contentStart, cell.contentEnd)),
    })),
  };
}

const graphemes = new Intl.Segmenter();

/** Characters as people count them, so padding lines up with accented letters and emoji. */
const width = (text: string) => [...graphemes.segment(text)].length;

type Style = {
  /** Spaces either side of a compact cell's content: one, or none in `|a|b|`. */
  space: string;
  /** Every line's pipes line up, so changed cells are padded to their column. */
  aligned: boolean;
  /** How a new row's line starts and ends: indentation and an outer pipe, or none. */
  prefix: string;
  suffix: string;
  widths: number[];
  eol: string;
};

function styleOf(text: string, table: BodyTable): Style {
  const lines = [table.header, table.delimiter, ...table.rows];
  const segment = (c: TableCell) => text.slice(c.start, c.end);
  const padding = (c: TableCell) =>
    width(segment(c)) - width(text.slice(c.contentStart, c.contentEnd));
  const widths = table.delimiter.cells.map((c) => width(segment(c)));
  // Equal widths alone don't make a table aligned: `|a|b|` over `|-|-|` is compact.
  const aligned =
    lines.every((line) => line.cells.every((c, i) => width(segment(c)) === widths[i])) &&
    lines.some((line) => line.cells.some((c) => padding(c) > 2));
  const space = table.header.cells.some((c) => padding(c) > 0) ? ' ' : '';
  const { delimiter } = table;
  const first = delimiter.cells[0];
  const last = delimiter.cells.at(-1);
  const prefix = first ? text.slice(delimiter.start, first.start) : '';
  const suffix = last ? text.slice(last.end, delimiter.end).trimEnd() : '';
  const end = (table.rows.at(-1) ?? delimiter).end;
  const eol = lineEndings(text.slice(table.header.start, end)).dominant;
  return { space, aligned, prefix, suffix, widths, eol };
}

/** Content padded to `size` characters between its pipes, placed as the column aligns. */
function padded(content: string, size: number, align: TableAlign): string | null {
  const room = size - width(content) - 2;
  if (room < 0) return null;
  if (align === 'right') return ' '.repeat(room + 1) + content + ' ';
  if (align === 'center') {
    const before = Math.floor(room / 2);
    return ' '.repeat(before + 1) + content + ' '.repeat(room - before + 1);
  }
  return ' ' + content + ' '.repeat(room + 1);
}

/** A changed cell, with its row's own spacing, or padded to its column in an aligned table. */
function rewritten(
  text: string,
  cell: TableCell,
  content: string,
  style: Style,
  align: TableAlign,
): string {
  if (style.aligned) {
    return padded(content, width(text.slice(cell.start, cell.end)), align) ?? ` ${content} `;
  }
  if (cell.contentStart === cell.contentEnd) return style.space + content + style.space;
  return (
    text.slice(cell.start, cell.contentStart) + content + text.slice(cell.contentEnd, cell.end)
  );
}

function newCell(content: string, style: Style, size: number | undefined, align: TableAlign) {
  if (style.aligned && size !== undefined) {
    const fits = padded(content, size, align);
    if (fits) return fits;
  }
  return content === '' && style.space === '' ? '' : style.space + content + style.space;
}

/** Dashes and colons for an alignment, `size` characters long where it can be. */
function dashes(size: number, align: TableAlign): string {
  const colons = align === 'center' ? 2 : align ? 1 : 0;
  const run = '-'.repeat(Math.max(1, size - colons));
  return align === 'center' ? `:${run}:` : align === 'left' ? `:${run}` : align ? `${run}:` : run;
}

/** A line rebuilt from its cells: unchanged cells keep their bytes. */
function joined(text: string, line: TableLine, parts: string[]): string {
  const first = line.cells[0];
  const last = line.cells.at(-1);
  if (!first || !last) return text.slice(line.start, line.end);
  return text.slice(line.start, first.start) + parts.join('|') + text.slice(last.end, line.end);
}

/** The line ending after `line` in the original, or null for the table's last line. */
function eolAfter(text: string, line: TableLine, table: BodyTable): string | null {
  const last = table.rows.at(-1) ?? table.delimiter;
  if (line === last) return null;
  return text[line.end] === '\r' ? '\r\n' : '\n';
}

function written(text: string, table: BodyTable, value: TableValue): string {
  const style = styleOf(text, table);
  const { columns, align } = value;
  const row = (line: TableLine | undefined, cells: readonly string[]) => {
    const parts = columns.map((from, i) => {
      const content = cells[i] ?? '';
      const cell = from === null ? undefined : line?.cells[from];
      if (!cell) {
        const size = from === null ? undefined : style.widths[from];
        return newCell(content, style, size, align[i] ?? null);
      }
      if (text.slice(cell.contentStart, cell.contentEnd) === content) {
        return text.slice(cell.start, cell.end);
      }
      return rewritten(text, cell, content, style, align[i] ?? null);
    });
    if (line) return joined(text, line, parts);
    // A new row without outer pipes doesn't start or end with padding.
    const inner = parts.join('|');
    const start = style.prefix.endsWith('|') ? inner : inner.trimStart();
    return style.prefix + (style.suffix === '' ? start.trimEnd() : start) + style.suffix;
  };

  const delimiterParts = columns.map((from, i) => {
    const cell = from === null ? undefined : table.delimiter.cells[from];
    const wanted = align[i] ?? null;
    const model = cell ?? table.delimiter.cells[0];
    if (from !== null && cell && table.align[from] === wanted) {
      return text.slice(cell.start, cell.end);
    }
    const lead = model ? text.slice(model.start, model.contentStart) : '';
    const trail = model ? text.slice(model.contentEnd, model.end) : '';
    return lead + dashes(cell ? cell.contentEnd - cell.contentStart : 3, wanted) + trail;
  });

  const [header, ...body] = value.rows;
  const out: { text: string; eol: string | null }[] = [
    { text: row(table.header, header?.cells ?? []), eol: eolAfter(text, table.header, table) },
    {
      text: joined(text, table.delimiter, delimiterParts),
      eol: eolAfter(text, table.delimiter, table),
    },
  ];
  for (const r of body) {
    const line = r.from !== null && r.from > 0 ? table.rows[r.from - 1] : undefined;
    out.push({ text: row(line, r.cells), eol: line ? eolAfter(text, line, table) : null });
  }
  return out
    .map((line, i) => (i === out.length - 1 ? line.text : line.text + (line.eol ?? style.eol)))
    .join('');
}

/** A new table, compact: `| a | b |` over `|---|---|`. */
function writtenNew(value: TableValue): string {
  const row = (cells: readonly string[]) =>
    `|${value.columns.map((_, i) => ` ${cells[i] ?? ''} `).join('|')}|`;
  const [header, ...body] = value.rows;
  return [
    row(header?.cells ?? []),
    `|${value.align.map((a) => dashes(3, a)).join('|')}|`,
    ...body.map((r) => row(r.cells)),
  ].join('\n');
}

function shapeProblem(value: TableValue): string | null {
  const count = value.columns.length;
  if (count === 0) return 'A table needs at least one column.';
  const [head, ...body] = value.rows;
  if (!head || (head.from !== null && head.from !== 0) || body.some((r) => r.from === 0)) {
    return 'A table’s first row is its header.';
  }
  if (value.align.length !== count || value.rows.some((r) => r.cells.length !== count)) {
    return 'Every row needs a cell for each column.';
  }
  if (value.rows.some((r) => r.cells.some((c) => /[\r\n]/.test(c) || c !== c.trim()))) {
    return 'A cell is one line, without spaces around it.';
  }
  return null;
}

/**
 * The table's new text, for the block it was loaded from (`source`: the
 * body, the table and the indentation of the container holding it) or for
 * a new table. Lines after the first come without that indentation, as
 * the body assembler expects. Refused when the text wouldn't read back as
 * exactly this table.
 */
export function editTable(
  source: { text: string; table: BodyTable; indent?: string } | null,
  value: TableValue,
  options: { format: BodyFormat; markdoc?: MarkdocParseOptions },
): TableEdit {
  const problem = shapeProblem(value);
  if (problem) return { ok: false, reason: problem };
  let out: string;
  if (source) {
    const indented = written(source.text, source.table, value);
    const plain = dedent(indented, source.indent ?? '');
    if (plain === null) return { ok: false, reason: 'A row isn’t indented like the table.' };
    out = plain;
  } else {
    out = writtenNew(value);
  }
  const reason = readsBack(out, value, options);
  return reason ? { ok: false, reason } : { ok: true, text: out };
}

/** Why `text` doesn't read back as `value`, or null when it does. */
function readsBack(
  text: string,
  value: TableValue,
  options: { format: BodyFormat; markdoc?: MarkdocParseOptions },
): string | null {
  const parsed = parseBody(
    text,
    options.format,
    options.markdoc ? { markdoc: options.markdoc } : {},
  );
  const [block, ...rest] = parsed.blocks;
  const table = block?.table;
  if (!block || rest.length > 0 || !table || block.start !== 0) {
    return 'That change would turn the table into something else, so it isn’t saved.';
  }
  const lines = [table.header, ...table.rows];
  const same =
    lines.length === value.rows.length &&
    table.align.length === value.align.length &&
    table.align.every((a, i) => a === value.align[i]) &&
    lines.every((line, r) =>
      line.cells.every(
        (c, i) => text.slice(c.contentStart, c.contentEnd) === value.rows[r]?.cells[i],
      ),
    );
  return same ? null : 'That change wouldn’t read back as written, so it isn’t saved.';
}
