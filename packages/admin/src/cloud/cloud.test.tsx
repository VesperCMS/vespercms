// @vitest-environment jsdom
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudClient, authorizeUrl, createDpopKey, createPkce, encodeChange } from '@vesper/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudFake, type CloudFake } from '../../../../scripts/cloud-fake.mjs';
import { createGitHubFake, type GitHubFake } from '../../../../scripts/github-fake.mjs';
import { keyValueStore, type KeyValueStore } from '../app/idb.ts';
import { PANES } from '../app/panes.tsx';
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
      {
        id: 'u_nurse',
        name: 'Nia Nursing',
        email: 'nia@example.edu',
        role: 'editor',
        grants: [{ collection: 'pages', match: 'academics/nursing/**' }],
      },
      { id: 'u_viewer', name: 'Vi Viewer', email: 'vi@example.edu', role: 'viewer' },
    ],
  });
  settings = { ...cloud.settings, schemas: '/_vesper/schemas.js' };
  // A store of its own per test: without IndexedDB in jsdom it keeps sessions in memory.
  store = keyValueStore<StoredSession>(`vesper-cloud-test-${String(++storeCount)}`, 'sessions');
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, '', '/admin/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Comes back from the app's sign-in as `person`, as the browser would after
 * the redirect. `started` is when the studio sent the browser away.
 */
async function returnFromSignIn(person: string, route = '#/', started = Date.now()): Promise<void> {
  cloud.state.signedIn = person;
  const { verifier, challenge } = await createPkce();
  localStorage.setItem(
    'vesper.cloud.pending.st_test',
    JSON.stringify({ state: 'st_test', verifier, route, started }),
  );
  const answer = await cloud.fetch(
    authorizeUrl(settings, { redirectUri: `${ORIGIN}/admin/`, state: 'st_test', challenge }),
  );
  const location = answer.headers.get('location') ?? '';
  window.history.replaceState(null, '', location.slice(location.indexOf('/admin/')));
}

/** A client signed in as `person`, for setting up drafts and reviews outside the studio. */
async function clientAs(person: string): Promise<CloudClient> {
  cloud.state.signedIn = person;
  const { verifier, challenge } = await createPkce();
  const redirectUri = `${ORIGIN}/admin/`;
  const answer = await cloud.fetch(
    authorizeUrl(settings, { redirectUri, state: 'st_api', challenge }),
  );
  const location = answer.headers.get('location') ?? '';
  const code = new URLSearchParams(location.slice(location.indexOf('?') + 1)).get('code') ?? '';
  const client = new CloudClient({ settings, key: await createDpopKey(), fetch: cloud.fetch });
  await client.exchangeCode({ code, verifier, redirectUri });
  return client;
}

