// A fake Vesper cloud for the studio's tests (spec §6.9, §7.2 to §7.5): the
// API the studio speaks (`@vesper/core`'s cloud protocol), with sign-in,
// DPoP-bound tokens, drafts, reviews, publishing and deploy status. It
// publishes through `GitHubStorage` to a fake GitHub over real git, as the
// real cloud publishes to GitHub with an installation token, so a publish in
// these tests is a real commit.
//
// The real cloud lives in its own private repository and runs
// `runCloudContract` against itself; this fake runs it too, so both answer
// the studio alike (DECISIONS.md, "The split").
//
// - In process: `createCloudFake({ github, manifest, site, people })` gives
//   `handle(request)` and `fetch`.
// - As a server: `serveCloudFake(fake, port)`. The app's pages are under
//   `/app` and the API under `/api`, on one port.
//
// The fake app signs in whoever `state.signedIn` names, at once, so tests
// never see a sign-in page.
//
// Scheduled publishing (spec §6.17) keeps a clock of its own, which tests
// move with `advance(ms)`; tokens and DPoP proofs keep the real time. Moving
// it runs what fell due, as the real cloud's alarm would.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import {
  ContentService,
  GitHubStorage,
  changeAccess,
  clearDrafts,
  collectionOf,
  decodeChange,
  discardDraft,
  draftForWire,
  emptyDraftState,
  publishChangeSet,
  rebaseDraft,
  saveDraft,
  toBase64,
  verifyDpopProof,
} from '@vesper/core';

const ACCESS_TTL = 600;
const REFRESH_IDLE = 12 * 3600;
const REFRESH_MAX = 7 * 24 * 3600;

/**
 * @param {{
 *   github: import('./github-fake.mjs').GitHubFake,
 *   manifest: import('@vesper/core').Manifest,
 *   site: { id: string, name: string, origins: string[], root?: string },
 *   people: { id: string, name: string, email: string, role: import('@vesper/core').SiteRole, grants?: import('@vesper/core').Grant[] | null, picture?: boolean }[],
 *   base?: string,
 * }} options
 */
