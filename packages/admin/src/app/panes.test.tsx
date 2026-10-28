// @vitest-environment jsdom
import type { EntryDocument, EntrySummary } from '@vespercms/core';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';
import { PANES } from './panes.tsx';

const post = (id: string, title: string): EntryDocument => ({
  collection: 'blog',
  id,
  path: `src/content/blog/${id}.md`,
  version: 'v1',
  format: 'md',
  status: 'editable',
  data: { title, summary: 'A post.', publishedAt: { $date: '2026-09-14T00:00:00.000Z' } },
  body: '\nText.\n',
});

const summaries: EntrySummary[] = [
  {
    id: 'harbor-at-dawn',
    path: 'src/content/blog/harbor-at-dawn.md',
    title: 'Harbor at dawn',
    status: 'editable',
    fields: {},
  },
  {
    id: 'winter-market',
    path: 'src/content/blog/winter-market.md',
    title: 'The winter market opens',
    status: 'editable',
    draft: true,
    fields: {},
  },
];

function media(wide: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: wide && query === PANES,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function windowWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true });
}

function open(hash = '#/c/blog/e/harbor-at-dawn') {
  const api = fakeApi({
    summary: [{ collection: 'blog', count: 2 }],
    entries: { blog: summaries },
    documents: {
      'blog/harbor-at-dawn': post('harbor-at-dawn', 'Harbor at dawn'),
      'blog/winter-market': post('winter-market', 'The winter market opens'),
    },
  });
  renderStudio(hash, { api });
  return { api, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.location.hash = '';
  vi.restoreAllMocks();
  windowWidth(1024);
});

