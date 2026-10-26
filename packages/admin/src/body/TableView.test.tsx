// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EntryDocument, SaveRequest } from '@vesper/core';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';

/*
 * Tables in the writing view (DECISIONS.md, "Tables are edited as a grid, and
 * a save splices cells"): the data grid's keys, a cell edited in place, Table
 * actions, what's announced, and saves that change only what changed.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls to the selection.
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
});

const TABLE = '| Item | Price |\n|:---|---:|\n| Coffee | $2.50 |\n| Tea | $2.00 |';
const BODY = `Our prices.\n\n${TABLE}\n\nThanks.\n`;

const entry: EntryDocument = {
  collection: 'blog',
  id: 'prices',
  path: 'src/content/blog/prices.md',
  version: 'v1',
  format: 'md',
  status: 'editable',
  data: {
    title: 'Prices',
    summary: 'What things cost.',
    hero: { src: '../../assets/blog/harbor-at-dawn.jpg', alt: 'An orange sun over a harbor' },
    author: 'ada-moreno',
    publishedAt: { $date: '2026-09-14T00:00:00.000Z' },
  },
  body: `\n\n${BODY}`,
};

function setup(body = BODY) {
  const api = fakeApi({ documents: { 'blog/prices': { ...entry, body: `\n\n${body}` } } });
  renderStudio('#/c/blog/e/prices', { api });
  return { api, user: userEvent.setup() };
}

async function editorOf(): Promise<Editor> {
  const body = await screen.findByRole('textbox', { name: 'Body' });
  const editor = (body as unknown as { editor?: Editor }).editor;
  if (!editor) throw new Error('no editor');
  return editor;
}

function tablePos(editor: Editor): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'vesperTable') found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error('no table');
  return found;
}

function selectTable(editor: Editor) {
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tablePos(editor))),
    );
    editor.view.focus();
  });
}

/** The cell's own editor (Tiptap keeps it on its element), to put text in it as typing would. */
function cellEditor(name: string): Editor {
  const box = screen.getByRole('textbox', { name });
  const editor = (box as unknown as { editor?: Editor }).editor;
  if (!editor) throw new Error(`no editor for ${name}`);
  return editor;
}

/** The cell being edited, once its editor has focus. */
async function editingCell(name: string): Promise<HTMLElement> {
  const box = await screen.findByRole('textbox', { name });
  await waitFor(() => {
    expect(box).toHaveFocus();
  });
  return box;
}

function typeInCell(name: string, text: string) {
  const editor = cellEditor(name);
  act(() => {
    editor.commands.insertContent(text);
  });
}

function savedBody(api: ReturnType<typeof setup>['api']): string {
  const request: SaveRequest | undefined = api.saveEntry.mock.calls.at(-1)?.[0];
  return (request?.body ?? '').replace(/^\n+/, '');
}

async function save(api: ReturnType<typeof setup>['api'], user: ReturnType<typeof setup>['user']) {
  const calls = api.saveEntry.mock.calls.length;
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(api.saveEntry).toHaveBeenCalledTimes(calls + 1);
  });
  return savedBody(api);
}

const grid = () => screen.getByRole('grid');
const cells = () => [
  ...within(grid()).getAllByRole('columnheader'),
  ...within(grid()).getAllByRole('gridcell'),
];
const cell = (name: string) =>
  within(grid()).queryByRole('columnheader', { name }) ??
  within(grid()).getByRole('gridcell', { name });

