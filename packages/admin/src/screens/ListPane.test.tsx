// @vitest-environment jsdom
import type { EntryDocument, EntrySummary } from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIST_PANE, WIDE_EDITOR } from '../app/media.ts';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';

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

function wide(matches: string[]) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: matches.includes(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function open(id = 'harbor-at-dawn') {
  const api = fakeApi({
    entries: { blog: summaries },
    documents: {
      'blog/harbor-at-dawn': post('harbor-at-dawn', 'Harbor at dawn'),
      'blog/winter-market': post('winter-market', 'The winter market opens'),
    },
  });
  renderStudio(`#/c/blog/e/${id}`, { api });
  return { api, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the list beside the editor', () => {
  beforeEach(() => {
    wide([LIST_PANE, WIDE_EDITOR]);
  });

  it('lists the collection in a navigation landmark before the editor, with the open entry marked', async () => {
    open();
    const pane = await screen.findByRole('navigation', { name: 'Blog posts' });
    expect(
      await within(pane).findByRole('row', { name: /Harbor at dawn, open now/ }),
    ).toBeInTheDocument();
    expect(within(pane).getByText('Draft')).toBeInTheDocument();
    // Before <main>, which still starts with the screen's heading.
    const main = screen.getByRole('main');
    expect(pane.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main.firstElementChild?.tagName).toBe('H1');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-expanded', 'true');
    await expectNoViolations();
  });

  it('opens another entry with Enter, and moves focus to its heading', async () => {
    const { user } = open();
    const pane = await screen.findByRole('navigation', { name: 'Blog posts' });
    const winter = await within(pane).findByRole('row', { name: /The winter market opens/ });
    winter.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/blog/e/winter-market');
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    });
    // Its row now says it's the one open, after its status.
    expect(
      await within(screen.getByRole('navigation', { name: 'Blog posts' })).findByRole('row', {
        name: 'The winter market opens, Draft, open now',
      }),
    ).toBeInTheDocument();
  });

  it('keeps its search from one entry to the next', async () => {
    const { user } = open();
    const pane = await screen.findByRole('navigation', { name: 'Blog posts' });
    await user.type(within(pane).getByRole('searchbox', { name: 'Search' }), 'winter');
    expect(within(pane).queryByText(/^Harbor at dawn/)).toBeNull();
    await user.click(within(pane).getByRole('row', { name: /The winter market opens/ }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/blog/e/winter-market');
    });
    const again = await screen.findByRole('navigation', { name: 'Blog posts' });
    expect(within(again).getByRole('searchbox', { name: 'Search' })).toHaveValue('winter');
  });

  it('asks before leaving unsaved changes for another entry', async () => {
    const { user } = open();
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await user.type(title, '!');
    const pane = screen.getByRole('navigation', { name: 'Blog posts' });
    await user.click(await within(pane).findByRole('row', { name: /The winter market opens/ }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Leave without saving?' }),
    ).toBeInTheDocument();
  });

  it('hides with the List button, and stays hidden for this viewer', async () => {
    const { user } = open();
    await screen.findByRole('navigation', { name: 'Blog posts' });
    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.queryByRole('navigation', { name: 'Blog posts' })).toBeNull();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem('vesper:list-pane')).toBe('hidden');
    cleanup();
    open();
    await screen.findByRole('textbox', { name: 'Title' });
    expect(screen.queryByRole('navigation', { name: 'Blog posts' })).toBeNull();
  });

  it('shows the page outline for a tree collection, and nothing for a singleton', async () => {
    const api = fakeApi({
      trees: {
        pages: {
          collection: 'pages',
          nodes: [
            {
              path: 'about',
              slug: 'about',
              title: 'About the college',
              id: 'about',
              url: '/about/',
              depth: 0,
              children: [],
            },
          ],
        },
      },
      documents: {
        'pages/about': {
          collection: 'pages',
          id: 'about',
          path: 'src/content/pages/about.md',
          version: 'v1',
          format: 'md',
          status: 'editable',
          data: { title: 'About the college' },
          body: '\n',
        },
      },
    });
    renderStudio('#/c/pages/e/about', { api });
    const pane = await screen.findByRole('navigation', { name: 'Pages' });
    expect(
      await within(pane).findByRole('row', { name: /About the college, open now/ }),
    ).toBeInTheDocument();
    expect(within(pane).getByRole('treegrid', { name: 'Pages' })).toBeInTheDocument();

    cleanup();
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
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation', { name: 'Site settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'List' })).toBeNull();
  });
});

describe('on a narrower screen', () => {
  it('shows no list and no List button: the editor is the single column', async () => {
    wide([WIDE_EDITOR]);
    open();
    await screen.findByRole('textbox', { name: 'Title' });
    expect(screen.queryByRole('navigation', { name: 'Blog posts' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'List' })).toBeNull();
  });
});
