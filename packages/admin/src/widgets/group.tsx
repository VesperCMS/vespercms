import {
  isPlainObject,
  resolveMediaPath,
  variantFor,
  type DataObject,
  type DataValue,
  type FieldModel,
  type FieldVariant,
} from '@vesper/core';
import { Button, Chevron, cx, Dialog, focusRing, Icon, Menu, type MenuItem } from '@vesper/ui';
import { useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react';
import {
  Button as RACButton,
  Disclosure,
  DisclosurePanel,
  Heading,
  useDrag,
  useDrop,
  type KeyboardEvent,
} from 'react-aria-components';
import { useFileUrl } from '../app/file-url.tsx';
import { formatCount } from '../app/format.ts';
import { useEditor, type EditorState } from '../editor/context.tsx';
import { Field } from '../editor/Field.tsx';
import { REVEAL_EVENT } from '../editor/reveal.ts';
import { keyOf, pathKey, type ValuePath } from '../editor/values.ts';
import type { WidgetProps } from '../types.ts';
import { changeKind, changeSummary, kindRow, kindValue } from './union.tsx';

type GroupProps = WidgetProps<DataValue> & { path: ValuePath };

/** An object: its fields, in schema order, inside the field's fieldset. */
export function GroupWidget({ field, path }: GroupProps) {
  const children = (field.children ?? []).filter((child) => !child.hidden);
  return (
    <div className="flex flex-col gap-4">
      {children.map((child) => (
        <Field key={keyOf(child)} field={child} path={[...path, keyOf(child)]} />
      ))}
    </div>
  );
}

/** What one item and several are called: "point" and "points", from the list's own label. */
export function itemNames(list: FieldModel): { one: string; many: string } {
  const item = list.children?.[0];
  const many = list.label.toLowerCase();
  const own = item?.label && item.label !== '[]' && item.label !== 'Item' ? item.label : '';
  const one = own ? own.toLowerCase() : /[^s]s$/.test(many) ? many.slice(0, -1) : many;
  return { one, many };
}

const capital = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

const NAME_KEYS = ['title', 'name', 'label', 'heading', 'text'];

function isImageItem(item: FieldModel | undefined): boolean {
  return item?.kind === 'image' || item?.widget === 'image' || item?.inferredWidget === 'image';
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function imageSource(value: DataValue): string {
  const src = isPlainObject(value) ? value.src : value;
  return typeof src === 'string' ? src : '';
}

/** Markdown's marks would read as noise in a one-line name. */
const plain = (text: string) => text.replace(/[*_`]/g, '').trim();

/**
 * A list item's name, from its own content: an image's alt text or file
 * name; otherwise the `summary` hint's field, a title-like field, or its
 * first text, in that order; else "Point 3".
 */
export function itemSummary(
  value: DataValue,
  index: number,
  list: FieldModel,
): { name: string; key: string | undefined } {
  const fallback = { name: `${capital(itemNames(list).one)} ${String(index + 1)}`, key: undefined };
  if (typeof value === 'string')
    return value.trim() ? { name: plain(value), key: undefined } : fallback;
  if (isImageItem(list.children?.[0])) {
    const alt = isPlainObject(value) && typeof value.alt === 'string' ? value.alt.trim() : '';
    const src = imageSource(value);
    if (alt) return { name: alt, key: 'alt' };
    return src ? { name: fileName(src), key: 'src' } : fallback;
  }
  if (!isPlainObject(value)) return fallback;
  // The hint, then a title-like field, then the item's first text field, in schema order.
  const order = (list.children?.[0]?.children ?? []).filter((c) => !c.hidden).map(keyOf);
  for (const key of [list.summary, ...NAME_KEYS, ...order]) {
    if (!key) continue;
    const text = value[key];
    if (typeof text === 'string' && text.trim()) return { name: plain(text), key };
  }
  return fallback;
}

/** The muted words after an item's name: how many of its first list it holds, else its next text. */
function itemDetail(value: DataValue, item: FieldModel, nameKey: string | undefined): string {
  if (!isPlainObject(value)) return '';
  const children = item.children ?? [];
  const list = children.find((child) => child.kind === 'array' && !child.hidden);
  if (list) {
    const held = value[keyOf(list)];
    const { one, many } = itemNames(list);
    return formatCount(Array.isArray(held) ? held.length : 0, one, many);
  }
  for (const child of children) {
    const key = keyOf(child);
    const text = value[key];
    if (key !== nameKey && !child.hidden && typeof text === 'string' && text.trim()) {
      return plain(text);
    }
  }
  return '';
}

/** How many of the item's fields have something to say: problems from the last save, or notes. */
function countUnder(map: ReadonlyMap<string, readonly unknown[]> | undefined, key: string): number {
  if (!map) return 0;
  let count = 0;
  for (const [at, list] of map) {
    if ((at === key || at.startsWith(`${key}.`)) && list.length > 0) count += list.length;
  }
  return count;
}

/** What a new item holds: `{}` for objects, nothing for scalars. */
function emptyItem(item: FieldModel | undefined): DataValue {
  if (!item) return null;
  if (item.default !== undefined && !item.defaultDynamic)
    return structuredClone(item.default) as DataValue;
  if (item.kind === 'object') return {};
  if (item.kind === 'boolean') return false;
  if (item.kind === 'array') return [];
  if (item.kind === 'number') return 0;
  return '';
}

let lastItemId = 0;
const newItemId = () => `item${String(++lastItemId)}`;

/** A dragged row carries only this, so nothing else on the page (a Markdown field) takes it as text. */
const DRAG_TYPE = 'application/x-vesper-list-item';

/** Where a dragged row would land: before the row at `slot`, drawn as a line `top` pixels down the list. */
type Landing = { slot: number; top: number };

/** A change of kind that would remove content, waiting for the person to confirm it. */
type PendingChange = {
  index: number;
  itemId: string;
  from: string;
  to: FieldVariant;
  /** Labels of the fields with content the new kind has no place for. */
  dropped: string[];
};

/** "Heading and Cards": a short list of field labels in words. */
function inWords(labels: readonly string[]): string {
  return labels.length <= 1
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`;
}

/**
 * The repeater (spec §6.3.2). A list of objects or images shows each item as
 * a row named by its content, which opens in place (DECISIONS.md, "Top-level
 * groups are sections, and list items are rows that open in place"). Rows
 * are closed when the entry opens, except a new item and any holding a field
 * that a refused save names. Order never depends on drag-and-drop (spec
 * §10.6): each item's "…" menu moves it, and Alt+↑/↓ on a row does too. A
 * row's handle drags it as well, for the pointer only (DECISIONS.md, "List
 * rows drag by a handle"). Closed items stay in the page
 * (`hidden="until-found"`), so the browser's find, the error summary and Go
 * to field still reach every field.
 *
 * A list of kinds (a discriminated union) names each row by its kind. Add
 * offers the kinds, each row's "…" menu adds one below it or changes its
 * kind, and a change that would remove content asks first (DECISIONS.md,
 * "Blocks are a discriminated union of objects").
 */
export function RepeaterWidget({ value, onChange, field, path, disabled, id }: GroupProps) {
  const editor = useEditor();
  const items: DataValue[] = Array.isArray(value) ? value : [];
  const item = field.children?.[0];
  const names = itemNames(field);
  const kinds = item?.kind === 'union' ? (item.variants ?? []) : null;
  const asRows = item?.kind === 'object' || kinds !== null || isImageItem(item);
  const max = field.constraints?.max;
  const full = max !== undefined && items.length >= max;
  const status = useRef<HTMLParagraphElement>(null);
  const list = useRef<HTMLOListElement>(null);
  // What each item held as each kind it left, so changing back before saving brings it back.
  const setAside = useRef(new Map<string, Map<string, DataObject>>());
  const [pending, setPending] = useState<PendingChange | null>(null);

  // Items have no identity in the file. Each gets one for this visit, so the
  // open rows and focus follow an item through moves; the file never sees it.
  const [kept, setKept] = useState<readonly string[]>(() => items.map(() => newItemId()));
  let ids = kept;
  if (kept.length !== items.length) {
    // A change from elsewhere (a reload, a restore) changed the count: ids follow by position.
    ids = items.map((_, index) => kept[index] ?? newItemId());
    setKept(ids);
  }

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const toggle = (itemId: string, expanded: boolean) => {
    setOpen((now) => {
      if (now.has(itemId) === expanded) return now;
      const next = new Set(now);
      if (expanded) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  // A refused save opens every item holding a field it names, so the message shows by its field.
  const [seenIssues, setSeenIssues] = useState(editor.issues);
  if (seenIssues !== editor.issues) {
    setSeenIssues(editor.issues);
    const failed = ids.filter(
      (_, index) => countUnder(editor.issues, pathKey([...path, index])) > 0,
    );
    if (failed.length > 0) setOpen((now) => new Set([...now, ...failed]));
  }

  // Going to a field inside a closed item (the error summary, Go to field) opens it first.
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const reveal = (event: Event) => {
      const target = event.target as Node;
      const index = [...element.children].findIndex((child) => child.contains(target));
      const itemId = ids[index];
      if (itemId) setOpen((now) => (now.has(itemId) ? now : new Set([...now, itemId])));
    };
    element.addEventListener(REVEAL_EVENT, reveal);
    return () => {
      element.removeEventListener(REVEAL_EVENT, reveal);
    };
  }, [ids]);

  const announce = (text: string) => {
    if (status.current) status.current.textContent = text;
  };
  /** After the next render: a row's own button, a new item's first control, or Add. */
  const focusLater = (selector: () => HTMLElement | null) => {
    // A timeout, not an animation frame: React Aria returns focus to a closed menu's button in one.
    setTimeout(() => {
      selector()?.focus();
    }, 0);
  };
  const moreButton = (itemId: string) =>
    document.getElementById(`${id}-more-${itemId}`)?.querySelector('button') ?? null;
  const rowButton = (itemId: string) => () =>
    asRows ? document.getElementById(`${id}-row-${itemId}`) : moreButton(itemId);
  const update = (next: DataValue[]) => {
    onChange(next.length === 0 && !field.required ? undefined : next);
  };
  /** A row's name and the muted words after it. */
  const rowOf = (entry: DataValue, index: number): { name: string; detail: string } => {
    if (kinds && item) return kindRow(entry, item);
    const { name, key } = itemSummary(entry, index, field);
    return { name, detail: item && asRows ? itemDetail(entry, item, key) : '' };
  };
  const nameAt = (index: number) => rowOf(items[index] ?? null, index).name;
  const kindNamed = (named: string) => kinds?.find((kind) => kind.value === named);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || disabled) return;
    const name = nameAt(from);
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved ?? null);
    const nextIds = [...ids];
    const [movedId = newItemId()] = nextIds.splice(from, 1);
    nextIds.splice(to, 0, movedId);
    setKept(nextIds);
    update(next);
    announce(`Moved ${name} to position ${String(to + 1)} of ${String(next.length)}.`);
    focusLater(rowButton(movedId));
  };
  const duplicate = (index: number) => {
    if (full) return;
    const copy = structuredClone(items[index] ?? null);
    const copyId = newItemId();
    setKept([...ids.slice(0, index + 1), copyId, ...ids.slice(index + 1)]);
    update([...items.slice(0, index + 1), copy, ...items.slice(index + 1)]);
    announce(`Duplicated ${nameAt(index)} as ${names.one} ${String(index + 2)}.`);
    focusLater(rowButton(copyId));
  };
  const remove = (index: number) => {
    const name = nameAt(index);
    const nextIds = ids.filter((_, i) => i !== index);
    const next = items.filter((_, i) => i !== index);
    setKept(nextIds);
    update(next);
    announce(`Removed ${name}.`);
    const neighbour = nextIds[Math.min(index, next.length - 1)];
    focusLater(neighbour ? rowButton(neighbour) : () => document.getElementById(`${id}-add`));
  };
  /** A new item at `at`: of `kind` in a list of kinds, otherwise empty. */
  const insertAt = (at: number, kind?: FieldVariant) => {
    if (full || disabled) return;
    const newId = newItemId();
    setKept([...ids.slice(0, at), newId, ...ids.slice(at)]);
    if (asRows) toggle(newId, true);
    const fresh = kind && item ? kindValue(item, kind) : emptyItem(item);
    update([...items.slice(0, at), fresh, ...items.slice(at)]);
    const position = `${names.one} ${String(at + 1)}`;
    announce(
      kind
        ? `Added ${kind.label}, ${position} of ${String(items.length + 1)}.`
        : `Added ${position}.`,
    );
    focusLater(
      () =>
        document
          .getElementById(`${id}-panel-${newId}`)
          ?.querySelector<HTMLElement>('input, textarea, [contenteditable="true"], button') ??
        rowButton(newId)(),
    );
  };

  // Only the list a row is dragged from takes the drop. Until then every list stands aside,
  // so the lists inside its open rows let the drag through, and no row lands in another list.
  const [dragged, setDragged] = useState<string | null>(null);
  const [landing, setLanding] = useState<Landing | null>(null);
  const landingAt = (y: number): Landing | null => {
    const element = list.current;
    const from = dragged === null ? -1 : ids.indexOf(dragged);
    if (!element || from === -1) return null;
    const box = element.getBoundingClientRect();
    const rows = [...element.children].map((child) => child.getBoundingClientRect());
    // Before the first row whose middle is below the pointer.
    const found = rows.findIndex((row) => box.top + y < row.top + row.height / 2);
    const slot = found === -1 ? rows.length : found;
    const before = rows[slot - 1];
    const after = rows[slot];
    // Either side of the dragged row is where it is already.
    if (slot === from || slot === from + 1 || (!before && !after)) return null;
    // The line sits in the middle of the gap, or as far outside the first or last row.
    const half = (Number.parseFloat(getComputedStyle(element).rowGap) || 0) / 2;
    const top =
      before && after
        ? (before.bottom + after.top) / 2
        : before
          ? before.bottom + half
          : (after?.top ?? 0) - half;
    // Drawn beside the list, in the widget's own box.
    const frame = element.parentElement?.getBoundingClientRect() ?? box;
    return { slot, top: top - frame.top };
  };
  const { dropProps } = useDrop({
    ref: list,
    isDisabled: dragged === null,
    // Its drags are the pointer's: the keyboard's drag and drop isn't offered here.
    hasDropButton: true,
    getDropOperation: (types) => (types.has(DRAG_TYPE) ? 'move' : 'cancel'),
    onDropEnter: ({ y }) => {
      setLanding(landingAt(y));
    },
    onDropMove: ({ y }) => {
      const next = landingAt(y);
      setLanding((now) => (now?.slot === next?.slot ? now : next));
    },
    onDropExit: () => {
      setLanding(null);
    },
    onDrop: ({ y }) => {
      const at = landingAt(y);
      const from = dragged === null ? -1 : ids.indexOf(dragged);
      setLanding(null);
      // The same move as the menu's and the keyboard's, announced the same way.
      if (at && from !== -1) move(from, at.slot > from ? at.slot - 1 : at.slot);
    },
  });
  const drag = disabled
    ? undefined
    : (itemId: string) => ({
        onStart: () => {
          setDragged(itemId);
        },
        onEnd: () => {
          setDragged(null);
          setLanding(null);
        },
      });

  /** Moves an item to another kind; one that would remove content waits for a confirmation. */
  const changeTo = (index: number, to: FieldVariant, confirmed = false) => {
    const itemId = ids[index];
    if (!item || !itemId || disabled) return;
    const entry = items[index] ?? null;
    const asides = setAside.current.get(itemId) ?? new Map<string, DataObject>();
    const change = changeKind(item, entry, to, asides.get(to.value));
    if (change.dropped.length > 0 && !confirmed) {
      setPending({ index, itemId, from: nameAt(index), to, dropped: change.dropped });
      return;
    }
    const from = variantFor(item, entry);
    if (from && isPlainObject(entry)) asides.set(from.value, entry);
    setAside.current.set(itemId, asides);
    update(items.map((one, i) => (i === index ? change.value : one)));
    announce(`Changed to ${to.label}. ${changeSummary(change)}`.trim());
    focusLater(rowButton(itemId));
  };
  /** The kinds as menu items, each with its description: "Add below" and "Change to" open these. */
  const kindItems = (prefix: string, except?: string): MenuItem[] =>
    (kinds ?? [])
      .filter((kind) => kind.value !== except)
      .map((kind) => ({
        id: `${prefix}:${kind.value}`,
        label: kind.label,
        ...(kind.description ? { description: kind.description } : {}),
      }));
  const actions = (index: number): MenuItem[] => {
    const moves: MenuItem[] = [
      { id: 'up', label: 'Move up', icon: 'move-up', isDisabled: disabled || index === 0 },
      {
        id: 'down',
        label: 'Move down',
        icon: 'move-down',
        isDisabled: disabled || index === items.length - 1,
      },
    ];
    const last: MenuItem[] = [
      { id: 'duplicate', label: 'Duplicate', icon: 'duplicate', isDisabled: disabled || full },
      { id: 'remove', label: 'Remove', icon: 'delete', isDanger: true, isDisabled: disabled },
    ];
    if (!kinds || !item) return [...moves, ...last];
    const [only] = kinds;
    const below: MenuItem =
      kinds.length === 1 && only
        ? { id: `below:${only.value}`, label: 'Add below', icon: 'add' }
        : { id: 'below', label: 'Add below', icon: 'add', items: kindItems('below') };
    const others = kindItems('change', variantFor(item, items[index] ?? null)?.value);
    return [
      ...moves,
      { ...below, isDisabled: disabled || full },
      ...(others.length > 0
        ? [
            {
              id: 'change',
              label: 'Change to',
              icon: 'change-kind' as const,
              isDisabled: disabled,
              items: others,
            },
          ]
        : []),
      ...last,
    ];
  };
  const act = (index: number) => (action: string) => {
    if (action === 'up') move(index, index - 1);
    if (action === 'down') move(index, index + 1);
    if (action === 'duplicate') duplicate(index);
    if (action === 'remove') remove(index);
    const below = action.startsWith('below:') ? kindNamed(action.slice(6)) : undefined;
    if (below) insertAt(index + 1, below);
    const change = action.startsWith('change:') ? kindNamed(action.slice(7)) : undefined;
    if (change) changeTo(index, change);
  };
  const itemMenu = (index: number, itemId: string, spoken: string) => (
    <ItemMenu
      id={`${id}-more-${itemId}`}
      label={`Actions for ${spoken}`}
      items={actions(index)}
      onAction={act(index)}
      isOpen={menuFor === itemId}
      onOpenChange={(isOpen) => {
        setMenuFor(isOpen ? itemId : null);
      }}
    />
  );

  const addLabel = `Add ${names.one}`;
  const allOpen = items.length > 0 && ids.every((itemId) => open.has(itemId));
  return (
    <div className="relative flex flex-col gap-3">
      {asRows && items.length >= 3 && (
        <div className="-mt-1 flex justify-end">
          <Button
            variant="quiet"
            onPress={() => {
              setOpen(allOpen ? new Set() : new Set(ids));
            }}
          >
            {allOpen ? 'Close all' : 'Open all'}
          </Button>
        </div>
      )}
      {items.length === 0 && <p className="text-small text-content-muted">None yet.</p>}
      <ol {...dropProps} ref={list} className={cx('flex flex-col', asRows ? 'gap-2' : 'gap-3')}>
        {items.map((entry, index) => {
          const itemId = ids[index] ?? String(index);
          const { name, detail } = rowOf(entry, index);
          // Several rows can share a kind ("Card grid"), so its words go into the menu's name.
          const spoken = kinds && detail ? `${name}, ${detail}` : name;
          if (!item) return null;
          if (!asRows) {
            return (
              <li key={itemId} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field
                    field={item}
                    path={[...path, index]}
                    label={`${capital(names.one)} ${String(index + 1)}`}
                    item="inline"
                  />
                </div>
                {itemMenu(index, itemId, spoken)}
              </li>
            );
          }
          const at = pathKey([...path, index]);
          return (
            <li key={itemId}>
              <ItemRow
                id={id}
                itemId={itemId}
                name={name}
                detail={detail}
                problems={countUnder(editor.issues, at)}
                notes={countUnder(editor.notes, at)}
                image={isImageItem(item) ? imageSource(entry) : null}
                headingLevel={path.length === 1 ? 3 : null}
                isOpen={open.has(itemId)}
                onOpenChange={(expanded) => {
                  toggle(itemId, expanded);
                }}
                onKeyDown={(event) => {
                  if (event.altKey && event.key === 'ArrowUp') {
                    event.preventDefault();
                    move(index, index - 1);
                  } else if (event.altKey && event.key === 'ArrowDown') {
                    event.preventDefault();
                    move(index, index + 1);
                  } else if (
                    (event.shiftKey && event.key === 'F10') ||
                    event.key === 'ContextMenu'
                  ) {
                    event.preventDefault();
                    setMenuFor(itemId);
                  } else {
                    // React Aria stops a button's keys unless told otherwise, and ⌘S listens on the window.
                    event.continuePropagation();
                  }
                }}
                menu={itemMenu(index, itemId, spoken)}
                drag={drag?.(itemId)}
                editor={editor}
              >
                <Field field={item} path={[...path, index]} label={name} item="row" />
              </ItemRow>
            </li>
          );
        })}
      </ol>
      {/* Beside the list, not in it: a list holds only its items. */}
      {landing && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 h-0.5 -translate-y-1/2 rounded-full bg-accent"
          style={{ top: landing.top }}
        />
      )}
      <div className="flex flex-col items-start gap-1">
        {kinds && kinds.length > 1 ? (
          <Menu
            label={addLabel}
            trigger={
              <Button id={`${id}-add`} icon="add" isDisabled={disabled || full}>
                {addLabel}
              </Button>
            }
            items={kindItems('add')}
            onAction={(action) => {
              const kind = kindNamed(action.slice(4));
              if (kind) insertAt(items.length, kind);
            }}
          />
        ) : (
          <Button
            id={`${id}-add`}
            icon="add"
            isDisabled={disabled || full}
            onPress={() => {
              insertAt(items.length, kinds?.[0]);
            }}
          >
            {addLabel}
          </Button>
        )}
        {full && (
          <p className="text-small text-content-muted">
            At most {formatCount(max, names.one, names.many)}.
          </p>
        )}
      </div>
      <p ref={status} role="status" className="sr-only" />
      <Dialog
        title={pending ? `Change ${pending.from} to ${pending.to.label}?` : ''}
        role="alertdialog"
        isOpen={pending !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPending(null);
        }}
      >
        {pending && (
          <>
            <p className="mb-6">
              {inWords(pending.dropped)} {pending.dropped.length === 1 ? 'has' : 'have'} no place in{' '}
              {pending.to.label}, so {pending.dropped.length === 1 ? 'it is' : 'they are'} removed.
              Changing back before you save brings {pending.dropped.length === 1 ? 'it' : 'them'}{' '}
              back.
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                onPress={() => {
                  setPending(null);
                  focusLater(rowButton(pending.itemId));
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onPress={() => {
                  setPending(null);
                  changeTo(pending.index, pending.to, true);
                }}
              >
                Change to {pending.to.label}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}

/** An item's "…": named for the item, so a list of them reads as "Actions for No second schema". */
function ItemMenu(props: {
  id: string;
  label: string;
  items: MenuItem[];
  onAction: (action: string) => void;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const { id, ...menu } = props;
  // The kit's "…" button takes no id, so the wrapper carries one to find it by.
  return (
    <span id={id} className="flex shrink-0">
      <Menu {...menu} />
    </span>
  );
}

function RowThumbnail({ src, entryPath }: { src: string; entryPath: string }) {
  const url = useFileUrl(src ? resolveMediaPath(src, entryPath) : null);
  return url ? (
    <img src={url} alt="" className="size-10 shrink-0 rounded-sm object-cover" />
  ) : (
    <span aria-hidden="true" className="size-10 shrink-0 rounded-sm bg-surface-sunken" />
  );
}

/**
 * A row's drag handle, for the pointer only: no Tab stop, and hidden from
 * screen readers, which move items with Alt+↑/↓ and the "…" menu. Those say
 * where the item lands; a drag mode would only add a stop to every row.
 */
function DragHandle({
  dragProps,
  header,
}: {
  dragProps: ReturnType<typeof useDrag>['dragProps'];
  header: RefObject<HTMLDivElement | null>;
}) {
  return (
    <span
      {...dragProps}
      aria-hidden="true"
      onDragStart={(event: DragEvent<HTMLElement>) => {
        dragProps.onDragStart?.(event);
        // The row's header follows the pointer, not the handle alone and not an open row's fields.
        const row = header.current;
        if (!row || event.defaultPrevented) return;
        const box = row.getBoundingClientRect();
        event.dataTransfer.setDragImage(row, event.clientX - box.left, event.clientY - box.top);
      }}
      className="ml-1 inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-content-muted hover:text-content active:cursor-grabbing"
    >
      <Icon name="drag" />
    </span>
  );
}

/** One item: a row that names it and opens in place, with its "…" menu beside it. */
function ItemRow({
  id,
  itemId,
  name,
  detail,
  problems,
  notes,
  image,
  headingLevel,
  isOpen,
  onOpenChange,
  onKeyDown,
  menu,
  drag,
  editor,
  children,
}: {
  id: string;
  itemId: string;
  name: string;
  detail: string;
  problems: number;
  notes: number;
  image: string | null;
  headingLevel: 3 | null;
  isOpen: boolean;
  onOpenChange: (expanded: boolean) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  menu: ReactNode;
  /** Its handle's start and end; none while the list can't change. */
  drag: { onStart: () => void; onEnd: () => void } | undefined;
  editor: EditorState;
  children: ReactNode;
}) {
  const header = useRef<HTMLDivElement>(null);
  const { dragProps, isDragging } = useDrag({
    isDisabled: !drag,
    // No drag button: the keyboard moves items with Alt+↑/↓ and the menu instead.
    hasDragButton: true,
    getItems: () => [{ [DRAG_TYPE]: itemId }],
    getAllowedDropOperations: () => ['move'],
    onDragStart: () => drag?.onStart(),
    onDragEnd: () => drag?.onEnd(),
  });
  const trigger = (
    <RACButton
      slot="trigger"
      id={`${id}-row-${itemId}`}
      onKeyDown={onKeyDown}
      className={cx(
        'flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md py-1 pl-2 text-left text-body text-content',
        focusRing,
      )}
    >
      {/* Turned at once: a transition here would hold back React Aria's focus moves. */}
      <Chevron className="shrink-0 -rotate-90 group-data-[expanded]:rotate-0" />
      {image !== null && <RowThumbnail src={image} entryPath={editor.entryPath} />}
      {/* The name wins the room; the detail takes what's left. */}
      <span className="max-w-2/3 min-w-0 shrink-0 truncate">{name}</span>
      {/* Spoken as "No second schema, 3 points": the parts are apart on screen, not in words. */}
      {detail && (
        <span className="min-w-0 flex-1 truncate text-small text-content-muted">
          <span className="sr-only">,</span> {detail}
        </span>
      )}
      {problems > 0 && (
        <span className="shrink-0 text-small text-danger">
          <span className="sr-only">,</span> {formatCount(problems, 'problem', 'problems')}
        </span>
      )}
      {notes > 0 && (
        <span className="shrink-0 text-small text-content-muted">
          <span className="sr-only">,</span> {formatCount(notes, 'note', 'notes')}
        </span>
      )}
    </RACButton>
  );
  return (
    <Disclosure
      id={itemId}
      isExpanded={isOpen}
      onExpandedChange={onOpenChange}
      className={cx(
        'group rounded-md border border-border bg-surface-raised',
        isDragging && 'opacity-50',
      )}
    >
      {/*
       * Its own background, so the picture that follows a drag is the row as it looks.
       * A closed row answers the pointer, like the rows of a pane; an open one is a form.
       */}
      <div
        ref={header}
        className={cx(
          'flex items-center gap-1 rounded-md bg-surface-raised pr-1',
          !isOpen && 'hover:bg-surface-sunken',
        )}
      >
        {drag && <DragHandle dragProps={dragProps} header={header} />}
        {headingLevel ? (
          <Heading level={headingLevel} className="m-0 min-w-0 flex-1">
            {trigger}
          </Heading>
        ) : (
          <div className="min-w-0 flex-1">{trigger}</div>
        )}
        {menu}
      </div>
      <DisclosurePanel>
        <div id={`${id}-panel-${itemId}`} className="border-t border-border px-4 pt-3 pb-4">
          {children}
        </div>
      </DisclosurePanel>
    </Disclosure>
  );
}
