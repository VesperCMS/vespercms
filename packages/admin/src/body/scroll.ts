import { NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/**
 * A formatting toolbar inside its editor's frame, stuck below whatever
 * already floats at the top of the scroller (`--sticky-top`, set by the
 * screen or the pane), and only while its editor is on screen. Outside them,
 * in a dialog, it sticks to the dialog's top.
 */
export const stuckToolbar =
  'sticky top-[var(--sticky-top,0px)] z-1 rounded-t-md border-b border-border bg-surface-raised p-1';

/** Less than the text's own padding, so a toolbar that isn't stuck never sets this off. */
const GAP = 4;

/**
 * ProseMirror keeps the caret inside its scroller's box, but a stuck
 * formatting toolbar (and the glass above it) covers that box's top, so the
 * caret could move up beneath them out of sight. Before ProseMirror scrolls,
 * this scrolls a caret that's under the toolbar clear of it; ProseMirror's
 * own scrolling then does the rest. Always false, so it never replaces it.
 */
export function scrollClearOfToolbar(view: EditorView, toolbar: HTMLElement | null): boolean {
  if (!toolbar) return false;
  const { selection } = view.state;
  let top: number;
  try {
    top = view.coordsAtPos(
      selection instanceof NodeSelection ? selection.from : selection.head,
    ).top;
  } catch {
    // No layout (jsdom).
    return false;
  }
  const clear = toolbar.getBoundingClientRect().bottom + GAP;
  // Above the text's own top, the caret is scrolled away inside a resized editor: ProseMirror's.
  if (top >= clear || top < view.dom.getBoundingClientRect().top) return false;
  scrollerOf(view.dom).scrollBy(0, top - clear);
  return false;
}

function scrollerOf(element: HTMLElement): Element | Window {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
  }
  return window;
}
