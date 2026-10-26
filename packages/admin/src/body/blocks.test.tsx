// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EntryDocument, FieldModel, SaveRequest } from '@vesper/core';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dragFrom, layOutLists, rowTop } from '../test/drag.ts';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';

/*
 * Markdoc tags and MDX components in the writing view (spec §6.5.1,
 * §6.5.2): named groups with settings, every action by keyboard, the "/"
 * list as a combobox, and a body the site couldn't build is never saved.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls to the selection.
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
});

const BODY = [
  '{% $product.name %} builds its editor from your content collections. {% .lead %}',
  '{% if $product.beta %}\nThis is a beta.\n{% else /%}\nThis release is stable.\n{% /if %}',
  'The {% abbr title="content management system" %}CMS{% /abbr %} appears.',
  '{% callout type="tip" title="Before you start" %}\nYou’ll need:\n\n- Astro 6 or 7\n{% /callout %}',
  '{% youtube id="VsprDemo001" title="A tour" /%}',
  '{% partial file="_support-hours.mdoc" /%}',
].join('\n\n');

const doc: EntryDocument = {
  collection: 'docs',
  id: 'getting-started',
  path: 'src/content/docs/getting-started.mdoc',
  version: 'v1',
  format: 'mdoc',
  status: 'editable',
  data: { title: 'Getting started', summary: 'Install it.' },
  body: `\n\n${BODY}\n`,
};

const PARTIALS = ['src/content/docs/_support-hours.mdoc', 'src/content/docs/getting-started.mdoc'];

function setup(entry: EntryDocument = doc) {
  const api = fakeApi({
    documents: { [`${entry.collection}/${entry.id}`]: entry },
    partials: PARTIALS,
  });
  renderStudio(`#/c/${entry.collection}/e/${entry.id}`, { api });
  return { api, user: userEvent.setup() };
}

async function editorOf(): Promise<Editor> {
  const body = await screen.findByRole('textbox', { name: 'Body' });
  const editor = (body as unknown as { editor?: Editor }).editor;
  if (!editor) throw new Error('no editor');
  return editor;
}

/** Position of the first node whose type starts with `type` and whose attributes match. */
function findNode(
  editor: Editor,
  type: string,
  match: (attrs: Record<string, unknown>) => boolean = () => true,
) {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name.startsWith(type) && match(node.attrs)) found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error(`no ${type}`);
  return found;
}

function selectNode(editor: Editor, pos: number) {
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    editor.view.focus();
  });
}

function cursorAt(editor: Editor, pos: number) {
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
    editor.view.focus();
  });
}

/** The body the last save sent, without the line breaks after the frontmatter. */
function savedBody(api: ReturnType<typeof setup>['api']): string {
  const request: SaveRequest | undefined = api.saveEntry.mock.calls.at(-1)?.[0];
  return (request?.body ?? '').replace(/^\n+/, '');
}

