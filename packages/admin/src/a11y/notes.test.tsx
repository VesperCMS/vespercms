// @vitest-environment jsdom
import type { EntryDocument, Manifest } from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.unstubAllGlobals();
});

// PDF.js itself is tested in pdf.test.ts (Node) and e2e (Chromium); here it reports an untagged PDF.
vi.mock('./pdf.ts', () => ({
  readPdfFacts: vi.fn(() => Promise.resolve({ tagged: false, title: null, language: 'en' })),
}));

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

const fixtureData = {
  title: 'Accessibility mistakes',
  summary: 'Test fixture.',
  textColor: '#a3abbd',
};

const fixture: EntryDocument = {
  collection: 'fixtures',
  id: 'accessibility-mistakes',
  path: 'src/content/fixtures/accessibility-mistakes.mdoc',
  version: 'v1',
  format: 'mdoc',
  status: 'editable',
  data: fixtureData,
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

describe('PDF notes', () => {
  it('reads the PDF in a file field and notes what it lacks, beside the field', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        fetched.push(url);
        return Promise.resolve(new Response(new Uint8Array([37, 80, 68, 70])));
      }),
    );
    open('#/c/fixtures/e/accessibility-mistakes', {
      ...fixture,
      data: { ...fixtureData, brochure: '/files/untagged-brochure.pdf' },
      body: '\nDownload the [course brochure](/files/untagged-brochure.pdf).\n',
    });
    const button = await screen.findByRole('button', { name: 'Replace file' });
    await waitFor(() => {
      expect(button).toHaveAccessibleDescription(expect.stringContaining('isn’t tagged') as string);
    });
    expect(button).toHaveAccessibleDescription(
      expect.stringContaining('no document title') as string,
    );
    expect(button).not.toHaveAccessibleDescription(expect.stringContaining('language') as string);
    const list = screen.getByRole('list', { name: 'Accessibility notes in the body' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('p')?.textContent),
    ).toEqual([
      expect.stringContaining('PDF “course brochure”: This PDF isn’t tagged'),
      expect.stringContaining('PDF “course brochure”: This PDF has no document title.'),
    ]);
    // Read once, though two places point at it.
    expect(fetched).toEqual(['/_vesper/api/file?path=public%2Ffiles%2Funtagged-brochure.pdf']);
  });
});

describe('the notes drawer', () => {
  it('opens from the count in the top bar, lists notes by field, and goes to each', async () => {
    const user = open('#/c/fixtures/e/accessibility-mistakes', fixture);
    const count = await screen.findByRole('button', { name: '3 accessibility notes' });
    // The count isn't part of the live status, so typing doesn't announce each change.
    expect(count.closest('[role="status"]')).toBeNull();
    await user.click(count);
    const drawer = await screen.findByRole('dialog', { name: 'Accessibility notes' });
    expect(drawer).toHaveTextContent('Automated checks find some problems, not all.');
    const groups = within(drawer).getAllByRole('heading', { level: 3 });
    expect(groups.map((h) => h.textContent)).toEqual(['Text color', 'Body']);
    const goButtons = within(drawer).getAllByRole('button', { name: 'Go to field' });
    expect(goButtons).toHaveLength(3);
    expect(goButtons[0]).toHaveAccessibleDescription(
      expect.stringContaining('Contrast 2.3:1') as string,
    );
    await expectNoViolations();

    await user.click(goButtons[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Text color/ })).toHaveFocus();
    });

    await user.click(screen.getByRole('button', { name: '3 accessibility notes' }));
    const again = await screen.findByRole('dialog', { name: 'Accessibility notes' });
    await user.click(
      within(again).getAllByRole('button', { name: 'Go to field' })[2] as HTMLElement,
    );
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Body' })).toHaveFocus();
    });
  });

  it('works by keyboard: Enter opens it, Tab reaches each note, Escape returns to the count', async () => {
    const user = open('#/c/fixtures/e/accessibility-mistakes', fixture);
    const count = await screen.findByRole('button', { name: '3 accessibility notes' });
    count.focus();
    await user.keyboard('{Enter}');
    const drawer = await screen.findByRole('dialog', { name: 'Accessibility notes' });
    await waitFor(() => {
      expect(drawer).toContainElement(document.activeElement as HTMLElement);
    });
    await user.tab();
    expect(within(drawer).getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(document.activeElement).toHaveTextContent('Go to field');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(count).toHaveFocus();
    });
  });
});

describe('the publish gate', () => {
  function gated(rules: string[]): Manifest {
    const manifest = siteWithBackgrounds();
    manifest.site.a11y = { ...manifest.site.a11y, blockPublishOn: rules as never };
    return manifest;
  }

  it('warns only by default: a save goes through with notes', async () => {
    const api = fakeApi({ documents: { 'fixtures/accessibility-mistakes': fixture } });
    renderStudio('#/c/fixtures/e/accessibility-mistakes', { api, manifest: siteWithBackgrounds() });
    const user = userEvent.setup();
    await screen.findByRole('button', { name: '3 accessibility notes' });
    await user.type(screen.getByRole('textbox', { name: /Summary/ }), ' More.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
    });
  });

  it('refuses a save with a blocking note, says why and links to the field', async () => {
    const api = fakeApi({ documents: { 'fixtures/accessibility-mistakes': fixture } });
    renderStudio('#/c/fixtures/e/accessibility-mistakes', {
      api,
      manifest: gated(['heading-skip']),
    });
    const user = userEvent.setup();
    expect(
      await screen.findByRole('button', { name: '3 accessibility notes, 1 blocks saving' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const summary = await screen.findByRole('alert');
    expect(summary).toHaveFocus();
    const link = within(summary).getByRole('link', {
      name: 'Body, accessibility: Heading “A heading that skips level 3”: Heading jumps from level 2 to level 4.',
    });
    expect(link).toHaveAttribute('href', '#entry-body');
    expect(api.saveEntry).not.toHaveBeenCalled();
    // The Save button stays focusable, with its reason in the count beside it.
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    await expectNoViolations(summary);
  });

  it('checks the values as they are at the moment of saving', async () => {
    const api = fakeApi({ documents: { 'fixtures/accessibility-mistakes': fixture } });
    renderStudio('#/c/fixtures/e/accessibility-mistakes', { api, manifest: gated(['link-vague']) });
    const user = userEvent.setup();
    await screen.findByRole('button', { name: '3 accessibility notes, 1 blocks saving' });
    await user.click(screen.getByRole('button', { name: 'Edit as Markdoc' }));
    const source = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Body' });
    await user.clear(source);
    // user-event reads [ as a key name; [[ types one.
    await user.type(source, 'See [[the timetable](/academics/).');
    // Saved at once, before the pause after typing: the gate checks the new text.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
    });
  });
});
