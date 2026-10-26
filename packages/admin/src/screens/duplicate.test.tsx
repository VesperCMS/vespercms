// @vitest-environment jsdom
import {
  DEFAULT_URL_SETTINGS,
  type EntryDocument,
  type Manifest,
  type SaveRequest,
} from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent, type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';

/*
 * Duplicate and the copy items in the editor's "…" menu (spec §10.3;
 * PLAN.md, "Duplicate an entry, and copy links").
 */

afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.restoreAllMocks();
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
    tags: ['harbor'],
    category: 'stories',
    publishedAt: { $date: '2026-09-14T00:00:00.000Z' },
  },
  body: '\r\n\r\nThe first boats go out around five.\r\n',
};

function setup(hash: string, options: { manifest?: Manifest; doc?: EntryDocument } = {}) {
  const api = fakeApi({
    documents: { 'blog/harbor-at-dawn': options.doc ?? harbor },
    pages: [
      {
        collection: 'blog',
        id: 'harbor-at-dawn',
        title: 'Harbor at dawn',
        url: '/stories/harbor/',
      },
    ],
  });
  const user = userEvent.setup();
  const result = renderStudio(hash, {
    api,
    siteUrl: '/',
    ...(options.manifest ? { manifest: options.manifest } : {}),
  });
  return { ...result, api, user };
}

async function openMenu(user: UserEvent): Promise<HTMLElement> {
  await screen.findByRole('textbox', { name: 'Title' });
  await user.click(screen.getByRole('button', { name: 'More actions for Harbor at dawn' }));
  return screen.findByRole('menu');
}

const names = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);

/** The playground's manifest with the site's own settings changed. */
function withSite(urls: Partial<NonNullable<Manifest['site']['urls']>>): Manifest {
  return {
    ...playgroundManifest,
    site: { ...playgroundManifest.site, urls: { ...DEFAULT_URL_SETTINGS, ...urls } },
  };
}

describe('the editor’s copy items and Duplicate', () => {
  it('lists View on site, the two copy items and Duplicate before Delete', async () => {
    const { user } = setup('#/c/blog/e/harbor-at-dawn');
    expect(names(await openMenu(user))).toEqual([
      'View on site',
      'Copy page address',
      'Copy editing link',
      'Duplicate',
      'Delete…',
    ]);
    await expectNoViolations();
  });

  it('opens an unsaved copy, then saves it as a new entry from the original’s text', async () => {
    const { api, user } = setup('#/c/blog/e/harbor-at-dawn');
    await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/blog/e/harbor-at-dawn/copy');
    });
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue(
      'Harbor at dawn (copy)',
    );
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue(
      'The fishing fleet leaves before sunrise.',
    );
    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'New entry, a copy of Harbor at dawn',
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Not saved yet');
    // A new entry has nothing to copy or duplicate yet.
    expect(screen.queryByRole('button', { name: /^More actions/ })).not.toBeInTheDocument();
    await expectNoViolations();

    api.saveEntry.mockResolvedValueOnce({
      ok: true,
      id: 'harbor-at-dawn-copy',
      path: 'src/content/blog/harbor-at-dawn-copy.md',
      version: 'v9',
      reformatted: false,
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/blog/e/harbor-at-dawn-copy');
    });
    const request = api.saveEntry.mock.calls[0]?.[0] as SaveRequest;
    expect(request).toMatchObject({
      collection: 'blog',
      id: '',
      version: null,
      copyOf: { id: 'harbor-at-dawn' },
      body: harbor.body,
    });
    expect(request.data).toMatchObject({
      title: 'Harbor at dawn (copy)',
      hero: (harbor.data as { hero: unknown }).hero,
      publishedAt: { $date: '2026-09-14T00:00:00.000Z' },
    });
  });

  it('copies the editing link, says so in the status, and keeps focus on the menu button', async () => {
    const { user } = setup('#/c/blog/e/harbor-at-dawn');
    await user.click(
      within(await openMenu(user)).getByRole('menuitem', { name: 'Copy editing link' }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole('status')[0]).toHaveTextContent('Link copied');
    });
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}${window.location.pathname}#/c/blog/e/harbor-at-dawn`,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'More actions for Harbor at dawn' })).toHaveFocus();
    });
  });

  it('copies the page address on Astro’s site when the site sets one', async () => {
    const { user } = setup('#/c/blog/e/harbor-at-dawn', {
      manifest: withSite({ site: 'https://college.example', trailingSlash: 'always' }),
    });
    await user.click(
      within(await openMenu(user)).getByRole('menuitem', { name: 'Copy page address' }),
    );
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe(
        'https://college.example/blog/harbor-at-dawn/',
      );
    });
  });

  it('shows the link selected, to copy by hand, when the clipboard refuses', async () => {
    const { user } = setup('#/c/blog/e/harbor-at-dawn');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Not allowed'));
    await user.click(
      within(await openMenu(user)).getByRole('menuitem', { name: 'Copy editing link' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Copy the editing link' });
    const field = within(dialog).getByRole('textbox', { name: 'Editing link' });
    const link = `${window.location.origin}${window.location.pathname}#/c/blog/e/harbor-at-dawn`;
    expect(field).toHaveValue(link);
    expect(field).toHaveAccessibleDescription('Press Ctrl+C to copy.');
    await waitFor(() => {
      expect(field).toHaveFocus();
    });
    expect([
      (field as HTMLInputElement).selectionStart,
      (field as HTMLInputElement).selectionEnd,
    ]).toEqual([0, link.length]);
    await expectNoViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('gives a function-form URL View on site and its address, from the site’s pages', async () => {
    const manifest: Manifest = {
      ...playgroundManifest,
      collections: playgroundManifest.collections.map((c) =>
        c.name === 'blog'
          ? { ...c, presentation: { ...c.presentation, url: { kind: 'function' } } }
          : c,
      ),
    };
    const { user } = setup('#/c/blog/e/harbor-at-dawn', { manifest });
    await screen.findByRole('textbox', { name: 'Title' });
    await waitFor(async () => {
      await user.click(screen.getByRole('button', { name: 'More actions for Harbor at dawn' }));
      expect(
        await screen.findByRole('menuitem', { name: 'Copy page address' }),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole('menuitem', { name: 'Copy page address' }));
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe(
        `${window.location.origin}/stories/harbor/`,
      );
    });
  });

  it('offers no Duplicate for an entry edited as raw frontmatter, and says why at its address', async () => {
    const raw: EntryDocument = {
      ...harbor,
      status: 'source-only',
      message: 'This frontmatter uses YAML anchors, so it’s edited as text.',
      rawFrontmatter: 'title: Harbor at dawn\n',
    };
    const { user } = setup('#/c/blog/e/harbor-at-dawn', { doc: raw });
    await screen.findByRole('textbox', { name: 'Frontmatter (YAML)' });
    await user.click(screen.getByRole('button', { name: 'More actions for Harbor at dawn' }));
    expect(names(await screen.findByRole('menu'))).not.toContain('Duplicate');

    cleanup();
    setup('#/c/blog/e/harbor-at-dawn/copy', { doc: raw });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This entry can’t be duplicated' }),
    ).toBeInTheDocument();
  });
});
