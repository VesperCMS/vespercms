// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls to the selection.
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
});

const campusLife = {
  collection: 'pages',
  id: 'campus-life',
  path: 'src/content/pages/campus-life.mdx',
  version: 'v1',
  format: 'mdx' as const,
  status: 'editable' as const,
  data: { title: 'Campus life' },
  body: "\nimport Gallery from '../../components/Gallery.astro';\n\nClubs meet *weekly*.\n\n<Gallery photos={3} />\n",
};

describe('the body editor', () => {
  it('shows Markdown as text and protects JSX and imports as named, read-only blocks', async () => {
    renderStudio('#/c/pages/e/campus-life', {
      api: fakeApi({ documents: { 'pages/campus-life': campusLife } }),
    });
    const body = await screen.findByRole('textbox', { name: 'Body' });
    expect(body).toHaveTextContent('Clubs meet weekly.');
    expect(within(body).getByText(/^Import, kept as written/)).toBeInTheDocument();
    expect(within(body).getByText(/^Component, kept as written/)).toBeInTheDocument();
    expect(within(body).getByText('<Gallery photos={3} />')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit as MDX' })).toBeInTheDocument();
    await expectNoViolations();
  });

  it('leaves the editor with Escape, never trapping the keyboard', async () => {
    renderStudio('#/c/pages/e/campus-life', {
      api: fakeApi({ documents: { 'pages/campus-life': campusLife } }),
    });
    const body = await screen.findByRole('textbox', { name: 'Body' });
    act(() => {
      body.focus();
    });
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Bold' })).toHaveFocus();
    });
  });

  it('sets the text style, Paragraph or Heading 2 to 6, from one menu, and goes back to the text', async () => {
    const api = fakeApi({ documents: { 'pages/campus-life': campusLife } });
    renderStudio('#/c/pages/e/campus-life', { api });
    const user = userEvent.setup();
    const body = await screen.findByRole('textbox', { name: 'Body' });
    const editor = (body as unknown as { editor: Editor }).editor;
    act(() => {
      const line = within(body).getByText(/Clubs meet/);
      editor.commands.setTextSelection(editor.view.posAtDOM(line.firstChild as Text, 3));
    });
    const style = await screen.findByRole('button', { name: 'Text style: Paragraph' });
    await user.click(style);
    // Named by its button, as the kit's menus with their own button are.
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['Paragraph', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Paragraph' })).toBeChecked();
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Heading 4' }));
    await waitFor(() => {
      expect(body).toHaveFocus();
    });
    expect(within(body).getByRole('heading', { level: 4 })).toHaveTextContent('Clubs meet weekly.');
    expect(screen.getByRole('button', { name: 'Text style: Heading 4' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    expect(api.saveEntry.mock.calls[0]?.[0]).toHaveProperty(
      'body',
      expect.stringContaining('\n#### Clubs meet *weekly*.\n'),
    );
  });

  it('starts the text styles where the collection’s headings start', async () => {
    const manifest = structuredClone(playgroundManifest);
    const pages = manifest.collections.find((c) => c.name === 'pages');
    if (pages) pages.presentation.headingStart = 1;
    renderStudio('#/c/pages/e/campus-life', {
      api: fakeApi({ documents: { 'pages/campus-life': campusLife } }),
      manifest,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Text style/ }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual([
      'Paragraph',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 4',
      'Heading 5',
      'Heading 6',
    ]);
  });

  it('round-trips the source view without changing a byte', async () => {
    const api = fakeApi({ documents: { 'pages/campus-life': campusLife } });
    renderStudio('#/c/pages/e/campus-life', { api });
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Body' });
    await user.click(screen.getByRole('button', { name: 'Edit as MDX' }));
    await user.click(screen.getByRole('button', { name: 'Back to the writing view' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    // Nothing changed, so the body isn't even sent.
    expect(api.saveEntry.mock.calls[0]?.[0]).not.toHaveProperty('body');
  });
});

describe('the link picker (spec §6.15.6)', () => {
  it('finds a page by title and links to its current address', async () => {
    const api = fakeApi({
      documents: { 'pages/campus-life': campusLife },
      pages: [
        {
          collection: 'pages',
          id: 'academics/nursing',
          title: 'Nursing',
          url: '/academics/nursing/',
        },
        { collection: 'pages', id: 'about', title: 'About the college', url: '/about/' },
      ],
    });
    renderStudio('#/c/pages/e/campus-life', { api });
    const user = userEvent.setup();
    const body = await screen.findByRole('textbox', { name: 'Body' });
    const word = within(body).getByText(/Clubs meet/);
    // Select "Clubs" in the paragraph, then add a link to it.
    act(() => {
      const range = document.createRange();
      const text = word.firstChild as Text;
      range.setStart(text, 0);
      range.setEnd(text, 5);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      body.focus();
    });
    await user.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a link' });
    const field = within(dialog).getByRole('combobox', { name: 'Page or web address' });
    await user.type(field, 'nurs');
    await user.click(await screen.findByRole('option', { name: /Nursing/ }));
    expect(field).toHaveValue('/academics/nursing/');
    await expectNoViolations();
    expect(api.listPages).toHaveBeenCalled();
  });

  it('offers pages for URL fields that take a path', async () => {
    const event = {
      collection: 'events',
      id: 'summer-orientation',
      path: 'src/content/events/summer-orientation.md',
      version: 'v1',
      format: 'md' as const,
      status: 'editable' as const,
      data: {
        title: 'Summer orientation',
        summary: 'Before the first semester.',
        startsAt: { $date: '2026-07-15T13:00:00.000Z' },
        unpublishRedirect: '/admissions/apply/',
      },
      body: '\nAlready expired.\n',
    };
    const api = fakeApi({
      documents: { 'events/summer-orientation': event },
      pages: [{ collection: 'pages', id: 'about', title: 'About the college', url: '/about/' }],
    });
    renderStudio('#/c/events/e/summer-orientation', { api });
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Body' });
    // The redirect is set with the schedule's times, from Details.
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await user.click(await screen.findByRole('button', { name: 'Change schedule…' }));
    const schedule = await screen.findByRole('dialog', { name: 'Change schedule' });
    await user.click(
      within(schedule).getByRole('button', { name: 'Choose a page for Then send visitors to' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Choose a page' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Page' }));
    await user.click(await screen.findByRole('option', { name: 'About the college (/about/)' }));
    await waitFor(() => {
      expect(within(schedule).getByRole('textbox', { name: /Then send visitors to/ })).toHaveValue(
        '/about/',
      );
    });
  });
});
