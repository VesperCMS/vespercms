import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { Menu, cx } from '@vesper/ui';
import { useId } from 'react';
import { insertable, type BlockKind, type BlockShape, type Catalog } from './catalog.ts';
import { placementAt } from './commands.ts';
import type { ContainerTypes } from './nodes.ts';

/*
 * Inserting tags (spec §6.5.1, "Inserting"): typing "/" at the start of a
 * line or after a space opens a list of what fits at the cursor, filtered as
 * you type; the toolbar's Insert button offers the same list as a menu.
 *
 * The "/" list follows the combobox pattern: focus stays in the text, which
 * becomes a combobox while the list is open (aria-expanded, aria-controls,
 * aria-activedescendant), and the arrow keys move through the options.
 */

export type InsertChoice = { kind: BlockKind; shape: BlockShape };

type SlashState = { active: false } | { active: true; from: number; index: number };

export const slashKey = new PluginKey<SlashState>('vesperSlash');

/** What can be inserted at the cursor right now, by friendly name. */
export function choicesAt(
  state: EditorState,
  catalog: Catalog,
  containers: ContainerTypes,
): InsertChoice[] {
  return insertable(catalog)
    .flatMap((kind) => {
      const shape = placementAt(state, kind, containers);
      return shape ? [{ kind, shape }] : [];
    })
    .sort((a, b) => a.kind.label.localeCompare(b.kind.label));
}

export function slashQuery(state: EditorState): string | null {
  const slash = slashKey.getState(state);
  if (!slash?.active) return null;
  return state.doc.textBetween(slash.from + 1, state.selection.from, '\n');
}

export function filterChoices(choices: readonly InsertChoice[], query: string): InsertChoice[] {
  const q = query.toLowerCase();
  return choices.filter(
    (c) => c.kind.label.toLowerCase().includes(q) || c.kind.name.toLowerCase().includes(q),
  );
}

export type SlashOptions = {
  listboxId: string;
  optionId: (index: number) => string;
  /** The options for the current query (computed by the caller, which knows the catalog). */
  choices: (state: EditorState) => InsertChoice[];
  choose: (choice: InsertChoice, range: { from: number; to: number }) => void;
  disabled: () => boolean;
};

/**
 * The "/" plugin: opens on "/" typed at a line's start or after a space in a
 * paragraph, closes on Escape, a space, or the cursor leaving the query, and
 * sets the editor's role and ARIA state while it's open.
 */
export function SlashCommands(options: SlashOptions) {
  return Extension.create({
    name: 'vesperSlash',
    // Ahead of every other key handler, so Enter, Escape and the arrows
    // belong to the list while it's open.
    priority: 1000,
    addProseMirrorPlugins() {
      return [
        new Plugin<SlashState>({
          key: slashKey,
          state: {
            init: () => ({ active: false }),
            apply(tr, previous, _old, next) {
              const meta = tr.getMeta(slashKey) as SlashState | { index: number } | undefined;
              let state: SlashState = previous;
              // A list opened by this transaction already points into the new document.
              const opened = meta !== undefined && 'active' in meta;
              if (opened) state = meta;
              else if (meta && state.active) state = { ...state, index: meta.index };
              if (!state.active) return state;
              const from = opened ? state.from : tr.mapping.map(state.from, -1);
              const { selection } = next;
              const text = next.doc.textBetween(from, Math.max(from, selection.from), '\n');
              const still =
                selection.empty &&
                selection.from > from &&
                next.doc.resolve(from).parent === selection.$from.parent &&
                text.startsWith('/') &&
                !/\s/.test(text);
              return still ? { ...state, from } : { active: false };
            },
          },
          props: {
            handleTextInput(view, from, to, text) {
              if (text !== '/' || options.disabled()) return false;
              const $from = view.state.doc.resolve(from);
              if ($from.parent.type.name !== 'paragraph') return false;
              const before = $from.parent.textBetween(0, $from.parentOffset, '\n');
              if (before !== '' && !/\s$/.test(before)) return false;
              view.dispatch(
                view.state.tr
                  .insertText('/', from, to)
                  .setMeta(slashKey, { active: true, from, index: 0 }),
              );
              return true;
            },
            handleKeyDown(view, event) {
              const state = slashKey.getState(view.state);
              if (!state?.active) return false;
              const query = slashQuery(view.state) ?? '';
              const list = filterChoices(options.choices(view.state), query);
              if (event.key === 'Escape') {
                view.dispatch(view.state.tr.setMeta(slashKey, { active: false }));
                return true;
              }
              if (list.length === 0) return false;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const step = event.key === 'ArrowDown' ? 1 : -1;
                const index = (state.index + step + list.length) % list.length;
                view.dispatch(view.state.tr.setMeta(slashKey, { index }));
                return true;
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const choice = list[Math.min(state.index, list.length - 1)];
                if (!choice) return false;
                const range = { from: state.from, to: view.state.selection.from };
                view.dispatch(view.state.tr.setMeta(slashKey, { active: false }));
                options.choose(choice, range);
                return true;
              }
              return false;
            },
          },
        }),
      ];
    },
  });
}

