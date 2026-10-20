// @vitest-environment jsdom
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorizeUrl, createPkce } from '@vesper/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCloudFake, type CloudFake } from '../../../../scripts/cloud-fake.mjs';
import { createGitHubFake, type GitHubFake } from '../../../../scripts/github-fake.mjs';
import { keyValueStore, type KeyValueStore } from '../app/idb.ts';
import { expectNoViolations, playgroundManifest } from '../test/helpers.tsx';
import { CloudGate } from './CloudGate.tsx';
import type { CloudSettings, StoredSession } from './session.ts';

/*
 * The studio connected to the cloud (spec §6.9) against the fake cloud,
 * which publishes to a fake GitHub over real git seeded with the
 * playground: signing in, staying signed in, and saves as drafts.
 */

const playground = join(process.cwd(), 'apps/playground');
const ORIGIN = window.location.origin;

const dirs: string[] = [];
let seeded: string;
let github: GitHubFake;
let cloud: CloudFake;
let settings: CloudSettings;
let store: KeyValueStore<StoredSession>;
let storeCount = 0;

const options = { manifest: playgroundManifest, siteName: 'Playground', siteUrl: '/' };

// Seeding starts a git process per file, so the playground is seeded once and copied per test.
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-studio-cloud-'));
  dirs.push(dir);
  seeded = join(dir, 'seeded.git');
  createGitHubFake({ dir: seeded, login: 'vesper[bot]' }).seedFolder(playground);
}, 60_000);

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-studio-cloud-'));
  dirs.push(dir);
  cpSync(seeded, join(dir, 'repo.git'), { recursive: true });
  github = createGitHubFake({ dir: join(dir, 'repo.git'), login: 'vesper[bot]' });
  cloud = createCloudFake({
    github,
    manifest: playgroundManifest,
    site: { id: 'site_playground', name: 'Playground', origins: [ORIGIN] },
    people: [
      { id: 'u_admin', name: 'Ada Admin', email: 'ada@example.edu', role: 'admin' },
      {
        id: 'u_editor',
        name: 'Eve Editor',
        email: 'eve@example.edu',
        role: 'editor',
        grants: [{ collection: 'blog' }],
      },
      {
        id: 'u_contributor',
        name: 'Cal Contributor',
        email: 'cal@example.edu',
        role: 'contributor',
      },
      { id: 'u_viewer', name: 'Vi Viewer', email: 'vi@example.edu', role: 'viewer' },
    ],
  });
  settings = { ...cloud.settings, schemas: '/_vesper/schemas.js' };
  // A store of its own per test: without IndexedDB in jsdom it keeps sessions in memory.
  store = keyValueStore<StoredSession>(`vesper-cloud-test-${String(++storeCount)}`, 'sessions');
  sessionStorage.clear();
  window.history.replaceState(null, '', '/admin/');
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Comes back from the app's sign-in as `person`, as the browser would after the redirect. */
async function returnFromSignIn(person: string, route = '#/'): Promise<void> {
  cloud.state.signedIn = person;
  const { verifier, challenge } = await createPkce();
  sessionStorage.setItem(
    'vesper.cloud.pending',
    JSON.stringify({ state: 'st_test', verifier, route }),
  );
  const answer = await cloud.fetch(
    authorizeUrl(settings, { redirectUri: `${ORIGIN}/admin/`, state: 'st_test', challenge }),
  );
  const location = answer.headers.get('location') ?? '';
  window.history.replaceState(null, '', location.slice(location.indexOf('/admin/')));
}

const gate = () => (
  <CloudGate settings={settings} options={options} fetcher={cloud.fetch} store={store} />
);

describe('the studio and the cloud', () => {
  it('asks to sign in with Vesper, offering GitHub too where the site has it, and passes axe', async () => {
    render(
      <CloudGate
        settings={settings}
        github={{
          owner: 'vesper',
          repo: 'site',
          branch: 'main',
          root: '',
          relay: 'https://relay.example.test',
          schemas: '/_vesper/schemas.js',
        }}
        options={options}
        fetcher={cloud.fetch}
        store={store}
      />,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in to edit this site' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Vesper' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    await expectNoViolations();
  });

  it('finishes a sign-in, returns to the screen it began on, and takes the code out of the address', async () => {
    await returnFromSignIn('u_admin', '#/c/blog');
    render(gate());
    expect(
      await screen.findByRole('button', { name: 'Ada Admin' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('#/c/blog');
    expect(window.location.href).not.toContain('code=');
    expect((await store.get('site_playground'))?.tokens).toMatchObject({
      access: expect.any(String) as unknown,
    });
  });

  it('refuses a sign-in that didn’t start in this tab', async () => {
    await returnFromSignIn('u_admin');
    sessionStorage.clear();
    render(gate());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That sign-in didn’t start here. Try again.',
    );
  });

  it('stays signed in across a reload, with the member’s current role', async () => {
    await returnFromSignIn('u_editor');
    const first = render(gate());
    await screen.findByRole('button', { name: 'Eve Editor' }, { timeout: 10_000 });
    first.unmount();
    // In the dashboard meanwhile, Eve became a viewer.
    cloud.setMember('u_editor', { role: 'viewer' });
    window.history.replaceState(null, '', '/admin/');
    render(gate());
    await screen.findByRole('button', { name: 'Eve Editor' }, { timeout: 10_000 });
    expect((await store.get('site_playground'))?.member).toMatchObject({ role: 'viewer' });
  });

  it('says plainly when the cloud can’t be reached, and tries again', async () => {
    await returnFromSignIn('u_admin');
    const first = render(gate());
    await screen.findByRole('button', { name: 'Ada Admin' }, { timeout: 10_000 });
    first.unmount();
    window.history.replaceState(null, '', '/admin/');
    let down = true;
    const fetcher: typeof fetch = (input, init) =>
      down ? Promise.reject(new TypeError('Failed to fetch')) : cloud.fetch(input, init);
    render(<CloudGate settings={settings} options={options} fetcher={fetcher} store={store} />);
    expect(
      await screen.findByRole('heading', { name: 'Vesper couldn’t be reached' }),
    ).toBeInTheDocument();
    await expectNoViolations();
    down = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', { name: 'Ada Admin' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });

  it('signs out here and in the cloud', async () => {
    await returnFromSignIn('u_admin');
    render(gate());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ada Admin' }, { timeout: 10_000 }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out of Vesper' }));
    expect(await screen.findByRole('button', { name: 'Sign in with Vesper' })).toBeInTheDocument();
    expect(await store.get('site_playground')).toBeUndefined();
    await waitFor(() => {
      expect(cloud.state.log.some((line) => line.startsWith('POST /api/sign-out'))).toBe(true);
    });
  });
});
