// @vitest-environment jsdom
import type { RedirectsDocument } from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const doc: RedirectsDocument = {
  version: 'v1',
  redirects: [
    {
      from: '/programs/nursing',
      to: '/academics/nursing',
      status: 301,
      reason: 'move',
      at: { $date: '2026-09-02T00:00:00.000Z' },
    },
    { from: '/apply-now', to: '/admissions/apply', status: 302, reason: 'manual' },
  ],
  warnings: [
    {
      kind: 'missing-target',
      from: '/gone',
      to: '/nowhere',
      message: '/gone redirects to /nowhere, which isn’t a page on this site.',
    },
  ],
};

function setup() {
  const api = fakeApi({
    redirects: doc,
    pages: [
      { collection: 'pages', id: 'campus-life', title: 'Campus life', url: '/campus-life/' },
      { collection: 'pages', id: 'about', title: 'About the college', url: '/about/' },
    ],
  });
  renderStudio('#/redirects', { api });
  return api;
}

describe('the Redirects screen (spec §6.15.5)', () => {
  it('lists redirects with their kind in words, and what needs a look', async () => {
    setup();
    const table = await screen.findByRole('grid', { name: 'Redirects' });
    const row = within(table).getByRole('row', { name: /\/apply-now/ });
    expect(row).toHaveTextContent('/admissions/apply');
    expect(row).toHaveTextContent('Temporary');
    expect(row).toHaveTextContent('Added here');
    expect(within(table).getByRole('row', { name: /\/programs\/nursing/ })).toHaveTextContent(
      'Permanent',
    );
    expect(screen.getByRole('heading', { name: 'Needs a look' })).toBeInTheDocument();
    expect(screen.getByText('/gone redirects to /nowhere, which isn’t a page on this site.'));
    expect(screen.getAllByRole('button', { name: 'Add redirect' })).toHaveLength(1);
    await expectNoViolations();
  });

  it('adds a redirect to a page found by title', async () => {
    const user = userEvent.setup();
    const api = setup();
    await screen.findByRole('grid', { name: 'Redirects' });
    await user.click(screen.getByRole('button', { name: 'Add redirect' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a redirect' });
    await expectNoViolations();
    await user.type(within(dialog).getByRole('textbox', { name: 'Old address' }), 'visit');
    await user.type(within(dialog).getByRole('combobox', { name: 'Goes to' }), 'campus');
    await user.click(await screen.findByRole('option', { name: /Campus life/ }));
    expect(within(dialog).getByRole('combobox', { name: 'Goes to' })).toHaveValue('/campus-life/');
    await user.click(within(dialog).getByRole('radio', { name: /Temporary/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add redirect' }));
    await waitFor(() => {
      expect(api.saveRedirects).toHaveBeenCalled();
    });
    const request = api.saveRedirects.mock.calls[0]?.[0];
    expect(request?.version).toBe('v1');
    expect(request?.redirects.at(-1)).toMatchObject({
      from: '/visit',
      to: '/campus-life/',
      status: 302,
      reason: 'manual',
    });
    expect(await screen.findByText('Added a redirect from /visit.')).toBeInTheDocument();
  });

  it('previews a CSV import before anything is saved', async () => {
    const user = userEvent.setup();
    const api = setup();
    await screen.findByRole('grid', { name: 'Redirects' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const csv =
      'source,target,regex,code\n/apply-now,/admissions/apply,0,301\n/old,/about,0,301\n/x/(.*),/y,1,301\n';
    await user.upload(input, new File([csv], 'redirection.csv', { type: 'text/csv' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import redirection.csv' });
    expect(dialog).toHaveTextContent('1 new redirect, and 1 that replace one already here.');
    expect(dialog).toHaveTextContent(
      'Row 4: Pattern redirects can’t be imported. Add the addresses it covers one by one.',
    );
    expect(api.saveRedirects).not.toHaveBeenCalled();
    await expectNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Import 2 redirects' }));
    await waitFor(() => {
      expect(api.saveRedirects).toHaveBeenCalled();
    });
    const saved = api.saveRedirects.mock.calls[0]?.[0].redirects ?? [];
    expect(saved).toHaveLength(3);
    expect(saved[1]).toMatchObject({
      from: '/apply-now',
      to: '/admissions/apply',
      status: 301,
      reason: 'import',
    });
    expect(saved[2]).toMatchObject({ from: '/old', to: '/about', reason: 'import' });
  });

  it('is reached from the Site menu', async () => {
    const user = userEvent.setup();
    renderStudio('#/', { api: fakeApi() });
    await user.click(await screen.findByRole('button', { name: 'Site' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Redirects' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Redirects' })).toBeInTheDocument();
  });
});
