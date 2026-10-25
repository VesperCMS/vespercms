// @vitest-environment jsdom
import type { EntryDocument, Manifest } from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';
import { itemNames, itemSummary } from './group.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const page = (sections: object[]): EntryDocument => ({
  collection: 'pages',
  id: 'campus-life',
  path: 'src/content/pages/campus-life.mdx',
  version: 'v1',
  format: 'mdx',
  status: 'editable',
  data: { title: 'Campus life', sections },
  body: '\n',
});

const three = [
  { heading: 'Clubs', body: 'Over **forty** of them.' },
  { heading: 'Sports', body: 'Teams for every season.' },
  { heading: 'Arts', body: 'Studios open late.' },
];

function open(sections: object[], manifest?: Manifest) {
  const api = fakeApi({ documents: { 'pages/campus-life': page(sections) } });
  return renderStudio('#/c/pages/e/campus-life', { api, ...(manifest ? { manifest } : {}) });
}

describe('list items as rows', () => {
  it('names a row by its content, with the next text after it, and keeps its fields hidden until opened', async () => {
    open(three);
    const user = userEvent.setup();
    const clubs = await screen.findByRole('button', { name: 'Clubs, Over forty of them.' });
    expect(clubs).toHaveAttribute('aria-expanded', 'false');
    // Closed, the item's fields stay in the page, hidden, so find and Go to field can reach them.
    const panel = document.getElementById(clubs.getAttribute('aria-controls') ?? '');
    expect(panel).toHaveAttribute('hidden');
    expect(panel?.querySelector('input')).toHaveValue('Clubs');
    await user.click(clubs);
    expect(clubs).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'Clubs' });
    expect(within(group).getByRole('textbox', { name: 'Heading' })).toHaveValue('Clubs');
    await expectNoViolations();
  });

  it('opens and closes them all at once, from three items', async () => {
    open(three);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Open all' }));
    for (const name of ['Clubs', 'Sports', 'Arts']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }
    await user.click(screen.getByRole('button', { name: 'Close all' }));
    expect(screen.getByRole('button', { name: /^Arts/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows no Open all for one or two items', async () => {
    open(three.slice(0, 2));
    await screen.findByRole('button', { name: /^Clubs/ });
    expect(screen.queryByRole('button', { name: 'Open all' })).toBeNull();
  });

  it('opens a row’s menu with Shift+F10, and duplicates an item after itself', async () => {
    open(three);
    const user = userEvent.setup();
    const sports = await screen.findByRole('button', { name: /^Sports/ });
    sports.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const duplicate = await screen.findByRole('menuitem', { name: 'Duplicate' });
    await user.click(duplicate);
    expect(screen.getByText('Duplicated Sports as section 3.')).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual([
      'Clubs, Over forty of them.',
      'Sports, Teams for every season.',
      'Sports, Teams for every season.',
      'Arts, Studios open late.',
    ]);
  });

  it('opens the item around a field the error summary goes to', async () => {
    const api = fakeApi({ documents: { 'pages/campus-life': page(three) } });
    api.saveEntry.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid',
      issues: [{ path: ['sections', 2, 'heading'], message: 'Add a heading.' }],
    });
    renderStudio('#/c/pages/e/campus-life', { api });
    const user = userEvent.setup();
    const arts = await screen.findByRole('button', { name: /^Arts/ });
    await user.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    // The refused save opens it; close it again, then go to the field from the summary.
    await waitFor(() => {
      expect(arts).toHaveAttribute('aria-expanded', 'true');
    });
    await user.click(arts);
    expect(arts).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('link', { name: /Add a heading/ }));
    await waitFor(() => {
      expect(arts).toHaveAttribute('aria-expanded', 'true');
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole('group', { name: 'Arts' })).getByRole('textbox', {
          name: 'Heading',
        }),
      ).toHaveFocus();
    });
  });

  it('names rows by the summary hint when the guess would pick the wrong field', async () => {
    const manifest = structuredClone(playgroundManifest);
    const sections = manifest.collections
      .find((c) => c.name === 'pages')
      ?.fields?.find((f) => f.path[0] === 'sections');
    if (!sections) throw new Error('no sections');
    sections.summary = 'body';
    open(three, manifest);
    expect(
      await screen.findByRole('button', { name: /^Over forty of them\./ }),
    ).toBeInTheDocument();
  });
});

describe('item names', () => {
  it('come from the list’s label, its item’s own label, or a numbered fallback', () => {
    const list = (label: string, itemLabel = 'Item') => ({
      path: ['x'],
      kind: 'array' as const,
      label,
      required: false,
      children: [{ path: ['x', '[]'], kind: 'object' as const, label: itemLabel, required: true }],
    });
    expect(itemNames(list('Points'))).toEqual({ one: 'point', many: 'points' });
    expect(itemNames(list('Opening hours'))).toEqual({
      one: 'opening hour',
      many: 'opening hours',
    });
    expect(itemNames(list('Address'))).toEqual({ one: 'address', many: 'address' });
    expect(itemNames(list('Team', 'Person'))).toEqual({ one: 'person', many: 'team' });
    expect(itemSummary({}, 2, list('Points')).name).toBe('Point 3');
    expect(itemSummary({ title: '  `Code` and _more_ ' }, 0, list('Points')).name).toBe(
      'Code and more',
    );
  });
});
