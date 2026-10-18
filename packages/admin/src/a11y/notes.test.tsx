// @vitest-environment jsdom
import type { EntryDocument, Manifest } from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
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

/** The playground's manifest with a declared background, and the fixture's colour marked as text. */
function siteWithBackgrounds(): Manifest {
  const manifest = structuredClone(playgroundManifest);
  manifest.site.a11y = { backgrounds: [{ name: 'Page, light', color: '#ffffff' }] };
  const fixtures = manifest.collections.find((c) => c.name === 'fixtures');
  const textColor = fixtures?.fields?.find((f) => f.path[0] === 'textColor');
  if (textColor) textColor.widgetOptions = { ...textColor.widgetOptions, contrast: 'text' };
  return manifest;
}

const fixture: EntryDocument = {
  collection: 'fixtures',
  id: 'accessibility-mistakes',
  path: 'src/content/fixtures/accessibility-mistakes.mdoc',
  version: 'v1',
  format: 'mdoc',
  status: 'editable',
  data: { title: 'Accessibility mistakes', summary: 'Test fixture.', textColor: '#a3abbd' },
  body: '\n## Images\n\n#### A heading that skips level 3\n\nFor the timetable, [click here](/academics/).\n',
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
    summary: 'The fishing fleet leaves before sunrise.',
    hero: { src: '../../assets/blog/harbor-at-dawn.jpg', alt: 'IMG_2041.jpg' },
    author: 'ada-moreno',
    category: 'stories',
    publishedAt: { $date: '2026-09-14T00:00:00.000Z' },
  },
  body: '\nThe first boats go out around five.\n',
};

function open(hash: string, doc: EntryDocument, manifest: Manifest = siteWithBackgrounds()) {
  const api = fakeApi({ documents: { [`${doc.collection}/${doc.id}`]: doc } });
  renderStudio(hash, { api, manifest });
  return userEvent.setup();
}

describe('accessibility notes beside fields', () => {
  it('puts a contrast note under the colour field, in its description', async () => {
    open('#/c/fixtures/e/accessibility-mistakes', fixture);
    const note = await screen.findByText(/Contrast 2\.3:1 against Page, light is below 4\.5:1\./);
    const color = screen.getByRole('textbox', { name: /Text color/ });
    expect(color).toHaveAccessibleDescription(expect.stringContaining('Contrast 2.3:1') as string);
    expect(note.closest('li')).toHaveTextContent(
      'Accessibility note: Contrast 2.3:1 against Page, light is below 4.5:1. Low-contrast text',
    );
  });

  it('says nothing about contrast when the site declares no backgrounds', async () => {
    const manifest = siteWithBackgrounds();
    delete manifest.site.a11y;
    open('#/c/fixtures/e/accessibility-mistakes', fixture, manifest);
    await screen.findByText('Accessibility notes in the body');
    expect(screen.queryByText(/Contrast/)).not.toBeInTheDocument();
  });

  it('puts an alt-text note beside the alt text, not under the whole image', async () => {
    open('#/c/blog/e/harbor-at-dawn', harbor);
    const alt = await screen.findByRole('textbox', { name: /Alt text/ });
    await waitFor(() => {
      expect(alt).toHaveAccessibleDescription(
        expect.stringContaining('Alt text looks like a file name.') as string,
      );
    });
    expect(screen.getAllByText(/Alt text looks like a file name\./)).toHaveLength(1);
  });
});

describe('accessibility notes in the body', () => {
  it('lists each note under the body, and Show takes the cursor there', async () => {
    const user = open('#/c/fixtures/e/accessibility-mistakes', fixture);
    const label = await screen.findByText('Accessibility notes in the body');
    const list = screen.getByRole('list', { name: 'Accessibility notes in the body' });
    expect(label).toBeInTheDocument();
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual([
      expect.stringContaining(
        'Heading “A heading that skips level 3”: Heading jumps from level 2 to level 4.',
      ),
      expect.stringContaining('Link “click here”: Link text should say where it goes.'),
    ]);
    const show = within(items[0] as HTMLElement).getByRole('button', { name: 'Show' });
    expect(show).toHaveAccessibleDescription(expect.stringContaining('Heading jumps') as string);
    await user.click(show);
    const body = screen.getByRole('textbox', { name: 'Body' });
    await waitFor(() => {
      expect(body).toHaveFocus();
    });
    const anchor = window.getSelection()?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    expect(element?.closest('h4')).toHaveTextContent('A heading that skips level 3');
    // The fixture's skipped heading is content axe would flag; the notes themselves must pass.
    await expectNoViolations(list.parentElement ?? list);
  });

  it('gives line numbers in the source view, where Show selects the text', async () => {
    const user = open('#/c/fixtures/e/accessibility-mistakes', fixture);
    await screen.findByText('Accessibility notes in the body');
    await user.click(screen.getByRole('button', { name: 'Edit as Markdoc' }));
    const list = screen.getByRole('list', { name: 'Accessibility notes in the body' });
    const [first] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('Line 3. Heading “A heading that skips level 3”');
    await user.click(within(first as HTMLElement).getByRole('button', { name: 'Show' }));
    const source = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Body' });
    expect(source).toHaveFocus();
    expect(source.value.slice(source.selectionStart, source.selectionEnd)).toBe(
      '#### A heading that skips level 3',
    );
  });
});
