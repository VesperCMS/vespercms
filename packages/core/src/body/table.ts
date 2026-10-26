import type { BodyTable, TableAlign, TableCell, TableLine } from './types.ts';

/*
 * Pipe tables, line by line (DECISIONS.md, "Tables are edited as a grid,
 * and a save splices cells"). Neither parser gives every cell's exact range:
 * micromark's include the pipes and padding, and Markdoc records only each
 * row's line. So a scanner splits each line at its unescaped pipes, the way
 * the site's parser does, and the caller checks the result against the
 * parser's own tree. Where the two disagree, the table is kept as written.
 */

/**
 * How a parser decides which pipes are escaped:
 * - `micromark` (Markdown and MDX) pairs a backslash with the next
 *   backslash or pipe, so `\\|` ends a cell;
 * - `markdown-it` (Markdoc) escapes any pipe straight after a backslash,
 *   so `\\|` doesn't, and drops that backslash.
 */
export type PipeDialect = 'micromark' | 'markdown-it';

const isBlank = (char: string | undefined) => char === ' ' || char === '\t';

/** Where each line in `[start, end)` runs, before its line ending. The first starts at `start`. */
function linesOf(text: string, start: number, end: number): { start: number; end: number }[] {
  const lines: { start: number; end: number }[] = [];
  let at = start;
  while (at <= end) {
    const nl = text.indexOf('\n', at);
    const stop = nl === -1 || nl >= end ? end : nl;
    lines.push({ start: at, end: stop > at && text[stop - 1] === '\r' ? stop - 1 : stop });
    if (stop >= end) break;
    at = stop + 1;
  }
  return lines;
}

/** Offsets of the pipes in `[from, to)` that split cells. */
function cellPipes(text: string, from: number, to: number, dialect: PipeDialect): number[] {
  const pipes: number[] = [];
  for (let i = from; i < to; i++) {
    const char = text[i];
    if (char === '\\' && dialect === 'micromark') {
      if (text[i + 1] === '\\' || text[i + 1] === '|') i++;
    } else if (char === '|' && !(dialect === 'markdown-it' && text[i - 1] === '\\')) {
      pipes.push(i);
    }
  }
  return pipes;
}

function cell(text: string, start: number, end: number): TableCell {
  let contentStart = start;
  let contentEnd = end;
  while (contentStart < contentEnd && isBlank(text[contentStart])) contentStart++;
  while (contentEnd > contentStart && isBlank(text[contentEnd - 1])) contentEnd--;
  return { start, end, contentStart, contentEnd };
}

/** A line split into cells, with outer pipes optional, as GFM has it. Null for a blank line. */
function splitLine(
  text: string,
  line: { start: number; end: number },
  pipes: (from: number, to: number) => number[],
): TableLine | null {
  let from = line.start;
  let to = line.end;
  while (from < to && isBlank(text[from])) from++;
  while (to > from && isBlank(text[to - 1])) to--;
  if (from === to) return null;
  const found = pipes(from, to);
  const leading = found[0] === from;
  const trailing = found.at(-1) === to - 1 && !(leading && found.length === 1);
  const inner = found.filter((p) => !(leading && p === from) && !(trailing && p === to - 1));
  const bounds = [
    leading ? from + 1 : from,
    ...inner.flatMap((p) => [p, p + 1]),
    trailing ? to - 1 : to,
  ];
  const cells: TableCell[] = [];
  for (let i = 0; i < bounds.length; i += 2)
    cells.push(cell(text, bounds[i] ?? 0, bounds[i + 1] ?? 0));
  return { start: line.start, end: line.end, cells };
}

function alignOf(spec: string): TableAlign | undefined {
  if (!/^:?-+:?$/.test(spec)) return undefined;
  const left = spec.startsWith(':');
  const right = spec.endsWith(':') && spec.length > 1;
  return left && right ? 'center' : left ? 'left' : right ? 'right' : null;
}

/**
 * The pipe table in `[start, end)` of `text`, line by line, or null when it
 * isn't one every row of which has as many cells as the header (GFM fills
 * or drops cells there, so a grid couldn't show what the page shows).
 */
export function scanTable(
  text: string,
  start: number,
  end: number,
  dialect: PipeDialect,
): BodyTable | null {
  const [headerLine, delimiterLine, ...rowLines] = linesOf(text, start, end);
  if (!headerLine || !delimiterLine) return null;
  const header = splitLine(text, headerLine, (from, to) => cellPipes(text, from, to, dialect));
  // The delimiter row holds only dashes, colons, pipes and spaces: every pipe splits.
  const delimiter = splitLine(text, delimiterLine, (from, to) =>
    cellPipes(text, from, to, 'micromark'),
  );
  if (!header || !delimiter) return null;
  const align: TableAlign[] = [];
  for (const c of delimiter.cells) {
    const a = alignOf(text.slice(c.contentStart, c.contentEnd));
    if (a === undefined) return null;
    align.push(a);
  }
  const rows: TableLine[] = [];
  for (const line of rowLines) {
    const row = splitLine(text, line, (from, to) => cellPipes(text, from, to, dialect));
    if (!row) return null;
    rows.push(row);
  }
  if ([header, ...rows].some((row) => row.cells.length !== align.length)) return null;
  return { align, header, delimiter, rows };
}

/** A cell's content as a parser reads it: a backslash before a pipe is dropped, in code spans too. */
export function unescapePipes(content: string): string {
  return content.replace(/\\\|/g, '|');
}

/** Content for a cell: every pipe escaped, in code spans too, as GFM asks. */
export function escapePipes(content: string): string {
  return content.replace(/\|/g, '\\|');
}
