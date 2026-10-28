// @vitest-environment jsdom
import type { EntryDocument, FieldModel, Manifest, SaveRequest } from '@vespercms/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dragFrom, layOutLists, rowTop } from '../test/drag.ts';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';
import { itemNames, itemSummary } from './group.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const page = (sections: unknown[]): EntryDocument => ({
  collection: 'pages',
  id: 'campus-life',
  path: 'src/content/pages/campus-life.mdx',
  version: 'v1',
  format: 'mdx',
  status: 'editable',
  data: { title: 'Campus life', sections },
  body: '\n',
});

const clubsItem = { heading: 'Clubs', body: 'Over **forty** of them.' };
const sportsItem = { heading: 'Sports', body: 'Teams for every season.' };
const artsItem = { heading: 'Arts', body: 'Studios open late.' };
const three = [clubsItem, sportsItem, artsItem];

function open(sections: unknown[], manifest?: Manifest) {
  const api = fakeApi({ documents: { 'pages/campus-life': page(sections) } });
  renderStudio('#/c/pages/e/campus-life', { api, ...(manifest ? { manifest } : {}) });
  return { api };
}

describe('list items as rows', () => {
  it('names a row by its content, with the next text after it, and keeps its fields hidden until opened', async () => {
    open(three);
    const user = userEvent.setup();
    const clubs = await screen.findByRole('button', { name: 'Clubs, Over forty of them.' });
    expect(clubs).toHaveAttribute('aria-expanded', 'false');
    // Closed, the item's fields stay in the page, hidden, so find and Go to field can reach them.
    const panel = document.getElementById(clubs.getAttribute('aria-controls') ?? '');
    expect(panel).toHaveAttribute('hidden');
    expect(panel?.querySelector('input')).toHaveValue('Clubs');
    await user.click(clubs);
    expect(clubs).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'Clubs' });
    expect(within(group).getByRole('textbox', { name: 'Heading' })).toHaveValue('Clubs');
    await expectNoViolations();
  });

  it('opens and closes them all at once, from three items', async () => {
    open(three);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Open all' }));
    for (const name of ['Clubs', 'Sports', 'Arts']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }
    await user.click(screen.getByRole('button', { name: 'Close all' }));
    expect(screen.getByRole('button', { name: /^Arts/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows no Open all for one or two items', async () => {
    open(three.slice(0, 2));
    await screen.findByRole('button', { name: /^Clubs/ });
    expect(screen.queryByRole('button', { name: 'Open all' })).toBeNull();
  });

  it('saves with Ctrl+S while a row has focus, after Alt+↓ moved it', async () => {
    const { api } = open(three);
    const user = userEvent.setup();
    const clubs = await screen.findByRole('button', { name: /^Clubs/ });
    clubs.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => {
      expect(clubs).toHaveFocus();
    });
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
  });

  it('opens a row’s menu with Shift+F10, and duplicates an item after itself', async () => {
    open(three);
    const user = userEvent.setup();
    const sports = await screen.findByRole('button', { name: /^Sports/ });
    sports.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const duplicate = await screen.findByRole('menuitem', { name: 'Duplicate' });
    await user.click(duplicate);
    expect(screen.getByText('Duplicated Sports as section 3.')).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual([
      'Clubs, Over forty of them.',
      'Sports, Teams for every season.',
      'Sports, Teams for every season.',
      'Arts, Studios open late.',
    ]);
  });

  it('opens the item around a field the error summary goes to', async () => {
    const api = fakeApi({ documents: { 'pages/campus-life': page(three) } });
    api.saveEntry.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid',
      issues: [{ path: ['sections', 2, 'heading'], message: 'Add a heading.' }],
    });
    renderStudio('#/c/pages/e/campus-life', { api });
    const user = userEvent.setup();
    const arts = await screen.findByRole('button', { name: /^Arts/ });
    await user.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    // The refused save opens it; close it again, then go to the field from the summary.
    await waitFor(() => {
      expect(arts).toHaveAttribute('aria-expanded', 'true');
    });
    await user.click(arts);
    expect(arts).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('link', { name: /Add a heading/ }));
    await waitFor(() => {
      expect(arts).toHaveAttribute('aria-expanded', 'true');
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole('group', { name: 'Arts' })).getByRole('textbox', {
          name: 'Heading',
        }),
      ).toHaveFocus();
    });
  });

  it('names rows by the summary hint when the guess would pick the wrong field', async () => {
    const manifest = structuredClone(playgroundManifest);
    const sections = manifest.collections
      .find((c) => c.name === 'pages')
      ?.fields?.find((f) => f.path[0] === 'sections');
    if (!sections) throw new Error('no sections');
    sections.summary = 'body';
    open(three, manifest);
    expect(
      await screen.findByRole('button', { name: /^Over forty of them\./ }),
    ).toBeInTheDocument();
  });
});

