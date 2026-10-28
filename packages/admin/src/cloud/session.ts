import {
  CloudClient,
  CloudError,
  authorizeUrl,
  createDpopKey,
  createPkce,
  type CloudStudioSettings,
  type CloudTokens,
  type CloudUser,
  type Member,
} from '@vespercms/core';
import { keyValueStore, type KeyValueStore } from '../app/idb.ts';

/*
 * Signing in to the cloud (spec §6.9, §7.2): a top-level redirect to the
 * app's /authorize with PKCE, and back to `/admin/#/callback` with a
 * one-time code, which the studio exchanges for tokens bound to a key it
 * made (DPoP). No popup and no third-party cookie (D14).
 *
 * The key pair, whose private half can't be read back out, and the tokens
 * live together in IndexedDB, so a reload or a second tab stays signed in
 * until the refresh token lapses (DECISIONS.md, "The studio stays signed in
 * with tokens bound to a key").
 */

/** The cloud's settings, as the build writes them into the studio. */
export type CloudSettings = CloudStudioSettings & {
  /** The site's schemas built for the browser. */
  schemas: string;
};

export type StoredSession = {
  key: CryptoKeyPair;
  tokens: CloudTokens | null;
  user?: CloudUser;
  member?: Member;
  siteName?: string;
};

/*
 * A sign-in in progress is kept by its state in localStorage, so any tab on
 * the site can finish it. Signing in by email link comes back in the tab the
 * mail client opened, whose sessionStorage is its own: kept there, the
 * sign-in was refused as one that didn't start here. A state no tab began is
 * still refused.
 */
const PENDING_PREFIX = 'vesper.cloud.pending.';
/** Long enough to ask for a sign-in link (15 minutes) and use it. */
const PENDING_TTL = 30 * 60 * 1000;

type Pending = { state: string; verifier: string; route: string; started: number };

let defaultStore: KeyValueStore<StoredSession> | null = null;
export function sessionStore(): KeyValueStore<StoredSession> {
  defaultStore ??= keyValueStore<StoredSession>('vesper-cloud', 'sessions');
  return defaultStore;
}

function pendingStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readPending(storage: Storage, key: string): Pending | null {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null') as Pending | null;
  } catch {
    return null;
  }
}

/** Drops sign-ins that never came back, so they don't pile up. */
function sweepPending(storage: Storage, now: number): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PENDING_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    const pending = readPending(storage, key);
    if (!pending || !(now - pending.started < PENDING_TTL)) storage.removeItem(key);
  }
}

/** The sign-in this state began, once: it leaves storage as it's read. */
function takePending(state: string | null): Pending | null {
  const storage = pendingStorage();
  if (!storage) return null;
  const now = Date.now();
  sweepPending(storage, now);
  if (!state) return null;
  const key = `${PENDING_PREFIX}${state}`;
  const pending = readPending(storage, key);
  storage.removeItem(key);
  return pending?.state === state ? pending : null;
}

/** Runs `work` alone among this browser's tabs, where Web Locks exist. */
function acrossTabs<T>(name: string, work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? locks.request(name, work) : work();
}

/** The stored key, made and kept on first use: a sign-in must exchange its code with the key it started with. */
export async function sessionKey(
  project: string,
  store: KeyValueStore<StoredSession> = sessionStore(),
): Promise<StoredSession> {
  const found = await store.get(project);
  if (found) return found;
  const session: StoredSession = { key: await createDpopKey(), tokens: null };
  await store.put(project, session);
  return session;
}