describe('Markdoc tags in the writing view', () => {
  it('shows tags as named groups with Settings buttons, chips by name, and passes axe', async () => {
    setup();
    await editorOf();
    expect(screen.getByRole('group', { name: 'Callout · Tip' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'YouTube video · A tour' })).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Partial · _support-hours.mdoc' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Conditional content · shown when $product.beta' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Otherwise' })).toBeInTheDocument();
    expect(screen.getByText('Abbreviation · CMS')).toBeInTheDocument();
    expect(screen.getByText('{% $product.name %}')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings for Callout' })).toBeInTheDocument();
    // Out of the Tab order: Enter on a selected block is the keyboard's way in.
    expect(screen.getByRole('button', { name: 'Settings for YouTube video' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
    await expectNoViolations();
  });

  it('marks nothing non-editable inside a chip, so ⌘← and ⌘→ can move past it', async () => {
    setup();
    await editorOf();
    // ProseMirror makes the chip's own element non-editable. A second
    // non-editable element inside looks to it like a widget to step over,
    // which stopped ⌘← and ⌘→ beside a chip at either end of a line
    // (DECISIONS.md); the e2e test presses the keys on a Mac.
    const chip = screen.getByText('Abbreviation · CMS').closest('.node-vesperInline');
    expect(chip).not.toBeNull();
    expect(chip?.querySelectorAll('[contenteditable]')).toHaveLength(0);
  });

  it('by keyboard: Escape selects the frame, Enter opens its settings, a change rewrites only the opening', async () => {
    const { api, user } = setup();
    const editor = await editorOf();
    const callout = findNode(editor, 'vesperTag', (a) => a.name === 'callout');
    cursorAt(editor, callout + 3);
    await user.keyboard('{Escape}');
    expect(
      await screen.findByText('Callout selected. Press Enter for its settings.'),
    ).toBeInTheDocument();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Callout settings' });
    // Focus starts on the chosen option, as Tab would put it.
    await waitFor(() => {
      expect(within(dialog).getByRole('radio', { name: 'Tip' })).toHaveFocus();
    });
    await user.keyboard('{ArrowLeft}');
    expect(within(dialog).getByRole('radio', { name: 'Warning' })).toBeChecked();
    await expectNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    expect(savedBody(api)).toBe(`${BODY.replace('type="tip"', 'type="warning"')}\n`);
  });

  /** A FAQ tag whose `items` attribute is a list of objects, from a schema hint, in the body. */
  function withFaq() {
    const manifest = structuredClone(playgroundManifest);
    const items: FieldModel = {
      path: ['items'],
      kind: 'array',
      label: 'Questions',
      required: true,
      inferredWidget: 'repeater',
      children: [
        {
          path: ['items', '[]'],
          kind: 'object',
          label: 'Item',
          required: true,
          inferredWidget: 'group',
          children: [
            {
              path: ['items', '[]', 'question'],
              kind: 'string',
              label: 'Question',
              required: true,
            },
            { path: ['items', '[]', 'answer'], kind: 'string', label: 'Answer', required: true },
          ],
        },
      ],
    };
    manifest.markdoc?.tags.push({
      name: 'faq',
      label: 'FAQ',
      selfClosing: true,
      attributes: [{ name: 'items', types: ['Array'], required: true }],
      fields: [items],
    });
    const faq = [
      '{% faq items=[',
      '  { question: "Open late?", answer: "Until ten." },',
      '  { question: "Parking?", answer: "Behind the library." }',
      '] /%}',
    ].join('\n');
    const api = fakeApi({
      documents: { 'docs/getting-started': { ...doc, body: `\n\n${faq}\n` } },
      partials: PARTIALS,
    });
    renderStudio('#/c/docs/e/getting-started', { api, manifest });
    return { api, faq };
  }

  it('edits a list attribute shaped by a schema hint as rows, and saves only the changed item’s line', async () => {
    const { api, faq } = withFaq();
    const user = userEvent.setup();
    const editor = await editorOf();
    // A self-closing tag is a card.
    selectNode(
      editor,
      findNode(editor, 'vesperCard', (a) => a.name === 'faq'),
    );
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'FAQ settings' });
    const parking = within(dialog).getByRole('button', { name: 'Parking?, Behind the library.' });
    await user.click(parking);
    const answer = within(within(dialog).getByRole('group', { name: 'Parking?' })).getByRole(
      'textbox',
      { name: 'Answer' },
    );
    await user.clear(answer);
    await user.type(answer, 'In the garage.');
    await expectNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    expect(savedBody(api)).toBe(
      `${faq.replace(
        '  { question: "Parking?", answer: "Behind the library." }',
        '  {question: "Parking?", answer: "In the garage."}',
      )}\n`,
    );
  });

  it('drags a list attribute’s row in the tag’s settings, and saves the items moved as written', async () => {
    layOutLists();
    const { api } = withFaq();
    const user = userEvent.setup();
    const editor = await editorOf();
    selectNode(
      editor,
      findNode(editor, 'vesperCard', (a) => a.name === 'faq'),
    );
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'FAQ settings' });
    const list = within(dialog).getByRole('list');
    const [open, parking] = list.querySelectorAll(':scope > li');
    const handle = parking?.querySelector('[draggable="true"]');
    if (!open || !handle) throw new Error('no rows');
    // Above the middle of the first row.
    const drag = await dragFrom(handle, open, rowTop(0) + 5);
    drag.drop();
    expect(within(dialog).getByText('Moved Parking? to position 1 of 2.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    // Each item keeps its own text; only the comma between them stays where it was.
    expect(savedBody(api)).toBe(
      `${[
        '{% faq items=[',
        '  { question: "Parking?", answer: "Behind the library." },',
        '  { question: "Open late?", answer: "Until ten." }',
        '] /%}',
      ].join('\n')}\n`,
    );
  });

  it('moves and removes a tag from its settings, by keyboard alone', async () => {
    const { api, user } = setup();
    const editor = await editorOf();
    selectNode(
      editor,
      findNode(editor, 'vesperCard', (a) => a.name === 'youtube'),
    );
    await user.keyboard('{Enter}');
    let dialog = await screen.findByRole('dialog', { name: 'YouTube video settings' });
    await user.click(within(dialog).getByRole('button', { name: 'Move up' }));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
    });
    const youtube = '{% youtube id="VsprDemo001" title="A tour" /%}';
    const callout = BODY.slice(BODY.indexOf('{% callout'), BODY.indexOf('{% /callout %}') + 14);
    expect(savedBody(api)).toBe(
      `${BODY.replace(`${callout}\n\n${youtube}`, `${youtube}\n\n${callout}`)}\n`,
    );

    // Alt+Down moves it back; then Remove takes it out.
    selectNode(
      editor,
      findNode(editor, 'vesperCard', (a) => a.name === 'youtube'),
    );
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    selectNode(
      editor,
      findNode(editor, 'vesperCard', (a) => a.name === 'youtube'),
    );
    await user.keyboard('{Enter}');
    dialog = await screen.findByRole('dialog', { name: 'YouTube video settings' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(2);
    });
    expect(savedBody(api)).toBe(`${BODY.replace(`${youtube}\n\n`, '')}\n`);
  });

  it('inserts a tag from the toolbar and opens its settings; a missing required attribute blocks saving', async () => {
    const { api, user } = setup();
    const editor = await editorOf();
    // An empty line at the end of the body.
    cursorAt(editor, editor.state.doc.content.size);
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph' });
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    await user.click(screen.getByRole('button', { name: /Insert/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'YouTube video' }));
    let dialog = await screen.findByRole('dialog', { name: 'YouTube video settings' });
    expect(within(dialog).getByText('Video ID is required.')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByRole('textbox', { name: /Video ID/ })).toHaveFocus();
    });
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    // The card says what's missing, inline.
    expect(
      within(screen.getByRole('group', { name: 'YouTube video' })).getByText(
        'YouTube video: Video ID is required.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('The entry wasn’t saved');
    expect(summary).toHaveTextContent('YouTube video: Video ID is required.');
    expect(summary).toHaveTextContent('YouTube video: Title is required.');
    expect(api.saveEntry).not.toHaveBeenCalled();

    selectNode(
      editor,
      findNode(editor, 'vesperCard', (a) => String(a.source).startsWith('{% youtube /%}')),
    );
    await user.keyboard('{Enter}');
    dialog = await screen.findByRole('dialog', { name: 'YouTube video settings' });
    await user.type(within(dialog).getByRole('textbox', { name: /Video ID/ }), 'abc');
    await user.type(within(dialog).getByRole('textbox', { name: /^Title/ }), 'T');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    expect(savedBody(api)).toBe(`${BODY}\n\n{% youtube id="abc" title="T" /%}\n`);
  });

  it('the "/" list is a combobox over the text, filtered to what fits there', async () => {
    const { user } = setup();
    const editor = await editorOf();
    const body = screen.getByRole('textbox', { name: 'Body' });
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph' });
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.focus();
    });
    const from = editor.state.selection.from;
    act(() => {
      editor.view.someProp('handleTextInput', (f) =>
        f(editor.view, from, from, '/', () => editor.state.tr.insertText('/', from, from)),
      );
    });
    const combobox = screen.getByRole('combobox', { name: 'Body' });
    expect(combobox).toBe(body);
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox', { name: 'Insert a block' });
    expect(combobox).toHaveAttribute('aria-controls', listbox.id);
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Abbreviation (in this line)', 'Callout', 'Partial', 'Table', 'YouTube video']);
    expect(combobox).toHaveAttribute(
      'aria-activedescendant',
      within(listbox).getAllByRole('option')[0]?.id,
    );
    await user.keyboard('{ArrowDown}');
    expect(combobox).toHaveAttribute(
      'aria-activedescendant',
      within(listbox).getAllByRole('option')[1]?.id,
    );
    await expectNoViolations();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Body' })).toBe(body);
  });

  it('inside a callout, offers only what the callout may hold', async () => {
    setup();
    const editor = await editorOf();
    const callout = findNode(editor, 'vesperTag', (a) => a.name === 'callout');
    cursorAt(editor, callout + 3);
    const from = editor.state.selection.from;
    act(() => {
      editor.commands.splitBlock();
      editor.view.someProp('handleTextInput', (f) =>
        f(editor.view, from + 2, from + 2, '/', () =>
          editor.state.tr.insertText('/', from + 2, from + 2),
        ),
      );
    });
    const listbox = screen.getByRole('listbox', { name: 'Insert a block' });
    // A callout holds paragraphs and lists: no block tags, only inline ones.
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Abbreviation (in this line)']);
  });

  it('edits a variable as raw text, and keeps every other byte', async () => {
    const { api, user } = setup();
    const editor = await editorOf();
    selectNode(
      editor,
      findNode(editor, 'vesperInline', (a) => a.source === '{% $product.name %}'),
    );
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Edit variable as text' });
    const field = within(dialog).getByRole('textbox', { name: 'Variable' });
    await user.clear(field);
    await user.type(field, '{{% $product.tier %}');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    expect(savedBody(api)).toBe(`${BODY.replace('$product.name', '$product.tier')}\n`);
  });
});

