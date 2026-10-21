// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import type { EntryDocument, SaveRequest } from '@vesper/core';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls to the selection.
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
});

const about: EntryDocument = {
  collection: 'pages',
  id: 'about',
  path: 'src/content/pages/about.md',
  version: 'v1',
  format: 'md',
  status: 'editable',
  data: {
    title: 'About the college',
    sections: [
      {
        heading: 'Our mission',
        body: 'Open doors, *practical* degrees, and a campus where people know your name.',
      },
      { heading: 'Accreditation', body: '# Not inline\n\nTwo paragraphs.' },
      {
        heading: 'For developers',
        body: 'Fields come from `src/content.config.ts`, as **written**.',
      },
    ],
  },
  body: '\n',
};

// One Markdown field, so its toolbar is the only "Formatting for Body".
const guide: EntryDocument = {
  ...about,
  id: 'guide',
  path: 'src/content/pages/guide.md',
  data: {
    title: 'Getting started',
    sections: [
      { heading: 'Where to start', body: 'Start with `src/content.config.ts`, then the studio.' },
    ],
  },
};

/** Selects the first occurrence of `text` in the editor. */
function select(editor: Editor, text: string) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text?.includes(text)) {
      from = pos + node.text.indexOf(text);
    }
    return from === -1;
  });
  if (from === -1) throw new Error(`no “${text}”`);
  act(() => {
    editor.commands.setTextSelection({ from, to: from + text.length });
  });
}

describe('the compact Markdown field', () => {
  it('shows formatting, and edits as Markdown only where it changes', async () => {
    const api = fakeApi({ documents: { 'pages/about': about } });
    renderStudio('#/c/pages/e/about', { api });
    const user = userEvent.setup();
    // The editor loads on first use, then fills in; query afresh until it has.
    await waitFor(
      () => {
        const [first] = screen.getAllByRole('textbox', { name: 'Body (required)' });
        expect(first?.querySelector('em')).toHaveTextContent('practical');
      },
      { timeout: 5000 },
    );
    expect(screen.getAllByRole('toolbar', { name: 'Formatting for Body' }).length).toBeGreaterThan(
      0,
    );

    // Code shows as code, with the other formatting beside it.
    const developers = screen
      .getAllByRole('textbox', { name: 'Body (required)' })
      .find((field) => field.querySelector('code'));
    expect(developers?.querySelector('code')).toHaveTextContent('src/content.config.ts');
    expect(developers?.querySelector('strong')).toHaveTextContent('written');

    // Nothing is rewritten by opening the entry.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const saved = api.saveEntry.mock.calls[0]?.[0] as SaveRequest & { data: typeof about.data };
    expect(saved.data).toEqual(about.data);
    await expectNoViolations();
  });

  it('falls back to plain text for Markdown it can’t show in one line, and says so', async () => {
    renderStudio('#/c/pages/e/about', { api: fakeApi({ documents: { 'pages/about': about } }) });
    const fallback = await screen.findByText(
      'This uses Markdown the compact editor can’t show, so it’s edited as text.',
    );
    expect(fallback).toBeInTheDocument();
    expect(screen.getByDisplayValue(/# Not inline/)).toBeInTheDocument();
  });

  it('toggles code with its tool and with Ctrl+E, and saves it as backticks', async () => {
    const api = fakeApi({ documents: { 'pages/guide': guide } });
    renderStudio('#/c/pages/e/guide', { api });
    const user = userEvent.setup();
    const field = await waitFor(
      () => {
        const found = screen.getByRole('textbox', { name: 'Body (required)' });
        expect(found.querySelector('code')).toHaveTextContent('src/content.config.ts');
        return found;
      },
      { timeout: 5000 },
    );
    const editor = (field as unknown as { editor?: Editor }).editor;
    if (!editor) throw new Error('no editor');
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting for Body' });
    const code = within(toolbar).getByRole('button', { name: 'Code' });
    expect(code).toHaveAttribute('aria-keyshortcuts', 'Control+E');

    // The tool turns code on for the selection, and says so.
    select(editor, 'the studio');
    await user.click(code);
    await waitFor(() => {
      expect(code).toHaveAttribute('aria-pressed', 'true');
    });
    expect(field.querySelectorAll('code')).toHaveLength(2);

    // Ctrl+E, from the text, turns it off again.
    select(editor, 'src/content.config.ts');
    await user.keyboard('{Control>}e{/Control}');
    await waitFor(() => {
      expect(field.querySelectorAll('code')).toHaveLength(1);
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const saved = api.saveEntry.mock.calls[0]?.[0] as SaveRequest & { data: typeof guide.data };
    expect(saved.data).toEqual({
      title: 'Getting started',
      sections: [
        { heading: 'Where to start', body: 'Start with src/content.config.ts, then `the studio`.' },
      ],
    });
    await expectNoViolations();
  });

  it('shows code that holds a backtick, and keeps it as written', async () => {
    const backtick: EntryDocument = {
      ...guide,
      data: {
        title: 'Getting started',
        sections: [{ heading: 'Backticks', body: 'Write ``a`b`` for a backtick in code.' }],
      },
    };
    const api = fakeApi({ documents: { 'pages/guide': backtick } });
    renderStudio('#/c/pages/e/guide', { api });
    const user = userEvent.setup();
    await waitFor(
      () => {
        const field = screen.getByRole('textbox', { name: 'Body (required)' });
        expect(field.querySelector('code')).toHaveTextContent('a`b');
      },
      { timeout: 5000 },
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const saved = api.saveEntry.mock.calls[0]?.[0] as SaveRequest & {
      data: typeof backtick.data;
    };
    expect(saved.data).toEqual(backtick.data);
  });
});
