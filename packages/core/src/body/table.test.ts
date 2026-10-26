import { describe, expect, it } from 'vitest';
import { assembleBody, parseBody } from './blocks.ts';
import { editTable, tableValue, type TableValue } from './table-edit.ts';
import { escapePipes, unescapePipes } from './table.ts';
import type { BodyBlock, BodyFormat, BodyItem } from './types.ts';

/** Each line's cell contents, header first. */
function contents(text: string, block: BodyBlock | undefined): string[][] | null {
  const table = block?.table;
  if (!table) return null;
  return [table.header, ...table.rows].map((line) =>
    line.cells.map((c) => text.slice(c.contentStart, c.contentEnd)),
  );
}

function firstTable(text: string, format: BodyFormat) {
  const parsed = parseBody(text, format);
  const index = parsed.blocks.findIndex((b) => b.kind === 'table');
  return { parsed, index, block: parsed.blocks[index] };
}

/** The body after changing its first table's value, saved the way the studio saves it. */
function edit(text: string, format: BodyFormat, change: (value: TableValue) => void): string {
  const { parsed, index, block } = firstTable(text, format);
  if (!block?.table) throw new Error('No writable table.');
  const value = tableValue(text, block.table);
  change(value);
  const result = editTable({ text, table: block.table }, value, { format });
  if (!result.ok) throw new Error(result.reason);
  const items: BodyItem[] = parsed.blocks.map((_, i) =>
    i === index ? { text: result.text, replaces: i } : { keep: i },
  );
  return assembleBody(parsed, items);
}

const FORMATS = ['md', 'mdx', 'mdoc'] as const;

function setCell(value: TableValue, row: number, column: number, content: string): void {
  const cells = value.rows[row]?.cells;
  if (!cells || column >= cells.length) throw new RangeError('No such cell.');
  cells[column] = content;
}