/** A draft of a file, its text changed by `edit`. */
async function draftOf(
  client: CloudClient,
  path: string,
  edit: (text: string) => string,
  summary: string,
): Promise<void> {
  const text = new TextDecoder().decode(github.files()[path]);
  await client.saveDraft({
    changes: [encodeChange({ op: 'put', path, bytes: new TextEncoder().encode(edit(text)) })],
    message: { summary },
  });
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

  it('finishes a sign-in in another tab, as an email link opens one', async () => {
    await returnFromSignIn('u_admin', '#/c/blog');
    // A new tab has a sessionStorage of its own, and the site's localStorage.
    sessionStorage.clear();
    render(gate());
    expect(
      await screen.findByRole('button', { name: 'Ada Admin' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('#/c/blog');
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('refuses a sign-in this browser didn’t start', async () => {
    await returnFromSignIn('u_admin');
    localStorage.clear();
    render(gate());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That sign-in didn’t start here. Try again.',
    );
  });

  it('refuses a sign-in that took over half an hour, and forgets old ones', async () => {
    const started = Date.now() - 31 * 60 * 1000;
    localStorage.setItem(
      'vesper.cloud.pending.st_old',
      JSON.stringify({ state: 'st_old', verifier: 'v', route: '#/', started }),
    );
    await returnFromSignIn('u_admin', '#/', started);
    render(gate());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That sign-in didn’t start here. Try again.',
    );
    expect(Object.keys(localStorage)).toEqual([]);
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

  it('saves a draft a moment after typing stops, and publishes it as one commit by the app', async () => {
    await returnFromSignIn('u_admin', '#/c/blog/e/harbor-at-dawn');
    render(gate());
    const user = userEvent.setup();
    const title = await screen.findByRole('textbox', { name: 'Title' }, { timeout: 10_000 });
    await user.type(title, ', drafted');
    expect(
      await screen.findByText(/^Draft saved/, undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
    const before = new TextDecoder().decode(github.files()['src/content/blog/harbor-at-dawn.md']);
    expect(before).toContain('title: Harbor at dawn\n');
    expect(cloud.state.drafts.drafts).toHaveLength(1);

    const commits = github.log().length;
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
    expect(github.log()).toHaveLength(commits + 1);
    const [latest] = github.log();
    expect(latest?.author).toBe('vesper[bot]');
    expect(latest?.message).toBe(
      'Update "Harbor at dawn, drafted" in Blog posts\n\nVesper-Collection: blog\nVesper-Editor: u_admin\nCo-authored-by: Ada Admin <u_admin@users.noreply.vesper.test>',
    );
    expect(latest?.changed).toEqual(['M\tsrc/content/blog/harbor-at-dawn.md']);
    expect(cloud.state.drafts.drafts).toEqual([]);
  });

  it('lets a contributor request review instead of publishing', async () => {
    await returnFromSignIn('u_contributor', '#/c/blog/e/harbor-at-dawn');
    render(gate());
    const user = userEvent.setup();
    const title = await screen.findByRole('textbox', { name: 'Title' }, { timeout: 10_000 });
    await user.type(title, ', please');
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Request review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request review' });
    await expectNoViolations(dialog);
    await user.type(
      screen.getByRole('textbox', { name: 'Note for the approver (optional)' }),
      'New photo next week',
    );
    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(
      await screen.findByText(
        'Sent for review. An approver will publish it or ask for changes.',
        undefined,
        {
          timeout: 10_000,
        },
      ),
    ).toBeInTheDocument();
    expect(cloud.state.reviews).toHaveLength(1);
    expect(cloud.state.reviews[0]?.comments[0]?.body).toBe('New photo next week');
    expect(cloud.state.emails.map((e) => e.to)).toContain('ada@example.edu');
    expect(await screen.findByText('Waiting for review')).toBeInTheDocument();
  });

  it('shows a viewer the entry, with nothing to change it', async () => {
    await returnFromSignIn('u_viewer', '#/c/blog/e/harbor-at-dawn');
    render(gate());
    expect(
      await screen.findByText('You can view this entry, not change it.', undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request review' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeDisabled();
  });

  // Two publishes, a conflict and an axe pass over the comparison, all in
  // jsdom: about 4 s on CI's Ubuntu runner, but 15 s and then 23.2 s on its
  // Windows runner for the same code (October 2026), past the suite's 20 s.
  it('compares both versions when someone published since the draft began, and keeps the draft on request', async () => {
    await returnFromSignIn('u_admin', '#/c/blog/e/harbor-at-dawn');
    render(gate());
    const user = userEvent.setup();
    const title = await screen.findByRole('textbox', { name: 'Title' }, { timeout: 10_000 });
    await user.type(title, ', mine');
    await screen.findByText(/^Draft saved/, undefined, { timeout: 10_000 });
    const path = 'src/content/blog/harbor-at-dawn.md';
    const current = new TextDecoder().decode(github.files()[path]);
    github.commitFiles(
      { [path]: current.replace('title: Harbor at dawn', 'title: Harbor at dusk') },
      'Elsewhere',
      'someone-else',
    );
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const compare = await screen.findByRole(
      'region',
      { name: 'Someone published this entry since your draft began' },
      { timeout: 10_000 },
    );
    expect(await screen.findByLabelText('Published now')).toHaveTextContent(
      'title: Harbor at dusk',
    );
    expect(screen.getByLabelText('Your draft')).toHaveTextContent('title: Harbor at dawn, mine');
    await expectNoViolations(compare);
    await user.click(screen.getByRole('button', { name: 'Keep my draft' }));
    expect(await screen.findByText(/Your draft is kept/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(
      await screen.findByText(
        'Published. It will be live after the site is next built.',
        undefined,
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(new TextDecoder().decode(github.files()[path])).toContain(
      'title: Harbor at dawn, mine\n',
    );
  }, 60_000);

  it('keeps changes on this device while the cloud can’t be reached, and saves them when it’s back', async () => {
    await returnFromSignIn('u_admin', '#/c/blog/e/harbor-at-dawn');
    let down = false;
    const fetcher: typeof fetch = (input, init) =>
      down ? Promise.reject(new TypeError('Failed to fetch')) : cloud.fetch(input, init);
    render(<CloudGate settings={settings} options={options} fetcher={fetcher} store={store} />);
    const user = userEvent.setup();
    const title = await screen.findByRole('textbox', { name: 'Title' }, { timeout: 10_000 });
    down = true;
    await user.type(title, ', offline');
    expect(
      await screen.findByText('Can’t reach Vesper. Kept on this device', undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
    expect(cloud.state.drafts.drafts).toEqual([]);
    down = false;
    expect(
      await screen.findByText(/^Draft saved/, undefined, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(cloud.state.drafts.drafts).toHaveLength(1);
  }, 30_000);
  it('shows an editor only the collections they edit, and no redirects', async () => {
    await returnFromSignIn('u_editor');
    render(gate());
    const user = userEvent.setup();
    expect(
      await screen.findByRole('link', { name: 'Blog posts' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pages' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Site' }));
    expect(await screen.findByRole('menuitem', { name: 'Media' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Redirects' })).not.toBeInTheDocument();
  });

  it('shows a folder grant its branch, with the pages above it to open but not change', async () => {
    await returnFromSignIn('u_nurse', '#/c/pages');
    render(gate());
    const user = userEvent.setup();
    const tree = await screen.findByRole('treegrid', undefined, { timeout: 10_000 });
    expect(within(tree).getByRole('row', { name: 'Academics' })).toBeInTheDocument();
    expect(within(tree).queryByRole('row', { name: 'About the college' })).not.toBeInTheDocument();
    expect(within(tree).queryByRole('row', { name: 'How to apply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New page' })).not.toBeInTheDocument();
    await user.click(within(tree).getByRole('button', { name: 'More actions for Academics' }));
    expect(await screen.findByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Add child page' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(within(tree).getByRole('button', { name: 'Expand Academics' }));
    await user.click(await within(tree).findByRole('button', { name: 'More actions for Nursing' }));
    expect(await screen.findByRole('menuitem', { name: 'Add child page' })).toBeInTheDocument();
    // Nursing's place among Academics' pages lives in Academics' folder, outside the grant.
    expect(screen.queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument();
  });

  it('publishes chosen drafts from Changes as one commit', async () => {
    const admin = await clientAs('u_admin');
    await draftOf(
      admin,
      'src/content/blog/harbor-at-dawn.md',
      (t) => t.replace('title: Harbor at dawn', 'title: Harbor at noon'),
      'Update “Harbor at noon” in Blog posts',
    );
    await draftOf(
      admin,
      'src/content/pages/about.md',
      (t) => `${t}\nOne more line.\n`,
      'Update “About the college” in Pages',
    );
    await returnFromSignIn('u_admin');
    render(gate());
    const user = userEvent.setup();
    expect(
      await screen.findByText('2 drafts are waiting to be published.', undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '2 changes' }));
    const drawer = await screen.findByRole('dialog', { name: 'Changes' });
    await expectNoViolations(drawer);
    expect(
      within(drawer).getByRole('checkbox', { name: 'Update “Harbor at noon” in Blog posts' }),
    ).toBeChecked();
    const commits = github.log().length;
    await user.click(within(drawer).getByRole('button', { name: 'Publish 2 changes' }));
    expect(
      await within(drawer).findByText('Published 2 changes.', undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(github.log()).toHaveLength(commits + 1);
    expect(github.log()[0]?.changed.sort()).toEqual([
      'M\tsrc/content/blog/harbor-at-dawn.md',
      'M\tsrc/content/pages/about.md',
    ]);
    expect(within(drawer).getByText('Nothing is waiting to be published.')).toBeInTheDocument();
  });

  it('shows drafts waiting beside the collections on a wide screen, and nothing there once none are', async () => {
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
    const admin = await clientAs('u_admin');
    await draftOf(
      admin,
      'src/content/blog/harbor-at-dawn.md',
      (t) => t.replace('title: Harbor at dawn', 'title: Harbor at noon'),
      'Update “Harbor at noon” in Blog posts',
    );
    await returnFromSignIn('u_admin');
    render(gate());
    const waiting = await screen.findByRole('region', { name: 'Changes' }, { timeout: 10_000 });
    expect(within(waiting).getByText('1 draft is waiting to be published.')).toBeInTheDocument();
    // Beside the page, never the page: the collections keep the one h1.
    expect(screen.getByRole('main', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await expectNoViolations();

    const user = userEvent.setup();
    await user.click(within(waiting).getByRole('button', { name: 'See changes' }));
    const drawer = await screen.findByRole('dialog', { name: 'Changes' });
    await user.click(within(drawer).getByRole('button', { name: 'Publish 1 change' }));
    expect(
      await within(drawer).findByText('Published 1 change.', undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Changes' })).not.toBeInTheDocument();
    });
    // Absent, not empty (spec §6.9).
    expect(screen.queryByRole('region', { name: 'Changes' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-filler]')).not.toBeNull();
  });

  it('lets an approver ask for changes on a review from Changes', async () => {
    const contributor = await clientAs('u_contributor');
    await draftOf(
      contributor,
      'src/content/blog/harbor-at-dawn.md',
      (t) => t.replace('title: Harbor at dawn', 'title: Harbor, please'),
      'Update “Harbor, please” in Blog posts',
    );
    const id = (await contributor.drafts()).drafts[0]?.id ?? '';
    await contributor.requestReview({ drafts: [id], note: 'Ready when you are' });
    await returnFromSignIn('u_admin');
    render(gate());
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: '1 change, 1 to review' }, { timeout: 10_000 }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'Changes' });
    const review = within(drawer).getByRole('article', { name: /^Cal Contributor asked/ });
    expect(within(review).getByText('Ready when you are')).toBeInTheDocument();
    await user.click(within(review).getByRole('button', { name: 'Ask for changes' }));
    await user.type(
      within(review).getByRole('textbox', { name: 'What should change?' }),
      'Keep the original title.',
    );
    await user.click(within(review).getByRole('button', { name: 'Send' }));
    expect(await within(review).findByText('Sent to Cal Contributor.')).toBeInTheDocument();
    expect(cloud.state.reviews[0]?.state).toBe('changes-requested');
    expect(cloud.state.emails.map((e) => e.to)).toContain('cal@example.edu');
    await expectNoViolations(drawer);
  });

  /** Cal's draft of Harbor at dawn, sent for review. */
  async function reviewFromCal(): Promise<void> {
    const contributor = await clientAs('u_contributor');
    await draftOf(
      contributor,
      'src/content/blog/harbor-at-dawn.md',
      (t) => t.replace('title: Harbor at dawn', 'title: Harbor, reviewed'),
      'Update “Harbor, reviewed” in Blog posts',
    );
    const id = (await contributor.drafts()).drafts[0]?.id ?? '';
    await contributor.requestReview({ drafts: [id] });
  }

  it('opens Changes at #/changes, through sign-in, and closes back to Home', async () => {
    await reviewFromCal();
    // The review email's link, followed by someone who has to sign in first.
    await returnFromSignIn('u_admin', '#/changes');
    render(gate());
    const drawer = await screen.findByRole('dialog', { name: 'Changes' }, { timeout: 10_000 });
    // Open at once, filled in as the drafts and reviews arrive.
    expect(
      await within(drawer).findByRole(
        'article',
        { name: /^Cal Contributor asked/ },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Changes' })).not.toBeInTheDocument();
    });
    expect(window.location.hash).toBe('#/');
    expect(screen.getByRole('heading', { level: 1, name: 'Content' })).toBeInTheDocument();
  });

  it('shows a review requested elsewhere when the tab comes back into view', async () => {
    await returnFromSignIn('u_admin');
    render(gate());
    await screen.findByRole('button', { name: 'Ada Admin' }, { timeout: 10_000 });
    expect(screen.queryByRole('button', { name: /to review$/ })).not.toBeInTheDocument();
    // Meanwhile, in Cal's studio.
    await reviewFromCal();
    expect(document.visibilityState).toBe('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(
      await screen.findByRole('button', { name: '1 change, 1 to review' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });
});

// Scheduled publishing in the cloud (spec §6.17): held drafts, each change's
// state, and cancelling a publish. Times are from now, whole minutes, as the
// Schedule dialog keeps them, so the playground's own dated events don't matter.
describe('scheduling in the cloud', () => {
  const DAY = 24 * 3600 * 1000;
  const minute = (ms: number) => new Date(Math.ceil(ms / 60_000) * 60_000);
  const eventPath = (id: string) => `src/content/events/${id}.md`;
  const eventText = (title: string, at: Date) =>
    `---\ntitle: ${title}\nsummary: ${title}.\nstartsAt: 2027-05-15T10:00:00-04:00\nlocation: main-campus\npublishAt: ${at.toISOString()}\n---\n\n${title}.\n`;
  const draftEvent = (client: CloudClient, id: string, title: string, at: Date) =>
    client.saveDraft({
      changes: [
        encodeChange({
          op: 'put',
          path: eventPath(id),
          bytes: new TextEncoder().encode(eventText(title, at)),
        }),
      ],
      message: { summary: `Add “${title}” in Events`, trailers: { 'Vesper-Collection': 'events' } },
    });

  it('holds a scheduled draft in Vesper where the site holds, and lets it stop waiting', async () => {
    cloud.setSchedule({ trigger: 'dispatch', holdScheduledDrafts: true, publicRepository: true });
    const at = minute(Date.now() + 2 * DAY);
    await draftEvent(await clientAs('u_admin'), 'book-sale', 'Book sale', at);
    await returnFromSignIn('u_admin', '#/c/events/e/book-sale');
    render(gate());
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Title' }, { timeout: 10_000 });

    await user.click(screen.getByRole('button', { name: 'More ways to publish' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Schedule…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule' });
    expect(within(dialog).getByText(/^Goes live at \w{3}, \w{3} \d+, /)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Vesper keeps it as a draft until then, and publishes it at that time.',
      ),
    ).toBeInTheDocument();
    await expectNoViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(
      await screen.findByText(
        /^Scheduled\. Vesper keeps it as a draft until .+, then publishes it\.$/,
        undefined,
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(cloud.state.schedule.holds).toMatchObject([
      { state: 'held', path: eventPath('book-sale'), at: at.toISOString() },
    ]);
    expect(github.files()[eventPath('book-sale')]).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'More ways to publish' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel schedule' }));
    expect(
      await screen.findByText('It’s no longer scheduled, and stays a draft.', undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
    expect(cloud.state.schedule.holds).toEqual([]);
    expect(cloud.state.drafts.drafts.map((d) => d.files.map((f) => f.path))).toEqual([
      [eventPath('book-sale')],
    ]);
  });

  it('takes a published entry whose time is still to come off the site, back to a draft', async () => {
    const admin = await clientAs('u_admin');
    await draftEvent(admin, 'book-sale', 'Book sale', minute(Date.now() + 2 * DAY));
    await admin.publish((await admin.drafts()).drafts.map((d) => d.id));
    const published = github.files()[eventPath('book-sale')];
    expect(published).toBeDefined();
    await returnFromSignIn('u_admin', '#/c/events/e/book-sale');
    render(gate());
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Title' }, { timeout: 10_000 });

    await user.click(screen.getByRole('button', { name: 'More actions for Book sale' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel schedule' }));
    expect(
      await screen.findByText('It’s off the schedule, and back to a draft.', undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
    expect(github.files()[eventPath('book-sale')]).toBeUndefined();
    expect(github.log()[0]?.message).toMatch(/^Take “Book sale” off the schedule in Events\n/);
    const [draft] = cloud.state.drafts.drafts;
    const file = draft?.files[0];
    expect(file).toMatchObject({ op: 'put', path: eventPath('book-sale'), base: null });
    const kept = file?.op === 'put' ? draft?.bytes[file.version] : undefined;
    expect(new TextDecoder().decode(kept)).toBe(new TextDecoder().decode(published));
  });

  it('says where each change stands in the Scheduled view, and which held change failed', async () => {
    cloud.setSchedule({ trigger: 'dispatch', holdScheduledDrafts: true });
    const admin = await clientAs('u_admin');
    await draftEvent(admin, 'book-sale', 'Book sale', minute(Date.now() + 2 * DAY));
    await admin.publish((await admin.drafts()).drafts.map((d) => d.id));
    const galaAt = minute(Date.now() + 3 * DAY);
    await draftEvent(admin, 'gala', 'Gala', galaAt);
    const gala = (await admin.drafts()).drafts[0];
    await admin.hold([gala?.id ?? ''], galaAt.toISOString());
    // Held for ten minutes from now, then published elsewhere first: it fails at its time.
    const commencement = eventPath('spring-commencement');
    await draftOf(
      admin,
      commencement,
      (t) => t.replace('Graduation', 'The graduation'),
      'Update “Spring commencement” in Events',
    );
    const changed = (await admin.drafts()).drafts.find((d) => d.files[0]?.path === commencement);
    await admin.hold([changed?.id ?? ''], minute(Date.now() + 10 * 60_000).toISOString());
    github.commitFiles(
      {
        [commencement]: new TextDecoder().decode(github.files()[commencement]).concat('\nMoved.\n'),
      },
      'Elsewhere',
    );
    await cloud.advance(20 * 60_000);

    await returnFromSignIn('u_admin', '#/scheduled');
    render(gate());
    const user = userEvent.setup();
    const table = await screen.findByRole(
      'grid',
      { name: 'Scheduled changes' },
      { timeout: 10_000 },
    );
    await waitFor(() => {
      expect(within(table).getByRole('columnheader', { name: 'State' })).toBeInTheDocument();
    });
    const row = (name: string) => within(table).getByRole('row', { name: new RegExp(name) });
    expect(row('Book sale').textContent).toMatch(/Goes liveRebuild at \d+:\d\d [AP]M/);
    expect(row('Gala').textContent).toMatch(/Goes liveWaiting in Vesper until \d+:\d\d [AP]M/);
    expect(
      screen.getByText(
        /^“Update “Spring commencement” in Events”, scheduled for .+, wasn’t published\. The page changed on the site after it was scheduled/,
      ),
    ).toBeInTheDocument();
    await expectNoViolations();

    await user.click(screen.getByRole('button', { name: 'Actions for Gala, going live' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel' }));
    expect(
      await screen.findByText('“Gala” is no longer scheduled. It’s a draft.', undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
    expect(cloud.state.schedule.holds.filter((h) => h.state === 'held')).toEqual([]);
  });

  it('leaves a held draft out of Changes’ Publish, and says when it goes out', async () => {
    cloud.setSchedule({ holdScheduledDrafts: true });
    const admin = await clientAs('u_admin');
    await draftEvent(admin, 'gala', 'Gala', minute(Date.now() + 3 * DAY));
    const gala = (await admin.drafts()).drafts[0];
    await admin.hold([gala?.id ?? ''], minute(Date.now() + 3 * DAY).toISOString());
    await draftOf(
      admin,
      'src/content/pages/about.md',
      (t) => `${t}\nOne more line.\n`,
      'Update “About the college” in Pages',
    );
    await returnFromSignIn('u_admin');
    render(gate());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '2 changes' }, { timeout: 10_000 }));
    const drawer = await screen.findByRole('dialog', { name: 'Changes' });
    expect(
      within(drawer).queryByRole('checkbox', { name: 'Add “Gala” in Events' }),
    ).not.toBeInTheDocument();
    expect(within(drawer).getByText(/scheduled for \w{3}, \w{3} \d+, /)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Publish 1 change' })).toBeInTheDocument();
    await expectNoViolations(drawer);
  });
});
