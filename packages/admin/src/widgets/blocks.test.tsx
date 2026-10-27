// @vitest-environment jsdom
import type { EntryDocument, FieldModel, Manifest, SaveRequest } from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dragFrom, layOutLists, rowTop } from '../test/drag.ts';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';
import { changeKind, kindRow } from './union.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

const page = (blocks: object[]): EntryDocument => ({
  collection: 'pages',
  id: 'admissions/tuition',
  path: 'src/content/pages/admissions/tuition.md',
  version: 'v1',
  format: 'md',
  status: 'editable',
  data: { title: 'Tuition and fees', blocks },
  body: '\n',
});

const tuition = [
  { type: 'text', heading: 'Paying in parts', body: 'Four payments, no interest.' },
  {
    type: 'faq',
    heading: 'Questions about cost',
    items: [{ question: 'Are books included?', answer: 'No.' }],
  },
];

function open(blocks: object[], manifest?: Manifest) {
  const api = fakeApi({ documents: { 'pages/admissions/tuition': page(blocks) } });
  const user = userEvent.setup();
  renderStudio('#/c/pages/e/admissions%2Ftuition', { api, ...(manifest ? { manifest } : {}) });
  return { api, user };
}

async function saved(
  user: ReturnType<typeof userEvent.setup>,
  api: ReturnType<typeof fakeApi>,
): Promise<unknown> {
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(api.saveEntry).toHaveBeenCalled();
  });
  const request = api.saveEntry.mock.calls.at(-1)?.[0] as SaveRequest & {
    data: { blocks?: unknown };
  };
  return request.data.blocks;
}

/** The pages collection's `blocks` list, from the playground's manifest. */
function blocksField(manifest: Manifest = playgroundManifest): FieldModel {
  const field = manifest.collections
    .find((c) => c.name === 'pages')
    ?.fields?.find((f) => f.path[0] === 'blocks');
  if (!field) throw new Error('no blocks');
  return field;
}

describe('a list of kinds', () => {
  it('names each row by its kind, then its own words, and opens to that kind’s fields', async () => {
    const { user } = open(tuition);
    const text = await screen.findByRole('button', { name: 'Text, Paying in parts' });
    expect(screen.getByRole('button', { name: 'FAQ, Questions about cost' })).toBeInTheDocument();
    await user.click(text);
    const group = screen.getByRole('group', { name: 'Text' });
    expect(within(group).getByRole('textbox', { name: 'Heading (optional)' })).toHaveValue(
      'Paying in parts',
    );
    // The kind isn't a field: it's the row's name, and "Change to" changes it.
    expect(within(group).queryByRole('textbox', { name: 'Type' })).toBeNull();
    await expectNoViolations();
  });

  it('adds a kind chosen from Add’s menu, at the end, opened and announced', async () => {
    const { api, user } = open(tuition);
    await user.click(await screen.findByRole('button', { name: 'Add block' }));
    const faq = await screen.findByRole('menuitem', { name: 'FAQ' });
    expect(faq).toHaveAccessibleDescription('Questions and answers.');
    await user.click(faq);
    expect(screen.getByText('Added FAQ, block 3 of 3.')).toBeInTheDocument();
    const rows = screen.getAllByRole('button', { name: /^FAQ/ });
    expect(rows.at(-1)).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => {
      expect(screen.getAllByRole('textbox', { name: 'Heading' }).at(-1)).toHaveFocus();
    });
    await user.keyboard('Paying for books');
    expect(await saved(user, api)).toEqual([
      ...tuition,
      { type: 'faq', heading: 'Paying for books' },
    ]);
  });

  it('adds a kind below a row from its menu', async () => {
    const { api, user } = open(tuition);
    const text = await screen.findByRole('button', { name: /^Text, / });
    text.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Add below' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Text' }));
    expect(screen.getByText('Added Text, block 2 of 3.')).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Text, Paying in parts', 'Text', 'FAQ, Questions about cost']);
    expect(await saved(user, api)).toEqual([tuition[0], { type: 'text' }, tuition[1]]);
  });

  it('drags a block by its handle, as any row', async () => {
    layOutLists();
    const { api, user } = open(tuition);
    const text = await screen.findByRole('button', { name: /^Text, / });
    const list = text.closest('ol');
    const handle = list?.querySelector(':scope > li [draggable="true"]');
    const faq = list?.querySelectorAll(':scope > li')[1];
    if (!handle || !faq) throw new Error('no rows');
    // Below the middle of the FAQ: the text block goes under it.
    const drag = await dragFrom(handle, faq, rowTop(1) + 30);
    drag.drop();
    expect(screen.getByText('Moved Text to position 2 of 2.')).toBeInTheDocument();
    expect(await saved(user, api)).toEqual([tuition[1], tuition[0]]);
  });

  it('changes a kind, asking first when content would go, and brings it back on changing back', async () => {
    const { api, user } = open(tuition);
    const faq = await screen.findByRole('button', { name: /^FAQ/ });
    faq.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Change to' }));
    // Only the other kinds are offered.
    expect(screen.queryByRole('menuitem', { name: 'FAQ' })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: 'Text' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Change FAQ to Text?' });
    expect(dialog).toHaveTextContent('Items has no place in Text, so it is removed.');
    await expectNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Change to Text' }));
    expect(screen.getByText('Changed to Text. Heading kept. Items removed.')).toBeInTheDocument();
    const changed = await screen.findByRole('button', { name: 'Text, Questions about cost' });
    await waitFor(() => {
      expect(changed).toHaveFocus();
    });

    // Back to FAQ: nothing is lost, so nothing is asked, and the items come back.
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Change to' }));
    await user.click(await screen.findByRole('menuitem', { name: 'FAQ' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await saved(user, api)).toEqual(tuition);
  });

  it('leaves a kind as it was when the change is cancelled', async () => {
    const { api, user } = open(tuition);
    const faq = await screen.findByRole('button', { name: /^FAQ/ });
    faq.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Change to' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Figure' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(faq).toHaveFocus();
    });
    await user.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    expect(await saved(user, api)).toEqual(tuition);
  });

  it('shows a kind the schema doesn’t list as YAML, and offers every kind to change it to', async () => {
    const { user } = open([{ type: 'hero', heading: 'Old' }]);
    const row = await screen.findByRole('button', { name: 'Unknown kind: hero' });
    await user.click(row);
    expect(screen.getByRole('textbox', { name: 'Unknown kind: hero' })).toHaveValue(
      'type: hero\nheading: Old',
    );
    row.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Change to' }));
    for (const name of ['Text', 'FAQ', 'Figure']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
    await expectNoViolations();
  });

  it('stops adding at the list’s most, and says so', async () => {
    const manifest = structuredClone(playgroundManifest);
    blocksField(manifest).constraints = { max: 2 };
    open(tuition, manifest);
    expect(await screen.findByRole('button', { name: 'Add block' })).toBeDisabled();
    expect(screen.getByText('At most 2 blocks.')).toBeInTheDocument();
  });
});