export function createCloudFake(options) {
  const { github, manifest, site } = options;
  const people = options.people.map((person) => ({ ...person }));
  const base = (options.base ?? 'http://cloud.test').replace(/\/+$/, '');
  const state = {
    /** Who the fake app signs in. */
    signedIn: people[0]?.id ?? null,
    /** The API stops answering, as if the cloud were unreachable. */
    down: false,
    /** Seconds added to the clock, to expire tokens. */
    skew: 0,
    codes: new Map(),
    access: new Map(),
    refresh: new Map(),
    jtis: new Set(),
    drafts: emptyDraftState(),
    reviews: [],
    /** Commit SHA to what the host reported. */
    deploys: new Map(),
    /** Emails the cloud would have sent. */
    emails: [],
    log: [],
    /** Scheduled publishing, as a site admin sets it in the dashboard, and what it has done. */
    schedule: {
      trigger: null,
      holdScheduledDrafts: false,
      publicRepository: false,
      /** Milliseconds scheduling's clock is ahead of the real one. */
      ahead: 0,
      /** Up to when the alarm has run. */
      ranTo: Date.now(),
      /** Held changes: `{ id, drafts, at, by, path, state, message? }`. */
      holds: [],
      /** What became of each time in the files, by event ID, once it came. */
      results: new Map(),
      /** Rebuilds asked of the host or the workflow, with the time each was for. */
      rebuilds: [],
    },
  };
  const now = () => Date.now() + state.skew * 1000;
  const scheduleNow = () => Date.now() + state.schedule.ahead;
  const DAY = 24 * 3600 * 1000;
  const seconds = () => Math.floor(now() / 1000);
  /** Where review emails send people, as the real cloud's do: the studio's Changes. */
  const changesUrl = () => `${site.origins[0] ?? ''}/admin/#/changes`;
  const published = new GitHubStorage({
    owner: github.owner,
    repo: github.repo,
    branch: github.branch,
    root: site.root ?? '',
    token: () => github.state.token,
    apiUrl: 'http://github.fake',
    fetch: github.fetch,
    snapshotTtlMs: 0,
  });

  const cors = (request) => {
    const origin = request.headers.get('origin');
    if (!origin || !site.origins.includes(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, DPoP, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  };
  const json = (request, status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...cors(request),
      },
    });
  const error = (request, status, code, message) => json(request, status, { error: code, message });
  const token = () => randomBytes(24).toString('base64url');
  const person = (id) => people.find((p) => p.id === id) ?? null;
  const memberOf = (p) => ({ role: p.role, grants: p.grants ?? null });
  const by = (p) => ({ id: p.id, name: p.name });
  const seen = (jti) => state.jtis.has(jti) || (state.jtis.add(jti), false);

  function issue(p, jkt, family, startedAt) {
    const access = token();
    const refresh = token();
    state.access.set(access, { person: p.id, jkt, expires: seconds() + ACCESS_TTL });
    state.refresh.set(refresh, {
      person: p.id,
      jkt,
      family,
      startedAt,
      lastUsed: seconds(),
      used: false,
    });
    return {
      access_token: access,
      token_type: 'DPoP',
      expires_in: ACCESS_TTL,
      refresh_token: refresh,
      user: {
        id: p.id,
        name: p.name,
        email: p.email,
        ...(p.picture ? { avatar: `${base}/api/avatars/${p.id}.svg` } : {}),
      },
      site: { id: site.id, name: site.name },
      member: memberOf(p),
    };
  }

  /** The app's sign-in: checks the site, the address and membership, then back with a code. */
  function authorize(request, url) {
    const redirect = url.searchParams.get('redirect_uri') ?? '';
    const back = (params) => {
      const query = new URLSearchParams({ ...params, state: url.searchParams.get('state') ?? '' });
      return new Response(null, {
        status: 302,
        headers: { Location: `${redirect}#/callback?${query.toString()}` },
      });
    };
    let origin;
    try {
      origin = new URL(redirect).origin;
    } catch {
      origin = null;
    }
    if (url.searchParams.get('site') !== site.id || !origin || !site.origins.includes(origin)) {
      return new Response('This site can’t sign in here.', { status: 400 });
    }
    const challenge = url.searchParams.get('code_challenge') ?? '';
    if (
      url.searchParams.get('code_challenge_method') !== 'S256' ||
      !/^[\w-]{43,128}$/.test(challenge)
    ) {
      return back({ error: 'invalid_request' });
    }
    const p = person(state.signedIn);
    if (!p) return back({ error: 'access_denied' });
    const code = token();
    state.codes.set(code, { person: p.id, challenge, redirect, expires: seconds() + 60 });
    return back({ code });
  }

  async function exchange(request) {
    const body = await request.json().catch(() => null);
    const proof = await verifyDpopProof(request.headers.get('dpop'), {
      method: request.method,
      url: request.url,
      now: now(),
      seen,
    });
    if (!proof.ok) return error(request, 400, 'invalid_dpop_proof', proof.message);
    if (!body || body.site !== site.id) {
      return error(request, 400, 'invalid_request', 'This sign-in is for another site.');
    }
    if (body.grant_type === 'authorization_code') {
      const waiting = state.codes.get(body.code);
      state.codes.delete(body.code);
      const challenge = createHash('sha256')
        .update(String(body.code_verifier ?? ''))
        .digest('base64url');
      if (
        !waiting ||
        waiting.expires < seconds() ||
        waiting.redirect !== body.redirect_uri ||
        waiting.challenge !== challenge
      ) {
        return error(request, 400, 'invalid_grant', 'This sign-in didn’t work. Try again.');
      }
      const p = person(waiting.person);
      if (!p) return error(request, 400, 'invalid_grant', 'This sign-in didn’t work. Try again.');
      return json(request, 200, issue(p, proof.jkt, token(), seconds()));
    }
    if (body.grant_type === 'refresh_token') {
      const held = state.refresh.get(body.refresh_token);
      const lapsed =
        !held ||
        held.jkt !== proof.jkt ||
        seconds() - held.lastUsed > REFRESH_IDLE ||
        seconds() - held.startedAt > REFRESH_MAX;
      if (held?.used) {
        // A rotated token used again: someone copied it, so the whole sign-in ends.
        for (const [key, value] of state.refresh) {
          if (value.family === held.family) state.refresh.delete(key);
        }
      }
      if (lapsed || held.used) {
        return error(
          request,
          400,
          'invalid_grant',
          'Your Vesper sign-in has ended. Sign in again.',
        );
      }
      held.used = true;
      const p = person(held.person);
      if (!p) return error(request, 400, 'invalid_grant', 'Your Vesper sign-in has ended.');
      return json(request, 200, issue(p, proof.jkt, held.family, held.startedAt));
    }
    return error(request, 400, 'invalid_request', 'Unknown grant type.');
  }

  async function signOutOf(request) {
    const body = await request.json().catch(() => null);
    const held = body ? state.refresh.get(body.refresh_token) : undefined;
    if (held) {
      for (const [key, value] of state.refresh) {
        if (value.family === held.family) state.refresh.delete(key);
      }
    }
    return json(request, 200, { ok: true });
  }

  /** The signed-in person behind a request, with the token and proof checked. */
  async function authenticate(request) {
    const match = /^DPoP (.+)$/.exec(request.headers.get('authorization') ?? '');
    const held = match ? state.access.get(match[1]) : undefined;
    if (!match || !held || held.expires < seconds()) {
      return {
        response: error(
          request,
          401,
          'invalid_token',
          'Your Vesper sign-in has expired. Sign in again.',
        ),
      };
    }
    const proof = await verifyDpopProof(request.headers.get('dpop'), {
      method: request.method,
      url: request.url,
      accessToken: match[1],
      now: now(),
      seen,
    });
    if (!proof.ok || proof.jkt !== held.jkt) {
      return {
        response: error(
          request,
          401,
          'invalid_dpop_proof',
          proof.ok ? 'This token belongs to another browser.' : proof.message,
        ),
      };
    }
    // Membership is read now, never from the token (spec §7.2).
    const p = person(held.person);
    if (!p) return { response: error(request, 403, 'forbidden', 'You’re no longer on this site.') };
    return { person: p, member: memberOf(p) };
  }

  const draftById = (id) => state.drafts.drafts.find((d) => d.id === id);
  const draftChanges = (draft) =>
    draft.files.map((file) =>
      file.op === 'delete'
        ? { op: 'delete', path: file.path, expectedVersion: file.base }
        : { op: 'put', path: file.path, bytes: new Uint8Array(), expectedVersion: file.base },
    );
  const mayEdit = (member, draft) => changeAccess(member, manifest, draftChanges(draft));
  const mayPublish = (member, draft) => {
    const access = mayEdit(member, draft);
    return access.ok && access.publish;
  };

  /** The hold a draft waits in, if any. */
  const holdOf = (id) =>
    state.schedule.holds.find((hold) => hold.state === 'held' && hold.drafts.includes(id));
  /** A draft as the API sends it, saying when it's held until. */
  const wireDraft = (draft) => {
    const hold = holdOf(draft.id);
    return { ...draftForWire(draft), ...(hold ? { held: { at: hold.at, event: hold.id } } : {}) };
  };
  /** Drafts published or discarded leave their holds; a hold left with none is gone. */
  const unhold = (ids) => {
    for (const hold of state.schedule.holds) {
      if (hold.state === 'held') hold.drafts = hold.drafts.filter((id) => !ids.includes(id));
    }
    state.schedule.holds = state.schedule.holds.filter(
      (hold) => hold.state !== 'held' || hold.drafts.length > 0,
    );
  };
  const holdEvent = (hold) => ({
    id: hold.id,
    at: hold.at,
    change: 'publish',
    path: hold.path,
    state: hold.state,
    held: { drafts: [...hold.drafts], by: hold.by },
    ...(hold.message ? { message: hold.message } : {}),
  });
  const fileEventId = (change) => `${change.change}:${change.path}:${change.at}`;
  /** Times still to come in the published files, read with core as the build reads them. */
  const fileChanges = (after) =>
    new ContentService(published, manifest).scheduledChanges(new Date(after));

  /** What `GET /schedule` lists: held changes always, times in the files when there's a trigger. */
  async function scheduleEvents() {
    const at = scheduleNow();
    const events = [];
    if (state.schedule.trigger) {
      for (const change of await fileChanges(at)) {
        events.push({
          id: fileEventId(change),
          at: change.at,
          change: change.change,
          path: change.path,
          state: 'waiting',
        });
      }
      for (const [id, result] of state.schedule.results) {
        if (at - Date.parse(result.at) < DAY) events.push({ id, ...result });
      }
    }
    for (const hold of state.schedule.holds) {
      if (hold.state === 'held' || at - Date.parse(hold.at) < DAY) events.push(holdEvent(hold));
    }
    return events.sort(
      (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.path.localeCompare(b.path),
    );
  }

  /** Publishes a held change as Publish would, by whoever held it, or says why it can't. */
  async function publishHeld(hold) {
    const fail = (message) => {
      hold.state = 'failed';
      hold.message = message;
      const scheduler = person(hold.by.id);
      if (scheduler) {
        state.emails.push({
          to: scheduler.email,
          subject: 'A scheduled change wasn’t published',
          url: `${site.origins[0] ?? ''}/admin/#/scheduled`,
        });
      }
      state.drafts.version += 1;
      return false;
    };
    const scheduler = person(hold.by.id);
    const drafts = hold.drafts.map(draftById);
    if (drafts.some((d) => !d)) return fail('Some of its changes were discarded.');
    if (!scheduler || drafts.some((d) => !mayPublish(memberOf(scheduler), d))) {
      return fail(`${hold.by.name} can no longer publish these changes, so they wait as a draft.`);
    }
    const changeSet = publishChangeSet(state.drafts, hold.drafts, {
      by: by(scheduler),
      noReplyDomain: 'users.noreply.vesper.test',
    });
    const result = await published.commit(changeSet);
    if (!result.ok) {
      return fail(
        'The page changed on the site after it was scheduled, so it wasn’t published. It waits as a draft: open it to compare and publish.',
      );
    }
    clearDrafts(state.drafts, hold.drafts);
    state.reviews = state.reviews.filter((r) => !r.drafts.some((d) => hold.drafts.includes(d)));
    state.deploys.set(result.version, { state: 'building' });
    hold.state = 'started';
    return true;
  }

  /**
   * The alarm: everything due since it last ran. Held changes are published
   * first; then each instant gets one rebuild, unless a publish at that
   * instant already starts the host's build.
   */
  async function fire() {
    const to = scheduleNow();
    const from = state.schedule.ranTo;
    state.schedule.ranTo = to;
    const instants = new Map();
    for (const hold of state.schedule.holds) {
      if (hold.state !== 'held' || Date.parse(hold.at) > to) continue;
      const committed = await publishHeld(hold);
      instants.set(hold.at, (instants.get(hold.at) ?? false) || committed);
    }
    if (state.schedule.trigger) {
      for (const change of await fileChanges(from)) {
        if (Date.parse(change.at) > to) continue;
        state.schedule.results.set(fileEventId(change), {
          at: change.at,
          change: change.change,
          path: change.path,
          state: 'started',
        });
        if (!instants.has(change.at)) instants.set(change.at, false);
      }
    }
    for (const [at, built] of [...instants].sort(([a], [b]) => Date.parse(a) - Date.parse(b))) {
      if (built || !state.schedule.trigger) continue;
      state.schedule.rebuilds.push({ at, via: state.schedule.trigger });
      if (state.schedule.trigger === 'dispatch') {
        await github.handle(
          new Request(`http://github.fake/repos/${github.owner}/${github.repo}/dispatches`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${github.state.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ event_type: 'vesper-rebuild', client_payload: { at } }),
          }),
        );
      }
    }
  }

  async function readBlob(version) {
    for (const draft of state.drafts.drafts) {
      if (draft.bytes[version]) return draft.bytes[version];
    }
    const response = await github.handle(
      new Request(`http://github.fake/repos/${github.owner}/${github.repo}/git/blobs/${version}`, {
        headers: {
          Authorization: `Bearer ${github.state.token}`,
          Accept: 'application/vnd.github.raw',
        },
      }),
    );
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  }

  async function siteRequest(request, url, rest) {
    const who = await authenticate(request);
    if (who.response) return who.response;
    const { person: p, member } = who;
    const method = request.method;
    let found;

    if (rest === '/tree' && method === 'GET') {
      const [head, entries] = await Promise.all([published.head(), published.list()]);
      return json(request, 200, { commit: head.version, entries });
    }
    if (rest === '/blobs' && method === 'POST') {
      const body = await request.json();
      const blobs = {};
      for (const version of (body.versions ?? []).slice(0, 100)) {
        const bytes = await readBlob(version);
        if (bytes) blobs[version] = toBase64(bytes);
      }
      return json(request, 200, { blobs });
    }
    if (rest === '/drafts' && method === 'GET') {
      return json(request, 200, {
        version: String(state.drafts.version),
        drafts: state.drafts.drafts.map(wireDraft),
      });
    }
    if (rest === '/drafts' && method === 'PUT') {
      const body = await request.json();
      const changes = body.changes.map(decodeChange);
      const access = changeAccess(member, manifest, changes);
      if (!access.ok) {
        return json(request, 403, {
          ok: false,
          reason: 'forbidden',
          path: access.path,
          message: access.message,
        });
      }
      const saved = await saveDraft(
        state.drafts,
        published,
        { changes, message: body.message },
        by(p),
      );
      if (!saved.ok) return json(request, saved.reason === 'conflict' ? 409 : 400, saved);
      return json(request, 200, {
        ok: true,
        version: String(state.drafts.version),
        draft: saved.draft ? wireDraft(saved.draft) : null,
      });
    }
    if ((found = /^\/drafts\/([\w-]+)$/.exec(rest)) && method === 'DELETE') {
      const draft = draftById(found[1]);
      if (!draft) return error(request, 404, 'not_found', 'That draft is gone.');
      const access = mayEdit(member, draft);
      if (!access.ok) return error(request, 403, 'forbidden', access.message);
      discardDraft(state.drafts, draft.id);
      unhold([draft.id]);
      state.reviews = state.reviews.filter((r) => !r.drafts.includes(draft.id));
      return json(request, 200, { ok: true, version: String(state.drafts.version) });
    }
    if ((found = /^\/drafts\/([\w-]+)\/rebase$/.exec(rest)) && method === 'POST') {
      const draft = draftById(found[1]);
      if (!draft) return error(request, 404, 'not_found', 'That draft is gone.');
      const access = mayEdit(member, draft);
      if (!access.ok) return error(request, 403, 'forbidden', access.message);
      const body = await request.json();
      await rebaseDraft(state.drafts, published, draft.id, body.paths ?? []);
      return json(request, 200, { ok: true, version: String(state.drafts.version) });
    }
    if (rest === '/publish' && method === 'POST') {
      const body = await request.json();
      const ids = body.drafts ?? [];
      const drafts = ids.map(draftById);
      if (ids.length === 0 || drafts.some((d) => !d)) {
        return error(
          request,
          404,
          'not_found',
          'Some of these changes are gone. Reload to see what’s left.',
        );
      }
      for (const draft of drafts) {
        const access = mayEdit(member, draft);
        if (!access.ok || !access.publish) {
          return json(request, 403, {
            ok: false,
            reason: 'forbidden',
            message: access.ok ? 'Publishing these changes needs an approver.' : access.message,
          });
        }
      }
      const changeSet = publishChangeSet(state.drafts, ids, {
        by: by(p),
        noReplyDomain: 'users.noreply.vesper.test',
      });
      const result = await published.commit(changeSet);
      if (!result.ok) return json(request, result.reason === 'conflict' ? 409 : 422, result);
      clearDrafts(state.drafts, ids);
      unhold(ids);
      state.reviews = state.reviews.filter((r) => !r.drafts.some((d) => ids.includes(d)));
      state.deploys.set(result.version, { state: 'building' });
      return json(request, 200, { ok: true, commit: result.version });
    }
    if (rest === '/schedule' && method === 'GET') {
      return json(request, 200, {
        trigger: state.schedule.trigger,
        holdScheduledDrafts: state.schedule.holdScheduledDrafts,
        publicRepository: state.schedule.publicRepository,
        events: await scheduleEvents(),
      });
    }
    if (rest === '/schedule' && method === 'POST') {
      const body = await request.json();
      const ids = Array.isArray(body.drafts) ? body.drafts : [];
      const drafts = ids.map(draftById);
      if (!state.schedule.holdScheduledDrafts) {
        return json(request, 400, {
          ok: false,
          reason: 'rejected',
          message:
            'This site publishes scheduled changes at once. A site admin can have Vesper keep them until their time, in the dashboard.',
        });
      }
      if (ids.length === 0 || drafts.some((d) => !d)) {
        return error(request, 404, 'not_found', 'Some of these changes are gone.');
      }
      for (const draft of drafts) {
        const access = mayEdit(member, draft);
        if (!access.ok || !access.publish) {
          return json(request, 403, {
            ok: false,
            reason: 'forbidden',
            message: access.ok ? 'Scheduling these changes needs an approver.' : access.message,
          });
        }
      }
      const at = Date.parse(String(body.at ?? ''));
      if (Number.isNaN(at) || at <= scheduleNow()) {
        return json(request, 400, {
          ok: false,
          reason: 'rejected',
          message: 'That time has passed. Choose a later one.',
        });
      }
      // Holding drafts again moves them: a reschedule.
      unhold(ids);
      const entry =
        drafts
          .flatMap((d) => d.files.map((f) => f.path))
          .find((path) => collectionOf(manifest, path)?.collection.presentation?.schedule) ??
        drafts[0].files[0]?.path ??
        '';
      const hold = {
        id: `h_${token().slice(0, 12)}`,
        drafts: [...ids],
        at: new Date(at).toISOString(),
        by: by(p),
        path: entry,
        state: 'held',
      };
      state.schedule.holds.push(hold);
      state.drafts.version += 1;
      return json(request, 200, {
        ok: true,
        version: String(state.drafts.version),
        event: holdEvent(hold),
      });
    }
    if ((found = /^\/schedule\/([\w-]+)$/.exec(rest)) && method === 'DELETE') {
      const hold = state.schedule.holds.find((h) => h.id === found[1] && h.state === 'held');
      if (!hold) return error(request, 404, 'not_found', 'That change isn’t waiting any more.');
      for (const draft of hold.drafts.map(draftById).filter(Boolean)) {
        if (!mayPublish(member, draft)) {
          return error(request, 403, 'forbidden', 'Only an approver can change this schedule.');
        }
      }
      state.schedule.holds = state.schedule.holds.filter((h) => h !== hold);
      state.drafts.version += 1;
      return json(request, 200, { ok: true, version: String(state.drafts.version) });
    }
    if (rest === '/reviews' && method === 'GET') {
      return json(request, 200, { reviews: state.reviews });
    }
    if (rest === '/reviews' && method === 'POST') {
      const body = await request.json();
      const drafts = (body.drafts ?? []).map(draftById);
      if (drafts.length === 0 || drafts.some((d) => !d)) {
        return error(request, 404, 'not_found', 'Some of these changes are gone.');
      }
      for (const draft of drafts) {
        const access = mayEdit(member, draft);
        if (!access.ok) return error(request, 403, 'forbidden', access.message);
      }
      const review = {
        id: `r_${token().slice(0, 12)}`,
        drafts: drafts.map((d) => d.id),
        requestedBy: by(p),
        requestedAt: new Date(now()).toISOString(),
        state: 'open',
        comments: body.note
          ? [{ by: by(p), at: new Date(now()).toISOString(), body: body.note }]
          : [],
      };
      state.reviews.push(review);
      for (const draft of drafts) draft.review = review.id;
      state.drafts.version += 1;
      for (const approver of people) {
        const canPublish = drafts.every((d) => {
          const access = mayEdit(memberOf(approver), d);
          return access.ok && access.publish;
        });
        if (canPublish && approver.id !== p.id) {
          state.emails.push({
            to: approver.email,
            subject: `${p.name} asked you to review changes`,
            url: changesUrl(),
          });
        }
      }
      return json(request, 200, review);
    }
    if ((found = /^\/reviews\/([\w-]+)$/.exec(rest)) && method === 'POST') {
      const review = state.reviews.find((r) => r.id === found[1]);
      if (!review) return error(request, 404, 'not_found', 'That review is gone.');
      const body = await request.json();
      const approver = review.drafts.every((id) => {
        const draft = draftById(id);
        const access = draft ? mayEdit(member, draft) : { ok: false };
        return access.ok && access.publish;
      });
      if (!approver)
        return error(request, 403, 'forbidden', 'Only an approver can answer this review.');
      review.comments.push({
        by: by(p),
        at: new Date(now()).toISOString(),
        body: String(body.body ?? ''),
      });
      if (body.action === 'request-changes') {
        review.state = 'changes-requested';
        const requester = person(review.requestedBy.id);
        if (requester) {
          state.emails.push({
            to: requester.email,
            subject: `${p.name} asked for changes`,
            url: changesUrl(),
          });
        }
      }
      return json(request, 200, review);
    }
    if (rest === '/status' && method === 'GET') {
      const commit = url.searchParams.get('commit') ?? '';
      return json(request, 200, state.deploys.get(commit) ?? { state: 'unknown' });
    }
    return error(request, 404, 'not_found', 'Not found.');
  }

  /** A person's picture, as the cloud serves one: no token, cached for good. */
  function pictureOf(id) {
    const p = person(id);
    if (!p?.picture) return new Response('Not found.', { status: 404 });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#226b63"/><circle cx="32" cy="26" r="12" fill="#f3ede7"/><rect x="14" y="42" width="36" height="22" rx="11" fill="#f3ede7"/></svg>`;
    return new Response(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  async function handle(request) {
    const url = new URL(request.url);
    state.log.push(`${request.method} ${url.pathname}${url.search}`);
    const path = url.pathname;
    if (path === '/app/authorize' && request.method === 'GET') return authorize(request, url);
    if (!path.startsWith('/api/')) return new Response('Not found.', { status: 404 });
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request) });
    }
    const rest = path.slice('/api'.length);
    if (rest === '/token' && request.method === 'POST') return exchange(request);
    if (rest === '/sign-out' && request.method === 'POST') return signOutOf(request);
    const avatar = /^\/avatars\/([\w-]+)\.svg$/.exec(rest);
    if (avatar && request.method === 'GET') return pictureOf(avatar[1]);
    const match = /^\/sites\/([\w-]+)(\/.*)$/.exec(rest);
    if (!match || match[1] !== site.id)
      return error(request, 404, 'not_found', 'There’s no such site.');
    return siteRequest(request, url, match[2]);
  }

  return {
    state,
    people,
    site,
    settings: { project: site.id, app: `${base}/app`, api: `${base}/api` },
    published,
    handle,
    fetch: (input, init) => handle(input instanceof Request ? input : new Request(input, init)),
    /** What the host reports for a commit, as GitHub's statuses would tell the cloud. */
    setDeploy: (commit, status) => state.deploys.set(commit, status),
    /** Changes someone's role or grants, as a site admin would in the dashboard. */
    setMember: (id, member) => {
      const p = person(id);
      if (p) Object.assign(p, member);
    },
    /** Scheduled publishing's settings, as a site admin sets them in the dashboard. */
    setSchedule: (settings) => {
      for (const key of ['trigger', 'holdScheduledDrafts', 'publicRepository']) {
        if (key in settings) state.schedule[key] = settings[key];
      }
    },
    /** Moves scheduling's clock on by `ms` and runs what fell due, as the alarm would. */
    advance: async (ms) => {
      state.schedule.ahead += ms;
      await fire();
    },
  };
}

