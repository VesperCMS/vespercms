import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state';
import {
  parseBody,
  type BodyBlock,
  type BodyFormat,
  type MarkdocParseOptions,
} from '@vespercms/core';
import { isManaged } from './commands.ts';
import type { ContainerTypes } from './nodes.ts';

/*
 * Taking someone to a place in the body (an accessibility note's "Show" and
 * "Go to field"). Notes point at offsets in the body's text; the writing
 * view's nodes are its blocks in the same order (DECISIONS.md, "The body
 * editor splices changed blocks into the original text"), nested only
 * inside containers. So the text is parsed again, the blocks holding the
 * offset are found at each level, and the node at the same place is chosen.
 */

/** The index of the block holding `offset` at each level, going into containers' children. */
export function blockPathAt(blocks: readonly BodyBlock[], offset: number): number[] {
  const path: number[] = [];
  let level = blocks;
  while (level.length > 0) {
    let index = level.findIndex((block) => offset >= block.start && offset <= block.end);
    // Between two blocks: the one before, or the first.
    if (index === -1)
      index = Math.max(
        0,
        level.findLastIndex((block) => block.start <= offset),
      );
    path.push(index);
    const children = level[index]?.tag?.children ?? [];
    // An offset in a container's opening or closing selects the container itself.
    if (!children.some((child) => offset >= child.start && offset <= child.end)) break;
    level = children;
  }
  return path;
}

/** The node at that path in the editor's document, and where it starts. */
function nodeAtPath(doc: PmNode, path: readonly number[]): { node: PmNode; pos: number } | null {
  let parent = doc;
  let contentStart = 0;
  let found: { node: PmNode; pos: number } | null = null;
  for (const wanted of path) {
    if (parent.childCount === 0) break;
    const index = Math.min(wanted, parent.childCount - 1);
    let pos = contentStart;
    for (let i = 0; i < index; i++) pos += parent.child(i).nodeSize;
    const node = parent.child(index);
    found = { node, pos };
    if (node.isTextblock || node.isAtom) break;
    parent = node;
    contentStart = pos + 1;
  }
  return found;
}

/** Selects the block at `offset` of `text` in the writing view, focuses it and scrolls to it. */
export function revealInEditor(
  editor: Editor,
  text: string,
  offset: number,
  options: { format: BodyFormat; markdoc?: MarkdocParseOptions; containers: ContainerTypes },
): void {
  const parsed = parseBody(
    text,
    options.format,
    options.markdoc ? { markdoc: options.markdoc } : {},
  );
  const target = nodeAtPath(editor.state.doc, blockPathAt(parsed.blocks, offset));
  // Focus first: the caret that focus brings would otherwise replace the selection.
  editor.view.focus();
  if (!target) return;
  const { doc } = editor.state;
  let selection: Selection;
  if (target.node.isTextblock) selection = TextSelection.create(doc, target.pos + 1);
  else if (isManaged(target.node.type.name, options.containers))
    selection = NodeSelection.create(doc, target.pos);
  else selection = TextSelection.near(doc.resolve(target.pos + 1));
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
}

/** Selects a range of the source view's text, focuses it and scrolls to it. */
export function revealInSource(textarea: HTMLTextAreaElement, start: number, end: number): void {
  textarea.setSelectionRange(start, end);
  // Focusing after the selection is set scrolls the text area to it.
  textarea.blur();
  textarea.focus();
}
