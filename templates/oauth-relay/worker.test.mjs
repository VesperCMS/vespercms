import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitHubFake } from '../../scripts/github-fake.mjs';
import worker from './worker.js';

// The relay (spec §6.8) against the fake GitHub's sign-in pages and token
// endpoint: the site allowlist, state, PKCE passed through, CORS, and a
// whole sign-in from the studio's redirect to its token.

const RELAY = 'https://relay.example.test';
const SITE = 'https://example.edu';
const env = {
  GITHUB_CLIENT_ID: 'Iv1.test',
  GITHUB_CLIENT_SECRET: 'secret',
  ALLOWED_ORIGINS: `${SITE}, https://www.example.edu`,
  GITHUB_URL: 'https://github.test',
};
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

const dirs = [];
let fake;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-relay-'));
  dirs.push(dir);
  fake = createGitHubFake({ dir: join(dir, 'repo.git') });
  // The relay's one outgoing call goes to the fake.
  vi.stubGlobal('fetch', (input, init) => fake.fetch(input, init));
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const call = (path, init) => worker.fetch(new Request(`${RELAY}${path}`, init), env);
const authorizeUrl = (returnTo = `${SITE}/admin/`, state = 'studio-state-1') =>
  `/authorize?${new URLSearchParams({ return: returnTo, state, code_challenge: challenge, code_challenge_method: 'S256' })}`;

describe('the GitHub sign-in relay', () => {
  it('sends an allowed site on to GitHub, with its client ID, callback and challenge', async () => {
    const response = await call(authorizeUrl());
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get('Location'));
    expect(target.origin + target.pathname).toBe('https://github.test/login/oauth/authorize');
    expect(Object.fromEntries(target.searchParams)).toMatchObject({
      client_id: 'Iv1.test',
      redirect_uri: `${RELAY}/callback`,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses sites not on its list, and sign-ins missing their state or challenge', async () => {
    expect((await call(authorizeUrl('https://evil.example/admin/'))).status).toBe(403);
    expect((await call(authorizeUrl('http://example.edu/admin/'))).status).toBe(403);
    expect((await call(authorizeUrl(`${SITE}/admin/`, ''))).status).toBe(400);
    expect(
      (await call('/token', { method: 'POST', headers: { Origin: 'https://evil.example' } }))
        .status,
    ).toBe(403);
  });

  it('signs in from start to finish, and the code alone gets nothing', async () => {
    // The studio goes to the relay, the relay to GitHub, GitHub back to the relay.
    const toGitHub = await call(authorizeUrl());
    const fromGitHub = await fake.handle(new Request(toGitHub.headers.get('Location')));
    const callback = new URL(fromGitHub.headers.get('Location'));
    expect(callback.origin + callback.pathname).toBe(`${RELAY}/callback`);
    const toSite = await call(callback.pathname + callback.search);
    const site = new URL(toSite.headers.get('Location'));
    expect(site.origin + site.pathname).toBe(`${SITE}/admin/`);
    expect(site.searchParams.get('state')).toBe('studio-state-1');
    const code = site.searchParams.get('github');

    const headers = { Origin: SITE, 'Content-Type': 'application/json' };
    const preflight = await call('/token', { method: 'OPTIONS', headers: { Origin: SITE } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(SITE);

    const wrong = await call('/token', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code, code_verifier: 'w'.repeat(43) }),
    });
    expect(wrong.status).toBe(400);

    // A fresh sign-in, since GitHub's codes work once.
    const again = await fake.handle(
      new Request((await call(authorizeUrl())).headers.get('Location')),
    );
    const againSite = new URL(
      (
        await call(
          new URL(again.headers.get('Location')).pathname +
            new URL(again.headers.get('Location')).search,
        )
      ).headers.get('Location'),
    );
    const ok = await call('/token', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: againSite.searchParams.get('github'), code_verifier: verifier }),
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(await ok.json()).toEqual({ token: fake.state.token, expiresIn: 28800 });
  });

  it('passes a refusal on GitHub back to the site, and won’t forward to a site it doesn’t know', async () => {
    const state = btoa(JSON.stringify({ r: `${SITE}/admin/`, s: 'abc' })).replace(/=+$/, '');
    const refused = await call(`/callback?error=access_denied&state=${state}`);
    const site = new URL(refused.headers.get('Location'));
    expect(Object.fromEntries(site.searchParams)).toEqual({
      github_error: 'access_denied',
      state: 'abc',
    });

    const forged = btoa(JSON.stringify({ r: 'https://evil.example/admin/', s: 'abc' })).replace(
      /=+$/,
      '',
    );
    expect((await call(`/callback?code=x&state=${forged}`)).status).toBe(400);
  });
});
