// @vitest-environment jsdom
import type { EntryDocument, EntrySummary } from '@vesper/core';
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

  it('shows a collection’s whole list beside the collections when no entry is open', async () => {
    open('#/c/blog');
    const main = await screen.findByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Blog posts' })).toBeInTheDocument();
    expect(await within(main).findByRole('grid', { name: 'Blog posts' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Blog posts' })).toBeNull();
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
});
