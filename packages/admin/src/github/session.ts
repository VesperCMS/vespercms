/*
 * Signing in with GitHub (spec §6.8, §6.9): a top-level redirect through the
 * site's OAuth relay, with PKCE, and no popup or third-party cookie (D14).
 *
 * 1. The studio keeps a random state and a PKCE verifier in sessionStorage
 *    and goes to the relay's /authorize with the code challenge.
 * 2. The relay sends the browser to GitHub, and back here with
 *    `?github=<code>&state=<state>`. The code is useless without the
 *    verifier, which never left this tab.
 * 3. The studio posts the code and verifier to the relay's /token, which
 *    adds the app's secret and answers with an 8-hour token.
 *
 * Only that token is kept, in sessionStorage: it's gone when the tab closes,
 * and signing in again is one redirect, since GitHub remembers the approval
 * (DECISIONS.md, "GitHub mode keeps its token in sessionStorage").
 */

/** GitHub mode's settings, as the build writes them into the studio. */
export type GitHubStudioSettings = {
  owner: string;
  repo: string;
  branch: string;
  /** The site's folder inside the repository. */
  root: string;
  /** The OAuth relay's address. */
  relay: string;
  /** GitHub Enterprise Server's API, or a test double; GitHub's own when absent. */
  apiUrl?: string;
  /** The site's schemas built for the browser. */
  schemas: string;
};

export type Session = { token: string; expiresAt: number };

const SESSION_KEY = 'vesper.github.session';
const PENDING_KEY = 'vesper.github.pending';
/** A token this close to expiring is treated as expired, so a save never starts on one. */
const MARGIN_MS = 5 * 60 * 1000;

type Pending = { state: string; verifier: string; route: string };

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readSession(): Session | null {
  try {
    const raw = storage()?.getItem(SESSION_KEY);
    const session = raw ? (JSON.parse(raw) as Partial<Session>) : null;
    if (typeof session?.token !== 'string' || typeof session.expiresAt !== 'number') return null;
    return session.expiresAt - MARGIN_MS > Date.now() ? (session as Session) : null;
  } catch {
    return null;
  }
}

export function signOut(): void {
  storage()?.removeItem(SESSION_KEY);
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const random = (size: number) => base64url(crypto.getRandomValues(new Uint8Array(size)));

/** Goes to the relay, then GitHub. `route` is the studio's hash route to come back to. */
export async function startSignIn(settings: GitHubStudioSettings, route: string): Promise<void> {
  const state = random(16);
  const verifier = random(32);
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  storage()?.setItem(PENDING_KEY, JSON.stringify({ state, verifier, route } satisfies Pending));
  const back = `${window.location.origin}${window.location.pathname}`;
  const url = new URL(`${settings.relay}/authorize`);
  url.searchParams.set('return', back);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(url.href);
}

export type Finished =
  { ok: true; session: Session; route: string } | { ok: false; message: string };

/**
 * Finishes a sign-in when GitHub sent the browser back here, or returns
 * null when it didn't. The code leaves the address either way.
 */
export async function finishSignIn(
  settings: GitHubStudioSettings,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<Finished | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('github');
  const error = params.get('github_error');
  if (code === null && error === null) return null;
  const pendingRaw = storage()?.getItem(PENDING_KEY);
  storage()?.removeItem(PENDING_KEY);
  const pending = pendingRaw ? (JSON.parse(pendingRaw) as Pending) : null;
  const route = pending?.route ?? '';
  history.replaceState(history.state, '', `${window.location.pathname}${route}`);
  if (error !== null) {
    return {
      ok: false,
      message:
        error === 'access_denied'
          ? 'GitHub sign-in was cancelled.'
          : 'GitHub didn’t sign you in. Try again.',
    };
  }
  if (!pending || pending.state !== params.get('state')) {
    return { ok: false, message: 'That sign-in didn’t start here. Try again.' };
  }
  let response: Response;
  try {
    response = await fetcher(`${settings.relay}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: pending.verifier }),
    });
  } catch {
    return { ok: false, message: 'The sign-in service couldn’t be reached. Try again.' };
  }
  const body = (await response.json().catch(() => ({}))) as {
    token?: string;
    expiresIn?: number;
    message?: string;
  };
  if (!response.ok || typeof body.token !== 'string') {
    return { ok: false, message: body.message ?? 'GitHub didn’t sign you in. Try again.' };
  }
  const session = {
    token: body.token,
    expiresAt: Date.now() + (body.expiresIn ?? 8 * 60 * 60) * 1000,
  };
  storage()?.setItem(SESSION_KEY, JSON.stringify(session));
  return { ok: true, session, route };
}
