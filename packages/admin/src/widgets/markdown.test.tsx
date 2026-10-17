// @vitest-environment jsdom
import type { EntryDocument, SaveRequest } from '@vesper/core';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const about: EntryDocument = {
  collection: 'pages',
  id: 'about',
  path: 'src/content/pages/about.md',
  version: 'v1',
  format: 'md',
  status: 'editable',
  data: {
    title: 'About the college',
    sections: [
      {
        heading: 'Our mission',
        body: 'Open doors, *practical* degrees, and a campus where people know your name.',
      },
      { heading: 'Accreditation', body: '# Not inline\n\nTwo paragraphs.' },
    ],
  },
  body: '\n',
};

describe('the compact Markdown field', () => {
  it('shows formatting, and edits as Markdown only where it changes', async () => {
    const api = fakeApi({ documents: { 'pages/about': about } });
    renderStudio('#/c/pages/e/about', { api });
    const user = userEvent.setup();
    // The editor loads on first use, then fills in; query afresh until it has.
    await waitFor(
      () => {
        const [first] = screen.getAllByRole('textbox', { name: 'Body (required)' });
        expect(first?.querySelector('em')).toHaveTextContent('practical');
      },
      { timeout: 5000 },
    );
    expect(screen.getAllByRole('toolbar', { name: 'Formatting for Body' }).length).toBeGreaterThan(
      0,
    );

    // Nothing is rewritten by opening the entry.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const saved = api.saveEntry.mock.calls[0]?.[0] as SaveRequest & { data: typeof about.data };
    expect(saved.data).toEqual(about.data);
    await expectNoViolations();
  });

  it('falls back to plain text for Markdown it can’t show in one line, and says so', async () => {
    renderStudio('#/c/pages/e/about', { api: fakeApi({ documents: { 'pages/about': about } }) });
    const fallback = await screen.findByText(
      'This uses Markdown the compact editor can’t show, so it’s edited as text.',
    );
    expect(fallback).toBeInTheDocument();
    expect(screen.getByDisplayValue(/# Not inline/)).toBeInTheDocument();
  });
});