describe('reading pipe tables', () => {
  it('reads cells, alignment and escaped pipes in every format', () => {
    const text =
      'Intro.\n\n| Name | Code |\n|:---|:---:|\n| a \\| b | `x\\|y` |\n| **bold** | [link](/x) |\n\nAfter.\n';
    for (const format of FORMATS) {
      const { block } = firstTable(text, format);
      expect(block?.kind, format).toBe('table');
      expect(block?.table?.align, format).toEqual(['left', 'center']);
      expect(contents(text, block), format).toEqual([
        ['Name', 'Code'],
        ['a \\| b', '`x\\|y`'],
        ['**bold**', '[link](/x)'],
      ]);
      expect(text.slice(block?.start, block?.end).endsWith('[link](/x) |'), format).toBe(true);
    }
  });

  it('reads rows without outer pipes, empty cells, aligned tables and CRLF', () => {
    const cases = [
      'a | b\n--- | ---\n1 | |\n',
      '| Item   | Price |\n|--------|------:|\n| Coffee |  2.50 |\n',
      '| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n',
    ];
    for (const format of FORMATS) {
      expect(contents(cases[0] ?? '', firstTable(cases[0] ?? '', format).block), format).toEqual([
        ['a', 'b'],
        ['1', ''],
      ]);
      expect(contents(cases[1] ?? '', firstTable(cases[1] ?? '', format).block), format).toEqual([
        ['Item', 'Price'],
        ['Coffee', '2.50'],
      ]);
      const crlf = firstTable(cases[2] ?? '', format).block;
      expect(contents(cases[2] ?? '', crlf), format).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
      expect((cases[2] ?? '').slice(crlf?.table?.header.start, crlf?.table?.header.end)).toBe(
        '| a | b |',
      );
    }
  });

  it('keeps as written what a grid can’t show or the writing view would change', () => {
    const kept = [
      '| a | b |\n|---|---|\n| 1 |\n', // a ragged row
      '| a | b |\n|---|---|\n| 1<br>2 | 3 |\n', // HTML
      '| a |\n|---|\n| [x](/y "Title") |\n', // a link with a title
      '| a |\n|---|\n| [x][ref] |\n\n[ref]: /y\n', // a reference link
    ];
    for (const format of FORMATS) {
      // `<br>` isn't MDX; `<br />` there is a component, a chip in its cell.
      for (const text of format === 'mdx' ? kept.filter((t) => !t.includes('<br>')) : kept) {
        // In Markdoc, `<br>` is HTML only where the site allows it.
        const [block] = parseBody(text, format, { markdoc: { allowHTML: true } }).blocks;
        expect(block?.kind, `${format}: ${text}`).toBe('source');
        expect(block?.type, `${format}: ${text}`).toBe('table');
      }
    }
    // A backslash before a pipe: micromark pairs `\\` and ends the cell, markdown-it doesn't.
    const escaped = '| a | b |\n|---|---|\n| a\\\\| b |\n';
    expect(contents(escaped, parseBody(escaped, 'md').blocks[0])).toEqual([
      ['a', 'b'],
      ['a\\\\', 'b'],
    ]);
    expect(parseBody(escaped, 'mdoc').blocks[0]?.kind).toBe('source');
  });

  it('finds Markdoc chips in cells, and keeps a cell with an annotation as written', () => {
    const text =
      '| Tier | Price |\n|---|---|\n| {% $tier %} | {% abbr title="US dollars" %}$5{% /abbr %} |\n';
    const { block } = firstTable(text, 'mdoc');
    expect(block?.kind).toBe('table');
    const chips = block?.table?.rows[0]?.cells.flatMap((c) => c.chips ?? []);
    expect(chips?.map((c) => [text.slice(c.start, c.end), c.kind])).toEqual([
      ['{% $tier %}', 'variable'],
      ['{% abbr title="US dollars" %}$5{% /abbr %}', 'tag'],
    ]);
    expect(parseBody('| a |\n|---|\n| x {% .wide %} |\n', 'mdoc').blocks[0]?.kind).toBe('source');
  });

  it('reads a table inside a Markdoc tag, and leaves one inside a list or quote to its block', () => {
    const text = '{% callout %}\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n{% /callout %}\n';
    const [callout] = parseBody(text, 'mdoc').blocks;
    const inner = callout?.tag?.children?.[0];
    expect(inner?.kind).toBe('table');
    expect(contents(text, inner)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    for (const format of FORMATS) {
      expect(parseBody('- item\n\n  | a |\n  |---|\n  | 1 |\n', format).blocks[0]?.kind).toBe(
        'source',
      );
      expect(parseBody('> | a |\n> |---|\n> | 1 |\n', format).blocks[0]?.kind).toBe('source');
    }
  });
});

describe('editing pipe tables', () => {
  const compact =
    'Before.\n\n| Option | Default |\n|---|---|\n| `siteName` | The host |\n| `deploy` | `true` |\n\nAfter.\n';

  it('changes nothing when nothing changed', () => {
    for (const format of FORMATS) expect(edit(compact, format, () => undefined)).toBe(compact);
  });

  it('rewrites one cell’s content and nothing else', () => {
    for (const format of FORMATS) {
      expect(
        edit(compact, format, (v) => {
          setCell(v, 2, 1, '`false`');
        }),
      ).toBe(compact.replace('| `deploy` | `true` |', '| `deploy` | `false` |'));
    }
  });

  it('escapes pipes typed into a cell, and reads them back', () => {
    for (const format of FORMATS) {
      const out = edit(compact, format, (v) => {
        setCell(v, 1, 1, escapePipes('a | b, `c|d`'));
      });
      expect(out).toContain('| `siteName` | a \\| b, `c\\|d` |');
      const { block } = firstTable(out, format);
      expect(unescapePipes(contents(out, block)?.[1]?.[1] ?? '')).toBe('a | b, `c|d`');
    }
  });

  it('pads a changed cell to its column in an aligned table, when it fits', () => {
    const aligned =
      '| Item   | Price |\n|--------|------:|\n| Coffee |  2.50 |\n| Tea    |  2.00 |\n';
    expect(
      edit(aligned, 'md', (v) => {
        setCell(v, 2, 0, 'Cocoa');
        setCell(v, 2, 1, '3.25');
      }),
    ).toBe(aligned.replace('| Tea    |  2.00 |', '| Cocoa  |  3.25 |'));
    expect(
      edit(aligned, 'md', (v) => {
        setCell(v, 1, 0, 'Flat white');
      }),
    ).toBe(aligned.replace('| Coffee |', '| Flat white |'));
  });

  it('adds, moves and deletes rows line by line, keeping each line’s ending', () => {
    for (const eol of ['\n', '\r\n']) {
      const text = ['| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'].join(eol) + eol;
      expect(
        edit(text, 'md', (v) => {
          v.rows.push({ from: null, cells: ['5', ''] });
        }),
      ).toBe(text + `| 5 |  |${eol}`.replace(/\r?\n$/, '') + eol);
      expect(
        edit(text, 'mdoc', (v) => {
          const last = v.rows.pop();
          if (last) v.rows.splice(1, 0, last);
        }),
      ).toBe(['| a | b |', '|---|---|', '| 3 | 4 |', '| 1 | 2 |'].join(eol) + eol);
      expect(
        edit(text, 'md', (v) => {
          v.rows.splice(1, 1);
        }),
      ).toBe(['| a | b |', '|---|---|', '| 3 | 4 |'].join(eol) + eol);
    }
  });

  it('adds, moves and deletes a column by exactly that cell in each line', () => {
    const text = '| a | b |\n|---|:-:|\n| 1 | 2 |\n';
    expect(
      edit(text, 'md', (v) => {
        v.columns.splice(1, 0, null);
        v.align.splice(1, 0, null);
        v.rows.forEach((r, i) => r.cells.splice(1, 0, i === 0 ? 'new' : ''));
      }),
    ).toBe('| a | new | b |\n|---|---|:-:|\n| 1 |  | 2 |\n');
    expect(
      edit(text, 'mdoc', (v) => {
        v.columns.reverse();
        v.align.reverse();
        v.rows.forEach((r) => r.cells.reverse());
      }),
    ).toBe('| b | a |\n|:-:|---|\n| 2 | 1 |\n');
    expect(
      edit(text, 'md', (v) => {
        v.columns.splice(0, 1);
        v.align.splice(0, 1);
        v.rows.forEach((r) => r.cells.splice(0, 1));
      }),
    ).toBe('| b |\n|:-:|\n| 2 |\n');
  });

  it('aligns a column in the delimiter row alone', () => {
    const text = '| a | b |\n|---|---|\n| 1 | 2 |\n';
    expect(
      edit(text, 'md', (v) => {
        v.align[1] = 'right';
      }),
    ).toBe('| a | b |\n|---|--:|\n| 1 | 2 |\n');
    expect(
      edit('| a |\n|:-:|\n| 1 |\n', 'mdoc', (v) => {
        v.align[0] = null;
      }),
    ).toBe('| a |\n|---|\n| 1 |\n');
  });

  it('keeps rows without outer pipes that way', () => {
    const text = 'a | b\n--- | ---\n1 | 2\n';
    expect(
      edit(text, 'md', (v) => {
        v.rows.push({ from: null, cells: ['3', '4'] });
      }),
    ).toBe('a | b\n--- | ---\n1 | 2\n3 | 4\n');
  });

  it('edits a table inside an indented tag, giving the assembler unindented text', () => {
    const text = '{% callout %}\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n{% /callout %}\n';
    const [callout] = parseBody(text, 'mdoc').blocks;
    const block = callout?.tag?.children?.[0];
    if (!block?.table) throw new Error('No table.');
    const value = tableValue(text, block.table);
    value.rows.push({ from: null, cells: ['3', '4'] });
    const result = editTable({ text, table: block.table, indent: '  ' }, value, { format: 'mdoc' });
    expect(result).toEqual({ ok: true, text: '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |' });
    const saved = assembleBody(parseBody(text, 'mdoc'), [
      { replaces: 0, children: [{ text: result.ok ? result.text : '', replaces: 0 }] },
    ]);
    expect(saved).toBe(text.replace('| 1 | 2 |\n', '| 1 | 2 |\n  | 3 | 4 |\n'));
  });

  it('refuses a change that wouldn’t read back as the table intended', () => {
    const { block } = firstTable(compact, 'md');
    if (!block?.table) throw new Error('No table.');
    const value = tableValue(compact, block.table);
    setCell(value, 1, 0, 'a<br>b');
    expect(editTable({ text: compact, table: block.table }, value, { format: 'md' }).ok).toBe(
      false,
    );
    setCell(value, 1, 0, 'two\nlines');
    expect(editTable({ text: compact, table: block.table }, value, { format: 'md' }).ok).toBe(
      false,
    );
  });

  it('writes a new table compactly', () => {
    const value: TableValue = {
      align: [null, null],
      columns: [null, null],
      rows: [
        { from: null, cells: ['Day', 'Hours'] },
        { from: null, cells: ['', ''] },
      ],
    };
    for (const format of FORMATS) {
      expect(editTable(null, value, { format })).toEqual({
        ok: true,
        text: '| Day | Hours |\n|---|---|\n|  |  |',
      });
    }
  });
});
