import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAIR_AT, eventFile, runCloudContract } from '@vespercms/core/cloud-testing';
import { afterAll, describe, expect, it } from 'vitest';
import { createCloudFake } from './cloud-fake.mjs';
import { createGitHubFake } from './github-fake.mjs';

// The fake cloud keeps the cloud's contract, over a fake GitHub on real git,
// so the studio's tests against it hold for the real cloud too.

const dirs = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Glob collections laid out as the playground's are, with events scheduled. */
const glob = (name) => ({
  loader: 'glob',
  base: `src/content/${name}`,
  pattern: '**/[^_]*.md',
  generateId: 'default',
  formats: ['md'],
});
const manifest = {
  version: 1,
  site: { srcDir: 'src', contentConfig: 'src/content.config.ts' },
  collections: [
    { name: 'pages', source: glob('pages'), presentation: {} },
    { name: 'blog', source: glob('blog'), presentation: {} },
    {
      name: 'events',
      source: glob('events'),
      editable: true,
      presentation: {
        schedule: { unpublish: true, publishAt: 'publishAt', unpublishAt: 'unpublishAt' },
      },
    },
  ],
};

const ORIGIN = 'https://site.example';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-cloud-fake-'));
  dirs.push(dir);
  const github = createGitHubFake({ dir: join(dir, 'repo.git'), login: 'vesper[bot]' });
  github.commitFiles(
    {
      'src/content/pages/about.md': 'About\n',
      'src/content/pages/admissions/index.md': 'Admissions\n',
      'src/content/pages/admissions/apply.md': 'Apply\n',
      'src/content/blog/a.md': 'A\n',
      'src/content/events/fair.md': eventFile('Fair', FAIR_AT),
    },
    'Seed',
  );
  const cloud = createCloudFake({
    github,
    manifest,
    site: { id: 'site_test', name: 'Test site', origins: [ORIGIN] },
    people: [
      { id: 'u_admin', name: 'Ada Admin', email: 'ada@example.edu', role: 'admin', picture: true },
      {
        id: 'u_editor',
        name: 'Eve Editor',
        email: 'eve@example.edu',
        role: 'editor',
        grants: [{ collection: 'pages', match: 'admissions/**' }],
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
  return { github, cloud };
}

runCloudContract(
  'fake cloud',
  async () => {
    const { github, cloud } = setup();
    return {
      settings: cloud.settings,
      origin: ORIGIN,
      fetch: cloud.fetch,
      signInAs: (person) => {
        cloud.state.signedIn = `u_${person}`;
      },
      publishElsewhere: async (path, text) => {
        github.commitFiles({ [path]: text }, 'Elsewhere', 'someone-else');
      },
      published: async (path) => {
        const bytes = github.files()[path];
        return bytes ? new TextDecoder().decode(bytes) : null;
      },
      commits: async () => github.log(),
      reportDeploy: (commit, state) => cloud.setDeploy(commit, { state }),
      setSchedule: async (settings) => {
        cloud.setSchedule(settings);
      },
      advance: (ms) => cloud.advance(ms),
      rebuilds: async () => cloud.state.schedule.rebuilds.map(({ at }) => ({ at })),
    };
  },
  { describe, it, equal: (actual, expected, message) => expect(actual, message).toEqual(expected) },
);

describe('the fake cloud', () => {
  it('commits as the app’s bot, naming the editor in trailers', async () => {
    const { github, cloud } = setup();
    const { CloudClient, authorizeUrl, createDpopKey, createPkce, encodeChange } =
      await import('@vespercms/core');
    cloud.state.signedIn = 'u_editor';
    const { verifier, challenge } = await createPkce();
    const redirectUri = `${ORIGIN}/admin/`;
    const answer = await cloud.fetch(
      authorizeUrl(cloud.settings, { redirectUri, state: 'st_bot', challenge }),
    );
    const location = answer.headers.get('location');
    const code = new URLSearchParams(location.slice(location.indexOf('?') + 1)).get('code');
    const client = new CloudClient({
      settings: cloud.settings,
      key: await createDpopKey(),
      fetch: cloud.fetch,
    });
    await client.exchangeCode({ code, verifier, redirectUri });
    await client.saveDraft({
      changes: [
        encodeChange({
          op: 'put',
          path: 'src/content/pages/admissions/apply.md',
          bytes: new TextEncoder().encode('Now\n'),
        }),
      ],
      message: { summary: 'Update “Apply” in Pages', trailers: { 'Vesper-Collection': 'pages' } },
    });
    const { drafts } = await client.drafts();
    expect((await client.publish(drafts.map((d) => d.id))).ok).toBe(true);
    const [latest] = github.log();
    expect(latest.author).toBe('vesper[bot]');
    expect(latest.message).toBe(
      'Update “Apply” in Pages\n\nVesper-Collection: pages\nVesper-Editor: u_editor\nCo-authored-by: Eve Editor <u_editor@users.noreply.vesper.test>',
    );
  });

  /** A client signed in as `id`, through the fake app. */
  async function clientFor(cloud, id) {
    const { CloudClient, authorizeUrl, createDpopKey, createPkce } = await import('@vespercms/core');
    cloud.state.signedIn = id;
    const { verifier, challenge } = await createPkce();
    const redirectUri = `${ORIGIN}/admin/`;
    const answer = await cloud.fetch(
      authorizeUrl(cloud.settings, { redirectUri, state: `st_${id}`, challenge }),
    );
    const location = answer.headers.get('location');
    const code = new URLSearchParams(location.slice(location.indexOf('?') + 1)).get('code');
    const client = new CloudClient({
      settings: cloud.settings,
      key: await createDpopKey(),
      fetch: cloud.fetch,
    });
    await client.exchangeCode({ code, verifier, redirectUri });
    return client;
  }

  it('sends its rebuild to the repository as repository_dispatch', async () => {
    const { github, cloud } = setup();
    const { encodeChange } = await import('@vespercms/core');
    cloud.setSchedule({ trigger: 'dispatch' });
    const client = await clientFor(cloud, 'u_admin');
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    await client.saveDraft({
      changes: [
        encodeChange({
          op: 'put',
          path: 'src/content/events/talk.md',
          bytes: new TextEncoder().encode(eventFile('Talk', at)),
        }),
      ],
      message: { summary: 'Add “Talk” in Events' },
    });
    await client.publish((await client.drafts()).drafts.map((d) => d.id));
    expect(github.state.dispatches).toEqual([]);
    await cloud.advance(10 * 60_000);
    expect(github.state.dispatches).toEqual([
      { event_type: 'vesper-rebuild', client_payload: { at } },
    ]);
  });

  it('keeps a held draft whose scheduler can no longer publish, and emails them', async () => {
    const { github, cloud } = setup();
    const { encodeChange } = await import('@vespercms/core');
    cloud.setSchedule({ holdScheduledDrafts: true });
    const client = await clientFor(cloud, 'u_admin');
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    await client.saveDraft({
      changes: [
        encodeChange({
          op: 'put',
          path: 'src/content/events/talk.md',
          bytes: new TextEncoder().encode(eventFile('Talk', at)),
        }),
      ],
      message: { summary: 'Add “Talk” in Events' },
    });
    const [draft] = (await client.drafts()).drafts;
    expect((await client.hold([draft.id], at)).ok).toBe(true);
    cloud.setMember('u_admin', { role: 'contributor' });
    const commits = github.log().length;
    await cloud.advance(10 * 60_000);
    expect(github.log()).toHaveLength(commits);
    expect(cloud.state.schedule.holds[0]).toMatchObject({
      state: 'failed',
      message: 'Ada Admin can no longer publish these changes, so they wait as a draft.',
    });
    expect(cloud.state.emails.at(-1)).toEqual({
      to: 'ada@example.edu',
      subject: 'A scheduled change wasn’t published',
      url: `${ORIGIN}/admin/#/scheduled`,
    });
    expect(github.state.dispatches).toEqual([]);
  });

  it('answers CORS only for the site’s registered origins', async () => {
    const { cloud } = setup();
    const preflight = (origin) =>
      cloud.fetch(`${cloud.settings.api}/token`, {
        method: 'OPTIONS',
        headers: { Origin: origin },
      });
    expect((await preflight(ORIGIN)).headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(
      (await preflight('https://elsewhere.example')).headers.get('access-control-allow-origin'),
    ).toBeNull();
  });
});
