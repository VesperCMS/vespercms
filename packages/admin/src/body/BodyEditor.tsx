import { Extension, type AnyExtension, type Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import { NodeSelection, Plugin, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  assembleBody,
  mediaReference,
  type A11yNote,
  type BodyFormat,
  type BodyIssue,
  type TableValue,
} from '@vesper/core';
import {
  Button,
  Checkbox,
  Dialog,
  Icon,
  TextArea,
  SuggestField,
  ToggleButton,
  ToolbarSeparator,
  ToolButton,
  Toolbar,
  cx,
} from '@vesper/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { NoteText } from '../a11y/FieldNotes.tsx';
import { useStudio } from '../app/context.tsx';
import { pageSuggestions, usePages } from '../editor/PagePicker.tsx';
import { MediaPicker } from '../media/MediaPicker.tsx';
import { inputClass } from '../widgets/basic.tsx';
import { catalogOf, fallbackLabel } from './catalog.ts';
import { chipInfo } from './chips.ts';
import {
  enclosingContainer,
  insertBlock,
  isManaged,
  moveBlock,
  removeBlock,
  selectBlock,
  selectedNode,
} from './commands.ts';
import {
  bodyItems,
  buildDocument,
  snapshot,
  sourceLabel,
  tableEdit,
  type BodyDocument,
} from './document.ts';
import {
  InsertMenu,
  SlashCommands,
  SlashList,
  choicesAt,
  filterChoices,
  slashAttributes,
  useSlashIds,
  type InsertChoice,
} from './insert.tsx';
import {
  BlockIndex,
  SourceBlock,
  VesperCard,
  VesperInline,
  VesperTable,
  containerTypes,
  type ContainerTypes,
} from './nodes.ts';
import { revealInEditor, revealInSource } from './reveal.ts';
import { isMac, shortcut } from './shortcuts.ts';
import { BlockSettings, partialFiles, relativePath } from './settings.tsx';
import { useFileUrl } from '../app/file-url.tsx';
import { bodyChecks } from './checks.ts';
import { BodyUiContext, type BodyUi } from './ui.ts';
import { TableView } from './TableView.tsx';
import { CardView, ContainerView, InlineView, SourceView } from './views.tsx';

export type BodyEditorProps = {
  /** The body text, LF line endings, without the line breaks after the frontmatter. */
  value: string;
  onChange: (value: string) => void;
  format: BodyFormat;
  disabled: boolean;
  /** The entry's file, so images are stored relative to it. */
  entryPath: string;
  /** Where images uploaded into the body go. */
  imageFolder: string;
  /** Files a Markdoc partial can point at, once loaded (Markdoc bodies only). */
  partials?: readonly string[] | null;
  /** Problems in the whole body, from the last check: listed under the source view. */
  issues?: readonly BodyIssue[];
  /** Accessibility notes about the body (spec §6.18), listed under it. */
  notes?: readonly A11yNote[];
  /** Filled with the editor's actions, for the entry's notes drawer. */
  apiRef?: RefObject<BodyApi | null>;
};

/** What the rest of the entry editor can ask of the body editor. */
export type BodyApi = {
  /** Puts the cursor on the place a note points at, in whichever view is open, and focuses it. */
  reveal: (note: A11yNote) => void;
};

const FORMAT_NAMES: Record<BodyFormat, string> = { md: 'Markdown', mdx: 'MDX', mdoc: 'Markdoc' };

/**
 * The body editor (spec §6.5): a writing view and a source view. The writing
 * view owns only the blocks it can show faithfully, and saves splice changed
 * blocks into the original text, so untouched blocks never change. Markdoc
 * tags and declared MDX components are blocks with settings (spec §6.5.1,
 * §6.5.2); everything else it can't show is a protected source block.
 */
export function BodyEditor(props: BodyEditorProps) {
  const [mode, setMode] = useState<'writing' | 'source'>('writing');
  // Each switch back to the writing view rebuilds it from the current text.
  const [generation, setGeneration] = useState(0);
  const formatName = FORMAT_NAMES[props.format];
  const blocking = (props.issues ?? []).filter((issue) => issue.level === 'error');
  const notes = props.notes ?? [];
  // The writing view registers how it reveals a place; the source view is a plain text area.
  const writingReveal = useRef<((offset: number) => void) | null>(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const reveal = (note: A11yNote) => {
    if (note.target.kind !== 'body') return;
    const textarea = document.getElementById('entry-body');
    if (modeRef.current === 'source' && textarea instanceof HTMLTextAreaElement)
      revealInSource(textarea, note.target.start, note.target.end);
    else writingReveal.current?.(note.target.start);
  };
  const revealRef = useRef(reveal);
  useEffect(() => {
    revealRef.current = reveal;
  });
  const { apiRef } = props;
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      reveal: (note) => {
        revealRef.current(note);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  return (
    // A region named "Body": the text's own headings stay real headings, so
    // people can move through them while editing, and screen readers say
    // they're in the body when a heading list or quick navigation lands there.
    <section aria-labelledby="entry-body-label" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id="entry-body-label" className="text-label text-content">
          Body
        </span>
        <Button
          variant="quiet"
          onPress={() => {
            if (mode === 'source') setGeneration((n) => n + 1);
            setMode(mode === 'writing' ? 'source' : 'writing');
          }}
        >
          {mode === 'writing' ? `Edit as ${formatName}` : 'Back to the writing view'}
        </Button>
      </div>
      {mode === 'writing' ? (
        <WritingView key={generation} {...props} revealRef={writingReveal} />
      ) : (
        <>
          <textarea
            id="entry-body"
            aria-labelledby="entry-body-label"
            aria-describedby={cx(
              'entry-body-source-help',
              blocking.length > 0 && 'entry-body-issues',
            )}
            aria-invalid={blocking.length > 0 || undefined}
            value={props.value}
            onChange={(event) => {
              props.onChange(event.target.value);
            }}
            rows={20}
            spellCheck={false}
            disabled={props.disabled}
            className={cx(inputClass, 'resize-y font-mono text-small leading-relaxed')}
          />
          <p id="entry-body-source-help" className="text-small text-content-muted">
            The whole body as {formatName}, exactly as it’s saved.
          </p>
          {blocking.length > 0 && (
            <ul id="entry-body-issues" className="flex flex-col gap-1 text-small text-danger">
              {blocking.map((issue) => (
                <li key={`${String(issue.line)}${issue.message}`}>
                  Line {issue.line}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <BodyNotes notes={notes} lines={mode === 'source'} onShow={reveal} />
    </section>
  );
}

/**
 * The body's accessibility notes (spec §6.18), under the body: each names
 * what it's about and has a Show button that takes the cursor there.
 */
function BodyNotes({
  notes,
  lines,
  onShow,
}: {
  notes: readonly A11yNote[];
  /** In the source view, each note says its line. */
  lines: boolean;
  onShow: (note: A11yNote) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p id="entry-body-a11y-label" className="text-label text-content">
        Accessibility notes in the body
      </p>
      <ul aria-labelledby="entry-body-a11y-label" className="m-0 flex list-none flex-col gap-2 p-0">
        {notes.map((note, index) => {
          const id = `entry-body-a11y-${String(index)}`;
          return (
            <li
              key={id}
              className="flex flex-wrap items-start justify-between gap-2 text-small text-content"
            >
              <p id={id} className="m-0 flex min-w-0 flex-1 gap-2">
                <Icon name="warning" size={16} className="mt-0.5 text-warning" />
                <span>
                  {lines && note.target.kind === 'body' ? `Line ${String(note.target.line)}. ` : ''}
                  <NoteText note={note} />
                </span>
              </p>
              <Button
                variant="quiet"
                aria-describedby={id}
                onPress={() => {
                  onShow(note);
                }}
              >
                Show
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ReactSourceBlock = SourceBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(SourceView);
  },
});
const ReactCard = VesperCard.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CardView);
  },
});
const ReactInline = VesperInline.extend({
  addNodeView() {
    return ReactNodeViewRenderer(InlineView, { as: 'span' });
  },
});
const ReactTable = VesperTable.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TableView, {
      // The grid and its actions own their events: a click on a cell focuses
      // the cell, rather than selecting the whole table in the text.
      stopEvent: ({ event }) =>
        event.target instanceof Element && event.target.closest('[data-vesper-table-ui]') !== null,
    });
  },
});

/**
 * Holds what the editor's extensions need from the latest render (they are
 * made once, with the editor).
 */
class Bridge {
  actions: EditorActions = { open: () => undefined, insert: () => undefined, disabled: true };
  update(actions: EditorActions): void {
    this.actions = actions;
  }
}

type EditorActions = {
  open: (pos: number) => void;
  insert: (choice: InsertChoice, range?: { from: number; to: number }) => void;
  disabled: boolean;
};

/**
 * The body's keys: Escape inside a frame selects the frame, and on a
 * selected block (or in plain text) moves to the toolbar, so leaving the
 * editor never depends on Tab, which indents list items. Enter on a
 * selected block opens its settings; Alt+↑ and Alt+↓ move it. On a Mac,
 * ⇧⌘← and ⇧⌘→ beside a chip are left to the browser.
 */
function bodyShortcuts(options: {
  containers: ContainerTypes;
  actions: () => EditorActions;
  onLink: () => void;
}) {
  const { containers, actions } = options;
  const move = (editor: Editor, direction: -1 | 1): boolean => {
    if (actions().disabled) return false;
    const selected = selectedNode(editor, containers);
    const pos =
      selected && selected.type !== 'vesperInline'
        ? selected.pos
        : enclosingContainer(editor, containers);
    if (pos === null) return false;
    moveBlock(editor, pos, direction);
    return true;
  };
  return Extension.create({
    name: 'vesperShortcuts',
    addKeyboardShortcuts() {
      const editor = this.editor;
      return {
        'Mod-k': () => {
          options.onLink();
          return true;
        },
        Escape: () => {
          if (!selectedNode(editor, containers)) {
            const container = enclosingContainer(editor, containers);
            if (container !== null) {
              selectBlock(editor, container);
              return true;
            }
          }
          // The formatting toolbar sits just before the text, in the same body editor.
          editor.view.dom
            .closest('[data-vesper-body]')
            ?.querySelector<HTMLElement>('[role="toolbar"] button')
            ?.focus();
          return true;
        },
        Enter: () => {
          const selected = selectedNode(editor, containers);
          if (!selected || actions().disabled) return false;
          actions().open(selected.pos);
          return true;
        },
        'Alt-ArrowUp': () => move(editor, -1),
        'Alt-ArrowDown': () => move(editor, 1),
      };
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDOMEvents: {
              // True here leaves the key to the browser: ProseMirror neither
              // handles it nor prevents its default.
              keydown: (view, event) => selectsLineOverLeaf(view, event),
            },
          },
        }),
      ];
    },
  });
}

/**
 * Whether the key is ⇧⌘← or ⇧⌘→ on a Mac with a chip, or another leaf such
 * as a line break, beside the caret on the side the key extends to. There
 * ProseMirror extends the selection over that one node, whatever else is
 * held, and stops the browser's own move to the visual line's end, which
 * is the one that knows where a wrapped line ends (DECISIONS.md, "⇧⌘← and
 * ⇧⌘→ beside a chip are the browser's").
 */
function selectsLineOverLeaf(view: EditorView, event: KeyboardEvent): boolean {
  if (!isMac || !event.shiftKey || !event.metaKey || event.altKey || event.ctrlKey) return false;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;
  const { selection } = view.state;
  if (!(selection instanceof TextSelection)) return false;
  // The side ProseMirror reads the key as, the way it does in Chrome.
  const backward = (event.key === 'ArrowLeft') !== (getComputedStyle(view.dom).direction === 'rtl');
  const node = backward ? selection.$head.nodeBefore : selection.$head.nodeAfter;
  return node !== null && !node.isText && node.isLeaf;
}

/** Moves focus into a table's grid, onto the cell last used. */
function focusGrid(dom: HTMLElement): void {
  const cell =
    dom.querySelector<HTMLElement>('[data-vesper-active]') ??
    dom.querySelector<HTMLElement>('[role="grid"] [aria-colindex]');
  cell?.focus();
}

/** A name for the selected block, read out when the arrow keys land on it. */
function selectionAnnouncement(editor: Editor, ui: Pick<BodyUi, 'catalog' | 'containers'>): string {
  // Only for someone in the text: the editor opens with its last block selected.
  if (!editor.isFocused) return '';
  const selected = selectedNode(editor, ui.containers);
  if (!selected) return '';
  const node = editor.state.doc.nodeAt(selected.pos);
  if (!node) return '';
  if (node.type.name === 'vesperTable') {
    const value = node.attrs.value as TableValue;
    const columns = value.columns.length;
    const rows = value.rows.length;
    return `Table, ${String(columns)} ${columns === 1 ? 'column' : 'columns'} and ${String(rows)} ${rows === 1 ? 'row' : 'rows'}, selected. Press Enter to edit its cells.`;
  }
  let label: string;
  if (node.type.name === 'sourceBlock') label = sourceLabel(String(node.attrs.blockType ?? ''));
  else if (node.type.name === 'vesperInline') {
    const info = chipInfo(String(node.attrs.source));
    const kind = info.name ? ui.catalog.find(info.syntax, info.name) : undefined;
    label =
      kind?.label ??
      (info.kind === 'variable' ? 'Variable' : info.kind === 'annotation' ? 'Annotation' : 'Tag');
  } else {
    const syntax = node.attrs.syntax as 'markdoc' | 'mdx';
    const name = String(node.attrs.name);
    label = ui.catalog.find(syntax, name)?.label ?? fallbackLabel(syntax, name);
  }
  return `${label} selected. Press Enter for its settings.`;
}

function WritingView({
  value,
  onChange,
  format,
  disabled,
  entryPath,
  imageFolder,
  partials = null,
  revealRef,
}: BodyEditorProps & { revealRef: RefObject<((offset: number) => void) | null> }) {
  const { manifest, loadMdxProps } = useStudio();
  const model = useRef<{ built: BodyDocument; initial: Map<string, string> } | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const previewUrl = useFileUrl(imagePath);
  const [settingsAt, setSettingsAt] = useState<number | null>(null);
  const slashIds = useSlashIds();
  // What a table says about its changes ("Row added below row 3.").
  const [said, setSaid] = useState('');
  const newTable = useRef(false);

  // The schema is made once per editor: the catalog decides its node types.
  const [setup] = useState(() => {
    const catalog = catalogOf(manifest, format);
    const containers = containerTypes(catalog);
    return { catalog, containers };
  });
  const { catalog, containers } = setup;
  // The editor's extensions are made once, so they reach the latest props through this.
  const [bridge] = useState(() => new Bridge());

  const [extensions] = useState<AnyExtension[]>(() => {
    const choices = (state: EditorState) => choicesAt(state, catalog, containers);
    return [
      StarterKit.configure({
        // Underline has no Markdown; a trailing empty line would add text nobody typed.
        underline: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Image.configure({ inline: true }),
      Markdown,
      BlockIndex,
      ReactSourceBlock,
      ReactCard,
      ReactInline,
      ReactTable,
      ...containers.extensions.map((extension) =>
        (extension as ReturnType<typeof VesperCard.extend>).extend({
          addNodeView() {
            return ReactNodeViewRenderer(ContainerView);
          },
        }),
      ),
      SlashCommands({
        ...slashIds,
        choices,
        choose: (choice, range) => {
          bridge.actions.insert(choice, range);
        },
        disabled: () => bridge.actions.disabled,
      }),
      bodyShortcuts({
        containers,
        actions: () => bridge.actions,
        onLink: () => {
          setLinkOpen(true);
        },
      }),
    ];
  });

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editable: !disabled,
    extensions,
    editorProps: {
      attributes: (state) => ({
        id: 'entry-body',
        'aria-labelledby': 'entry-body-label',
        'aria-describedby': 'entry-body-help',
        // The frame around the toolbar and text draws the boundary and the focus ring.
        class: 'vesper-body min-h-72 resize-y overflow-y-auto px-4 py-3 text-body outline-none',
        // A textbox, or a combobox while the "/" list is open.
        ...slashAttributes(state, {
          ...slashIds,
          count: (query) => filterChoices(choicesAt(state, catalog, containers), query).length,
        }),
      }),
    },
    onCreate: ({ editor: created }) => {
      const built = buildDocument(value, {
        format,
        markdown: created.markdown as MarkdownManager,
        catalog,
        containers,
        ...(manifest.markdoc ? { markdoc: manifest.markdoc.options } : {}),
      });
      created.commands.setContent(built.doc, { emitUpdate: false });
      model.current = { built, initial: snapshot(created.getJSON(), containers) };
    },
    onUpdate: ({ editor: updated }) => {
      if (!model.current) return;
      const items = bodyItems(updated.getJSON(), model.current.initial, {
        markdown: updated.markdown as MarkdownManager,
        containers,
        parsed: model.current.built.parsed,
        format,
        ...(manifest.markdoc ? { markdoc: manifest.markdoc.options } : {}),
      });
      onChangeRef.current(assembleBody(model.current.built.parsed, items));
    },
  });

  function insertChoice(choice: InsertChoice, range?: { from: number; to: number }) {
    // A new table opens with its first cell being edited.
    newTable.current = choice.kind.builtin === 'table';
    const pos = insertBlock(
      editor,
      choice.kind,
      choice.shape,
      containers,
      range,
      defaultsFor(choice),
    );
    // A new tag with attributes opens its settings straight away (spec §6.5.1).
    if (pos !== null && (choice.kind.fields.length > 0 || choice.shape === 'inline'))
      setSettingsAt(pos);
  }

  /** A new partial starts out pointing at the first partial file, so it's valid from the start. */
  function defaultsFor(choice: InsertChoice): Record<string, unknown> {
    if (choice.kind.builtin !== 'partial') return {};
    const [first] = partialFiles(partials ?? [], entryPath);
    return first ? { file: relativePath(entryPath, first) } : {};
  }

  useEffect(() => {
    bridge.update({
      open: (pos) => {
        // A table has no settings: Enter moves into its cells, onto the one last used.
        if (editor.state.doc.nodeAt(pos)?.type.name === 'vesperTable') {
          const dom = editor.view.nodeDOM(pos);
          if (dom instanceof HTMLElement) focusGrid(dom);
          return;
        }
        setSettingsAt(pos);
      },
      insert: insertChoice,
      disabled,
    });
  });

  const checks = useMemo(
    () => bodyChecks({ manifest, format, loadMdxProps, partials, entryPath }),
    [manifest, format, loadMdxProps, partials, entryPath],
  );
  const ui = useMemo<BodyUi>(
    () => ({
      catalog,
      containers,
      disabled,
      checks,
      partials,
      entryPath,
      openSettings: (pos) => {
        setSettingsAt(pos);
      },
      move: (pos, direction) => {
        const moved = moveBlock(editor, pos, direction);
        if (moved !== null) setSettingsAt((open) => (open === null ? null : moved));
      },
      remove: (pos) => {
        removeBlock(editor, pos);
      },
      announce: (message) => {
        // A different string each time, so the same words are said again.
        setSaid((previous) => (previous === message ? `${message}\u00a0` : message));
      },
      checkTable: (path, value) =>
        tableEdit(path, value, {
          markdown: editor.markdown as MarkdownManager,
          containers,
          format,
          ...(model.current ? { parsed: model.current.built.parsed } : {}),
          ...(manifest.markdoc ? { markdoc: manifest.markdoc.options } : {}),
        }),
      takeNewTable: () => {
        const fresh = newTable.current;
        newTable.current = false;
        return fresh;
      },
    }),
    [catalog, containers, disabled, checks, partials, entryPath, editor, format, manifest.markdoc],
  );

  // How a note's Show finds its block: by the current text, parsed again.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });
  useEffect(() => {
    revealRef.current = (offset) => {
      revealInEditor(editor, valueRef.current, offset, {
        format,
        containers,
        ...(manifest.markdoc ? { markdoc: manifest.markdoc.options } : {}),
      });
    };
    return () => {
      revealRef.current = null;
    };
  }, [editor, format, containers, manifest.markdoc, revealRef]);

  const announcement = useEditorState({
    editor,
    selector: ({ editor: e }) => selectionAnnouncement(e, { catalog, containers }),
  });
  const hasBlocks = catalog.kinds.size > 0;

  return (
    <BodyUiContext.Provider value={ui}>
      <div data-vesper-body="" className="flex flex-col gap-2">
        {/*
         * One hairline frame holds the toolbar and the text. Focus in the text
         * rings the frame; the toolbar's buttons ring themselves.
         */}
        <div
          className={cx(
            'rounded-md border border-border-strong bg-surface-raised',
            'has-[#entry-body:focus-visible]:outline-2 has-[#entry-body:focus-visible]:outline-solid has-[#entry-body:focus-visible]:outline-offset-2 has-[#entry-body:focus-visible]:outline-focus',
            'has-[#entry-body:focus-visible]:ring-6 has-[#entry-body:focus-visible]:ring-(color:--glow-focus)',
          )}
        >
          <div className="border-b border-border p-1">
            <FormatToolbar
              editor={editor}
              disabled={disabled}
              onLink={() => {
                setLinkOpen(true);
              }}
              onImage={() => {
                setPicking(true);
              }}
              insert={
                <InsertMenu
                  editor={editor}
                  choices={(state) => choicesAt(state, catalog, containers)}
                  onChoose={(choice) => {
                    insertChoice(choice);
                  }}
                  disabled={disabled}
                />
              }
            />
          </div>
          <EditorContent editor={editor} />
        </div>
        <SlashList
          editor={editor}
          {...slashIds}
          choices={(state) => choicesAt(state, catalog, containers)}
          onChoose={(choice, range) => {
            insertChoice(choice, range);
          }}
        />
        <p className="sr-only" role="status">
          {announcement}
        </p>
        {/*
         * Apart from the selection's: a change made in a table's grid also
         * changes what the text's selection says, and neither may hide the other.
         */}
        <div className="sr-only" role="status">
          {said}
        </div>
        <p id="entry-body-help" className="text-small text-content-muted">
          Ctrl+B bold, Ctrl+I italic, Ctrl+K link.
          {hasBlocks
            ? ' Type / to insert a block or a table. Arrow onto a block and press Enter for its settings, or onto a table for its cells; Alt+↑ and Alt+↓ move it.'
            : ' Type / to insert a table. Arrow onto a table and press Enter for its cells; Alt+↑ and Alt+↓ move it.'}{' '}
          Escape leaves a block, then the text. Dashed boxes are kept exactly as written.
        </p>

        <BlockSettings
          editor={editor}
          pos={settingsAt}
          onClose={() => {
            const pos = settingsAt;
            setSettingsAt(null);
            // Back to the text with the block still selected, so Enter reopens
            // its settings and Alt+↑/↓ or cut moves it. Only once the closing
            // dialog has put focus back in the editor (after its exit), since
            // the caret that focus brings would replace the selection.
            const dom = editor.view.dom;
            let done = false;
            const reselect = () => {
              // Someone may have left the entry in the meantime.
              if (done || editor.isDestroyed) return;
              done = true;
              dom.removeEventListener('focusin', onFocus);
              editor.view.focus();
              const node = pos === null ? null : editor.state.doc.nodeAt(pos);
              if (pos !== null && node && isManaged(node.type.name, containers)) {
                editor.view.dispatch(
                  editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
                );
              }
            };
            const onFocus = () => setTimeout(reselect, 0);
            dom.addEventListener('focusin', onFocus);
            // In case focus was meant to go somewhere else entirely.
            setTimeout(reselect, 500);
          }}
        />
        <LinkDialog editor={editor} isOpen={linkOpen} onOpenChange={setLinkOpen} />
        <MediaPicker
          isOpen={picking}
          onOpenChange={setPicking}
          kind="image"
          folder={imageFolder}
          onChoose={(path) => {
            setImagePath(path);
          }}
        />
        <ImageAltDialog
          path={imagePath}
          previewUrl={previewUrl}
          onCancel={() => {
            setImagePath(null);
            editor.commands.focus();
          }}
          onInsert={(alt) => {
            if (!imagePath) return;
            editor
              .chain()
              .focus()
              .setImage({ src: mediaReference(imagePath, entryPath), alt })
              .run();
            setImagePath(null);
          }}
        />
      </div>
    </BodyUiContext.Provider>
  );
}

function FormatToolbar({
  editor,
  disabled,
  onLink,
  onImage,
  insert,
}: {
  editor: Editor;
  disabled: boolean;
  onLink: () => void;
  onImage: () => void;
  /** The Insert menu, for bodies whose site has tags or components. */
  insert: ReactNode;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      code: e.isActive('code'),
      heading2: e.isActive('heading', { level: 2 }),
      heading3: e.isActive('heading', { level: 3 }),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <Toolbar label="Formatting">
      <ToggleButton
        icon="bold"
        label="Bold"
        shortcut={shortcut('Mod', 'B')}
        isDisabled={disabled}
        isSelected={state.bold}
        onChange={() => chain().toggleBold().run()}
      />
      <ToggleButton
        icon="italic"
        label="Italic"
        shortcut={shortcut('Mod', 'I')}
        isDisabled={disabled}
        isSelected={state.italic}
        onChange={() => chain().toggleItalic().run()}
      />
      <ToolbarSeparator />
      <ToggleButton
        icon="heading"
        label="Heading"
        shortcut={shortcut('Mod', 'Alt', '2')}
        isDisabled={disabled}
        isSelected={state.heading2}
        onChange={() => chain().toggleHeading({ level: 2 }).run()}
      />
      <ToggleButton
        icon="subheading"
        label="Subheading"
        shortcut={shortcut('Mod', 'Alt', '3')}
        isDisabled={disabled}
        isSelected={state.heading3}
        onChange={() => chain().toggleHeading({ level: 3 }).run()}
      />
      <ToolbarSeparator />
      <ToggleButton
        icon="bullets"
        label="Bullets"
        shortcut={shortcut('Mod', 'Shift', '8')}
        isDisabled={disabled}
        isSelected={state.bullets}
        onChange={() => chain().toggleBulletList().run()}
      />
      <ToggleButton
        icon="numbers"
        label="Numbers"
        shortcut={shortcut('Mod', 'Shift', '7')}
        isDisabled={disabled}
        isSelected={state.numbers}
        onChange={() => chain().toggleOrderedList().run()}
      />
      <ToggleButton
        icon="quote"
        label="Quote"
        shortcut={shortcut('Mod', 'Shift', 'B')}
        isDisabled={disabled}
        isSelected={state.quote}
        onChange={() => chain().toggleBlockquote().run()}
      />
      <ToggleButton
        icon="code"
        label="Code"
        shortcut={shortcut('Mod', 'E')}
        isDisabled={disabled}
        isSelected={state.code}
        onChange={() => chain().toggleCode().run()}
      />
      <ToolbarSeparator />
      <ToolButton
        icon="link"
        label={state.link ? 'Edit link' : 'Link'}
        shortcut={shortcut('Mod', 'K')}
        isDisabled={disabled}
        onPress={onLink}
      />
      <ToolButton icon="image" label="Image" isDisabled={disabled} onPress={onImage} />
      {insert}
    </Toolbar>
  );
}

export function LinkDialog({
  editor,
  isOpen,
  onOpenChange,
}: {
  editor: Editor;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const current = editor.getAttributes('link').href as string | undefined;
  const close = () => {
    onOpenChange(false);
    editor.commands.focus();
  };
  return (
    <Dialog
      title={current ? 'Edit link' : 'Add a link'}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) onOpenChange(true);
        else close();
      }}
    >
      {isOpen && <LinkForm editor={editor} current={current} onDone={close} />}
    </Dialog>
  );
}

