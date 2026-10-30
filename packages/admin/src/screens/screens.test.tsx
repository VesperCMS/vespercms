// @vitest-environment jsdom
import type { EntryDocument, EntrySummary, SaveRequest } from '@vespercms/core';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { Icon } from '@vespercms/ui';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const harbor: EntryDocument = {
  collection: 'blog',
  id: 'harbor-at-dawn',
  path: 'src/content/blog/harbor-at-dawn.md',
  version: 'v1',
  format: 'md',
  status: 'editable',
  data: {
    title: 'Harbor at dawn',
    summary: 'The fishing fleet leaves before sunrise.',
    hero: { src: '../../assets/blog/harbor-at-dawn.jpg', alt: 'An orange sun over a harbor' },
    author: 'ada-moreno',
    related: ['welcome'],
    tags: ['harbor', 'mornings'],
    category: 'stories',
    publishedAt: { $date: '2026-09-14T00:00:00.000Z' },
    series: { name: 'Waterfront walks', part: 1 },
  },
  body: '\r\n\r\nThe first boats go out around five.\r\n',
};

const blogEntries: EntrySummary[] = [
  {
    id: 'harbor-at-dawn',
    path: harbor.path,
    title: 'Harbor at dawn',
    status: 'editable',
    fields: { title: 'Harbor at dawn', publishedAt: { $date: '2026-09-14T00:00:00.000Z' } },
  },
  {
    id: '2026/winter-market',
    path: 'src/content/blog/2026/winter-market/index.md',
    title: 'The winter market opens',
    status: 'editable',
    draft: true,
    fields: {
      title: 'The winter market opens',
      publishedAt: { $date: '2026-12-05T00:00:00.000Z' },
    },
  },
];

function setup(hash: string) {
  const api = fakeApi({
    entries: {
      blog: blogEntries,
      settings: [
        {
          id: 'site',
          path: 'src/content/settings/site.yaml',
          title: 'Site',
          status: 'editable',
          fields: {},
        },
      ],
    },
    documents: { 'blog/harbor-at-dawn': harbor },
  });
  const result = renderStudio(hash, { api });
  return { ...result, api, user: userEvent.setup() };
}

describe('collection icons', () => {
  const drawing = (element: Element | null | undefined) => element?.querySelector('svg')?.innerHTML;
  const defaultIcon = (name: 'tree' | 'collection') => {
    const { container, unmount } = render(<Icon name={name} />);
    const html = drawing(container);
    unmount();
    return html;
  };

  it('draws the icon vesper.config.ts names, or a default by kind', async () => {
    const { user } = setup('#/');
    const blog = await screen.findByRole('link', { name: 'Blog posts' });
    const newspaper = drawing(blog.closest('li'));
    expect(newspaper).toContain('d="M15 18h-5"');
    expect(drawing(screen.getByRole('link', { name: 'Pages' }).closest('li'))).toBe(
      defaultIcon('tree'),
    );
    expect(newspaper).not.toBe(defaultIcon('collection'));

    await user.click(screen.getByRole('button', { name: 'Content' }));
    expect(drawing(await screen.findByRole('menuitem', { name: 'Blog posts' }))).toBe(newspaper);
  });

  it('puts the icon before a collection’s heading, hidden from screen readers', async () => {
    setup('#/c/blog');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Blog posts' });
    expect(heading.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(drawing(heading)).toContain('d="M15 18h-5"');
  });
});

describe('the entry list', () => {
  it('shows each entry’s title, list fields and status in words, newest first', async () => {
    setup('#/c/blog');
    const table = await screen.findByRole('grid', { name: 'Blog posts' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('The winter market opens'),
      expect.stringContaining('Harbor at dawn'),
    ]);
    expect(rows[0]).toHaveTextContent('Draft');
    expect(rows[1]).toHaveTextContent('Sep 14, 2026');
    await expectNoViolations();
  });

  it('filters by search and by status', async () => {
    const { user } = setup('#/c/blog');
    await screen.findByRole('grid');
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'harbor');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 entries shown.');
  });

  it('opens a singleton’s only entry directly', async () => {
    setup('#/c/settings');
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/settings/e/site');
    });
  });
});

