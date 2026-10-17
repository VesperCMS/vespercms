// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
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