describe('MDX components', () => {
  const page: EntryDocument = {
    collection: 'pages',
    id: 'campus-life',
    path: 'src/content/pages/campus-life.mdx',
    version: 'v1',
    format: 'mdx',
    status: 'editable',
    data: { title: 'Campus life' },
    body: '\nimport Gallery from \'../../components/Gallery.astro\';\n\nBusy afternoons.\n\n<Callout type="tip" title="Visiting?">\n  Tours leave at 10 and 2.\n</Callout>\n\n<Gallery caption="A year" items={[\'a\']} />\n',
  };

  it('shows a declared component as a frame with props from its schema, and an undeclared one as protected', async () => {
    const { api, user } = setup(page);
    const editor = await editorOf();
    expect(screen.getByRole('group', { name: 'Callout · Tip' })).toBeInTheDocument();
    expect(screen.getByText(/^Component, kept as written/)).toBeInTheDocument();
    selectNode(
      editor,
      findNode(editor, 'vesperTag', (a) => a.name === 'Callout'),
    );
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Callout settings' });
    // Note is the schema's default: choosing it takes the prop out of the tag.
    await user.click(within(dialog).getByRole('radio', { name: 'Note' }));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    expect(savedBody(api)).toBe(
      (page.body ?? '')
        .replace(/^\n+/, '')
        .replace('<Callout type="tip" title="Visiting?">', '<Callout title="Visiting?">'),
    );
  });
});

describe('leaving the editor', () => {
  it('closing a block’s settings and leaving at once leaves nothing running', async () => {
    const { user } = setup();
    const editor = await editorOf();
    selectNode(
      editor,
      findNode(editor, 'vesperCard', (a) => a.name === 'youtube'),
    );
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'YouTube video settings' });
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    // Leave before the editor takes the block's selection back (it waits up
    // to 500 ms for focus). A late callback touching the destroyed editor
    // throws, and Vitest fails the run on that unhandled error.
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(editor.isDestroyed).toBe(true);
  });
});
