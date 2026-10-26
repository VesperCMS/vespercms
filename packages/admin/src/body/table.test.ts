// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { assembleBody, type BodyFormat, type TableValue } from '@vesper/core';
import { afterEach, describe, expect, it } from 'vitest';
import { playgroundManifest } from '../test/helpers.tsx';
import { catalogOf } from './catalog.ts';
import { chipPlaceholder } from './chips.ts';
import { bodyItems, buildDocument, snapshot } from './document.ts';
import {
  BlockIndex,
  SourceBlock,
  VesperCard,
  VesperInline,
  VesperTable,
  containerTypes,
} from './nodes.ts';
import {
  alignColumn,
  cellFits,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  newTableValue,
  setCell,
} from './table.ts';

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const markdoc = playgroundManifest.markdoc?.options;

function open(body: string, format: BodyFormat) {
  const catalog = catalogOf(playgroundManifest, format);
  const containers = containerTypes(catalog);
  editor = new Editor({
    extensions: [
      StarterKit.configure({ underline: false, trailingNode: false }),
      Image.configure({ inline: true }),
      Markdown,
      BlockIndex,
      SourceBlock,
      VesperCard,
      VesperInline,
      VesperTable,
      ...containers.extensions,
    ],
  });
  const e = editor;
  const markdown = e.markdown as MarkdownManager;
  const built = buildDocument(body, {
    format,
    markdown,
    catalog,
    containers,
    ...(markdoc ? { markdoc } : {}),
  });
  e.commands.setContent(built.doc, { emitUpdate: false });
  const initial = snapshot(e.getJSON(), containers);
  const save = () =>
    assembleBody(
      built.parsed,
      bodyItems(e.getJSON(), initial, {
        markdown,
        containers,
        parsed: built.parsed,
        format,
        ...(markdoc ? { markdoc } : {}),
      }),
    );
  /** The first table's position and value. */
  const table = () => {
    const found: { pos: number; value: TableValue }[] = [];
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === 'vesperTable')
        found.push({ pos, value: node.attrs.value as TableValue });
      return true;
    });
    const [first] = found;
    if (!first) throw new Error('No table.');
    return first;
  };
  const change = (next: (value: TableValue) => TableValue) => {
    const { pos, value } = table();
    const attrs = e.state.doc.nodeAt(pos)?.attrs;
    e.view.dispatch(e.state.tr.setNodeMarkup(pos, undefined, { ...attrs, value: next(value) }));
  };
  return { e, markdown, built, save, table, change };
}

const PRICES =
  'Our prices.\n\n| Item | Price |\n|:---|---:|\n| Coffee | $2.50 |\n| Tea | $2.00 |\n\nThanks.\n';

describe('cells', () => {
  it('reads one line of inline Markdown, block markers and pipes included', () => {
    const { markdown } = open('', 'md');
    expect(cellFits(markdown, '**bold**, *em*, `code`, ~~gone~~ and [a link](/x)')).not.toBeNull();
    expect(cellFits(markdown, '2. Second')).toEqual([{ type: 'text', text: '2. Second' }]);
    expect(cellFits(markdown, '# 1')).toEqual([{ type: 'text', text: '# 1' }]);
    expect(cellFits(markdown, '- none')).toEqual([{ type: 'text', text: '- none' }]);
    expect(cellFits(markdown, 'a \\| b')).toEqual([{ type: 'text', text: 'a | b' }]);
    expect(cellFits(markdown, '')).toEqual([]);
    expect(cellFits(markdown, `${chipPlaceholder('{% $price %}')} each`)).toEqual([
      { type: 'vesperInline', attrs: { source: '{% $price %}' } },
      { type: 'text', text: ' each' },
    ]);
  });

  it('refuses what the writing view would change: a line break, an entity it doesn’t decode', () => {
    const { markdown } = open('', 'md');
    expect(cellFits(markdown, 'one<br>two')).toBeNull();
    expect(cellFits(markdown, '&nbsp;x')).toBeNull();
  });
});

