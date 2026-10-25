// @vitest-environment jsdom
import type { MoveResult, PageTree as Tree, PageTreeNode } from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANES } from '../app/panes.tsx';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';
import { planText } from './PageTree.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const P = 'src/content/pages/';
const node = (
  path: string,
  title: string,
  children: PageTreeNode[] = [],
  extra: Partial<PageTreeNode> = {},
): PageTreeNode => ({
  path,
  slug: path.slice(path.lastIndexOf('/') + 1),
  title,
  id: path || 'index',
  url: path ? `/${path}/` : '/',
  depth: path ? path.split('/').length : 0,
  file: `${P}${path || 'index'}.md`,
  version: `v-${path}`,
  status: 'editable',
  children,
  ...extra,
});

const tree: Tree = {
  collection: 'pages',
  nodes: [
    node('', 'Vesper playground'),
    node('about', 'About the college'),
    node('academics', 'Academics', [
      node('academics/nursing', 'Nursing', [
        node('academics/nursing/rn-to-bsn', 'RN to BSN bridge'),
      ]),
      node('academics/business', 'Business'),
    ]),
    {
      path: 'admissions',
      slug: 'admissions',
      title: 'Admissions',
      url: null,
      depth: 1,
      children: [node('admissions/apply', 'How to apply')],
    },
  ],
};

function setup() {
  const api = fakeApi({
    trees: { pages: tree },
    pages: [{ collection: 'pages', id: 'about', title: 'About the college', url: '/about/' }],
  });
  const view = renderStudio('#/c/pages', { api });
  return { api, view };
}