describe('a single field of kinds', () => {
  const event: EntryDocument = {
    collection: 'events',
    id: 'open-day',
    path: 'src/content/events/open-day.md',
    version: 'v1',
    format: 'md',
    status: 'editable',
    data: { title: 'Open day', summary: 'Come and see.', startsAt: '2026-11-07T10:00:00-05:00' },
    body: '\n',
  };

  it('starts with a choice of kind, then shows the chosen kind’s fields', async () => {
    const api = fakeApi({ documents: { 'events/open-day': event } });
    const user = userEvent.setup();
    renderStudio('#/c/events/e/open-day', { api });
    const group = await screen.findByRole('group', { name: 'Ticket (optional)' });
    const kind = within(group).getByRole('radiogroup', { name: 'Kind' });
    expect(within(kind).getByRole('radio', { name: 'None' })).toBeChecked();
    await user.click(within(kind).getByRole('radio', { name: 'Paid' }));
    expect(within(group).getByText('Bought ahead, at the address below.')).toBeInTheDocument();
    await user.type(within(group).getByRole('spinbutton', { name: 'Price' }), '12');
    await expectNoViolations();
    await user.click(within(kind).getByRole('radio', { name: 'Free' }));
    expect(within(group).queryByRole('spinbutton', { name: 'Price' })).toBeNull();
    // Back to Paid before saving: the price comes back.
    await user.click(within(kind).getByRole('radio', { name: 'Paid' }));
    expect(within(group).getByRole('spinbutton', { name: 'Price' })).toHaveValue(12);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const request = api.saveEntry.mock.calls.at(-1)?.[0] as SaveRequest & {
      data: { ticket?: unknown };
    };
    expect(request.data.ticket).toEqual({ kind: 'paid', price: 12 });
  });
});

describe('changing kinds', () => {
  const item = blocksField().children?.[0] as FieldModel;
  const [text, faq, figure] = item.variants ?? [];
  if (!text || !faq || !figure) throw new Error('expected three kinds');

  it('keeps fields both kinds have under the same key and kind, and names what goes', () => {
    expect(changeKind(item, tuition[1] ?? null, text)).toEqual({
      value: { type: 'text', heading: 'Questions about cost' },
      kept: ['Heading'],
      dropped: ['Items'],
    });
    // Nothing typed is nothing lost.
    expect(changeKind(item, { type: 'faq', heading: '', items: [] }, figure).dropped).toEqual([]);
  });

  it('brings back what a value held as that kind before', () => {
    const before = { type: 'faq', heading: 'Old', items: [{ question: 'Q', answer: 'A' }] };
    expect(changeKind(item, { type: 'text', heading: 'New' }, faq, before).value).toEqual({
      type: 'faq',
      heading: 'New',
      items: [{ question: 'Q', answer: 'A' }],
    });
  });

  it('names a row by its kind, its words, or how many it holds', () => {
    expect(kindRow({ type: 'faq', heading: '*Cost*' }, item)).toEqual({
      name: 'FAQ',
      detail: 'Cost',
    });
    expect(kindRow({ type: 'faq', items: [{}, {}] }, item)).toEqual({
      name: 'FAQ',
      detail: '2 items',
    });
    expect(kindRow({ type: 'video' }, item).name).toBe('Unknown kind: video');
    expect(kindRow({}, item).name).toBe('No kind');
  });
});
