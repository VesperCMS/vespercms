// @vitest-environment jsdom
import {
  gitBlobSha,
  type EntryDocument,
  type Manifest,
  type MediaItem,
  type SaveRequest,
} from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const harborHero = {
  src: '../../assets/blog/harbor-at-dawn.jpg',
  alt: 'An orange sun over a harbor',
  focus: { x: 0.62, y: 0.35 },
};

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
    hero: harborHero,
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

/** Harbor at dawn with its hero (or no hero) as given. */
function withHero(hero: unknown): EntryDocument {
  const { hero: _hero, ...data } = harbor.data as Record<string, unknown>;
  return { ...harbor, data: hero === undefined ? data : { ...data, hero } };
}

function setup(extra: { media?: MediaItem[]; doc?: EntryDocument; manifest?: Manifest } = {}) {
  const api = fakeApi({
    documents: { 'blog/harbor-at-dawn': extra.doc ?? harbor },
    media: extra.media ?? media,
  });
  renderStudio('#/c/blog/e/harbor-at-dawn', {
    api,
    ...(extra.manifest && { manifest: extra.manifest }),
  });
  return { api, user: userEvent.setup() };
}

/** Opens the picker from the hero's button and chooses one of the site's images. */
async function choose(user: ReturnType<typeof userEvent.setup>, button: string, file: RegExp) {
  await user.click(await screen.findByRole('button', { name: button }));
  const dialog = await screen.findByRole('dialog', { name: 'Choose an image' });
  await user.click(await within(dialog).findByRole('button', { name: file }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

const REPLACED = 'You replaced the image. Check that the alt text still describes it.';

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
    const hero = await screen.findByRole('group', { name: 'Hero (optional)' });
    expect(api.fileUrl).toHaveBeenCalledWith('src/assets/blog/harbor-at-dawn.jpg');
    expect(within(hero).getByText('harbor-at-dawn.jpg')).toBeInTheDocument();
    const alt = within(hero).getByRole('textbox', { name: 'Alt text' });
    expect(alt).toHaveValue('An orange sun over a harbor');
    expect(alt).toHaveAccessibleDescription('Describe what this image communicates on this page.');
    await expectNoViolations();
  });

  it('marks an image decorative, which stores an empty alt', async () => {
    const { api, user } = setup();
    const hero = await screen.findByRole('group', { name: 'Hero (optional)' });
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
    const hero = await screen.findByRole('group', { name: 'Hero (optional)' });
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

  it('drops the old image’s focal point and crops on a replace, and asks about its alt text', async () => {
    const { api, user } = setup({
      doc: withHero({
        ...harborHero,
        crops: { square: { x: 0.2, y: 0, w: 0.5625, h: 1 } },
      }),
    });
    const hero = await screen.findByRole('group', { name: 'Hero (optional)' });
    expect(within(hero).queryByText(REPLACED)).not.toBeInTheDocument();
    await choose(user, 'Replace image', /winter-market\.jpg/);

    // Beside the alt text and in its description, never in the live status.
    const alt = within(hero).getByRole('textbox', { name: 'Alt text' });
    expect(within(hero).getByText(REPLACED)).toBeInTheDocument();
    expect(alt).toHaveAccessibleDescription(expect.stringContaining(REPLACED) as string);
    expect(within(hero).queryByRole('status')).not.toBeInTheDocument();
    await expectNoViolations();

    expect((await lastSave(user, api)).data.hero).toEqual({
      src: '../../assets/blog/winter-market.jpg',
      alt: 'An orange sun over a harbor',
    });

    await user.type(alt, ', in winter');
    expect(within(hero).queryByText(REPLACED)).not.toBeInTheDocument();
    expect(alt).toHaveAccessibleDescription('Describe what this image communicates on this page.');
  });

  it('asks whether a replaced decorative image is still decorative', async () => {
    const { api, user } = setup({
      doc: withHero({ src: '../../assets/blog/harbor-at-dawn.jpg', alt: '', decorative: true }),
    });
    const hero = await screen.findByRole('group', { name: 'Hero (optional)' });
    await choose(user, 'Replace image', /winter-market\.jpg/);
    const checkbox = within(hero).getByRole('checkbox', { name: /Decorative image/ });
    expect(checkbox).toHaveAccessibleDescription(
      expect.stringContaining(
        'You replaced the image. Check that it’s still decorative.',
      ) as string,
    );
    expect((await lastSave(user, api)).data.hero).toEqual({
      src: '../../assets/blog/winter-market.jpg',
      alt: '',
      decorative: true,
    });
    await user.click(checkbox);
    expect(within(hero).queryByText(/You replaced the image/)).not.toBeInTheDocument();
  });

  it('chooses a first image with no note', async () => {
    const { api, user } = setup({ doc: withHero(undefined) });
    const hero = await screen.findByRole('group', { name: 'Hero (optional)' });
    await choose(user, 'Choose image', /winter-market\.jpg/);
    expect(within(hero).getByText('winter-market.jpg')).toBeInTheDocument();
    expect(within(hero).queryByText(/You replaced the image/)).not.toBeInTheDocument();
    expect((await lastSave(user, api)).data.hero).toEqual({
      src: '../../assets/blog/winter-market.jpg',
    });
  });

  it('changes nothing when the same image is chosen again', async () => {
    const { user } = setup();
    const hero = await screen.findByRole('group', { name: 'Hero (optional)' });
    await choose(user, 'Replace image', /harbor-at-dawn\.jpg/);
    expect(within(hero).queryByText(/You replaced the image/)).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('replaces a plain image() path with no note', async () => {
    const manifest = structuredClone(playgroundManifest);
    const fields = manifest.collections.find((c) => c.name === 'blog')?.fields ?? [];
    fields.splice(
      fields.findIndex((f) => f.path.join('.') === 'hero'),
      1,
      {
        path: ['hero'],
        kind: 'image',
        required: false,
        label: 'Hero',
        widget: 'image',
      },
    );
    const { api, user } = setup({
      doc: withHero('../../assets/blog/harbor-at-dawn.jpg'),
      manifest,
    });
    await choose(user, 'Replace image', /winter-market\.jpg/);
    expect(screen.queryByText(/You replaced the image/)).not.toBeInTheDocument();
    expect((await lastSave(user, api)).data.hero).toBe('../../assets/blog/winter-market.jpg');
  });

  it('uploads through hygiene into the image’s folder', async () => {
    const { api, user } = setup();
    const hero = await screen.findByRole('group', { name: 'Hero (optional)' });
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
    expect((await lastSave(user, api)).data.hero).toEqual({
      src: '../../assets/blog/Logo Mark.svg',
      alt: 'An orange sun over a harbor',
    });
    expect(within(hero).getByText(REPLACED)).toBeInTheDocument();
  });

  it('offers the existing copy when the same file is uploaded again', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\nsame');
    const hash = await gitBlobSha(pdf);
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