describe('the studio as panes', () => {
  beforeEach(() => {
    media(true);
    windowWidth(1440);
  });

  it('shows the collections, the list and the entry side by side, as landmarks in that order', async () => {
    open();
    const structure = await screen.findByRole('navigation', { name: 'Content' });
    const list = screen.getByRole('navigation', { name: 'Blog posts' });
    const main = screen.getByRole('main');
    expect(within(structure).getByRole('link', { name: /Blog posts/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      await within(list).findByRole('row', { name: 'Harbor at dawn, open now' }),
    ).toBeVisible();
    expect(structure.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One h1: the entry's. The panes that lead to it have h2s.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      within(main).getByRole('heading', { level: 1, name: 'Harbor at dawn' }),
    ).toBeInTheDocument();
    // The list is beside the entry, so the bar has no way back to it.
    expect(within(main).queryByRole('link', { name: 'Blog posts' })).toBeNull();
    await expectNoViolations();
  });

  it('opens another entry with Enter on its row, moving focus to its heading', async () => {
    const { user } = open();
    const list = await screen.findByRole('navigation', { name: 'Blog posts' });
    (await within(list).findByRole('row', { name: /The winter market opens/ })).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/blog/e/winter-market');
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    });
    expect(
      await within(screen.getByRole('navigation', { name: 'Blog posts' })).findByRole('row', {
        name: 'The winter market opens, Draft, open now',
      }),
    ).toBeInTheDocument();
  });

  it('keeps the list pane, search and all, while entries change beside it', async () => {
    const { user } = open();
    const list = await screen.findByRole('navigation', { name: 'Blog posts' });
    const search = within(list).getByRole('searchbox', { name: 'Search' });
    await user.type(search, 'winter');
    await user.click(within(list).getByRole('row', { name: /The winter market opens/ }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/blog/e/winter-market');
    });
    expect(screen.getByRole('navigation', { name: 'Blog posts' })).toBe(list);
    expect(search).toHaveValue('winter');
  });

  it('asks before leaving unsaved changes for another entry', async () => {
    const { user } = open();
    await user.type(await screen.findByRole('textbox', { name: 'Title' }), '!');
    const list = screen.getByRole('navigation', { name: 'Blog posts' });
    await user.click(await within(list).findByRole('row', { name: /The winter market opens/ }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Leave without saving?' }),
    ).toBeInTheDocument();
  });

  it('shows a collection’s list as a pane, with its tools, when no entry is open', async () => {
    open('#/c/blog');
    const main = await screen.findByRole('main', { name: 'Blog posts' });
    expect(within(main).getByRole('heading', { level: 1, name: 'Blog posts' })).toBeInTheDocument();
    expect(await within(main).findByRole('treegrid', { name: 'Blog posts' })).toBeInTheDocument();
    expect(within(main).getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: /^Sort: / })).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Show: All entries' })).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: 'New entry' })).toHaveAttribute(
      'href',
      '#/c/blog/new',
    );
    // The deepest pane is never folded, so it has no collapse button.
    expect(within(main).queryByRole('button', { name: /^Collapse/ })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Content' })).toBeInTheDocument();
    await expectNoViolations();
  });

  it('sorts and filters the list pane from its menus', async () => {
    const { user } = open('#/c/blog');
    const main = await screen.findByRole('main', { name: 'Blog posts' });
    await within(main).findByRole('row', { name: /Harbor at dawn/ });
    const titles = () =>
      within(main)
        .getAllByRole('row')
        .map((row) => row.textContent);
    expect(titles()[0]).toMatch(/^Harbor at dawn/);

    await user.click(within(main).getByRole('button', { name: 'Show: All entries' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Drafts' }));
    await waitFor(() => {
      expect(titles()).toHaveLength(1);
    });
    expect(titles()[0]).toMatch(/^The winter market opens/);
    expect(within(main).getByRole('status')).toHaveTextContent('1 of 2 entries shown.');
  });

  it('collapses a pane into a strip on request, and keeps it collapsed', async () => {
    const { user } = open();
    const structure = await screen.findByRole('navigation', { name: 'Content' });
    // The entry is the deepest pane: it can't be collapsed.
    expect(
      within(screen.getByRole('main')).queryByRole('button', { name: /^Collapse/ }),
    ).toBeNull();
    await user.click(within(structure).getByRole('button', { name: 'Collapse Content' }));
    expect(screen.queryByRole('navigation', { name: 'Content' })).toBeNull();
    // The button went with the pane, so focus moves to the strip in its place.
    expect(screen.getByRole('button', { name: 'Show Content' })).toHaveFocus();
    expect(localStorage.getItem('vesper:collapsed-panes')).toBe('structure');

    // Collapsed panes stay collapsed from one entry to the next.
    window.location.hash = '#/c/blog/e/winter-market';
    await screen.findByRole('heading', { level: 1, name: 'The winter market opens' });
    expect(screen.queryByRole('navigation', { name: 'Content' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show Content' }));
    const reopened = await screen.findByRole('navigation', { name: 'Content' });
    expect(within(reopened).getByRole('button', { name: 'Collapse Content' })).toHaveFocus();
    expect(localStorage.getItem('vesper:collapsed-panes')).toBe('');
  });

  it('collapses the list beside an entry, and the strip brings it back', async () => {
    const { user } = open();
    const list = await screen.findByRole('navigation', { name: 'Blog posts' });
    await user.click(within(list).getByRole('button', { name: 'Collapse Blog posts' }));
    expect(screen.queryByRole('navigation', { name: 'Blog posts' })).toBeNull();
    // Collapsed, it isn't the list's whole page: the list route still shows it, as the deepest pane.
    window.location.hash = '#/c/blog';
    expect(await screen.findByRole('main', { name: 'Blog posts' })).toBeInTheDocument();
    window.location.hash = '#/c/blog/e/harbor-at-dawn';
    await screen.findByRole('heading', { level: 1, name: 'Harbor at dawn' });
    await user.click(screen.getByRole('button', { name: 'Show Blog posts' }));
    expect(await screen.findByRole('navigation', { name: 'Blog posts' })).toBeInTheDocument();
  });

  it('makes the collections the page when nothing is chosen, with nothing beside them', async () => {
    // Collapsed by choice elsewhere, but here it's the deepest pane, which never folds.
    localStorage.setItem('vesper:collapsed-panes', 'structure');
    const { user } = open('#/');
    const main = await screen.findByRole('main', { name: 'Content' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(main).getByRole('heading', { level: 1, name: 'Content' })).toBeInTheDocument();
    expect(within(main).getByRole('heading', { level: 2, name: 'Site' })).toBeInTheDocument();
    expect(within(main).queryByRole('button', { name: /^Collapse/ })).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    // Home isn't beside them repeating them: the rest of the row is empty.
    expect(screen.queryByRole('heading', { name: 'Collections' })).toBeNull();
    expect(document.querySelector('[data-filler]')).not.toBeNull();
    expect(document.title).toBe('Content · Playground');
    await expectNoViolations();

    // Going back to them from an entry, focus lands on their heading.
    await user.click(within(main).getByRole('link', { name: /Blog posts/ }));
    await user.click(
      await within(screen.getByRole('main')).findByRole('row', { name: /Harbor at dawn/ }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Harbor at dawn' });
    await user.click(screen.getByRole('link', { name: 'Playground' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Content' })).toHaveFocus();
    });
    expect(screen.getByRole('main', { name: 'Content' })).toBeInTheDocument();
  });

  it('opens a singleton beside the collections, with no list', async () => {
    renderStudio('#/c/settings/e/site', {
      api: fakeApi({
        documents: {
          'settings/site': {
            collection: 'settings',
            id: 'site',
            path: 'src/content/settings/site.yaml',
            version: 'v1',
            format: 'yaml',
            status: 'editable',
            data: { siteName: 'Highlands College' },
          },
        },
      }),
    });
    await screen.findByRole('main');
    expect(screen.getByRole('navigation', { name: 'Content' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Site settings' })).toBeNull();
  });

  it('folds the earlier panes into strips when they don’t fit, and opens one with a click', async () => {
    windowWidth(900);
    const { user } = open();
    await screen.findByRole('main');
    // The collections fold first; the list and the entry stay open.
    const strip = screen.getByRole('button', { name: 'Show Content' });
    expect(screen.queryByRole('navigation', { name: 'Content' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Blog posts' })).toBeInTheDocument();
    await user.click(strip);
    // Opened by hand, it stays open, and the list folds in its place.
    expect(await screen.findByRole('navigation', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Blog posts' })).toBeInTheDocument();
    act(() => {
      windowWidth(1440);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByRole('navigation', { name: 'Blog posts' })).toBeInTheDocument();
  });
});

describe('on a narrow screen', () => {
  it('shows one screen at a time, with the top bar’s menus', async () => {
    media(false);
    open();
    await screen.findByRole('textbox', { name: 'Title' });
    expect(screen.queryByRole('navigation', { name: 'Content' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Blog posts' })).toBeInTheDocument();
  });

  it('keeps Home, the one place there with the collections and their counts', async () => {
    media(false);
    open('#/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Content' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Collections' })).toBeInTheDocument();
    expect(await screen.findByText(/^2 entries/)).toBeInTheDocument();
  });
});

describe('a collection in a set order', () => {
  beforeEach(() => {
    media(true);
    windowWidth(1440);
  });

  const doc = (id: string, title: string, order?: number): EntrySummary => ({
    id,
    path: `src/content/docs/${id}.mdoc`,
    title,
    status: 'editable',
    fields: order === undefined ? {} : { order },
  });
  // The playground's docs: two share 3, and one has no number.
  const docs = [
    doc('guides/opening-hours', 'Opening hours', 3),
    doc('getting-started', 'Getting started', 1),
    doc('guides/conditional-content', 'Conditional content', 3),
    doc('unnumbered', 'A page with no number'),
    doc('guides/writing-callouts', 'Writing callouts', 2),
  ];

  function openDocs() {
    const api = fakeApi({ summary: [{ collection: 'docs', count: 5 }], entries: { docs } });
    renderStudio('#/c/docs', { api });
    return { api, user: userEvent.setup() };
  }
  const titles = (main: HTMLElement) =>
    within(main)
      .getAllByRole('row')
      .map((row) => row.textContent.split(/\d|·/)[0]?.trim());

  it('lists entries by their number, those without one last, and sorts by Order first', async () => {
    const { user } = openDocs();
    const main = await screen.findByRole('main', { name: 'Docs' });
    await within(main).findByRole('row', { name: /Getting started/ });
    expect(titles(main)).toEqual([
      'Getting started',
      'Writing callouts',
      'Conditional content',
      'Opening hours',
      'A page with no number',
    ]);
    await user.click(within(main).getByRole('button', { name: 'Sort: Order' }));
    const options = await screen.findAllByRole('menuitemradio');
    expect(options.map((o) => o.textContent)).toEqual(['Order', 'Title', 'Last edited']);
  });

  it('moves a row with Alt+arrow keys and its menu, and says where it went', async () => {
    const { api, user } = openDocs();
    vi.mocked(api.reorderEntry).mockResolvedValue({
      ok: true,
      position: { index: 3, of: 5 },
      changed: ['guides/opening-hours', 'guides/conditional-content'],
    });
    const main = await screen.findByRole('main', { name: 'Docs' });
    const row = await within(main).findByRole('row', { name: /^Opening hours/ });
    act(() => {
      row.focus();
    });
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(api.reorderEntry).toHaveBeenLastCalledWith({
      collection: 'docs',
      id: 'guides/opening-hours',
      after: 'guides/writing-callouts',
    });
    await waitFor(() => {
      expect(within(main).getByRole('status')).toHaveTextContent(
        'Opening hours moved up, position 3 of 5.',
      );
    });
    // The list reads the collection again once the numbers are written.
    await waitFor(() => {
      expect(api.listEntries.mock.calls.filter(([name]) => name === 'docs').length).toBe(2);
    });

    await user.click(
      within(main).getByRole('button', { name: 'More actions for Getting started' }),
    );
    expect(await screen.findByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(api.reorderEntry).toHaveBeenLastCalledWith({
      collection: 'docs',
      id: 'getting-started',
      after: 'guides/writing-callouts',
    });
    await expectNoViolations();
  });

  it('says why a move was refused', async () => {
    const { api, user } = openDocs();
    vi.mocked(api.reorderEntry).mockResolvedValue({
      ok: false,
      reason: 'error',
      message: '“Writing callouts” can’t be changed in the studio, so the order wasn’t changed.',
    });
    const main = await screen.findByRole('main', { name: 'Docs' });
    const row = await within(main).findByRole('row', { name: /^Writing callouts/ });
    act(() => {
      row.focus();
    });
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(await within(main).findByRole('alert')).toHaveTextContent(
      '“Writing callouts” can’t be changed in the studio, so the order wasn’t changed.',
    );
  });

  it('moves nothing while the list is searched or sorted another way', async () => {
    const { api, user } = openDocs();
    const main = await screen.findByRole('main', { name: 'Docs' });
    await within(main).findByRole('row', { name: /^Opening hours/ });
    await user.type(within(main).getByRole('searchbox', { name: 'Search' }), 'o');
    expect(within(main).queryByRole('button', { name: /^More actions/ })).toBeNull();
    const row = within(main).getByRole('row', { name: /^Opening hours/ });
    act(() => {
      row.focus();
    });
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(api.reorderEntry).not.toHaveBeenCalled();
  });
});

describe('an open entry its list rewrites', () => {
  beforeEach(() => {
    media(true);
    windowWidth(1440);
  });

  it('is read again when a move writes its number, so its next save starts from the file', async () => {
    const api = fakeApi({
      summary: [{ collection: 'docs', count: 2 }],
      entries: {
        docs: [
          {
            id: 'a',
            path: 'src/content/docs/a.mdoc',
            title: 'A',
            status: 'editable',
            fields: { order: 1 },
          },
          {
            id: 'b',
            path: 'src/content/docs/b.mdoc',
            title: 'B',
            status: 'editable',
            fields: { order: 2 },
          },
        ],
      },
      documents: {
        'docs/a': {
          collection: 'docs',
          id: 'a',
          path: 'src/content/docs/a.mdoc',
          version: 'v1',
          format: 'mdoc',
          status: 'editable',
          data: { title: 'A', summary: 'First.', order: 1 },
          body: '\nText.\n',
        },
      },
    });
    vi.mocked(api.reorderEntry).mockResolvedValue({
      ok: true,
      position: { index: 2, of: 2 },
      changed: ['a'],
    });
    renderStudio('#/c/docs/e/a', { api });
    const user = userEvent.setup();
    const list = await screen.findByRole('treegrid', { name: 'Docs' });
    await screen.findByRole('heading', { level: 1, name: 'A' });
    const row = within(list).getByRole('row', { name: /^A/ });
    act(() => {
      row.focus();
    });
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => {
      expect(api.readEntry.mock.calls.filter(([, id]) => id === 'a')).toHaveLength(2);
    });
  });
});
