// @vitest-environment jsdom
import type { EntryDocument, MediaItem, SaveRequest } from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '../media/upload.ts';
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
    summary: 'Boats.',
    hero: {
      src: '../../assets/blog/harbor-at-dawn.jpg',
      alt: 'An orange sun over a harbor',
      focus: { x: 0.62, y: 0.35 },
    },
    author: 'ada',
    category: 'stories',
    publishedAt: { $date: '2026-09-14T00:00:00.000Z' },
  },
  body: '\n',
};

const media: MediaItem[] = [
  {
    path: 'src/assets/blog/harbor-at-dawn.jpg',
    size: 120_000,
    hash: 'a'.repeat(64),
    usedBy: [{ collection: 'blog', id: 'harbor-at-dawn', title: 'Harbor at dawn' }],
  },
  { path: 'src/assets/blog/winter-market.jpg', size: 90_000, hash: 'b'.repeat(64), usedBy: [] },
  { path: 'public/files/untagged-brochure.pdf', size: 4_000, hash: 'c'.repeat(64), usedBy: [] },
];

function setup(extra: { media?: MediaItem[] } = {}) {
  const api = fakeApi({
    documents: { 'blog/harbor-at-dawn': harbor },
    media: extra.media ?? media,
  });
  renderStudio('#/c/blog/e/harbor-at-dawn', { api });
  return { api, user: userEvent.setup() };
}

async function lastSave(user: ReturnType<typeof userEvent.setup>, api: ReturnType<typeof fakeApi>) {
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(api.saveEntry).toHaveBeenCalled();
  });
  return api.saveEntry.mock.calls.at(-1)?.[0] as SaveRequest & {
    data: { hero: Record<string, unknown> };
  };
}

describe('the image field', () => {
  it('previews the image from its path relative to the entry, with alt text written for this page', async () => {
    const { api } = setup();
    const hero = await screen.findByRole('group', { name: 'Hero' });
    expect(api.fileUrl).toHaveBeenCalledWith('src/assets/blog/harbor-at-dawn.jpg');
    expect(within(hero).getByText('harbor-at-dawn.jpg')).toBeInTheDocument();
    const alt = within(hero).getByRole('textbox', { name: 'Alt text (required)' });
    expect(alt).toHaveValue('An orange sun over a harbor');
    expect(alt).toHaveAccessibleDescription('Describe what this image communicates on this page.');
    await expectNoViolations();
  });

  it('marks an image decorative, which stores an empty alt', async () => {
    const { api, user } = setup();
    const hero = await screen.findByRole('group', { name: 'Hero' });
    await user.click(within(hero).getByRole('checkbox', { name: /Decorative image/ }));
    expect(within(hero).queryByRole('textbox', { name: /Alt text/ })).not.toBeInTheDocument();
    const saved = await lastSave(user, api);
    // Focal point and crops already in the file are kept.
    expect(saved.data.hero).toEqual({
      src: '../../assets/blog/harbor-at-dawn.jpg',
      alt: '',
      decorative: true,
      focus: { x: 0.62, y: 0.35 },
    });
  });

  it('replaces the image with one already in the site, stored relative to the entry', async () => {
    const { api, user } = setup();
    const hero = await screen.findByRole('group', { name: 'Hero' });
    await user.click(within(hero).getByRole('button', { name: 'Replace image' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose an image' });
    // Only images are offered for an image field.
    expect(within(dialog).queryByText('untagged-brochure.pdf')).not.toBeInTheDocument();
    await user.click(await within(dialog).findByRole('button', { name: /winter-market\.jpg/ }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect((await lastSave(user, api)).data.hero.src).toBe('../../assets/blog/winter-market.jpg');
  });

  it('uploads through hygiene into the image’s folder', async () => {
    const { api, user } = setup();
    const hero = await screen.findByRole('group', { name: 'Hero' });
    await user.click(within(hero).getByRole('button', { name: 'Replace image' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose an image' });
    const svg = readFileSync(join(process.cwd(), 'apps/playground/fixtures/uploads/script.svg'));
    const input = dialog.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File([svg], 'Logo Mark.svg', { type: 'image/svg+xml' }));
    await waitFor(() => {
      expect(api.upload).toHaveBeenCalled();
    });
    const [blob, name, folder] = api.upload.mock.calls[0] as [Blob, string, string];
    expect([name, folder]).toEqual(['Logo Mark.svg', 'src/assets/blog']);
    expect(await blob.text()).not.toMatch(/<script/i);
    expect(await within(hero).findByRole('status')).toHaveTextContent(
      'Added. Removed scripts and unsafe links from the SVG.',
    );
    expect((await lastSave(user, api)).data.hero.src).toBe('../../assets/blog/Logo Mark.svg');
  });

  it('offers the existing copy when the same file is uploaded again', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\nsame');
    const hash = await sha256(pdf);
    const api = fakeApi({
      documents: {
        'pages/campus-life': {
          collection: 'pages',
          id: 'campus-life',
          path: 'src/content/pages/campus-life.mdx',
          version: 'v1',
          format: 'mdx',
          status: 'editable',
          data: { title: 'Campus life' },
          body: '\n',
        },
      },
      media: [{ path: 'public/files/guide.pdf', size: pdf.length, hash, usedBy: [] }],
    });
    renderStudio('#/c/pages/e/campus-life', { api });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Choose file' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose a file' });
    await user.upload(
      dialog.querySelector('input[type=file]') as HTMLInputElement,
      new File([pdf], 'guide-copy.pdf'),
    );
    expect(
      await within(dialog).findByText(
        'This file is already in the site as public/files/guide.pdf.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Use the existing file' }));
    expect(api.upload).not.toHaveBeenCalled();
    expect(await screen.findByRole('link', { name: 'guide.pdf' })).toBeInTheDocument();
  });
});

describe('the media browser', () => {
  it('lists files with where each is used, and filters to unused ones', async () => {
    const api = fakeApi({ media });
    renderStudio('#/media', { api });
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'harbor-at-dawn.jpg' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Harbor at dawn' })).toHaveAttribute(
      'href',
      '#/c/blog/e/harbor-at-dawn',
    );
    await user.click(screen.getByRole('button', { name: /Show/ }));
    await user.click(await screen.findByRole('option', { name: 'Unused files' }));
    expect(screen.queryByRole('heading', { name: 'harbor-at-dawn.jpg' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    await expectNoViolations();
  });

  it('deletes an unused file only after confirming', async () => {
    const api = fakeApi({ media });
    renderStudio('#/media', { api });
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'harbor-at-dawn.jpg' }),
    ).toBeInTheDocument();
    // A used file has no delete button.
    expect(
      screen.queryByRole('button', { name: 'Delete src/assets/blog/harbor-at-dawn.jpg' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Delete src/assets/blog/winter-market.jpg' }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this file?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(api.deleteMedia).toHaveBeenCalledWith('src/assets/blog/winter-market.jpg');
    });
  });
});
