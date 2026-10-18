import type { KeyboardEvent, ReactNode } from 'react';
import {
  Button as RACButton,
  Collection,
  Tree as RACTree,
  TreeItem as RACTreeItem,
  TreeItemContent,
  type DragAndDropHooks,
  type Key,
} from 'react-aria-components';
import { Icon } from './Button.tsx';
import { Chevron } from './overlays.tsx';
import { colorTransition, cx, focusRing } from './shared.tsx';

/*
 * An outline (spec §6.15.2): React Aria's Tree, a single-column treegrid.
 * Arrow keys move and expand, Home and End jump, typing finds a row by its
 * text, and each row can hold buttons (its "…" menu). A treegrid, not a
 * plain tree, because WAI-ARIA's tree items can't contain buttons.
 */

/** React Aria's drag and drop for a Tree, with its keyboard and screen reader support. */
export { useDragAndDrop, type Key } from 'react-aria-components';

export type TreeNode = { id: string; children: TreeNode[] };

export type TreeRowState = { isExpanded: boolean; hasChildItems: boolean; level: number };

export type TreeProps<T extends TreeNode> = {
  /** Accessible name, e.g. "Pages". */
  label: string;
  items: T[];
  /** The row's text, for type-ahead. */
  textValue: (item: T) => string;
  renderRow: (item: T, state: TreeRowState) => ReactNode;
  /** Enter or a click on a row. */
  onAction?: (item: T) => void;
  expandedKeys?: Iterable<Key>;
  onExpandedChange?: (keys: Set<Key>) => void;
  /** From React Aria's `useDragAndDrop`. Dragging is offered, never required. */
  dragAndDropHooks?: DragAndDropHooks<T>;
  /** Keys pressed on a focused row (Alt+arrows to move it, say). Stop the event to keep it from the tree. */
  onRowKeyDown?: (item: T, event: KeyboardEvent<HTMLDivElement>) => void;
  emptyState?: ReactNode;
};

export function Tree<T extends TreeNode>({
  label,
  items,
  textValue,
  renderRow,
  onAction,
  expandedKeys,
  onExpandedChange,
  dragAndDropHooks,
  onRowKeyDown,
  emptyState,
}: TreeProps<T>) {
  // React Aria's rows keep their own key handling, so row keys are read on the
  // way down, from whichever row has focus.
  const byKey = new Map<string, T>();
  const remember = (nodes: T[]) => {
    for (const node of nodes) {
      byKey.set(node.id, node);
      remember(node.children as T[]);
    }
  };
  remember(items);
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onRowKeyDown) return;
    const row = (event.target as HTMLElement).closest('[role="row"]');
    if (row !== event.target) return;
    const item = byKey.get(row.getAttribute('data-key') ?? '');
    if (item) onRowKeyDown(item, event);
  };

  const renderItem = (item: T): ReactNode => (
    <RACTreeItem
      id={item.id}
      textValue={textValue(item)}
      {...(onAction
        ? {
            onAction: () => {
              onAction(item);
            },
          }
        : {})}
      className={cx(
        'group rounded-md text-body outline-none data-[hovered]:bg-surface-sunken',
        'data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-focus',
        // Where a dragged page would land is the current item: accent-subtle and its halo.
        'data-[drop-target]:bg-accent-subtle data-[drop-target]:shadow-glow-selected data-[dragging]:opacity-50',
        colorTransition,
      )}
    >
      <TreeItemContent>
        {({ isExpanded, hasChildItems, level, allowsDragging }) => (
          <div
            className="flex min-h-12 items-center gap-1 py-1 pr-1"
            style={{ paddingInlineStart: `calc(var(--spacing) * ${String(6 * (level - 1) + 1)})` }}
          >
            {allowsDragging && (
              <RACButton
                slot="drag"
                className={cx(
                  'inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-content-muted data-[hovered]:text-content',
                  focusRing,
                )}
              >
                <Icon name="drag" />
              </RACButton>
            )}
            {hasChildItems ? (
              <RACButton
                slot="chevron"
                className={cx(
                  'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-content-muted data-[hovered]:bg-surface-sunken',
                  focusRing,
                )}
              >
                {/* Turned at once: a transition here would hold back React Aria's focus moves. */}
                <Chevron className={isExpanded ? 'rotate-0' : '-rotate-90'} />
              </RACButton>
            ) : (
              <span aria-hidden="true" className="inline-block size-8 shrink-0" />
            )}
            {renderRow(item, { isExpanded, hasChildItems, level })}
          </div>
        )}
      </TreeItemContent>
      <Collection items={item.children as T[]}>{renderItem}</Collection>
    </RACTreeItem>
  );

  return (
    <div onKeyDownCapture={onKeyDownCapture}>
      <RACTree
        aria-label={label}
        items={items}
        {...(expandedKeys ? { expandedKeys } : {})}
        {...(onExpandedChange ? { onExpandedChange } : {})}
        {...(dragAndDropHooks ? { dragAndDropHooks } : {})}
        renderEmptyState={() => <p className="px-3 py-6 text-content-muted">{emptyState}</p>}
        className="flex w-full flex-col gap-0.5"
      >
        {renderItem}
      </RACTree>
    </div>
  );
}
