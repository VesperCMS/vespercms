// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';
import { App } from './App.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('the studio shell', () => {
  it('lists collections and singletons with counts and last edits', async () => {
    const api = fakeApi({
      summary: [
        {
          collection: 'blog',
          count: 4,
          updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
        },
        { collection: 'authors', count: 1 },
        {
          collection: 'settings',
          count: 1,
          updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
        },
      ],
    });
    renderStudio('#/', { api });

    expect(screen.getByRole('heading', { level: 1, name: 'Content' })).toBeInTheDocument();
    expect(await screen.findByText('4 entries · edited 3 hours ago')).toBeInTheDocument();
    expect(screen.getByText('1 entry')).toBeInTheDocument();
    // Singletons sit under their own heading and don't show a count.
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('edited yesterday')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Blog posts' })).toHaveAttribute('href', '#/c/blog');
    expect(document.title).toBe('Content · Playground');
    await expectNoViolations();
  });

  it('shows Vesper’s mark before the site’s name, and names the home link by the site alone', () => {
    renderStudio('#/');
    const home = screen.getByRole('link', { name: 'Playground' });
    expect(home).toHaveAttribute('href', '#/');
    expect(home.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows a site’s name as written, and only Vesper’s own in lowercase', () => {
    const { unmount } = renderStudio('#/', { siteName: 'Highlands College' });
    expect(screen.getByRole('link', { name: 'Highlands College' })).not.toHaveClass('lowercase');
    unmount();
    render(<App manifest={playgroundManifest} api={fakeApi()} />);
    expect(screen.getByRole('link', { name: 'Vesper' })).toHaveClass('lowercase');
  });

  it('leaves focus alone on load in StrictMode, and moves it to the heading on navigation', async () => {
    // mountStudio renders in StrictMode, which runs effects twice on mount in development.
    window.location.hash = '#/';
    render(
      <StrictMode>
        <App manifest={playgroundManifest} siteName="Playground" api={fakeApi()} />
      </StrictMode>,
    );
    const heading = await screen.findByRole('heading', { level: 1, name: 'Content' });
    expect(heading).not.toHaveFocus();
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();

    act(() => {
      window.location.hash = '#/media';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Media' })).toHaveFocus();
    });
  });

  it('starts with a skip link that moves focus to the content', async () => {
    renderStudio('#/');
    const user = userEvent.setup();
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(document.getElementById('main')).toHaveFocus();
    // The route is untouched: the skip link doesn't navigate.
    expect(window.location.hash).toBe('#/');
  });

  it('opens a collection from the Content menu by keyboard, and focuses the new heading', async () => {
    renderStudio('#/');
    const user = userEvent.setup();
    act(() => {
      screen.getByRole('button', { name: 'Content' }).focus();
    });
    // ArrowDown opens the menu on its first item.
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('menu', { name: 'Content' })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(window.location.hash).toBe('#/c/authors');
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    });
  });

  it('says so when a route does not exist', async () => {
    renderStudio('#/nowhere');
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument();
    await expectNoViolations();
  });

  it('shows a plain explanation when there is no back end', async () => {
    renderStudio('#/', { api: null });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Editing isn’t available here yet' }),
    ).toBeInTheDocument();
    await expectNoViolations();
  });

  it('reports a failed summary inline and still lists collections', async () => {
    const api = fakeApi();
    api.summary.mockRejectedValue(new Error('The dev server stopped.'));
    renderStudio('#/', { api });
    expect(await screen.findByRole('alert')).toHaveTextContent('The dev server stopped.');
    expect(screen.getByRole('link', { name: 'Blog posts' })).toBeInTheDocument();
  });

  it('follows the hash when it changes', async () => {
    renderStudio('#/');
    act(() => {
      window.location.hash = '#/nowhere';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument();
  });
});