describe('tables in the writing view', () => {
  it('shows a pipe table as a named grid, out of the Tab order, and passes axe', async () => {
    setup();
    await editorOf();
    expect(screen.getByRole('group', { name: 'Table · 2 columns' })).toBeInTheDocument();
    expect(grid()).toHaveAttribute('aria-rowcount', '3');
    expect(grid()).toHaveAttribute('aria-colcount', '2');
    expect(
      within(grid())
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Item', 'Price']);
    expect(
      within(grid())
        .getAllByRole('gridcell')
        .map((c) => c.textContent),
    ).toEqual(['Coffee', '$2.50', 'Tea', '$2.00']);
    // Nothing in the table is a Tab stop until someone is in it.
    for (const one of cells()) {
      expect(one).toHaveAttribute('tabindex', '-1');
    }
    expect(screen.getByRole('button', { name: 'Table actions' })).toHaveAttribute('tabindex', '-1');
    await expectNoViolations();
  });

  it('by keyboard: Enter on the selected table moves into its cells, the arrows move between them, Escape leaves', async () => {
    const { user } = setup();
    const editor = await editorOf();
    selectTable(editor);
    expect(
      await screen.findByText(
        'Table, 2 columns and 3 rows, selected. Press Enter to edit its cells.',
      ),
    ).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(cell('Item')).toHaveFocus();
    });
    expect(cell('Item')).toHaveAttribute('tabindex', '0');
    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(cell('Coffee')).toHaveFocus();
    });
    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(cell('$2.50')).toHaveFocus();
    });
    await user.keyboard('{Home}');
    await waitFor(() => {
      expect(cell('Coffee')).toHaveFocus();
    });
    await user.keyboard('{Control>}{End}{/Control}');
    await waitFor(() => {
      expect(cell('$2.00')).toHaveFocus();
    });
    await expectNoViolations();
    // Shift+Tab reaches Table actions, which is a stop while someone is in the table.
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: 'Table actions' })).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(cell('$2.00')).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    });
    expect(editor.isFocused).toBe(true);
    // Enter goes back to the cell last used.
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(cell('$2.00')).toHaveFocus();
    });
  });

  it('edits a cell in place: Enter keeps it, and the save changes that cell alone', async () => {
    const { api, user } = setup();
    const editor = await editorOf();
    selectTable(editor);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(cell('Item')).toHaveFocus();
    });
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}{Enter}');
    const box = await screen.findByRole('textbox', { name: 'Price, row 3' });
    await waitFor(() => {
      expect(box).toHaveFocus();
    });
    await expectNoViolations();
    act(() => {
      cellEditor('Price, row 3').commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '$2.25 | each' }] }],
      });
    });
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(cell('$2.25 | each')).toHaveFocus();
    });
    // One transaction per cell: undo and redo work from the grid.
    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => {
      expect(cell('$2.00')).toBeInTheDocument();
    });
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    await waitFor(() => {
      expect(cell('$2.25 | each')).toBeInTheDocument();
    });
    expect(await save(api, user)).toBe(BODY.replace('| $2.00 |', '| $2.25 \\| each |'));
  });

  it('Tab edits the next cell, and in the last cell adds a row', async () => {
    const { api, user } = setup();
    const editor = await editorOf();
    selectTable(editor);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(cell('Item')).toHaveFocus();
    });
    await user.keyboard('{Control>}{End}{/Control}{F2}');
    await editingCell('Price, row 3');
    await user.keyboard('{Tab}');
    expect(await screen.findByText('Row added.')).toBeInTheDocument();
    await editingCell('Item, row 4');
    typeInCell('Item, row 4', 'Cocoa');
    await user.keyboard('{Tab}');
    await editingCell('Price, row 4');
    typeInCell('Price, row 4', '$3.00');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(cell('$3.00')).toHaveFocus();
    });
    expect(await save(api, user)).toBe(
      BODY.replace('| Tea | $2.00 |', '| Tea | $2.00 |\n| Cocoa | $3.00 |'),
    );
  });

  it('Table actions, from Shift+F10 on a cell: insert, move and delete rows and columns, and align', async () => {
    const { api, user } = setup();
    const editor = await editorOf();
    selectTable(editor);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(cell('Item')).toHaveFocus();
    });
    await user.keyboard('{ArrowDown}{Shift>}{F10}{/Shift}');
    const menu = await screen.findByRole('menu', { name: 'Table actions' });
    await expectNoViolations();
    await user.click(within(menu).getByRole('menuitem', { name: 'Insert row below' }));
    expect(await screen.findByText('Row added below row 2.')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(grid()).getAllByRole('gridcell')[2]).toHaveFocus();
    });
    expect(await save(api, user)).toBe(
      BODY.replace('| Coffee | $2.50 |', '| Coffee | $2.50 |\n|  |  |'),
    );

    // Alt+arrows move the row and the column.
    act(() => {
      cell('Tea').focus();
    });
    await user.keyboard('{Alt>}{ArrowUp}{ArrowUp}{/Alt}');
    expect(await screen.findByText('Row 3 moved up.')).toBeInTheDocument();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(await screen.findByText('Column Item moved right.')).toBeInTheDocument();
    expect(await save(api, user)).toBe(
      BODY.replace(
        TABLE,
        '| Price | Item |\n|---:|:---|\n| $2.00 | Tea |\n| $2.50 | Coffee |\n|  |  |',
      ),
    );

    // Align, then delete the empty row and the moved column.
    act(() => {
      cell('Tea').focus();
    });
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitemradio', { name: 'Centre' }));
    expect(await screen.findByText('Column Item aligned centre.')).toBeInTheDocument();
    act(() => {
      within(grid()).getAllByRole('gridcell')[4]?.focus();
    });
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Delete row' }));
    expect(await screen.findByText('Row 4 deleted.')).toBeInTheDocument();
    act(() => {
      cell('Price').focus();
    });
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const last = await screen.findByRole('menu', { name: 'Table actions' });
    // The header row stays: it can't move or go.
    expect(within(last).getByRole('menuitem', { name: 'Delete row' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(within(last).getByRole('menuitem', { name: 'Delete column' }));
    expect(await screen.findByText('Column Price deleted.')).toBeInTheDocument();
    expect(await save(api, user)).toBe(
      BODY.replace(TABLE, '| Item |\n|:--:|\n| Tea |\n| Coffee |'),
    );
  });

  it('inserts a new table from the toolbar, in a Markdown body, with its first cell being edited', async () => {
    const { api, user } = setup('One.\n');
    const editor = await editorOf();
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph' });
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1),
        ),
      );
      editor.view.focus();
    });
    await user.click(screen.getByRole('button', { name: /Insert/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Table' }));
    await editingCell('column 1, the header row');
    typeInCell('column 1, the header row', 'Day');
    await user.keyboard('{Tab}');
    await editingCell('column 2, the header row');
    typeInCell('column 2, the header row', 'Hours');
    await user.keyboard('{Enter}');
    expect(await save(api, user)).toBe('One.\n\n| Day | Hours |\n|---|---|\n|  |  |\n');
  });
});