/**
 * The text's role and ARIA state: a multi-line textbox, or a combobox while
 * the "/" list is open. Given to the editor through `editorProps.attributes`,
 * which is the only place that can replace Tiptap's own `role="textbox"`.
 */
export function slashAttributes(
  state: EditorState,
  options: Pick<SlashOptions, 'listboxId' | 'optionId'> & { count: (query: string) => number },
): Record<string, string> {
  const slash = slashKey.getState(state);
  if (!slash?.active) return { role: 'textbox', 'aria-multiline': 'true' };
  const count = options.count(slashQuery(state) ?? '');
  return {
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': options.listboxId,
    'aria-autocomplete': 'list',
    ...(count > 0
      ? { 'aria-activedescendant': options.optionId(Math.min(slash.index, count - 1)) }
      : {}),
  };
}

/** The "/" list, shown under the cursor while the plugin is open. */
export function SlashList({
  editor,
  listboxId,
  optionId,
  choices,
  onChoose,
}: {
  editor: Editor;
  listboxId: string;
  optionId: (index: number) => string;
  choices: (state: EditorState) => InsertChoice[];
  onChoose: (choice: InsertChoice, range: { from: number; to: number }) => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const slash = slashKey.getState(e.state);
      if (!slash?.active) return null;
      return {
        from: slash.from,
        to: e.state.selection.from,
        index: slash.index,
        query: slashQuery(e.state) ?? '',
        place: placeOf(e, slash.from),
      };
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  if (!state) return null;
  const { place } = state;
  const list = filterChoices(choices(editor.state), state.query);
  const active = Math.min(state.index, Math.max(0, list.length - 1));
  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label="Insert a block"
      style={place ? { top: place.top, left: place.left } : undefined}
      className="fixed z-40 max-h-64 min-w-56 overflow-y-auto rounded-md border border-border bg-surface-raised p-1 shadow-overlay"
    >
      {list.length === 0 ? (
        <div
          role="option"
          tabIndex={-1}
          aria-selected="false"
          aria-disabled="true"
          className="px-3 py-2 text-content-muted"
        >
          Nothing fits here
        </div>
      ) : (
        list.map((choice, index) => (
          <div
            key={choice.kind.key}
            id={optionId(index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            className={cx(
              'cursor-default rounded-sm px-3 py-2 text-body text-content',
              index === active && 'bg-accent-subtle',
            )}
            onMouseDown={(event) => {
              // Keep focus (and the "/" range) in the text.
              event.preventDefault();
              onChoose(choice, { from: state.from, to: state.to });
            }}
          >
            {choice.kind.label}
            {choice.shape === 'inline' && (
              <span className="text-content-muted"> (in this line)</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/** Where the list goes: just under the "/". Null when the view can't say (no layout). */
function placeOf(editor: Editor, from: number): { top: number; left: number } | null {
  try {
    const coords = editor.view.coordsAtPos(from);
    return { top: coords.bottom + 4, left: coords.left };
  } catch {
    return null;
  }
}

/** The toolbar's Insert menu: the same list, for people who don't use "/". */
export function InsertMenu({
  editor,
  choices,
  onChoose,
  disabled,
}: {
  editor: Editor;
  choices: (state: EditorState) => InsertChoice[];
  onChoose: (choice: InsertChoice) => void;
  disabled: boolean;
}) {
  const list = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      choices(e.state)
        .map((c) => `${c.kind.key}|${c.shape}`)
        .join(','),
  });
  const available = choices(editor.state);
  if (disabled || list === '' || available.length === 0) return null;
  return (
    <Menu
      label="Insert a block"
      triggerText="Insert"
      items={available.map((c) => ({
        id: `${c.kind.key}|${c.shape}`,
        label: c.shape === 'inline' ? `${c.kind.label} (in this line)` : c.kind.label,
      }))}
      onAction={(id) => {
        const choice = available.find((c) => `${c.kind.key}|${c.shape}` === id);
        if (choice) onChoose(choice);
      }}
    />
  );
}

/** Stable ids for the "/" listbox and its options. */
export function useSlashIds(): { listboxId: string; optionId: (index: number) => string } {
  const base = useId().replace(/:/g, '');
  return { listboxId: `${base}-insert`, optionId: (index) => `${base}-insert-${String(index)}` };
}