function LinkForm({
  editor,
  current,
  onDone,
}: {
  editor: Editor;
  current: string | undefined;
  onDone: () => void;
}) {
  const [href, setHref] = useState(current ?? '');
  // The link picker (spec §6.15.6): pages by title, written as their address.
  const pages = usePages();
  const suggestions = useMemo(() => pageSuggestions(pages), [pages]);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const url = href.trim();
        if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
        else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        onDone();
      }}
    >
      <SuggestField
        label="Page or web address"
        description="Search pages by title, or type an address such as https://example.com."
        value={href}
        onChange={setHref}
        suggestions={suggestions}
        inputMode="url"
      />
      <div className="flex flex-wrap justify-end gap-3">
        {current && (
          <Button
            variant="quiet"
            onPress={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              onDone();
            }}
          >
            Remove link
          </Button>
        )}
        <Button type="submit" variant="primary">
          {current ? 'Update link' : 'Add link'}
        </Button>
      </div>
    </form>
  );
}

/** Alt text before an image goes into the body: required, unless it's decorative. */
function ImageAltDialog({
  path,
  previewUrl,
  onCancel,
  onInsert,
}: {
  path: string | null;
  previewUrl: string;
  onCancel: () => void;
  onInsert: (alt: string) => void;
}) {
  const [alt, setAlt] = useState('');
  const [decorative, setDecorative] = useState(false);
  const [missing, setMissing] = useState(false);
  return (
    <Dialog
      title="Describe the image"
      isOpen={path !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!decorative && alt.trim() === '') {
            setMissing(true);
            return;
          }
          onInsert(decorative ? '' : alt.trim());
          setAlt('');
          setDecorative(false);
          setMissing(false);
        }}
      >
        {previewUrl && (
          <img src={previewUrl} alt="" className="max-h-40 self-start rounded-md object-contain" />
        )}
        {path && (
          <p className="text-small text-content-muted">{path.slice(path.lastIndexOf('/') + 1)}</p>
        )}
        {!decorative && (
          <TextArea
            label="Alt text"
            isRequired
            description="Describe what this image communicates here."
            value={alt}
            onChange={(next) => {
              setAlt(next);
              setMissing(false);
            }}
            isInvalid={missing}
            errorMessage="Describe the image, or mark it decorative."
            rows={2}
          />
        )}
        <Checkbox isSelected={decorative} onChange={setDecorative}>
          Decorative image (it adds nothing a reader needs)
        </Checkbox>
        <div className="flex justify-end">
          <Button type="submit" variant="primary">
            Insert image
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
