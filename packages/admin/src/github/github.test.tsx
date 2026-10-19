// @vitest-environment jsdom
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitHubFake, type GitHubFake } from '../../../../scripts/github-fake.mjs';
import { expectNoViolations, playgroundManifest } from '../test/helpers.tsx';
import { GitHubGate } from './GitHubGate.tsx';
import type { GitHubStudioSettings } from './session.ts';

/*
 * GitHub mode in the studio (spec §6.8, §6.9) against the fake GitHub, whose
 * repository is real git seeded with the playground: the screens before the
 * studio, a finished sign-in through the relay, and an edit published as
 * one commit by the editor.
 */

// Tests run from the repository's root; jsdom's import.meta.url isn't a file URL.
const playground = join(process.cwd(), 'apps/playground');
const API = 'https://api.github.test';
const RELAY = 'https://relay.example.test';
const settings: GitHubStudioSettings = {
  owner: 'vesper',
  repo: 'site',
  branch: 'main',
  root: '',
  relay: RELAY,
  apiUrl: API,
  // The schemas can't load here: the field model's checks stand in.
  schemas: '/_vesper/schemas.js',
};

const dirs: string[] = [];
let fake: GitHubFake;

/** The fake GitHub for API calls, and a relay whose /token answers with the fake's token. */
const fetcher: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  if (request.url === `${RELAY}/token`) {
    const body = (await request.json()) as { code?: string; code_verifier?: string };
    if (body.code !== 'good-code' || !body.code_verifier) {
      return Response.json({ message: 'GitHub didn’t sign you in. Try again.' }, { status: 400 });
    }
    return Response.json({ token: fake.state.token, expiresIn: 28800 });
  }
  return fake.handle(request);
};

const options = { manifest: playgroundManifest, siteName: 'Playground', siteUrl: '/' };

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-studio-github-'));
  dirs.push(dir);
  fake = createGitHubFake({ dir: join(dir, 'repo.git') });
  fake.seedFolder(playground);
  sessionStorage.clear();
  window.history.replaceState(null, '', '/admin/');
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function signedIn() {
  sessionStorage.setItem(
    'vesper.github.session',
    JSON.stringify({ token: fake.state.token, expiresAt: Date.now() + 8 * 3600 * 1000 }),
  );
}

describe('GitHub mode in the studio', () => {
  it('asks to sign in, saying where changes go, and passes axe', async () => {
    render(<GitHubGate settings={settings} options={options} fetcher={fetcher} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in to edit this site' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You’ll publish to vesper\/site on GitHub/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    await expectNoViolations();
  });

  it('finishes a sign-in from the relay, and takes the code out of the address', async () => {
    sessionStorage.setItem(
      'vesper.github.pending',
      JSON.stringify({ state: 'abc', verifier: 'v'.repeat(43), route: '#/c/blog' }),
    );
    window.history.replaceState(null, '', '/admin/?github=good-code&state=abc');
    render(<GitHubGate settings={settings} options={options} fetcher={fetcher} />);
    expect(
      await screen.findByRole('button', { name: '@editor' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#/c/blog');
    expect(JSON.parse(sessionStorage.getItem('vesper.github.session') ?? '{}')).toMatchObject({
      token: fake.state.token,
    });
  });

  it('refuses a sign-in that didn’t start in this tab', async () => {
    window.history.replaceState(null, '', '/admin/?github=good-code&state=forged');
    render(<GitHubGate settings={settings} options={options} fetcher={fetcher} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That sign-in didn’t start here. Try again.',
    );
    expect(sessionStorage.getItem('vesper.github.session')).toBeNull();
  });

  it('tells an editor who can’t push, plainly, with a way out', async () => {
    fake.state.push = false;
    signedIn();
    render(<GitHubGate settings={settings} options={options} fetcher={fetcher} />);
    expect(
      await screen.findByRole('heading', { name: 'Your GitHub account can’t change this site' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/signed in to GitHub as @editor/)).toBeInTheDocument();
    await expectNoViolations();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out of GitHub' }));
    expect(await screen.findByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    expect(sessionStorage.getItem('vesper.github.session')).toBeNull();
  });

  it('publishes an edit as one commit by the editor, and says when it will be live', async () => {
    signedIn();
    window.history.replaceState(null, '', '/admin/#/c/blog/e/harbor-at-dawn');
    render(<GitHubGate settings={settings} options={options} fetcher={fetcher} />);
    const user = userEvent.setup();
    const title = await screen.findByRole(
      'textbox',
      { name: 'Title (required)' },
      { timeout: 10_000 },
    );
    await user.type(title, ', again');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(
      await screen.findByText(
        'Published. It will be live after the site is next built.',
        undefined,
        {
          timeout: 10_000,
        },
      ),
    ).toBeInTheDocument();
    const [latest] = fake.log();
    expect(latest?.author).toBe('editor');
    expect(latest?.message).toBe(
      'Update "Harbor at dawn, again" in Blog posts\n\nVesper-Collection: blog',
    );
    expect(latest?.changed).toEqual(['M\tsrc/content/blog/harbor-at-dawn.md']);
  });

  it('keeps unsaved changes when the sign-in expires mid-edit', async () => {
    signedIn();
    window.history.replaceState(null, '', '/admin/#/c/blog/e/harbor-at-dawn');
    render(<GitHubGate settings={settings} options={options} fetcher={fetcher} />);
    const user = userEvent.setup();
    const title = await screen.findByRole(
      'textbox',
      { name: 'Title (required)' },
      { timeout: 10_000 },
    );
    await user.type(title, ', later');
    fake.state.token = 'a-new-token-the-studio-doesnt-have';
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const alert = await screen.findByRole('alert', undefined, { timeout: 10_000 });
    expect(alert).toHaveTextContent(
      'Your GitHub sign-in has expired. Sign in again to publish. Your changes are kept.',
    );
    expect(within(alert).getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(sessionStorage.getItem('vesper.kept') ?? '{}')).toMatchObject({
        collection: 'blog',
        id: 'harbor-at-dawn',
      });
    });
  });
});