describe('tables in the body document', () => {
  it('makes a pipe table a grid in every format, and keeps one it can’t show as written', () => {
    for (const format of ['md', 'mdx', 'mdoc'] as const) {
      expect(
        open(PRICES, format).built.doc.content?.map((n) => n.type),
        format,
      ).toEqual(['paragraph', 'vesperTable', 'paragraph']);
    }
    const kept = '| a |\n|---|\n| one<br>two |\n';
    expect(open(kept, 'md').built.doc.content?.map((n) => n.type)).toEqual(['sourceBlock']);
  });

  it('holds the table as loaded: alignment, rows and columns at their index, cells as written', () => {
    expect(open(PRICES, 'md').table().value).toEqual({
      align: ['left', 'right'],
      columns: [0, 1],
      rows: [
        { from: 0, cells: ['Item', 'Price'] },
        { from: 1, cells: ['Coffee', '$2.50'] },
        { from: 2, cells: ['Tea', '$2.00'] },
      ],
    });
  });

  it('saves a changed cell, row, column or alignment as just that change', () => {
    const cases: [(v: TableValue) => TableValue, string][] = [
      [(v) => setCell(v, 2, 1, '$2.25'), PRICES.replace('$2.00', '$2.25')],
      [(v) => insertRow(v, 3), PRICES.replace('| Tea | $2.00 |', '| Tea | $2.00 |\n|  |  |')],
      [
        (v) => moveRow(v, 2, 1),
        PRICES.replace(/\| Coffee.*\n\| Tea.*\n/, '| Tea | $2.00 |\n| Coffee | $2.50 |\n'),
      ],
      [(v) => deleteRow(v, 1), PRICES.replace('| Coffee | $2.50 |\n', '')],
      [(v) => alignColumn(v, 1, 'center'), PRICES.replace('---:', ':--:')],
      [
        (v) => moveColumn(v, 1, 0),
        PRICES.replace(
          '| Item | Price |\n|:---|---:|\n| Coffee | $2.50 |\n| Tea | $2.00 |',
          '| Price | Item |\n|---:|:---|\n| $2.50 | Coffee |\n| $2.00 | Tea |',
        ),
      ],
      [
        (v) => deleteColumn(v, 0),
        PRICES.replace(
          '| Item | Price |\n|:---|---:|\n| Coffee | $2.50 |\n| Tea | $2.00 |',
          '| Price |\n|---:|\n| $2.50 |\n| $2.00 |',
        ),
      ],
      [
        (v) => setCell(insertColumn(v, 2), 0, 2, 'Size'),
        PRICES.replace(
          '| Item | Price |\n|:---|---:|\n| Coffee | $2.50 |\n| Tea | $2.00 |',
          '| Item | Price | Size |\n|:---|---:|---|\n| Coffee | $2.50 |  |\n| Tea | $2.00 |  |',
        ),
      ],
    ];
    for (const [next, expected] of cases) {
      const { save, change } = open(PRICES, 'md');
      change(next);
      expect(save()).toBe(expected);
    }
  });

  it('keeps a cell’s chips byte for byte when another cell changes', () => {
    const body =
      '| Tier | Price |\n|---|---|\n| {% $tier %} | {% abbr title="US dollars" %}$5{% /abbr %} |\n';
    const { save, change } = open(body, 'mdoc');
    change((v) => setCell(v, 0, 1, 'Monthly price'));
    expect(save()).toBe(body.replace('| Price |', '| Monthly price |'));
  });

  it('edits a table inside a tag’s content, keeping its indentation', () => {
    const body = '{% if $beta %}\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n{% /if %}\n';
    const { save, change } = open(body, 'mdoc');
    change((v) => insertRow(setCell(v, 1, 1, '3'), 2));
    expect(save()).toBe(
      '{% if $beta %}\n  | a | b |\n  |---|---|\n  | 1 | 3 |\n  |  |  |\n{% /if %}\n',
    );
  });

  it('writes a new table compactly, with blank lines around it', () => {
    const { e, save } = open('One.\n\nTwo.\n', 'md');
    e.chain()
      .setTextSelection(5)
      .insertContentAt(5, {
        type: 'vesperTable',
        attrs: { value: setCell(setCell(newTableValue(), 0, 0, 'Day'), 0, 1, 'Hours') },
      })
      .run();
    expect(save()).toBe('One.\n\n| Day | Hours |\n|---|---|\n|  |  |\n\nTwo.\n');
  });
});
