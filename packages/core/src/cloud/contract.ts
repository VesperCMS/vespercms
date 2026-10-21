import type { ContractHarness } from '../storage/contract.ts';
import { gitBlobSha } from '../storage/git-blob-sha.ts';
import type { Member } from './grants.ts';
import { CloudClient, CloudError, authorizeUrl, createPkce } from './client.ts';
import { createDpopKey } from './dpop.ts';
import { encodeChange, fromBase64, type CloudStudioSettings, type CloudUser } from './protocol.ts';

/*
 * What the studio relies on from the cloud's API, as a reusable suite
 * (DECISIONS.md, "The split"). The fake cloud in this repository and the
 * real cloud in its private one both run it, so the studio, tested against
 * the fake, works against the real thing.
 *
 * The fixture's site starts with `src/content/pages/about.md`,
 * `src/content/pages/admissions/index.md`,
 * `src/content/pages/admissions/apply.md` and `src/content/blog/a.md` in a
 * collection layout like the playground's (`pages` and `blog` glob
 * collections), and these people, by role:
 * - `admin`: site admin;
 * - `editor`: an editor granted `pages` under `admissions/**`, publishing allowed;
 * - `contributor`: a contributor with no grants (the whole site, never publishing);
 * - `viewer`: a viewer.
 */

export type CloudFixture = {
  settings: CloudStudioSettings;
  /** A registered origin for the site's studio. */
  origin: string;
  /** How the suite reaches the app and the API. */
  fetch: typeof fetch;
  /** Who the app signs in next, as if they'd signed in on its page. */
  signInAs: (person: 'admin' | 'editor' | 'contributor' | 'viewer') => void;
  /** Someone publishes straight to the repository, outside the cloud. */
  publishElsewhere: (path: string, text: string) => Promise<void>;
  /** A published file's text, or null. */
  published: (path: string) => Promise<string | null>;
  /** The repository's commits, newest first. */
  commits: () => Promise<{ message: string }[]>;
  /** Makes the host report a status for a commit, where the fixture can. */
  reportDeploy?: (commit: string, state: 'building' | 'live' | 'failed') => void;
};

const encoder = new TextEncoder();
const text = (value: string) => encoder.encode(value);
const decoder = new TextDecoder();

