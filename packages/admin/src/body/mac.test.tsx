// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { EntryDocument } from '@vesper/core';
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderStudio } from '../test/helpers.tsx';

/*
 * The body's keys on a Mac, wherever the tests run. The studio and
 * ProseMirror read the platform once, as they load, so it's set first.
 */
vi.hoisted(() => {
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls to the selection.
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
});

const doc: EntryDocument = {
  collection: 'docs',
  id: 'getting-started',
  path: 'src/content/docs/getting-started.mdoc',
  version: 'v1',
  format: 'mdoc',
  status: 'editable',
  data: { title: 'Getting started', summary: 'Install it.' },
  body: '\n\nFrom {% abbr title="content management system" %}CMS{% /abbr %} to the end.\n',
};

async function editorWithChip(): Promise<{ editor: Editor; chip: number }> {
  renderStudio('#/c/docs/e/getting-started', {
    api: fakeApi({ documents: { 'docs/getting-started': doc } }),
  });
  const body = await screen.findByRole('textbox', { name: 'Body' });
  const editor = (body as unknown as { editor?: Editor }).editor;
  if (!editor) throw new Error('no editor');
  let chip = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'vesperInline') chip = pos;
  });
  return { editor, chip };
}

/** Presses a key in the text with the caret at `pos`; true if the browser's own action was stopped. */
function press(editor: Editor, pos: number, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
    editor.view.focus();
    editor.view.dom.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe('the body editor on a Mac', () => {
  it('leaves ⇧⌘← after a chip and ⇧⌘→ before one to the browser', async () => {
    const { editor, chip } = await editorWithChip();
    // ProseMirror would select just the chip and stop the browser's move to
    // the line's end (DECISIONS.md, "⇧⌘← and ⇧⌘→ beside a chip are the
    // browser's"); the e2e test checks where the browser's move lands.
    const lineStart = { key: 'ArrowLeft', keyCode: 37, shiftKey: true, metaKey: true };
    expect(press(editor, chip + 1, lineStart)).toBe(false);
    expect(editor.state.selection.head).toBe(chip + 1);
    const lineEnd = { key: 'ArrowRight', keyCode: 39, shiftKey: true, metaKey: true };
    expect(press(editor, chip, lineEnd)).toBe(false);
    expect(editor.state.selection.head).toBe(chip);
  });

  it('still selects just the chip with ⇧←', async () => {
    const { editor, chip } = await editorWithChip();
    expect(press(editor, chip + 1, { key: 'ArrowLeft', keyCode: 37, shiftKey: true })).toBe(true);
    expect(editor.state.selection).toMatchObject({ anchor: chip + 1, head: chip });
  });
});
