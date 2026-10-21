// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import type { EntryDocument, Manifest, SaveRequest } from '@vesper/core';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';

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

const FALLBACK = 'This uses Markdown the compact editor can’t show, so it’s edited as text.';

/** `about`, with one section per body. */
function withBodies(bodies: string[]): EntryDocument {
  return {
    ...about,
    data: {
      title: 'About the college',
      sections: bodies.map((body, i) => ({ heading: `Section ${String(i + 1)}`, body })),
    },
  };
}

/** The playground's manifest, with the sections' Body a multi-line Markdown field. */
function multiLine(): Manifest {
  const manifest = structuredClone(playgroundManifest);
  const sections = manifest.collections
    .find((c) => c.name === 'pages')
    ?.fields?.find((f) => f.path[0] === 'sections');
  const body = sections?.children?.[0]?.children?.find((f) => f.path.at(-1) === 'body');
  if (!body) throw new Error('no section body');
  body.widgetOptions = {};
  return manifest;
}

/** Every section's Body, once each has opened as plain text (`TEXTAREA`) or in the editor (`DIV`). */
async function bodies(count: number, tag: 'TEXTAREA' | 'DIV'): Promise<HTMLElement[]> {
  return waitFor(
    () => {
      const fields = screen.getAllByRole('textbox', { name: 'Body (required)' });
      expect(fields.map((field) => field.tagName)).toEqual(Array<string>(count).fill(tag));
      // The editor is empty until it has checked the value and filled in.
      if (tag === 'DIV') expect(fields.every((field) => field.textContent !== '')).toBe(true);
      return fields;
    },
    { timeout: 5000 },
  );
}

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

  it('falls back to plain text for Markdown the editor would drop, and saves it as written', async () => {
    // Each of these once opened in the editor without what it couldn't show
    // (or, for the rule and the lists, empty), and the first edit saved that.
    const lossy = [
      'Was ~~$40~~ now $30.',
      'Look ![a map](/map.png) here.',
      '> A quote',
      '***',
      '| Day | Open |\n| --- | --- |\n| Monday | 9–5 |',
      '- One item',
      '1. One item',
      'See [the guide][guide].\n\n[guide]: /docs/',
      'Open daily.[^1]',
      '5&nbsp;km from campus',
      'Some <b>bold</b> words',
      // Code ending in a space would be written back as code, then a space.
      '`a `',
    ];
    const entry = withBodies(lossy);
    const api = fakeApi({ documents: { 'pages/about': entry } });
    renderStudio('#/c/pages/e/about', { api });
    const user = userEvent.setup();
    const fields = await bodies(lossy.length, 'TEXTAREA');
    expect(fields.map((field) => (field as HTMLTextAreaElement).value)).toEqual(lossy);
    expect(screen.getAllByText(FALLBACK)).toHaveLength(lossy.length);

    await user.type(screen.getByDisplayValue('Was ~~$40~~ now $30.'), ' Edited.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const saved = api.saveEntry.mock.calls[0]?.[0] as SaveRequest & { data: typeof entry.data };
    expect(saved.data).toEqual(
      withBodies(['Was ~~$40~~ now $30. Edited.', ...lossy.slice(1)]).data,
    );
    await expectNoViolations();
  });

  it('falls back for blocks a multi-line field would drop, and still opens lists', async () => {
    const lossy = [
      '> A quote',
      'Before\n\n***\n\nAfter',
      '| Day | Open |\n| --- | --- |\n| Monday | 9–5 |',
      '```\nnpm test\n```',
      '- [ ] To do\n- [x] Done',
      'See [the guide][guide].\n\n[guide]: /docs/',
      'Open daily.[^1]\n\n[^1]: Except holidays.',
      '## A heading',
    ];
    const entry = withBodies([...lossy, '- One\n- Two']);
    const api = fakeApi({ documents: { 'pages/about': entry } });
    renderStudio('#/c/pages/e/about', { api, manifest: multiLine() });
    const user = userEvent.setup();
    await waitFor(
      () => {
        const fields = screen.getAllByRole('textbox', { name: 'Body (required)' });
        expect(
          fields.map((field) =>
            field instanceof HTMLTextAreaElement
              ? field.value
              : field.querySelector('ul')?.textContent,
          ),
        ).toEqual([...lossy, 'OneTwo']);
      },
      { timeout: 5000 },
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const saved = api.saveEntry.mock.calls[0]?.[0] as SaveRequest & { data: typeof entry.data };
    expect(saved.data).toEqual(entry.data);
  });

  it('opens the Markdown it holds in the editor, and keeps it as written', async () => {
    const held = [
      '**Bold**, *italic* and _italic_ too.',
      'Run `npm test`, and put `<Search>` on a page.',
      'Write `` a`b `` for a backtick.',
      '[The guide](/docs/ "Docs") and <https://vespercms.com>.',
      'One line\\\nand the next.',
      'Escaped \\*stars\\*, \\[^1] and \\&nbsp; stay text.',
      'AT&amp;T, &lt;3 and &#169; 2026.',
    ];
    const entry = withBodies(held);
    const api = fakeApi({ documents: { 'pages/about': entry } });
    renderStudio('#/c/pages/e/about', { api });
    const user = userEvent.setup();
    const fields = await bodies(held.length, 'DIV');
    expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument();
    // A code span holding `<` is code, not HTML.
    expect(fields[1]?.querySelectorAll('code')[1]).toHaveTextContent('<Search>');
    expect(fields[3]?.querySelectorAll('a')).toHaveLength(2);
    expect(fields[4]?.querySelector('br')).toBeInTheDocument();
    expect(fields[6]).toHaveTextContent('AT&T, <3 and © 2026.');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const saved = api.saveEntry.mock.calls[0]?.[0] as SaveRequest & { data: typeof entry.data };
    expect(saved.data).toEqual(entry.data);
    await expectNoViolations();
  });
});
