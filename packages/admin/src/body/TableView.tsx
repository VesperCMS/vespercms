import { Extension, Node, type Editor, type JSONContent } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import { EditorContent, NodeViewWrapper, useEditor, type ReactNodeViewProps } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import type { TableAlign, TableValue } from '@vesper/core';
import { IconButton, Menu, cx, type MenuItem } from '@vesper/ui';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { LinkDialog } from './BodyEditor.tsx';
import { fallbackLabel } from './catalog.ts';
import { chipInfo } from './chips.ts';
import { selectBlock } from './commands.ts';
import { VesperInline } from './nodes.ts';
import { isMac, shortcut } from './shortcuts.ts';
import {
  alignColumn,
  cellText,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseCell,
  setCell,
} from './table.ts';
import { useBodyUi, type BodyUi } from './ui.ts';

/*
 * A table in the writing view (DECISIONS.md, "Tables are edited as a grid,
 * and a save splices cells"): the WAI-ARIA data grid pattern. The arrow keys
 * move between cells, Enter or F2 edits one in place, and row and column
 * actions sit behind "Table actions" and Shift+F10. Every change is one
 * transaction on the node's value, checked first by core's writer, so
 * Ctrl+Z undoes it with the rest of the body and nothing that wouldn't save
 * is ever made.
 *
 * Like the other blocks' buttons, the grid is out of the Tab order until
 * someone is in it: from the text, the arrow keys select the table and
 * Enter moves into its cells.
 */

type Cell = { row: number; col: number };
type Then = 'stay' | 'next' | 'previous' | 'leave';

/** A selected table shows a focus outline, but only while the text has focus. */
const SELECTED = cx(
  'in-[.ProseMirror-focused]:outline-2 in-[.ProseMirror-focused]:outline-solid in-[.ProseMirror-focused]:outline-offset-2 in-[.ProseMirror-focused]:outline-focus',
  'in-[.ProseMirror-focused]:ring-6 in-[.ProseMirror-focused]:ring-(color:--glow-focus)',
);

const ALIGNS: { id: string; label: string; align: TableAlign }[] = [
  { id: 'left', label: 'Left', align: 'left' },
  { id: 'center', label: 'Centre', align: 'center' },
  { id: 'right', label: 'Right', align: 'right' },
  { id: 'none', label: 'As written', align: null },
];

const ALIGN_CLASS: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