describe('dragging a row by its handle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The pages collection's manifest, with `sections` changed by `change`. */
  function withSections(change: (sections: FieldModel) => void): Manifest {
    const manifest = structuredClone(playgroundManifest);
    const sections = manifest.collections
      .find((c) => c.name === 'pages')
      ?.fields?.find((f) => f.path[0] === 'sections');
    if (!sections) throw new Error('no sections');
    change(sections);
    return manifest;
  }
  const headings = () =>
    screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
  /** The handles of a list's own rows, or every handle on the page. */
  const handles = (list?: Element) => [
    ...(list ?? document).querySelectorAll(
      list ? ':scope > li > div > div > [draggable="true"]' : '[draggable="true"]',
    ),
  ];
  const rowsOf = (list: Element) => [...list.querySelectorAll(':scope > li')];
  const line = (list: Element) =>
    list.parentElement?.querySelector(':scope > [aria-hidden="true"]');

  it('moves a row to where its line shows, as the menu would, and saves the new order', async () => {
    layOutLists();
    const { api } = open(three);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: /^Clubs/ });
    const list = screen.getAllByRole('list')[0];
    if (!list) throw new Error('no list');
    // Below the middle of Arts, the last row: the line goes under it.
    const arts = rowsOf(list)[2];
    const clubs = handles(list)[0];
    if (!arts || !clubs) throw new Error('no rows');
    const drag = await dragFrom(clubs, arts, rowTop(2) + 30);
    expect(line(list)).not.toBeNull();
    expect(arts.firstElementChild).not.toHaveClass('opacity-50');
    expect(rowsOf(list)[0]?.firstElementChild).toHaveClass('opacity-50');
    drag.drop();

    expect(headings()).toEqual([
      'Sports, Teams for every season.',
      'Arts, Studios open late.',
      'Clubs, Over forty of them.',
    ]);
    expect(line(list)).toBeNull();
    expect(screen.getByText('Moved Clubs to position 3 of 3.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Clubs/ })).toHaveFocus();
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const request = api.saveEntry.mock.calls[0]?.[0] as SaveRequest;
    expect(request.data).toEqual({
      title: 'Campus life',
      sections: [sportsItem, artsItem, clubsItem],
    });
  });

  it('shows no line and moves nothing beside the row being dragged', async () => {
    layOutLists();
    open(three);
    await screen.findByRole('button', { name: /^Clubs/ });
    const list = screen.getAllByRole('list')[0];
    const sports = list && handles(list)[1];
    const sportsRow = list && rowsOf(list)[1];
    if (!list || !sports || !sportsRow) throw new Error('no rows');
    // Over its own top half, and then just under Clubs: both are where it is now.
    for (const y of [rowTop(1) + 5, rowTop(0) + 30]) {
      const drag = await dragFrom(sports, sportsRow, y);
      expect(line(list)).toBeNull();
      drag.drop();
    }
    expect(headings()[1]).toBe('Sports, Teams for every season.');
    expect(screen.queryByText(/^Moved/)).toBeNull();
  });

  it('keeps the handle for the pointer: out of the Tab order and hidden from screen readers', async () => {
    open(three);
    const user = userEvent.setup();
    const clubs = await screen.findByRole('button', { name: /^Clubs/ });
    const all = handles();
    expect(all).toHaveLength(3);
    for (const handle of all) {
      expect(handle).toHaveAttribute('aria-hidden', 'true');
      expect(handle).not.toHaveAttribute('tabindex');
    }
    // The handle sits before the row's name, and Tab passes it by.
    clubs.focus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Open all' })).toHaveFocus();
    await user.tab();
    expect(clubs).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Actions for Clubs' })).toHaveFocus();
    await expectNoViolations();
  });

  it('lets a drag through the lists inside an open row, and keeps their rows in their own list', async () => {
    layOutLists();
    const manifest = withSections((sections) => {
      const item = sections.children?.[0];
      if (!item) throw new Error('no item');
      const links: FieldModel = {
        path: ['sections', '[]', 'links'],
        kind: 'array',
        label: 'Links',
        required: false,
        inferredWidget: 'repeater',
        children: [
          {
            path: ['sections', '[]', 'links', '[]'],
            kind: 'object',
            label: 'Item',
            required: true,
            inferredWidget: 'group',
            children: [
              {
                path: ['sections', '[]', 'links', '[]', 'text'],
                kind: 'string',
                label: 'Text',
                required: true,
              },
            ],
          },
        ],
      };
      item.children = [...(item.children ?? []), links];
    });
    const nested = [
      { ...clubsItem, links: [{ text: 'Chess' }, { text: 'Rowing' }] },
      sportsItem,
      artsItem,
    ];
    const { api } = open(nested, manifest);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Clubs/ }));
    const [outer, inner] = screen.getAllByRole('list');
    if (!outer || !inner) throw new Error('no lists');

    // Sports, dragged over Clubs' own links, lands in the outer list, above Clubs.
    const sports = handles(outer)[1];
    const chess = rowsOf(inner)[0];
    if (!sports || !chess) throw new Error('no rows');
    let drag = await dragFrom(sports, chess, rowTop(0) + 5);
    expect(line(outer)).not.toBeNull();
    expect(line(inner)).toBeNull();
    drag.drop();
    expect(headings()[0]).toMatch(/^Sports/);

    // Rowing, dragged over the outer list's rows, isn't taken there.
    const rowing = handles(inner)[1];
    const arts = rowsOf(outer)[2];
    if (!rowing || !arts) throw new Error('no rows');
    drag = await dragFrom(rowing, arts, rowTop(2) + 30);
    expect(line(outer)).toBeNull();
    drag.cancel();
    // Over Chess, it moves above it, within Clubs' links.
    drag = await dragFrom(rowing, chess, rowTop(0) + 5);
    expect(line(inner)).not.toBeNull();
    drag.drop();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const request = api.saveEntry.mock.calls[0]?.[0] as SaveRequest;
    expect(request.data).toEqual({
      title: 'Campus life',
      sections: [
        sportsItem,
        { ...clubsItem, links: [{ text: 'Rowing' }, { text: 'Chess' }] },
        artsItem,
      ],
    });
  });

  it('gives a list of images handles too, and a list that can’t change none', async () => {
    const images = withSections((sections) => {
      sections.children = [
        {
          path: ['sections', '[]'],
          kind: 'image',
          label: 'Item',
          required: true,
          inferredWidget: 'image',
          widget: 'image',
        },
      ];
    });
    open(['./quad.jpg', './library.jpg'], images);
    await screen.findByRole('button', { name: /^\.\/quad\.jpg/ });
    expect(handles()).toHaveLength(2);
    cleanup();

    const readOnly = withSections((sections) => {
      sections.readOnly = true;
    });
    open(three, readOnly);
    await screen.findByRole('button', { name: /^Clubs/ });
    expect(handles()).toHaveLength(0);
  });
});

describe('item names', () => {
  it('come from the list’s label, its item’s own label, or a numbered fallback', () => {
    const list = (label: string, itemLabel = 'Item') => ({
      path: ['x'],
      kind: 'array' as const,
      label,
      required: false,
      children: [{ path: ['x', '[]'], kind: 'object' as const, label: itemLabel, required: true }],
    });
    expect(itemNames(list('Points'))).toEqual({ one: 'point', many: 'points' });
    expect(itemNames(list('Opening hours'))).toEqual({
      one: 'opening hour',
      many: 'opening hours',
    });
    expect(itemNames(list('Address'))).toEqual({ one: 'address', many: 'address' });
    expect(itemNames(list('Team', 'Person'))).toEqual({ one: 'person', many: 'team' });
    expect(itemSummary({}, 2, list('Points')).name).toBe('Point 3');
    expect(itemSummary({ title: '  `Code` and _more_ ' }, 0, list('Points')).name).toBe(
      'Code and more',
    );
  });
});