describe('the page outline (spec §6.15.2)', () => {
  it('is a treegrid, collapsed beyond the first level, with status in words', async () => {
    setup();
    const grid = await screen.findByRole('treegrid', { name: 'Pages' });
    await within(grid).findByRole('row', { name: 'Academics' });
    const rows = within(grid).getAllByRole('row');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Vesper playground',
      'About the college',
      'Academics',
      'Admissions',
    ]);
    expect(rows[2]).toHaveAttribute('aria-expanded', 'false');
    expect(rows[2]).toHaveAttribute('aria-level', '1');
    expect(within(rows[3] as HTMLElement).getByText('No section page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New page' })).toHaveAttribute('href', '#/c/pages/new');
    await expectNoViolations();
  });

  it('expands with the arrow keys and opens a page with Enter', async () => {
    const user = userEvent.setup();
    setup();
    const grid = await screen.findByRole('treegrid', { name: 'Pages' });
    await within(grid).findByRole('row', { name: 'Academics' });
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    const first = within(grid).getAllByRole('row')[0] as HTMLElement;
    first.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}');
    const academics = within(grid).getByRole('row', { name: 'Academics' });
    expect(academics).toHaveAttribute('aria-expanded', 'true');
    expect(within(grid).getByRole('row', { name: 'Nursing' })).toHaveAttribute('aria-level', '2');
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/pages/e/academics%2Fnursing');
    });
  });

  it('moves a page with Alt+arrow keys and says where it went', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    api.reorderPage.mockResolvedValue({ ok: true, position: { index: 3, of: 3 } });
    const grid = await screen.findByRole('treegrid', { name: 'Pages' });
    (await within(grid).findByRole('row', { name: 'Academics' })).focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(api.reorderPage).toHaveBeenCalledWith({
      collection: 'pages',
      path: 'academics',
      direction: 'down',
    });
    await waitFor(() => {
      expect(screen.getByText('Academics moved down, position 3 of 3.')).toBeInTheDocument();
    });
  });

  it('offers every action in the row’s menu, and Move to… confirms in plain language', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const plan: MoveResult = {
      ok: true,
      path: 'nursing',
      id: 'nursing',
      title: 'Nursing',
      pages: 2,
      links: 3,
      redirects: 2,
      from: '/academics/nursing/',
      to: '/nursing/',
      parent: null,
      position: { index: 4, of: 4 },
    };
    api.movePage.mockResolvedValue(plan);
    (await screen.findByRole('row', { name: 'Academics' })).focus();
    await user.keyboard('{ArrowRight}');
    await user.click(await screen.findByRole('button', { name: 'More actions for Nursing' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Open', 'Add child page', 'Move to…', 'Move up', 'Move down', 'Delete…']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Move to…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move “Nursing”' });
    await expectNoViolations();
    await user.click(within(dialog).getByRole('combobox', { name: 'Put it under' }));
    await user.click(await screen.findByRole('option', { name: 'Top level' }));
    await user.click(within(dialog).getByRole('button', { name: 'Review move' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Move “Nursing”?' });
    expect(confirm).toHaveTextContent(
      'This moves “Nursing” and its 1 page to the top level. Its address becomes /nursing/. 3 links on other pages will be updated. Visitors to the old addresses will be sent to the new ones.',
    );
    expect(api.movePage).toHaveBeenLastCalledWith(
      { collection: 'pages', path: 'academics/nursing', parent: '', slug: 'nursing' },
      { dryRun: true },
    );
    await user.click(within(confirm).getByRole('button', { name: 'Move' }));
    await waitFor(() => {
      expect(
        screen.getByText('Nursing moved to the top level, position 4 of 4.'),
      ).toBeInTheDocument();
    });
    expect(api.movePage).toHaveBeenLastCalledWith({
      collection: 'pages',
      path: 'academics/nursing',
      parent: '',
      slug: 'nursing',
    });
  });

  it('shows a refusal in the dialog, in words', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    api.movePage.mockResolvedValue({
      ok: false,
      reason: 'invalid',
      message:
        '/contact/ is already a page on this site that isn’t edited here (src/pages/contact.astro). Choose a different address.',
    });
    await screen.findByRole('row', { name: 'Academics' });
    await user.click(screen.getByRole('button', { name: 'More actions for About the college' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move “About the college”' });
    const address = within(dialog).getByRole('textbox', { name: 'Address' });
    await user.clear(address);
    await user.type(address, 'contact');
    await user.click(within(dialog).getByRole('button', { name: 'Review move' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '/contact/ is already a page on this site that isn’t edited here',
    );
  });

  it('adds a child page and creates a missing section page from the menu', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await screen.findByRole('row', { name: 'Academics' });
    await user.click(screen.getByRole('button', { name: 'More actions for About the college' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Add child page' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/pages/new/about');
    });
    expect(
      await screen.findByText(/This page will go under “About the college”/),
    ).toBeInTheDocument();

    window.location.hash = '#/c/pages';
    await user.click(await screen.findByRole('button', { name: 'More actions for Admissions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Create section page' }));
    expect(api.createSection).toHaveBeenCalledWith('pages', 'admissions');
  });
});

describe('the page outline among panes', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === PANES,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  });

  it('marks the page open beside it, with its folders open, and New page heads the pane', async () => {
    const id = 'academics/nursing/rn-to-bsn';
    renderStudio(`#/c/pages/e/${encodeURIComponent(id)}`, {
      api: fakeApi({
        trees: { pages: tree },
        documents: {
          [`pages/${id}`]: {
            collection: 'pages',
            id,
            path: `${P}${id}.md`,
            version: 'v1',
            format: 'md',
            status: 'editable',
            data: { title: 'RN to BSN bridge' },
            body: '\nText.\n',
          },
        },
      }),
    });
    const pane = await screen.findByRole('navigation', { name: 'Pages' });
    expect(
      await within(pane).findByRole('row', { name: 'RN to BSN bridge, open now' }),
    ).toBeInTheDocument();
    expect(within(pane).getByRole('row', { name: 'Academics' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(pane).getByRole('row', { name: 'Nursing' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(pane).getByRole('link', { name: 'New page' })).toHaveAttribute(
      'href',
      '#/c/pages/new',
    );
    await expectNoViolations();
  });
});

describe('planText', () => {
  it('says what moves and what changes with it', () => {
    expect(
      planText({
        ok: true,
        path: 'academics/about',
        id: 'academics/about',
        title: 'About',
        pages: 1,
        links: 1,
        redirects: 1,
        from: '/about/',
        to: '/academics/about/',
        parent: 'Academics',
        position: { index: 1, of: 2 },
      }),
    ).toBe(
      'This moves “About” under “Academics”. Its address becomes /academics/about/. 1 link on other pages will be updated. Visitors to the old addresses will be sent to the new ones.',
    );
  });
});