/**
 * Serves a fake cloud over HTTP. While `state.down`, every connection is
 * dropped. With `control`, the end-to-end tests drive it at `/__test/…`,
 * which answers even while it's down:
 * - `POST /__test/sign-in-as` `{ id }`: who the app signs in next;
 * - `POST /__test/down` `{ down }`;
 * - `POST /__test/deploy` `{ commit, state, url? }`: what the host reports;
 * - `POST /__test/schedule` `{ trigger?, holdScheduledDrafts?, publicRepository? }`;
 * - `POST /__test/advance` `{ ms }`: scheduling's clock moves on, and what fell due runs;
 * - `GET /__test/state`: drafts, reviews, emails, held changes and rebuilds.
 */
export function serveCloudFake(fake, port, host = '127.0.0.1', options = {}) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    if (options.control && req.url?.startsWith('/__test/')) {
      const input = body ? JSON.parse(body.toString('utf8')) : {};
      const answer = (value) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(value));
      };
      if (req.url === '/__test/sign-in-as') {
        fake.state.signedIn = input.id ?? null;
        return answer({ ok: true });
      }
      if (req.url === '/__test/down') {
        fake.state.down = input.down === true;
        return answer({ ok: true });
      }
      if (req.url === '/__test/deploy') {
        fake.setDeploy(input.commit, {
          state: input.state,
          ...(input.url ? { url: input.url } : {}),
        });
        return answer({ ok: true });
      }
      if (req.url === '/__test/schedule') {
        fake.setSchedule(input);
        return answer({ ok: true });
      }
      if (req.url === '/__test/advance') {
        await fake.advance(Number(input.ms) || 0);
        return answer({ ok: true });
      }
      if (req.url === '/__test/state') {
        return answer({
          drafts: fake.state.drafts.drafts.map((d) => ({
            id: d.id,
            summary: d.summary,
            files: d.files.map((f) => f.path),
            review: d.review ?? null,
          })),
          reviews: fake.state.reviews,
          emails: fake.state.emails,
          holds: fake.state.schedule.holds,
          rebuilds: fake.state.schedule.rebuilds,
        });
      }
      res.statusCode = 404;
      return answer({ ok: false });
    }
    if (fake.state.down) {
      req.socket.destroy();
      return;
    }
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([key, value]) =>
        Array.isArray(value)
          ? value.map((v) => [key, v])
          : value === undefined
            ? []
            : [[key, value]],
      ),
      ...(body && req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}),
    });
    try {
      const response = await fake.handle(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (thrown) {
      res.statusCode = 500;
      res.end(String(thrown));
    }
  });
  // Never close an idle connection: git runs synchronously here, so a keep-alive
  // timer could fire late, as a test's request arrived on that connection, and
  // reset it (the studio's checks for new drafts made that happen).
  server.keepAliveTimeout = 0;
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
