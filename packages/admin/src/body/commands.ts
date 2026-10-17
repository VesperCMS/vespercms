import type { Editor, JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { BlockKind, BlockShape } from './catalog.ts';
import { newTagText } from './catalog.ts';
import type { ContainerTypes } from './nodes.ts';

/*
 * Keyboard-reachable block operations (spec §6.5.1, "Accessibility of
 * blocks"): every tag can be inserted, configured, moved and removed
 * without a mouse.
 */

/** Node types that are blocks the studio manages: tags, components and protected blocks. */
export function isManaged(type: string, containers: ContainerTypes): boolean {
  return (
    type === 'vesperCard' ||
    type === 'vesperInline' ||
    type === 'sourceBlock' ||
    containers.kindOf(type) !== undefined
  );
}

/** The managed node the selection is on (a node selection), or null. */
export function selectedNode(
  editor: Editor,
  containers: ContainerTypes,
): { pos: number; type: string } | null {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && isManaged(selection.node.type.name, containers)) {
    return { pos: selection.from, type: selection.node.type.name };
  }
  return null;
}

/** The innermost container the cursor is inside, or null. */
export function enclosingContainer(editor: Editor, containers: ContainerTypes): number | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if (containers.kindOf($from.node(depth).type.name)) return $from.before(depth);
  }
  return null;
}

/** Selects the block at `pos` as a whole, so its frame shows focus and Enter opens its settings. */
export function selectBlock(editor: Editor, pos: number): void {
  const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

/** Moves the block at `pos` past its previous or next sibling. Returns its new position, or null. */
export function moveBlock(editor: Editor, pos: number, direction: -1 | 1): number | null {
  const { state } = editor;
  const $pos = state.doc.resolve(pos);
  const node = state.doc.nodeAt(pos);
  if (!node || node.isInline) return null;
  const parent = $pos.parent;
  const index = $pos.index();
  const sibling = index + direction;
  if (sibling < 0 || sibling >= parent.childCount) return null;
  const other = parent.child(sibling);
  const tr = state.tr;
  let target: number;
  if (direction === -1) {
    const otherPos = pos - other.nodeSize;
    tr.delete(pos, pos + node.nodeSize).insert(otherPos, node);
    target = otherPos;
  } else {
    tr.delete(pos, pos + node.nodeSize);
    const after = pos + other.nodeSize;
    tr.insert(after, node);
    target = after;
  }
  tr.setSelection(NodeSelection.create(tr.doc, target)).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
  return target;
}

/** Removes the block or chip at `pos`, leaving the cursor where it was. */
export function removeBlock(editor: Editor, pos: number): void {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const tr = editor.state.tr.delete(pos, pos + node.nodeSize);
  const at = Math.min(pos, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(at)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

/** The editor node a new block of `kind` starts as. */
export function newNode(
  kind: BlockKind,
  shape: BlockShape,
  containers: ContainerTypes,
  attributes: Readonly<Record<string, unknown>> = {},
  inner = '',
): JSONContent {
  const text = newTagText(kind, attributes, shape, inner);
  if (shape === 'inline') return { type: 'vesperInline', attrs: { source: text.whole } };
  const container = shape === 'container' ? containers.typeOf(kind) : undefined;
  if (container) {
    return {
      type: container,
      attrs: { syntax: kind.syntax, name: kind.name, open: text.open, close: text.close },
      content: [{ type: 'paragraph' }],
    };
  }
  return {
    type: 'vesperCard',
    attrs: { syntax: kind.syntax, name: kind.name, source: text.whole },
  };
}

/** Where a kind can go at the cursor: as a block, inline, or not at all. */
export function placementAt(
  editor: Editor,
  kind: BlockKind,
  containers: ContainerTypes,
): BlockShape | null {
  const { $from } = editor.state.selection;
  const block = $from.parent;
  if (!block.isTextblock) return null;
  // An empty line (or one holding only the "/" being typed) takes a block; a line of text, a chip.
  const emptyLine = block.type.name === 'paragraph' && /^\/?[^\s]*$/.test(block.textContent);
  // Asked of the schema directly: inserting through ProseMirror would make
  // a block "fit" by splitting the frame it's in, which isn't what fits here.
  const fitsBlock = (shape: BlockShape) => {
    const depth = $from.depth - 1;
    if (depth < 0) return false;
    const node = editor.schema.nodeFromJSON(newNode(kind, shape, containers));
    const parent = $from.node(depth);
    const index = $from.index(depth);
    return emptyLine
      ? parent.canReplace(index, index + 1, Fragment.from(node))
      : parent.canReplaceWith(index + 1, index + 1, node.type);
  };
  if (kind.block && (emptyLine || !kind.inline) && fitsBlock(kind.block)) return kind.block;
  const chip = editor.schema.nodes.vesperInline;
  if (kind.inline && chip && block.canReplaceWith($from.index(), $from.index(), chip)) {
    return 'inline';
  }
  return null;
}

/**
 * Inserts a new block or chip of `kind` at the cursor (replacing `range`,
 * the "/" text, when given) and returns its position.
 */
export function insertBlock(
  editor: Editor,
  kind: BlockKind,
  shape: BlockShape,
  containers: ContainerTypes,
  range?: { from: number; to: number },
  attributes: Readonly<Record<string, unknown>> = {},
): number | null {
  const node = newNode(kind, shape, containers, attributes);
  let chain = editor.chain().focus();
  if (range) chain = chain.deleteRange(range);
  const before = range ? range.from : editor.state.selection.from;
  if (!chain.insertContent(node).run()) return null;
  // Find the node just inserted: the first of its type at or after where the cursor was.
  const found: { pos: number | null } = { pos: null };
  editor.state.doc.nodesBetween(
    Math.max(0, before - 2),
    editor.state.doc.content.size,
    (child, pos) => {
      if (found.pos !== null) return false;
      if (
        child.type.name === node.type &&
        JSON.stringify(child.attrs.source ?? child.attrs.open) ===
          JSON.stringify(node.attrs?.source ?? node.attrs?.open)
      ) {
        found.pos = pos;
        return false;
      }
      return true;
    },
  );
  if (found.pos !== null && shape === 'container') {
    editor.commands.setTextSelection(found.pos + 2);
  }
  return found.pos;
}
