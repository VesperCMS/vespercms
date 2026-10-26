import { Button } from '@vesper/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { App } from '../app/App.tsx';
import type { StudioApi } from '../app/api.ts';
import type { Account, StudioOptions } from '../types.ts';
import { createGitHubApi } from './api.ts';
import { indexedDbCache } from './cache.ts';
import {
  finishSignIn,
  readSession,
  signOut,
  startSignIn,
  type GitHubStudioSettings,
  type Session,
} from './session.ts';

/*
 * GitHub mode's way in (spec §6.8, §6.9): finish a sign-in GitHub sent back
 * here, check the editor can push to the repository, then the studio with
 * GitHub as its back end. One primary action per screen (spec §10.4).
 */

type GateOptions = Omit<StudioOptions, 'api' | 'github' | 'account' | 'cloud'>;

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);
const noProps = () => Promise.resolve({});

type State =
  | { kind: 'checking' }
  | { kind: 'signed-out'; message?: string }
  | { kind: 'no-access'; login: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      session: Session;
      login: string;
      name: string;
      picture: string;
      /** The repository is public: a scheduled change can be read there early (spec §6.17). */
      publicRepository: boolean;
    };

export function GitHubGate({
  settings,
  options,
  fetcher = defaultFetch,
}: {
  settings: GitHubStudioSettings;
  options: GateOptions;
  fetcher?: typeof fetch;
}) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [expired, setExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const apiUrl = (settings.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');

  useEffect(() => {
    let live = true;
    const set = (next: State) => {
      if (live) setState(next);
    };
    void (async () => {
      const finished = await finishSignIn(settings, fetcher);
      if (finished && !finished.ok) {
        set({ kind: 'signed-out', message: finished.message });
        return;
      }
      const session = finished?.session ?? readSession();
      if (!session) {
        set({ kind: 'signed-out' });
        return;
      }
      const headers = {
        Authorization: `Bearer ${session.token}`,
        Accept: 'application/vnd.github+json',
      };
      try {
        const repo = await fetcher(
          `${apiUrl}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`,
          { headers },
        );
        if (repo.status === 401) {
          signOut();
          set({ kind: 'signed-out', message: 'Your GitHub sign-in has expired. Sign in again.' });
          return;
        }
        const user = await fetcher(`${apiUrl}/user`, { headers });
        const profile = user.ok
          ? ((await user.json()) as { login?: string; name?: string | null; avatar_url?: string })
          : {};
        const login = profile.login ?? '';
        const details = repo.ok
          ? ((await repo.json()) as { permissions?: { push?: boolean }; private?: boolean })
          : {};
        const permissions = details.permissions;
        if (!permissions?.push) {
          set({ kind: 'no-access', login });
          return;
        }
        set({
          kind: 'ready',
          session,
          login,
          name: profile.name?.trim() || `@${login}`,
          picture: avatarAt(profile.avatar_url ?? '', 64),
          publicRepository: details.private === false,
        });
      } catch {
        set({
          kind: 'error',
          message: 'GitHub couldn’t be reached. Check the connection and try again.',
        });
      }
    })();
    return () => {
      live = false;
    };
    // `attempt` reruns the check after "Try again".
  }, [settings, apiUrl, fetcher, attempt]);

  const signIn = useCallback(() => {
    void startSignIn(settings, window.location.hash);
  }, [settings]);
  const leave = useCallback(() => {
    signOut();
    setExpired(false);
    setState({ kind: 'signed-out' });
  }, []);

  const session = state.kind === 'ready' ? state.session : null;
  // One API per session, so its cache and services last the whole visit.
  const api = useMemo<StudioApi | null>(
    () =>
      session
        ? createGitHubApi({
            settings,
            token: () => session.token,
            manifest: options.manifest,
            loadMdxProps: options.loadMdxProps ?? noProps,
            ...(options.loadUrlFunctions ? { loadUrlFunctions: options.loadUrlFunctions } : {}),
            ...(options.routes ? { routes: options.routes } : {}),
            cache: indexedDbCache(),
            onExpired: () => {
              setExpired(true);
            },
            fetch: fetcher,
          })
        : null,
    [session, settings, options, fetcher],
  );
  const account = useMemo<Account | null>(
    () =>
      state.kind === 'ready'
        ? {
            label: `@${state.login}`,
            name: state.name,
            ...(state.picture ? { picture: state.picture } : {}),
            description: `Signed in to GitHub as @${state.login}`,
            signOutLabel: 'Sign out of GitHub',
            signOut: leave,
            signInAgain: signIn,
            expired,
            ...(state.publicRepository ? { publicRepository: true } : {}),
          }
        : null,
    [state, leave, signIn, expired],
  );

  useEffect(() => {
    // Signed in, each screen names the page itself.
    if (state.kind !== 'ready')
      document.title = `${titleOf(state)} · ${options.siteName ?? 'Vesper'}`;
  }, [state, options.siteName]);

  if (api && account) return <App {...options} api={api} account={account} />;

  const repo = `${settings.owner}/${settings.repo}`;
  return (
    <div className="afterglow min-h-screen">
      <main id="main" className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16">
        <h1 className="text-heading-1 text-content">{titleOf(state)}</h1>
        {state.kind === 'checking' && (
          <p role="status" className="text-content-muted">
            Opening the studio…
          </p>
        )}
        {state.kind === 'signed-out' && (
          <>
            {state.message && (
              <p role="alert" className="rounded-md border border-danger bg-surface-raised p-4">
                {state.message}
              </p>
            )}
            <p>You’ll publish to {repo} on GitHub. Changes go live after the site rebuilds.</p>
            <div>
              <Button variant="primary" onPress={signIn}>
                Sign in with GitHub
              </Button>
            </div>
          </>
        )}
        {state.kind === 'no-access' && (
          <>
            <p>
              {state.login ? `You’re signed in to GitHub as @${state.login}. ` : ''}Ask the site’s
              owner to give your account write access to {repo}.
            </p>
            <div>
              <Button onPress={leave}>Sign out of GitHub</Button>
            </div>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <p role="alert">{state.message}</p>
            <div>
              <Button
                variant="primary"
                onPress={() => {
                  setState({ kind: 'checking' });
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function titleOf(state: State): string {
  switch (state.kind) {
    case 'checking':
      return 'Opening the studio';
    case 'no-access':
      return 'Your GitHub account can’t change this site';
    case 'error':
      return 'GitHub couldn’t be reached';
    default:
      return 'Sign in to edit this site';
  }
}

/**
 * GitHub's picture at a size (`s`), or nothing when GitHub gave no address.
 * It loads from GitHub's image host, which GitHub mode already trusts with
 * every read and save (DECISIONS.md, "GitHub mode loads the editor's picture from GitHub").
 */
export function avatarAt(address: string, size: number): string {
  if (!address) return '';
  try {
    const url = new URL(address);
    url.searchParams.set('s', String(size));
    return url.href;
  } catch {
    return '';
  }
}
