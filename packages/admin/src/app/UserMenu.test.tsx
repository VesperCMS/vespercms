// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';
import type { Account } from '../types.ts';
import { APPEARANCE_KEY, applyAppearance, readAppearance } from './appearance.ts';

afterEach(() => {
  cleanup();
  window.location.hash = '';
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

const account = (extra: Partial<Account> = {}): Account => ({
  label: '@ada',
  name: 'Ada Lovelace',
  description: 'Signed in to GitHub as @ada',
  signOutLabel: 'Sign out of GitHub',
  signOut: vi.fn(),
  signInAgain: vi.fn(),
  expired: false,
  ...extra,
});

describe('the user menu', () => {
  it('in local mode, is named by git’s user and holds Appearance', async () => {
    const api = fakeApi({ person: 'Jeremy Bise' });
    renderStudio('#/', { api });
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Jeremy Bise' });
    await user.click(button);
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['System', 'Light', 'Dark']);
    expect(within(menu).queryByRole('menuitem')).toBeNull();
    expect(screen.getByText('Editing on this computer')).toBeInTheDocument();
    await expectNoViolations();
    expect(api.person).toHaveBeenCalledTimes(1);
  });

  it('in local mode without a git name, reads “You”', async () => {
    renderStudio('#/');
    expect(await screen.findByRole('button', { name: 'You' })).toBeInTheDocument();
  });

  it('applies and keeps a Light or Dark choice, and System clears it', async () => {
    renderStudio('#/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'You' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'You' }));
    expect(
      (await screen.findByRole('menuitemradio', { name: 'Dark' })).getAttribute('aria-checked'),
    ).toBe('true');
    await user.click(screen.getByRole('menuitemradio', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull();
  });

  it('follows the system when storage is refused', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('refused');
    });
    expect(readAppearance()).toBe('system');
    applyAppearance(readAppearance());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('when signed in, shows the picture beside the login, and the way out', async () => {
    const signedIn = account({ picture: 'https://avatars.example.test/u/1?s=64' });
    const api = fakeApi({ person: 'Not asked' });
    renderStudio('#/', { api, account: signedIn });
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: '@ada' });
    expect(button.querySelector('img')?.getAttribute('src')).toBe(
      'https://avatars.example.test/u/1?s=64',
    );
    await user.click(button);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out of GitHub' }));
    expect(signedIn.signOut).toHaveBeenCalled();
    // Git's name is local mode's alone.
    expect(api.person).not.toHaveBeenCalled();
  });

  it('shows initials when a picture fails to load', async () => {
    renderStudio('#/', { account: account({ picture: 'https://avatars.example.test/gone' }) });
    const img = screen.getByRole('button', { name: '@ada' }).querySelector('img');
    img?.dispatchEvent(new Event('error'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '@ada' }).textContent).toContain('AL');
    });
  });

  it('offers Sign in again once the sign-in has expired', () => {
    renderStudio('#/', { account: account({ expired: true }) });
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
  });
});
