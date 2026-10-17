// @vitest-environment jsdom
import type { EntryDocument, EntrySummary, SaveRequest } from '@vesper/core';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
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
  it('lays out the title, main fields, body and a closed Details section', async () => {
    setup('#/c/blog/e/harbor-at-dawn');
    const title = await screen.findByRole('textbox', { name: 'Title (required)' });
    expect(title).toHaveValue('Harbor at dawn');
    expect(screen.getByRole('textbox', { name: 'Summary (required)' })).toBeInTheDocument();
    // The body opens in the writing view.
    expect(await screen.findByRole('textbox', { name: 'Body' })).toHaveTextContent(
      'The first boats go out around five.',
    );
    // Dates and tags wait in Details, which starts closed.
    const details = screen.getByRole('button', { name: 'Details' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    // A union the editor can't map is edited as YAML.
    expect(screen.getByRole('textbox', { name: 'Series' })).toHaveValue(
      'name: Waterfront walks\npart: 1',
    );
    await expectNoViolations();
  });

  it('saves edited values, leaves an untouched body out, and says so', async () => {
    const { api, user } = setup('#/c/blog/e/harbor-at-dawn');
    const title = await screen.findByRole('textbox', { name: 'Title (required)' });
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
    await screen.findByRole('textbox', { name: 'Title (required)' });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const summary = await screen.findByRole('alert');
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
    expect(
      within(summary).getByRole('link', { name: /Hero, alt: Describe this image/ }),
    ).toBeInTheDocument();
    const alt = screen.getByRole('textbox', { name: 'Alt text (required)' });
    expect(alt).toHaveAttribute('aria-invalid', 'true');
    expect(alt).toHaveAccessibleDescription(
      'Describe what this image communicates on this page. Describe this image, or mark it decorative.',
    );
    // The date error is in Details, so Details opens.
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(within(summary).getByRole('link', { name: /Hero, alt:/ }));
    expect(alt).toHaveFocus();
    expect(window.location.hash).toBe('#/c/blog/e/harbor-at-dawn');
  });

  it('explains a conflict and offers to reload', async () => {
    const { api, user } = setup('#/c/blog/e/harbor-at-dawn');
    api.saveEntry.mockResolvedValueOnce({
      ok: false,
      reason: 'conflict',
      message: 'This entry changed since you opened it.',
    });
    await screen.findByRole('textbox', { name: 'Title (required)' });
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
    await user.type(await screen.findByRole('textbox', { name: 'Title (required)' }), '!');
    act(() => {
      window.location.hash = '#/';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    expect(window.location.hash).toBe('#/c/blog/e/harbor-at-dawn');
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Title (required)' })).toHaveValue(
      'Harbor at dawn!',
    );

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
    await user.type(await screen.findByRole('textbox', { name: 'Title (required)' }), 'A new post');
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
    const down = await screen.findByRole('button', { name: 'Move Clubs down' });
    await user.click(down);
    expect(screen.getByRole('button', { name: 'Move Clubs up' })).toBeInTheDocument();
    expect(screen.getByText('Moved Clubs to position 2 of 2.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Sports' }));
    expect(screen.queryByRole('button', { name: /Sports/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Add / }));
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2);
  });
});