/** A chip's name in a cell: its tag's label, or its source. */
function chipLabel(ui: Pick<BodyUi, 'catalog'>, source: string): string {
  const info = chipInfo(source);
  const kind = info.name ? ui.catalog.find(info.syntax, info.name) : undefined;
  const label =
    kind?.label ??
    (info.name && (info.kind === 'tag' || info.kind === 'component')
      ? fallbackLabel(info.syntax, info.name)
      : null);
  if (label === null) return source.length > 40 ? `${source.slice(0, 37)}…` : source;
  // Its text too, when that's plain words, as the chip in the text shows it.
  const inner = info.inner ?? '';
  return inner && !/[{<*_`[\]\\]/.test(inner) ? `${label} · ${inner}` : label;
}

/** A cell's text without its formatting: for column names. */
function plainText(ui: Pick<BodyUi, 'catalog'>, inline: readonly JSONContent[]): string {
  return inline
    .map((node) => {
      if (node.type === 'text') return node.text ?? '';
      if (node.type === 'image') return String(node.attrs?.alt ?? '');
      if (node.type === 'vesperInline') return chipLabel(ui, String(node.attrs?.source ?? ''));
      return '';
    })
    .join('')
    .trim();
}

/** A cell's content as the page shows it: formatting, links as text, images by their alt text, chips by name. */
function CellContent({ inline }: { inline: readonly JSONContent[] }) {
  const ui = useBodyUi();
  return inline.map((node, i) => {
    if (node.type === 'image') {
      const alt = String(node.attrs?.alt ?? '');
      return (
        <span key={i} className="text-content-muted">
          {alt ? `Image: ${alt}` : 'Image'}
        </span>
      );
    }
    if (node.type === 'vesperInline') {
      return (
        <span
          key={i}
          className="mx-0.5 rounded-sm border border-border-strong bg-surface-sunken px-1 py-0.5 text-small"
        >
          {chipLabel(ui, String(node.attrs?.source ?? ''))}
        </span>
      );
    }
    let out: ReactNode = node.text ?? '';
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') out = <strong className="font-semibold">{out}</strong>;
      else if (mark.type === 'italic') out = <em>{out}</em>;
      else if (mark.type === 'strike') out = <s>{out}</s>;
      else if (mark.type === 'code') out = <code className="font-mono text-small">{out}</code>;
      else if (mark.type === 'link') out = <span className="text-accent underline">{out}</span>;
    }
    return <Fragment key={i}>{out}</Fragment>;
  });
}

/** What the cell's extensions, made once, need from the latest render. */
class CellBridge {
  done = false;
  changed = false;
  linkOpen = false;
  onFinish: (inline: JSONContent[] | null, then: Then) => void = () => undefined;
  openLink: () => void = () => undefined;
  update(from: Pick<CellBridge, 'onFinish' | 'linkOpen' | 'openLink'>): void {
    this.onFinish = from.onFinish;
    this.linkOpen = from.linkOpen;
    this.openLink = from.openLink;
  }
  /** Stops editing, once, with the content if it changed. */
  finish(editor: Editor, then: Then): boolean {
    if (this.done) return true;
    this.done = true;
    this.onFinish(this.changed ? (editor.getJSON().content[0]?.content ?? []) : null, then);
    return true;
  }
}

/** The cell's editor holds one line. */
const CellDocument = Node.create({ name: 'doc', topNode: true, content: 'paragraph' });

/**
 * One cell, edited in place: a one-line Markdown editor with bold, italic,
 * strikethrough, code, links, images and chips. Enter or Escape stops
 * editing and keeps the change; Tab and Shift+Tab go on to the next or
 * previous cell; leaving it keeps the change too.
 */
function CellEditor({
  inline,
  label,
  describedBy,
  chipName,
  onFinish,
}: {
  inline: readonly JSONContent[];
  label: string;
  describedBy: string;
  chipName: (source: string) => string;
  /** The cell's content when it was changed, else null; and where to go next. */
  onFinish: (inline: JSONContent[] | null, then: Then) => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [bridge] = useState(() => new CellBridge());
  useEffect(() => {
    bridge.update({
      onFinish,
      linkOpen,
      openLink: () => {
        setLinkOpen(true);
      },
    });
  });
  const [extensions] = useState(() => {
    return [
      CellDocument,
      StarterKit.configure({
        document: false,
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        hardBreak: false,
        underline: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Image.configure({ inline: true }),
      // A chip shows its name, as in the grid.
      VesperInline.extend({
        addNodeView() {
          return ({ node }) => {
            const dom = document.createElement('span');
            dom.className =
              'mx-0.5 rounded-sm border border-border-strong bg-surface-sunken px-1 py-0.5 text-small';
            dom.textContent = chipName(String(node.attrs.source));
            return { dom };
          };
        },
      }),
      Markdown,
      Extension.create({
        name: 'vesperCellKeys',
        addKeyboardShortcuts() {
          const editor = this.editor;
          return {
            Enter: () => bridge.finish(editor, 'stay'),
            'Shift-Enter': () => true,
            Escape: () => bridge.finish(editor, 'stay'),
            Tab: () => bridge.finish(editor, 'next'),
            'Shift-Tab': () => bridge.finish(editor, 'previous'),
            'Mod-k': () => {
              bridge.openLink();
              return true;
            },
          };
        },
      }),
      Extension.create({
        name: 'vesperCellBlur',
        onUpdate() {
          bridge.changed = true;
        },
        onBlur() {
          // Leaving is judged a moment later: StrictMode takes the editor
          // down and puts it back as it first shows, and the link dialog takes
          // focus for a while. Neither is leaving the cell.
          const editor = this.editor;
          setTimeout(() => {
            if (editor.isDestroyed || editor.view.hasFocus() || bridge.linkOpen) return;
            bridge.finish(editor, 'leave');
          }, 0);
        },
      }),
    ];
  });
  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [...inline] }] },
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'false',
        'aria-label': label,
        'aria-describedby': describedBy,
        class: 'vesper-body min-h-6 w-full min-w-24 text-body text-content outline-none',
      },
    },
  });
  useEffect(() => {
    // With the caret at the end, as F2 does in a spreadsheet. At once, not in
    // the next frame as Tiptap's focus command does, so keys typed straight
    // after Enter land in the cell.
    const toEnd = () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.focus();
    };
    toEnd();
    // And again in the next frame if the text took focus back meanwhile: the
    // Insert menu focuses the text in one, as Tiptap does, before a new table's
    // first cell opens.
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed && !bridge.done && !editor.view.hasFocus()) toEnd();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [editor, bridge]);
  return (
    <>
      <EditorContent editor={editor} />
      <LinkDialog
        editor={editor}
        isOpen={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open);
        }}
      />
    </>
  );
}

export function TableView({ node, getPos, selected, editor }: ReactNodeViewProps) {
  const ui = useBodyUi();
  const value = node.attrs.value as TableValue;
  const path = (node.attrs.vesperBlock as string | null) ?? null;
  const markdown = editor.markdown as MarkdownManager;
  const rowCount = value.rows.length;
  const colCount = value.columns.length;
  const labelId = useId();
  const problemId = useId();
  const helpId = useId();
  const [active, setActive] = useState<Cell>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<Cell | null>(null);
  // Where the actions menu was opened from: a cell (Shift+F10) gets focus back.
  const [menu, setMenu] = useState<'cell' | 'button' | null>(null);
  const [inside, setInside] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const at: Cell = {
    row: Math.min(active.row, rowCount - 1),
    col: Math.min(active.col, colCount - 1),
  };
  // The latest cell and editing state, for focus moved after a render.
  const latest = useRef({ at, editing });
  useEffect(() => {
    latest.current = { at, editing };
  });

  const parsed = useMemo(
    () => value.rows.map((row) => row.cells.map((cell) => parseCell(markdown, cell) ?? [])),
    [value, markdown],
  );
  const headers = (parsed[0] ?? []).map(
    (inline, i) => plainText(ui, inline) || `column ${String(i + 1)}`,
  );
  const columnName = (col: number) => headers[col] ?? `column ${String(col + 1)}`;

  /**
   * Focuses the current cell once the change has rendered. A timeout, as the
   * list's rows do: after a menu, React Aria gives focus back to its button
   * in an animation frame, unless something else has taken it by then.
   */
  const focusLater = () => {
    setTimeout(() => {
      const { at: cell, editing: open } = latest.current;
      if (!open) cells.current.get(`${String(cell.row)}:${String(cell.col)}`)?.focus();
    }, 0);
  };

  /** Moves to a cell, kept inside the table: the one shown, or the one a change just made. */
  const goTo = (row: number, col: number, table: TableValue = value) => {
    const next = {
      row: Math.max(0, Math.min(table.rows.length - 1, row)),
      col: Math.max(0, Math.min(table.columns.length - 1, col)),
    };
    latest.current = { ...latest.current, at: next };
    setActive(next);
    focusLater();
  };

  /** Starts or stops editing a cell; the cell being edited is the current one. */
  const edit = (cell: Cell | null) => {
    latest.current = { at: cell ?? latest.current.at, editing: cell };
    if (cell) setActive(cell);
    setEditing(cell);
  };

  // A table just inserted starts with its first cell being edited: once,
  // when its view first shows, on word from the insertion outside React.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ui.takeNewTable()) edit({ row: 0, col: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Makes a change, if core's writer would save it, as one transaction. */
  const apply = (next: TableValue, message?: string): boolean => {
    const check = ui.checkTable(path, next);
    if (!check.ok) {
      setProblem(check.reason);
      ui.announce(check.reason);
      return false;
    }
    const pos = getPos();
    const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
    if (typeof pos !== 'number' || current?.type.name !== 'vesperTable') return false;
    setProblem(null);
    // Its own step in the history, so Ctrl+Z undoes it alone.
    editor.view.dispatch(
      closeHistory(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, value: next }),
      ),
    );
    if (message) ui.announce(message);
    return true;
  };

  const leave = () => {
    const pos = getPos();
    if (typeof pos === 'number') selectBlock(editor, pos);
  };

  const rowName = (row: number) => (row === 0 ? 'the header row' : `row ${String(row + 1)}`);

  /** What an action changes, what it says, and the cell focus goes to after it. */
  const changeFor = (id: string, { row, col }: Cell): [TableValue, string, Cell] | null => {
    const name = columnName(col);
    const number = String(row + 1);
    if (id === 'row-above' && row > 0) {
      return [insertRow(value, row), `Row added above ${rowName(row)}.`, { row, col }];
    }
    if (id === 'row-below') {
      return [insertRow(value, row + 1), `Row added below ${rowName(row)}.`, { row: row + 1, col }];
    }
    if (id === 'column-left') {
      return [insertColumn(value, col), `Column added left of ${name}.`, { row, col }];
    }
    if (id === 'column-right') {
      return [
        insertColumn(value, col + 1),
        `Column added right of ${name}.`,
        { row, col: col + 1 },
      ];
    }
    if (id === 'row-up' && row > 1) {
      return [moveRow(value, row, row - 1), `Row ${number} moved up.`, { row: row - 1, col }];
    }
    if (id === 'row-down' && row > 0 && row < rowCount - 1) {
      return [moveRow(value, row, row + 1), `Row ${number} moved down.`, { row: row + 1, col }];
    }
    if (id === 'column-move-left' && col > 0) {
      return [moveColumn(value, col, col - 1), `Column ${name} moved left.`, { row, col: col - 1 }];
    }
    if (id === 'column-move-right' && col < colCount - 1) {
      return [
        moveColumn(value, col, col + 1),
        `Column ${name} moved right.`,
        { row, col: col + 1 },
      ];
    }
    if (id === 'row-delete' && row > 0)
      return [deleteRow(value, row), `Row ${number} deleted.`, { row, col }];
    if (id === 'column-delete' && colCount > 1) {
      return [deleteColumn(value, col), `Column ${name} deleted.`, { row, col }];
    }
    return null;
  };

  const act = (id: string) => {
    const change = changeFor(id, at);
    if (change && apply(change[0], change[1])) goTo(change[2].row, change[2].col, change[0]);
    else goTo(at.row, at.col);
  };

  const align = (id: string) => {
    const choice = ALIGNS.find((a) => a.id === id);
    const { col } = at;
    if (!choice || value.align[col] === choice.align) return;
    const how =
      choice.align === null ? 'as written' : choice.id === 'center' ? 'centre' : choice.id;
    apply(alignColumn(value, col, choice.align), `Column ${columnName(col)} aligned ${how}.`);
  };

  const finish = (cell: Cell) => (inline: JSONContent[] | null, then: Then) => {
    edit(null);
    let next = value;
    let message: string | undefined;
    if (inline) {
      const text = cellText(markdown, inline);
      const again = parseCell(markdown, text);
      if (!again || cellText(markdown, again) !== text) {
        const reason = 'That can’t be written in a table cell, so the cell wasn’t changed.';
        setProblem(reason);
        ui.announce(reason);
        goTo(cell.row, cell.col);
        return;
      }
      if (text !== value.rows[cell.row]?.cells[cell.col])
        next = setCell(next, cell.row, cell.col, text);
    }
    const last = cell.row === rowCount - 1 && cell.col === colCount - 1;
    let target: Cell | null = null;
    if (then === 'next' && last) {
      // As word processors do: Tab in the last cell adds a row.
      next = insertRow(next, rowCount);
      message = 'Row added.';
      target = { row: rowCount, col: 0 };
    } else if (then === 'next') {
      target =
        cell.col < colCount - 1
          ? { row: cell.row, col: cell.col + 1 }
          : { row: cell.row + 1, col: 0 };
    } else if (then === 'previous') {
      target =
        cell.col > 0
          ? { row: cell.row, col: cell.col - 1 }
          : cell.row > 0
            ? { row: cell.row - 1, col: colCount - 1 }
            : null;
    }
    if (next !== value && !apply(next, message)) {
      goTo(cell.row, cell.col);
      return;
    }
    if (then === 'leave') return;
    if (target) edit(target);
    else {
      goTo(cell.row, cell.col);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // The cell's editor has keys of its own.
    if (editing) return;
    const { row, col } = at;
    const mod = isMac ? event.metaKey : event.ctrlKey;
    const key = event.key;
    const editable = !ui.disabled;
    if (event.altKey && editable && key === 'ArrowUp') act('row-up');
    else if (event.altKey && editable && key === 'ArrowDown') act('row-down');
    else if (event.altKey && editable && key === 'ArrowLeft') act('column-move-left');
    else if (event.altKey && editable && key === 'ArrowRight') act('column-move-right');
    else if (key === 'ArrowUp') goTo(row - 1, col);
    else if (key === 'ArrowDown') goTo(row + 1, col);
    else if (key === 'ArrowLeft') goTo(row, col - 1);
    else if (key === 'ArrowRight') goTo(row, col + 1);
    else if (key === 'Home') goTo(event.ctrlKey || event.metaKey ? 0 : row, 0);
    else if (key === 'End') {
      goTo(event.ctrlKey || event.metaKey ? rowCount - 1 : row, colCount - 1);
    } else if ((key === 'Enter' || key === 'F2') && editable) edit({ row, col });
    else if (key === 'Escape') leave();
    else if (((key === 'F10' && event.shiftKey) || key === 'ContextMenu') && editable) {
      setMenu('cell');
    } else if (mod && key.toLowerCase() === 'z') {
      if (event.shiftKey) editor.commands.redo();
      else editor.commands.undo();
    } else if (mod && key.toLowerCase() === 'y') editor.commands.redo();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const items: MenuItem[] = [
    { id: 'row-above', label: 'Insert row above', isDisabled: at.row === 0 },
    { id: 'row-below', label: 'Insert row below' },
    { id: 'column-left', label: 'Insert column left' },
    { id: 'column-right', label: 'Insert column right' },
    { id: 'row-up', label: 'Move row up', isDisabled: at.row <= 1 },
    { id: 'row-down', label: 'Move row down', isDisabled: at.row === 0 || at.row === rowCount - 1 },
    { id: 'column-move-left', label: 'Move column left', isDisabled: at.col === 0 },
    { id: 'column-move-right', label: 'Move column right', isDisabled: at.col === colCount - 1 },
    { id: 'row-delete', label: 'Delete row', isDanger: true, isDisabled: at.row === 0 },
    { id: 'column-delete', label: 'Delete column', isDanger: true, isDisabled: colCount <= 1 },
  ];
  const current = ALIGNS.find((a) => a.align === (value.align[at.col] ?? null)) ?? ALIGNS[3];

  const columnWord = colCount === 1 ? 'column' : 'columns';
  return (
    <NodeViewWrapper
      as="div"
      role="group"
      aria-labelledby={labelId}
      aria-describedby={problem ? problemId : undefined}
      onFocus={() => {
        setInside(true);
      }}
      onBlur={(event: React.FocusEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setInside(false);
        }
      }}
      className={cx('my-3', selected && SELECTED)}
    >
      <div data-vesper-table-ui="" className="mb-1 flex items-center justify-between gap-2">
        <p id={labelId} className="text-label text-content-muted">
          Table · {colCount} {columnWord}
        </p>
        {!ui.disabled && (
          <Menu
            label="Table actions"
            trigger={
              <IconButton
                icon="more"
                label="Table actions"
                // A stop only while someone is in the table: Shift+Tab from a cell reaches it.
                excludeFromTabOrder={!inside}
                className="size-8"
              />
            }
            items={items}
            onAction={act}
            choice={{
              title: 'Align column',
              options: ALIGNS.map((a) => ({ id: a.id, label: a.label })),
              selected: current?.id ?? 'none',
              onChange: align,
            }}
            isOpen={menu !== null}
            onOpenChange={(open) => {
              const from = menu;
              setMenu(open ? (from ?? 'button') : null);
              // Opened from a cell, the menu gives focus back to the cell.
              if (!open && from === 'cell') focusLater();
            }}
          />
        )}
      </div>
      <div
        data-vesper-table-ui=""
        className="overflow-x-auto rounded-md border border-border bg-surface-raised"
      >
        <table
          // The APG's data grid is a table with this role.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
          role="grid"
          aria-label={`Table: ${headers.join(', ')}`}
          aria-rowcount={rowCount}
          aria-colcount={colCount}
          aria-describedby={helpId}
          onKeyDown={onKeyDown}
          className="w-full border-collapse text-body"
        >
          {/* The header row, then the rest. */}
          {[value.rows.slice(0, 1), value.rows.slice(1)].map((group, g) => {
            const rows = group.map((row, i) => {
              const r = g === 0 ? i : i + 1;
              return (
                <tr key={r} aria-rowindex={r + 1}>
                  {row.cells.map((_, c) => {
                    const isActive = at.row === r && at.col === c;
                    const isEditing = editing?.row === r && editing.col === c;
                    const Tag = r === 0 ? 'th' : 'td';
                    return (
                      <Tag
                        key={c}
                        ref={(element: HTMLElement | null) => {
                          const k = `${String(r)}:${String(c)}`;
                          if (element) cells.current.set(k, element);
                          else cells.current.delete(k);
                        }}
                        role={r === 0 ? 'columnheader' : 'gridcell'}
                        aria-colindex={c + 1}
                        tabIndex={isActive && inside && !isEditing ? 0 : -1}
                        data-vesper-active={isActive ? '' : undefined}
                        onFocus={(event) => {
                          if (isEditing) return;
                          setActive({ row: r, col: c });
                          // The text's caret stays in the page's selection while a cell has
                          // focus, and text inserted without keys (dictation, an input
                          // method) would land there, unseen. With none, it lands nowhere.
                          const selection = window.getSelection();
                          if (
                            selection?.anchorNode &&
                            !event.currentTarget.contains(selection.anchorNode)
                          ) {
                            selection.removeAllRanges();
                          }
                        }}
                        onDoubleClick={() => {
                          if (!ui.disabled) edit({ row: r, col: c });
                        }}
                        className={cx(
                          'border border-border px-3 py-2 align-top outline-none',
                          r === 0 ? 'bg-surface-sunken text-label text-content' : 'text-content',
                          ALIGN_CLASS[value.align[c] ?? ''] ?? 'text-left',
                          'focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus',
                          // The cell being edited keeps the ring while its editor has focus.
                          isEditing && 'outline-2 outline-solid -outline-offset-2 outline-focus',
                        )}
                      >
                        {isEditing ? (
                          <CellEditor
                            inline={parsed[r]?.[c] ?? []}
                            label={`${columnName(c)}, ${rowName(r)}`}
                            describedBy={helpId}
                            chipName={(source) => chipLabel(ui, source)}
                            onFinish={finish({ row: r, col: c })}
                          />
                        ) : (
                          <CellContent inline={parsed[r]?.[c] ?? []} />
                        )}
                      </Tag>
                    );
                  })}
                </tr>
              );
            });
            return g === 0 ? <thead key="head">{rows}</thead> : <tbody key="body">{rows}</tbody>;
          })}
        </table>
      </div>
      <p id={helpId} className="sr-only">
        {editing
          ? `Enter or Escape keeps the cell, Tab goes to the next. ${shortcut('Mod', 'B').text} bold, ${shortcut('Mod', 'I').text} italic, ${shortcut('Mod', 'E').text} code, ${shortcut('Mod', 'K').text} link.`
          : 'Enter edits the cell. Shift+F10 for row and column actions. Escape returns to the text.'}
      </p>
      {problem && (
        <p id={problemId} className="mt-2 text-small text-danger">
          {problem}
        </p>
      )}
    </NodeViewWrapper>
  );
}