/** The studio's own address, which the app sends the browser back to. */
export function studioAddress(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/** Goes to the app's sign-in. `route` is the studio's hash route to come back to. */
export async function startCloudSignIn(
  settings: CloudSettings,
  route: string,
  store?: KeyValueStore<StoredSession>,
): Promise<void> {
  await sessionKey(settings.project, store);
  const state = crypto.randomUUID();
  const { verifier, challenge } = await createPkce();
  const storage = pendingStorage();
  if (storage) {
    const started = Date.now();
    sweepPending(storage, started);
    storage.setItem(
      `${PENDING_PREFIX}${state}`,
      JSON.stringify({ state, verifier, route, started } satisfies Pending),
    );
  }
  window.location.assign(
    authorizeUrl(settings, { redirectUri: studioAddress(), state, challenge }),
  );
}

/** The callback's parameters, when the app sent the browser back here. */
export function callbackParams(hash: string = window.location.hash): URLSearchParams | null {
  const match = /^#\/callback\?(.*)$/.exec(hash);
  return match ? new URLSearchParams(match[1]) : null;
}

export type CloudSignedIn = {
  client: CloudClient;
  user: CloudUser;
  member: Member;
  siteName: string;
};

export type CloudSignIn =
  ({ ok: true; route: string } & CloudSignedIn) | { ok: false; message: string };

function clientFor(
  settings: CloudSettings,
  session: StoredSession,
  store: KeyValueStore<StoredSession>,
  fetcher?: typeof fetch,
): CloudClient {
  return new CloudClient({
    settings,
    key: session.key,
    tokens: session.tokens,
    ...(fetcher ? { fetch: fetcher } : {}),
    onTokens: (tokens) => {
      session.tokens = tokens;
      void store.put(settings.project, session);
    },
    latest: async () => (await store.get(settings.project))?.tokens ?? null,
    exclusive: (work) => acrossTabs(`vesper-cloud-renew:${settings.project}`, work),
  });
}

/**
 * Finishes a sign-in when the app sent the browser back here, or returns
 * null when it didn't. The code leaves the address either way.
 */
export async function finishCloudSignIn(
  settings: CloudSettings,
  options: { store?: KeyValueStore<StoredSession>; fetch?: typeof fetch } = {},
): Promise<CloudSignIn | null> {
  const params = callbackParams();
  if (!params) return null;
  const store = options.store ?? sessionStore();
  const pending = takePending(params.get('state'));
  const route = pending?.route && !pending.route.startsWith('#/callback') ? pending.route : '#/';
  history.replaceState(history.state, '', `${window.location.pathname}${route}`);
  const error = params.get('error');
  if (error !== null) {
    return {
      ok: false,
      message:
        error === 'access_denied'
          ? 'Your Vesper account doesn’t have access to this site. Ask the site’s admin to invite you.'
          : 'Vesper didn’t sign you in. Try again.',
    };
  }
  const code = params.get('code');
  if (!pending || !code) {
    return { ok: false, message: 'That sign-in didn’t start here. Try again.' };
  }
  const session = await sessionKey(settings.project, store);
  const client = clientFor(settings, session, store, options.fetch);
  try {
    const tokens = await client.exchangeCode({
      code,
      verifier: pending.verifier,
      redirectUri: studioAddress(),
    });
    Object.assign(session, {
      user: tokens.user,
      member: tokens.member,
      siteName: tokens.site.name,
    });
    await store.put(settings.project, session);
    return {
      ok: true,
      route,
      client,
      user: tokens.user,
      member: tokens.member,
      siteName: tokens.site.name,
    };
  } catch (thrown) {
    return {
      ok: false,
      message:
        thrown instanceof CloudError ? thrown.message : 'Vesper couldn’t be reached. Try again.',
    };
  }
}

export type Resumed =
  ({ kind: 'signed-in' } & CloudSignedIn) | { kind: 'signed-out' } | { kind: 'unreachable' };

/**
 * Picks up a sign-in this browser already has. The refresh brings fresh
 * tokens and the person's current role and grants, which may have changed
 * in the dashboard since.
 */
export async function resumeCloudSession(
  settings: CloudSettings,
  options: { store?: KeyValueStore<StoredSession>; fetch?: typeof fetch } = {},
): Promise<Resumed> {
  const store = options.store ?? sessionStore();
  const session = await store.get(settings.project);
  if (!session?.tokens) return { kind: 'signed-out' };
  const client = clientFor(settings, session, store, options.fetch);
  try {
    const tokens = await client.refresh();
    Object.assign(session, {
      user: tokens.user,
      member: tokens.member,
      siteName: tokens.site.name,
    });
    await store.put(settings.project, session);
    return {
      kind: 'signed-in',
      client,
      user: tokens.user,
      member: tokens.member,
      siteName: tokens.site.name,
    };
  } catch (thrown) {
    if (thrown instanceof CloudError && thrown.status >= 400 && thrown.status < 500) {
      return { kind: 'signed-out' };
    }
    return { kind: 'unreachable' };
  }
}

/** Ends the sign-in, here and in the cloud. The key goes too: the next sign-in makes a new one. */
export async function endCloudSession(
  settings: CloudSettings,
  client: CloudClient | null,
  store: KeyValueStore<StoredSession> = sessionStore(),
): Promise<void> {
  await client?.signOut();
  await store.delete(settings.project);
}
