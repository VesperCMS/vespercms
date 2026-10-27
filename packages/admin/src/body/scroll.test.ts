// @vitest-environment jsdom
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollClearOfToolbar } from './scroll.ts';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function box(element: HTMLElement, top: number, bottom: number) {
  element.getBoundingClientRect = () => new DOMRect(0, top, 600, bottom - top);
}

/** A pane that scrolls, holding a toolbar whose bottom is at 100 and the text from 50 (scrolled). */
function layout(caretTop: number, { scrolls = true } = {}) {
  const pane = document.createElement('div');
  pane.style.overflowY = 'auto';
  Object.defineProperty(pane, 'scrollHeight', { value: scrolls ? 2000 : 500 });
  Object.defineProperty(pane, 'clientHeight', { value: 500 });
  const scrolled = vi.fn();
  pane.scrollBy = scrolled;
  const toolbar = document.createElement('div');
  const text = document.createElement('div');
  pane.append(toolbar, text);
  document.body.append(pane);
  box(toolbar, 40, 100);
  box(text, 50, 2000);
  const view = {
    state: { selection: { head: 7, from: 7 } },
    coordsAtPos: () => ({ top: caretTop, bottom: caretTop + 20, left: 0, right: 0 }),
    dom: text,
  } as unknown as EditorView;
  return { scrolled, toolbar, view };
}

describe('the caret and a stuck toolbar', () => {
  it('scrolls a caret beneath the toolbar to just below it, then leaves the rest to ProseMirror', () => {
    const { scrolled, toolbar, view } = layout(80);
    expect(scrollClearOfToolbar(view, toolbar)).toBe(false);
    expect(scrolled).toHaveBeenCalledWith(0, -24);
  });

  it('leaves a caret below the toolbar alone', () => {
    const { scrolled, toolbar, view } = layout(104);
    scrollClearOfToolbar(view, toolbar);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('leaves a caret above the text itself to ProseMirror: a resized editor scrolled inside', () => {
    const { scrolled, toolbar, view } = layout(30);
    scrollClearOfToolbar(view, toolbar);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('scrolls the window where nothing around the text scrolls (one screen at a time)', () => {
    const { scrolled, toolbar, view } = layout(80, { scrolls: false });
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    scrollClearOfToolbar(view, toolbar);
    expect(scrolled).not.toHaveBeenCalled();
    expect(scrollBy).toHaveBeenCalledWith(0, -24);
  });
});