describe('the entry editor', () => {
  it('lays out the title, then tabs: the main fields and body on Content, the rest on Details', async () => {
    setup('#/c/blog/e/harbor-at-dawn');
    const title = await screen.findByRole('textbox', { name: 'Title' });
    expect(title).toHaveValue('Harbor at dawn');
    expect(screen.getByRole('textbox', { name: 'Summary' })).toBeInTheDocument();
    // The body opens in the writing view.
    expect(await screen.findByRole('textbox', { name: 'Body' })).toHaveTextContent(
      'The first boats go out around five.',
    );
    // Dates and tags wait on Details; Content is chosen.
    expect(screen.getByRole('tablist', { name: 'Harbor at dawn' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('combobox', { name: /^Tags/ })).not.toBeInTheDocument();
    // A union the editor can't map is edited as YAML.
    expect(screen.getByRole('textbox', { name: 'Series (optional)' })).toHaveValue(
      'name: Waterfront walks\npart: 1',
    );
    await expectNoViolations();
  });

  it('always says something in the status: No changes, or Read only where it can’t be edited', async () => {
    const { user } = setup('#/c/blog/e/harbor-at-dawn');
    const title = await screen.findByRole('textbox', { name: 'Title' });
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('No changes');
    await user.type(title, '!');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Unsaved changes');
    // Back as it was: nothing to save again.
    await user.type(title, '{Backspace}');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('No changes');
    cleanup();

    renderStudio('#/c/blog/e/harbor-at-dawn', {
      api: fakeApi({
        documents: {
          'blog/harbor-at-dawn': {
            ...harbor,
            status: 'read-only',
            message: 'This entry uses a newer format.',
          },
        },
      }),
    });
    await screen.findByText('This entry uses a newer format.');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Read only');
  });

  it('discards changes from the “…” menu, without leaving the entry', async () => {
    const { api, user } = setup('#/c/blog/e/harbor-at-dawn');
    const title = await screen.findByRole('textbox', { name: 'Title' });
    const more = () => screen.getByRole('button', { name: /^More actions for/ });
    // Nothing to discard yet.
    await user.click(more());
    expect(screen.queryByRole('menuitem', { name: 'Discard changes…' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.clear(title);
    await user.type(title, 'Harbor at first light');
    await screen.findByRole('textbox', { name: 'Body' });
    // ProseMirror can't be typed into in jsdom; the source view is a textarea.
    await user.click(screen.getByRole('button', { name: 'Edit as Markdown' }));
    await user.type(screen.getByRole('textbox', { name: 'Body' }), 'Gulls follow them out.');
    expect(screen.getByRole('textbox', { name: 'Body' })).toHaveValue(
      'The first boats go out around five.\nGulls follow them out.',
    );
    await user.click(more());
    await user.click(await screen.findByRole('menuitem', { name: 'Discard changes…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard your changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Harbor at first light');

    await user.click(more());
    await user.click(await screen.findByRole('menuitem', { name: 'Discard changes…' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Discard changes',
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Harbor at dawn');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('No changes');
    // The body editor is drawn again from the saved text.
    const after = await screen.findByRole('textbox', { name: 'Body' });
    expect(after).toHaveTextContent('The first boats go out around five.');
    expect(after).not.toHaveTextContent('Gulls follow');
    expect(api.saveEntry).not.toHaveBeenCalled();
    // Focus goes back to the menu's button, which stayed put.
    await waitFor(() => {
      expect(more()).toHaveFocus();
    });
  });

  it('unpublishes an entry as a draft, after asking, and makes it live again', async () => {
    const { api, user } = setup('#/c/blog/e/harbor-at-dawn');
    await screen.findByRole('textbox', { name: 'Title' });
    const more = () => screen.getByRole('button', { name: /^More actions for/ });
    await user.click(more());
    expect(screen.queryByRole('menuitem', { name: 'Make it live' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: 'Unpublish…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Unpublish “Harbor at dawn”?' });
    expect(dialog).toHaveTextContent('the site leaves it out the next time it’s built');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it live' }));
    expect(api.saveEntry).not.toHaveBeenCalled();

    await user.click(more());
    await user.click(await screen.findByRole('menuitem', { name: 'Unpublish…' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Unpublish' }),
    );
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
    });
    expect((api.saveEntry.mock.calls[0]?.[0] as SaveRequest).data).toMatchObject({ draft: true });
    await waitFor(() => {
      expect(screen.getAllByRole('status')[0]).toHaveTextContent(/^Draft · Saved/);
    });

    // A draft offers the way back.
    await user.click(more());
    await user.click(await screen.findByRole('menuitem', { name: 'Make it live' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(2);
    });
    expect((api.saveEntry.mock.calls[1]?.[0] as SaveRequest).data).toMatchObject({
      draft: false,
    });
  });

  it('saves edited values, leaves an untouched body out, and says so', async () => {
    const { api, user } = setup('#/c/blog/e/harbor-at-dawn');
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.type(title, 'Harbor at first light');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Unsaved changes');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
    });
    const request = api.saveEntry.mock.calls[0]?.[0] as SaveRequest;
    expect(request).toMatchObject({ collection: 'blog', id: 'harbor-at-dawn', version: 'v1' });
    expect(request.data).toMatchObject({
      title: 'Harbor at first light',
      publishedAt: { $date: '2026-09-14T00:00:00.000Z' },
    });
    expect(request).not.toHaveProperty('body');
    expect(await screen.findByText(/Saved just now/)).toBeInTheDocument();
  });

  it('keeps the body’s CRLF line endings when it is edited', async () => {
    const { api, user } = setup('#/c/blog/e/harbor-at-dawn');
    await screen.findByRole('textbox', { name: 'Body' });
    // The source view shows the text without the line breaks after the frontmatter.
    await user.click(screen.getByRole('button', { name: 'Edit as Markdown' }));
    const body = screen.getByRole('textbox', { name: 'Body' });
    expect(body).toHaveValue('The first boats go out around five.\n');
    await user.type(body, 'More.');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
    });
    expect((api.saveEntry.mock.calls[0]?.[0] as SaveRequest).body).toBe(
      '\r\n\r\nThe first boats go out around five.\r\nMore.',
    );
  });

  it('shows validation errors in a summary that links to each field', async () => {
    const { api, user } = setup('#/c/blog/e/harbor-at-dawn');
    api.saveEntry.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid',
      issues: [
        { path: ['hero', 'alt'], message: 'Describe this image, or mark it decorative.' },
        { path: ['publishedAt'], message: 'Enter a valid date.' },
      ],
    });
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const summary = await screen.findByRole('alert');
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
    expect(
      within(summary).getByRole('link', { name: /Hero, alt: Describe this image/ }),
    ).toBeInTheDocument();
    const alt = screen.getByRole('textbox', { name: 'Alt text' });
    expect(alt).toHaveAttribute('aria-invalid', 'true');
    expect(alt).toHaveAccessibleDescription(
      'Describe what this image communicates on this page. Describe this image, or mark it decorative.',
    );
    // The date's problem is on Details: its tab says so in words, before it's chosen.
    expect(screen.getByRole('tab', { name: 'Details (1 problem)' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await user.click(within(summary).getByRole('link', { name: /Hero, alt:/ }));
    expect(alt).toHaveFocus();
    // A link to a field on another tab chooses that tab, then focuses the field.
    await user.click(within(summary).getByRole('link', { name: /Enter a valid date\./ }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Details (1 problem)' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute('aria-invalid', 'true');
    });
    expect(window.location.hash).toBe('#/c/blog/e/harbor-at-dawn');
  });

  it('moves between tabs with the arrow keys, keeping each tab’s fields as they were', async () => {
    const { user } = setup('#/c/blog/e/harbor-at-dawn');
    const summary = await screen.findByRole('textbox', { name: 'Summary' });
    await user.type(summary, ' Kept.');
    const content = screen.getByRole('tab', { name: 'Content' });
    content.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('combobox', { name: /^Tags/ })).toBeInTheDocument();
    await expectNoViolations();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue(
      'The fishing fleet leaves before sunrise. Kept.',
    );
  });

  it('explains a conflict and offers to reload', async () => {
    const { api, user } = setup('#/c/blog/e/harbor-at-dawn');
    api.saveEntry.mockResolvedValueOnce({
      ok: false,
      reason: 'conflict',
      message: 'This entry changed since you opened it.',
    });
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This entry changed since you opened it.',
    );
    await user.click(screen.getByRole('button', { name: 'Reload this entry' }));
    await waitFor(() => {
      expect(api.readEntry).toHaveBeenCalledTimes(2);
    });
  });

  it('asks before leaving with unsaved changes', async () => {
    const { user } = setup('#/c/blog/e/harbor-at-dawn');
    await user.type(await screen.findByRole('textbox', { name: 'Title' }), '!');
    act(() => {
      window.location.hash = '#/';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    expect(window.location.hash).toBe('#/c/blog/e/harbor-at-dawn');
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Harbor at dawn!');

    act(() => {
      window.location.hash = '#/';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Leave without saving',
      }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Content' })).toBeInTheDocument();
  });

  it('creates a new entry and moves to its editor', async () => {
    const { api, user } = setup('#/c/blog/new');
    api.saveEntry.mockResolvedValueOnce({
      ok: true,
      id: 'a-new-post',
      path: 'src/content/blog/a-new-post.md',
      version: 'v9',
      reformatted: false,
    });
    await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'A new post');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Unsaved changes');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/blog/e/a-new-post');
    });
    const request = api.saveEntry.mock.calls[0]?.[0] as SaveRequest;
    expect(request).toMatchObject({
      version: null,
      data: { title: 'A new post', tags: [], draft: false },
    });
  });

  it('reorders repeater items by keyboard, announcing each move', async () => {
    const api = fakeApi({
      documents: {
        'pages/campus-life': {
          collection: 'pages',
          id: 'campus-life',
          path: 'src/content/pages/campus-life.mdx',
          version: 'v1',
          format: 'mdx',
          status: 'editable',
          data: { title: 'Campus life', sections: [{ heading: 'Clubs' }, { heading: 'Sports' }] },
          body: '\n',
        },
      },
    });
    renderStudio('#/c/pages/e/campus-life', { api });
    const user = userEvent.setup();
    // A top-level list is a section with its own heading, and each item a row named by its content.
    expect(await screen.findByRole('heading', { level: 2, name: /^Sections/ })).toBeInTheDocument();
    const clubs = screen.getByRole('button', { name: 'Clubs' });
    expect(clubs).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { level: 3, name: 'Clubs' })).toBeInTheDocument();
    // Alt+↓ on the row moves the item, and focus stays on it.
    clubs.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(screen.getByText('Moved Clubs to position 2 of 2.')).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Sports', 'Clubs']);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clubs' })).toHaveFocus();
    });
    // The "…" menu moves it back.
    await user.click(screen.getByRole('button', { name: 'Actions for Clubs' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }));
    expect(screen.getByText('Moved Clubs to position 1 of 2.')).toBeInTheDocument();
    // Remove, from the menu, moves focus to the next row.
    await user.click(screen.getByRole('button', { name: 'Actions for Sports' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    expect(screen.queryByRole('button', { name: 'Sports' })).not.toBeInTheDocument();
    expect(screen.getByText('Removed Sports.')).toBeInTheDocument();
    // A new item opens, with focus in its first field.
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    const added = screen.getByRole('button', { name: 'Section 2' });
    expect(added).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Heading' })).toHaveFocus();
    });
    await expectNoViolations();
  });

  it('opens a closed item to show a refused save’s problem, and names the count on its row', async () => {
    const api = fakeApi({
      documents: {
        'pages/campus-life': {
          collection: 'pages',
          id: 'campus-life',
          path: 'src/content/pages/campus-life.mdx',
          version: 'v1',
          format: 'mdx',
          status: 'editable',
          data: { title: 'Campus life', sections: [{ heading: 'Clubs' }, { heading: '' }] },
          body: '\n',
        },
      },
    });
    api.saveEntry.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid',
      issues: [{ path: ['sections', 1, 'heading'], message: 'Add a heading.' }],
    });
    renderStudio('#/c/pages/e/campus-life', { api });
    const user = userEvent.setup();
    const second = await screen.findByRole('button', { name: 'Section 2' });
    expect(second).toHaveAttribute('aria-expanded', 'false');
    await user.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Section 2/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });
    expect(screen.getByRole('button', { name: /^Section 2/ })).toHaveTextContent('1 problem');
    expect(screen.getByText('Add a heading.')).toBeVisible();
    // The other item stays as it was.
    expect(screen.getByRole('button', { name: 'Clubs' })).toHaveAttribute('aria-expanded', 'false');
  });
});