export function runCloudContract(
  name: string,
  create: () => Promise<CloudFixture>,
  t: ContractHarness,
): void {
  const { describe, it, equal } = t;
  const ok = (value: unknown, message: string) => {
    equal(Boolean(value), true, message);
  };

  /** Signs a person in through the app, as the studio does, and hands back a client. */
  async function signIn(
    fixture: CloudFixture,
    person: 'admin' | 'editor' | 'contributor' | 'viewer',
  ): Promise<{ client: CloudClient; member: Member; user: CloudUser }> {
    fixture.signInAs(person);
    const redirectUri = `${fixture.origin}/admin/`;
    const { verifier, challenge } = await createPkce();
    const state = `st_${person}_${String(Date.now())}`;
    const answer = await fixture.fetch(
      authorizeUrl(fixture.settings, { redirectUri, state, challenge }),
      { redirect: 'manual' },
    );
    const location = answer.headers.get('location') ?? '';
    equal(
      location.startsWith(`${redirectUri}#/callback?`),
      true,
      'the app sends the browser back to the studio',
    );
    const params = new URLSearchParams(location.slice(location.indexOf('?') + 1));
    equal(params.get('state'), state, 'the state comes back unchanged');
    const code = params.get('code') ?? '';
    const client = new CloudClient({
      settings: fixture.settings,
      key: await createDpopKey(),
      fetch: fixture.fetch,
    });
    const tokens = await client.exchangeCode({ code, verifier, redirectUri });
    return { client, member: tokens.member, user: tokens.user };
  }

  const pathOf = 'src/content/pages/admissions/apply.md';

  describe(`cloud contract: ${name}`, () => {
    it('signs in with PKCE, once per code, for tokens carrying the member', async () => {
      const fixture = await create();
      const { member } = await signIn(fixture, 'editor');
      equal(member.role, 'editor');
      equal(member.grants?.[0]?.collection, 'pages');

      fixture.signInAs('admin');
      const redirectUri = `${fixture.origin}/admin/`;
      const { verifier, challenge } = await createPkce();
      const answer = await fixture.fetch(
        authorizeUrl(fixture.settings, { redirectUri, state: 'st_twice', challenge }),
        { redirect: 'manual' },
      );
      const location = answer.headers.get('location') ?? '';
      const code = new URLSearchParams(location.slice(location.indexOf('?') + 1)).get('code') ?? '';
      const wrong = new CloudClient({
        settings: fixture.settings,
        key: await createDpopKey(),
        fetch: fixture.fetch,
      });
      const refused = await wrong
        .exchangeCode({ code, verifier: `${verifier}x`, redirectUri })
        .then(
          () => null,
          (error: unknown) => error,
        );
      ok(refused instanceof CloudError, 'a wrong verifier is refused');
      const again = await wrong.exchangeCode({ code, verifier, redirectUri }).then(
        () => null,
        (error: unknown) => error,
      );
      ok(again instanceof CloudError, 'a code works once, even after a failed try');
    });

    it('refuses an address the site hasn’t registered', async () => {
      const fixture = await create();
      fixture.signInAs('admin');
      const { challenge } = await createPkce();
      const answer = await fixture.fetch(
        authorizeUrl(fixture.settings, {
          redirectUri: 'https://elsewhere.example/admin/',
          state: 'st_elsewhere',
          challenge,
        }),
        { redirect: 'manual' },
      );
      equal(
        (answer.headers.get('location') ?? '').startsWith('https://elsewhere.example'),
        false,
        'no code goes to an unregistered address',
      );
    });

    it('binds tokens to the key, and rotates refresh tokens once each', async () => {
      const fixture = await create();
      const { client } = await signIn(fixture, 'admin');
      const tree = await client.tree();
      ok(
        tree.entries.some((e) => e.path === pathOf),
        'the tree lists the site’s files',
      );

      // A request without a proof, or with another key's, is refused.
      const plain = await fixture.fetch(
        `${fixture.settings.api}/sites/${fixture.settings.project}/tree`,
        { headers: { Authorization: 'DPoP stolen' } },
      );
      equal(plain.status, 401, 'a request without a valid token and proof is refused');

      const latest: { refresh: string | null } = { refresh: null };
      const watched = new CloudClient({
        settings: fixture.settings,
        key: await createDpopKey(),
        fetch: fixture.fetch,
        onTokens: (tokens) => {
          latest.refresh = tokens?.refresh ?? null;
        },
      });
      fixture.signInAs('admin');
      const { verifier, challenge } = await createPkce();
      const redirectUri = `${fixture.origin}/admin/`;
      const answer = await fixture.fetch(
        authorizeUrl(fixture.settings, { redirectUri, state: 'st_rotate', challenge }),
        { redirect: 'manual' },
      );
      const location = answer.headers.get('location') ?? '';
      await watched.exchangeCode({
        code: new URLSearchParams(location.slice(location.indexOf('?') + 1)).get('code') ?? '',
        verifier,
        redirectUri,
      });
      const first = latest.refresh;
      await watched.refresh();
      ok(latest.refresh && latest.refresh !== first, 'a refresh hands out a new refresh token');

      // The used one, from any key, ends the sign-in.
      const thief = new CloudClient({
        settings: fixture.settings,
        key: await createDpopKey(),
        fetch: fixture.fetch,
        tokens: { access: 'x', refresh: first ?? '', expiresAt: 0 },
      });
      const stolen = await thief.refresh().then(
        () => null,
        (error: unknown) => error,
      );
      ok(stolen instanceof CloudError, 'a used refresh token is refused');
      const after = await watched.refresh().then(
        () => null,
        (error: unknown) => error,
      );
      ok(after instanceof CloudError, 'reusing a refresh token ends that whole sign-in');
    });

    it('saves drafts the published site doesn’t see, with conflicts for stale versions', async () => {
      const fixture = await create();
      const { client } = await signIn(fixture, 'admin');
      const before = await fixture.published(pathOf);
      const base = (await client.tree()).entries.find((e) => e.path === pathOf)?.version ?? null;
      const saved = await client.saveDraft({
        changes: [
          encodeChange({
            op: 'put',
            path: pathOf,
            bytes: text('Draft one\n'),
            expectedVersion: base,
          }),
        ],
        message: { summary: 'Update “Apply” in Pages', trailers: { 'Vesper-Collection': 'pages' } },
      });
      equal(saved.ok, true, 'the draft is saved');
      equal(await fixture.published(pathOf), before, 'nothing is published');
      const { drafts } = await client.drafts();
      const draft = drafts.find((d) => d.files.some((f) => f.path === pathOf));
      const file = draft?.files.find((f) => f.path === pathOf);
      equal(
        file?.op === 'put' ? file.version : null,
        await gitBlobSha(text('Draft one\n')),
        'the draft’s version is its bytes’ blob SHA',
      );
      const blobs = await client.blobs([file?.op === 'put' ? file.version : '']);
      const bytes = Object.values(blobs.blobs)[0];
      equal(
        bytes && decoder.decode(fromBase64(bytes)),
        'Draft one\n',
        'the draft’s bytes can be read',
      );

      const stale = await client.saveDraft({
        changes: [
          encodeChange({
            op: 'put',
            path: pathOf,
            bytes: text('Draft two\n'),
            expectedVersion: base,
          }),
        ],
        message: { summary: 'Update' },
      });
      equal(!stale.ok && stale.reason, 'conflict', 'a save from a stale version is a conflict');
    });

    it('publishes drafts as one commit, and clears them', async () => {
      const fixture = await create();
      const { client } = await signIn(fixture, 'admin');
      const commits = (await fixture.commits()).length;
      await client.saveDraft({
        changes: [encodeChange({ op: 'put', path: pathOf, bytes: text('Apply now\n') })],
        message: { summary: 'Update “Apply” in Pages' },
      });
      await client.saveDraft({
        changes: [encodeChange({ op: 'put', path: 'src/content/blog/a.md', bytes: text('A2\n') })],
        message: { summary: 'Update “A” in Blog posts' },
      });
      const ids = (await client.drafts()).drafts.map((d) => d.id);
      equal(ids.length, 2, 'two drafts wait');
      const result = await client.publish(ids);
      equal(result.ok, true, 'the drafts are published');
      equal((await fixture.commits()).length, commits + 1, 'as one commit');
      equal(await fixture.published(pathOf), 'Apply now\n');
      equal(await fixture.published('src/content/blog/a.md'), 'A2\n');
      equal((await client.drafts()).drafts.length, 0, 'and the drafts are gone');
      if (result.ok && fixture.reportDeploy) {
        fixture.reportDeploy(result.commit, 'live');
        equal((await client.status(result.commit)).state, 'live', 'deploy status is reported');
      }
    });

    it('credits everyone whose drafts a publish carries, each once, at no-reply addresses', async () => {
      const fixture = await create();
      const contributor = await signIn(fixture, 'contributor');
      const editor = await signIn(fixture, 'editor');
      const admin = await signIn(fixture, 'admin');
      const post = 'src/content/blog/a.md';
      const save = (who: { client: CloudClient }, path: string, body: string, collection: string) =>
        who.client.saveDraft({
          changes: [encodeChange({ op: 'put', path, bytes: text(body) })],
          message: { summary: `Update ${path}`, trailers: { 'Vesper-Collection': collection } },
        });
      // Two people on each draft, and the publisher on the second.
      await save(contributor, pathOf, 'Apply, drafted\n', 'pages');
      await save(editor, pathOf, 'Apply, edited\n', 'pages');
      await save(contributor, post, 'A, drafted\n', 'blog');
      await save(admin, post, 'A, edited\n', 'blog');
      const { drafts } = await admin.client.drafts();
      const apply = drafts.find((d) => d.files.some((f) => f.path === pathOf));
      const blog = drafts.find((d) => d.files.some((f) => f.path === post));
      equal(
        apply?.authors.map((a) => a.id),
        [contributor.user.id, editor.user.id],
        'a draft lists everyone who saved it, in the order they first did',
      );
      equal(
        blog?.authors.map((a) => a.id),
        [contributor.user.id, admin.user.id],
        'each draft its own',
      );

      const result = await admin.client.publish([apply?.id ?? '', blog?.id ?? '']);
      equal(result.ok, true, 'the drafts are published');
      const lines = ((await fixture.commits())[0]?.message ?? '').split('\n');
      const values = (key: string) =>
        lines
          .filter((line) => line.startsWith(`${key}: `))
          .map((line) => line.slice(key.length + 2));
      const people = [admin.user, contributor.user, editor.user];
      equal(
        values('Vesper-Editor'),
        people.map((p) => p.id),
        'the publisher first, then each draft’s authors in order, each once',
      );
      const credited = values('Co-authored-by');
      equal(credited.length, people.length, 'each in a Co-authored-by of their own');
      people.forEach((person, index) => {
        const line = credited[index] ?? '';
        ok(
          line.startsWith(`${person.name} <${person.id}@`) && line.endsWith('>'),
          `${person.name} is named, at an address made from their ID`,
        );
        ok(!line.includes(person.email), 'never at their email');
      });
      equal(values('Vesper-Collection'), ['pages', 'blog'], 'and every collection is named');
    });

    it('reports a change published since the draft began as a conflict, and rebases on request', async () => {
      const fixture = await create();
      const { client } = await signIn(fixture, 'admin');
      await client.saveDraft({
        changes: [encodeChange({ op: 'put', path: pathOf, bytes: text('Mine\n') })],
        message: { summary: 'Mine' },
      });
      await fixture.publishElsewhere(pathOf, 'Theirs\n');
      const id = (await client.drafts()).drafts[0]?.id ?? '';
      const result = await client.publish([id]);
      equal(
        !result.ok && result.reason,
        'conflict',
        'publishing over a newer version is a conflict',
      );
      equal(await fixture.published(pathOf), 'Theirs\n', 'and nothing is overwritten');
      await client.rebaseDraft(id, [pathOf]);
      equal((await client.publish([id])).ok, true, 'kept and rebased, it publishes');
      equal(await fixture.published(pathOf), 'Mine\n');
    });

    it('discards a draft', async () => {
      const fixture = await create();
      const { client } = await signIn(fixture, 'admin');
      await client.saveDraft({
        changes: [encodeChange({ op: 'put', path: pathOf, bytes: text('Never mind\n') })],
        message: { summary: 'Never mind' },
      });
      const id = (await client.drafts()).drafts[0]?.id ?? '';
      await client.discardDraft(id);
      equal((await client.drafts()).drafts.length, 0, 'the draft is gone');
    });

    it('keeps a folder grant to its folder, in drafts and in publishing', async () => {
      const fixture = await create();
      const { client } = await signIn(fixture, 'editor');
      const inside = await client.saveDraft({
        changes: [encodeChange({ op: 'put', path: pathOf, bytes: text('Inside\n') })],
        message: { summary: 'Inside' },
      });
      equal(inside.ok, true, 'a page in the granted folder can be drafted');
      const outside = await client.saveDraft({
        changes: [
          encodeChange({ op: 'put', path: 'src/content/pages/about.md', bytes: text('Outside\n') }),
        ],
        message: { summary: 'Outside' },
      });
      equal(!outside.ok && outside.reason, 'forbidden', 'a page outside it can’t');

      // An admin's draft outside the grant can't be published by the editor.
      const { client: admin } = await signIn(fixture, 'admin');
      await admin.saveDraft({
        changes: [
          encodeChange({ op: 'put', path: 'src/content/pages/about.md', bytes: text('Admin\n') }),
        ],
        message: { summary: 'Admin' },
      });
      const drafts = (await client.drafts()).drafts;
      const theirs = drafts.find((d) =>
        d.files.some((f) => f.path === 'src/content/pages/about.md'),
      );
      const refused = await client.publish([theirs?.id ?? '']);
      equal(!refused.ok && refused.reason, 'forbidden', 'nor can anything outside it be published');
    });

    it('lets contributors request review, and approvers answer and publish', async () => {
      const fixture = await create();
      const { client: contributor } = await signIn(fixture, 'contributor');
      await contributor.saveDraft({
        changes: [encodeChange({ op: 'put', path: pathOf, bytes: text('Please review\n') })],
        message: { summary: 'Please review' },
      });
      const id = (await contributor.drafts()).drafts[0]?.id ?? '';
      const refused = await contributor.publish([id]);
      equal(!refused.ok && refused.reason, 'forbidden', 'a contributor can’t publish');
      const review = await contributor.requestReview({ drafts: [id], note: 'New deadline' });
      equal(review.state, 'open');
      equal(
        (await contributor.drafts()).drafts[0]?.review,
        review.id,
        'the draft points at its review',
      );

      const { client: admin } = await signIn(fixture, 'admin');
      const answered = await admin.answerReview(review.id, {
        action: 'request-changes',
        body: 'Say which date.',
      });
      equal(answered.state, 'changes-requested');
      const answeredBack = await contributor
        .answerReview(review.id, { action: 'comment', body: 'Done' })
        .then(
          () => null,
          (error: unknown) => error,
        );
      ok(answeredBack instanceof CloudError, 'only an approver answers a review');
      equal((await admin.publish([id])).ok, true, 'an approver publishes it');
      equal((await admin.reviews()).reviews.length, 0, 'and the review closes');
    });

    it('lets viewers read and nothing more', async () => {
      const fixture = await create();
      const { client } = await signIn(fixture, 'viewer');
      ok((await client.tree()).entries.length > 0, 'a viewer reads the site');
      const saved = await client.saveDraft({
        changes: [encodeChange({ op: 'put', path: pathOf, bytes: text('Viewer\n') })],
        message: { summary: 'Viewer' },
      });
      equal(!saved.ok && saved.reason, 'forbidden', 'a viewer can’t draft');
    });
  });
}
