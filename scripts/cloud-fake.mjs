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
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import {
  GitHubStorage,
  changeAccess,
  clearDrafts,
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
 *   people: { id: string, name: string, email: string, role: import('@vesper/core').SiteRole, grants?: import('@vesper/core').Grant[] | null }[],
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
  };
  const now = () => Date.now() + state.skew * 1000;
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
      user: { id: p.id, name: p.name, email: p.email },
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
        drafts: state.drafts.drafts.map(draftForWire),
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
        draft: saved.draft ? draftForWire(saved.draft) : null,
      });
    }
    if ((found = /^\/drafts\/([\w-]+)$/.exec(rest)) && method === 'DELETE') {
      const draft = draftById(found[1]);
      if (!draft) return error(request, 404, 'not_found', 'That draft is gone.');
      const access = mayEdit(member, draft);
      if (!access.ok) return error(request, 403, 'forbidden', access.message);
      discardDraft(state.drafts, draft.id);
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
      const changeSet = publishChangeSet(state.drafts, ids);
      const trailers = {
        ...changeSet.message.trailers,
        'Vesper-Editor': p.id,
        'Co-authored-by': `${p.name} <${p.id}@users.noreply.vesper.test>`,
      };
      const result = await published.commit({
        ...changeSet,
        message: { ...changeSet.message, trailers },
      });
      if (!result.ok) return json(request, result.reason === 'conflict' ? 409 : 422, result);
      clearDrafts(state.drafts, ids);
      state.reviews = state.reviews.filter((r) => !r.drafts.some((d) => ids.includes(d)));
      state.deploys.set(result.version, { state: 'building' });
      return json(request, 200, { ok: true, commit: result.version });
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
  };
}

/**
 * Serves a fake cloud over HTTP. While `state.down`, every connection is
 * dropped. With `control`, the end-to-end tests drive it at `/__test/…`,
 * which answers even while it's down:
 * - `POST /__test/sign-in-as` `{ id }`: who the app signs in next;
 * - `POST /__test/down` `{ down }`;
 * - `POST /__test/deploy` `{ commit, state, url? }`: what the host reports;
 * - `GET /__test/state`: drafts, reviews and emails.
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
