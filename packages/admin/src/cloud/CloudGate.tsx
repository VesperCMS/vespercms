import { Button } from '@vespercms/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { App } from '../app/App.tsx';
import { startSignIn as startGitHubSignIn, type GitHubStudioSettings } from '../github/session.ts';
import type { Account, StudioOptions } from '../types.ts';
import { connect } from './connection.ts';
import {
  endCloudSession,
  finishCloudSignIn,
  resumeCloudSession,
  startCloudSignIn,
  type CloudSettings,
  type CloudSignedIn,
  type StoredSession,
} from './session.ts';
import type { KeyValueStore } from '../app/idb.ts';

/*
 * The cloud's way in (spec §6.9): finish a sign-in the app sent back here,
 * or pick up one this browser already has, then the studio connected to
 * the cloud. When the site also has GitHub mode, signing in with GitHub is
 * the second way in. One primary action per screen (spec §10.4).
 */

type GateOptions = Omit<StudioOptions, 'api' | 'github' | 'account' | 'cloud' | 'connection'>;

type State =
  | { kind: 'checking' }
  | { kind: 'signed-out'; message?: string }
  | { kind: 'unreachable' }
  | ({ kind: 'ready' } & CloudSignedIn);

const noProps = () => Promise.resolve({});

/** How often a visible studio asks for drafts and reviews: three small requests, the tree cached by commit in the cloud. */
const CHECK_EVERY = 60_000;

export function CloudGate({
  settings,
  github,
  options,
  fetcher,
  store,
}: {
  settings: CloudSettings;
  github?: GitHubStudioSettings | null;
  options: GateOptions;
  fetcher?: typeof fetch;
  /** Where the key and tokens are kept: IndexedDB unless a test passes its own. */
  store?: KeyValueStore<StoredSession>;
}) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [expired, setExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reach = useMemo(
    () => ({ ...(fetcher ? { fetch: fetcher } : {}), ...(store ? { store } : {}) }),
    [fetcher, store],
  );

  useEffect(() => {
    let live = true;
    const set = (next: State) => {
      if (live) setState(next);
    };
    void (async () => {
      const finished = await finishCloudSignIn(settings, reach);
      if (finished) {
        set(
          finished.ok
            ? { kind: 'ready', ...finished }
            : { kind: 'signed-out', message: finished.message },
        );
        return;
      }
      const resumed = await resumeCloudSession(settings, reach);
      if (resumed.kind === 'signed-in') set({ ...resumed, kind: 'ready' });
      else set({ kind: resumed.kind });
    })();
    return () => {
      live = false;
    };
    // `attempt` reruns the check after "Try again".
  }, [settings, reach, attempt]);

  const signIn = useCallback(() => {
    void startCloudSignIn(settings, window.location.hash, store);
  }, [settings, store]);
  const client = state.kind === 'ready' ? state.client : null;
  const leave = useCallback(() => {
    void endCloudSession(settings, client, store).then(() => {
      setExpired(false);
      setState({ kind: 'signed-out' });
    });
  }, [settings, client, store]);

  const ready = state.kind === 'ready' ? state : null;
  // One connection per sign-in, so its caches and drafts last the whole visit.
  const connected = useMemo(
    () =>
      ready
        ? connect({
            settings,
            client: ready.client,
            user: ready.user,
            member: ready.member,
            siteName: ready.siteName,
            manifest: options.manifest,
            loadMdxProps: options.loadMdxProps ?? noProps,
            ...(options.loadUrlFunctions ? { loadUrlFunctions: options.loadUrlFunctions } : {}),
            ...(options.routes ? { routes: options.routes } : {}),
            onExpired: () => {
              setExpired(true);
            },
          })
        : null,
    [ready, settings, options],
  );
  useEffect(() => {
    if (!connected) return;
    const drafts = connected.connection.drafts;
    // One check at a time: coming back into view and the timer can coincide.
    let checking = false;
    const check = () => {
      if (checking) return;
      checking = true;
      void drafts
        .refresh()
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    };
    check();
    // Other people's drafts and reviews arrive while this tab is open: an
    // approver's studio, open before a review was requested, showed nothing
    // of it until reloaded. A hidden tab doesn't ask.
    const whenSeen = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', whenSeen);
    const timer = window.setInterval(whenSeen, CHECK_EVERY);
    return () => {
      document.removeEventListener('visibilitychange', whenSeen);
      window.clearInterval(timer);
    };
  }, [connected]);

  const account = useMemo<Account | null>(
    () =>
      connected
        ? {
            label: connected.connection.user.name,
            name: connected.connection.user.name,
            ...(connected.connection.user.avatar
              ? { picture: connected.connection.user.avatar }
              : {}),
            description: `Signed in to Vesper as ${connected.connection.user.name}`,
            signOutLabel: 'Sign out of Vesper',
            dashboardUrl: connected.connection.dashboardUrl,
            signOut: leave,
            signInAgain: signIn,
            expired,
          }
        : null,
    [connected, leave, signIn, expired],
  );

  useEffect(() => {
    // Signed in, each screen names the page itself.
    if (state.kind !== 'ready')
      document.title = `${titleOf(state)} · ${options.siteName ?? 'Vesper'}`;
  }, [state, options.siteName]);

  if (connected && account) {
    return (
      <App {...options} api={connected.api} account={account} connection={connected.connection} />
    );
  }

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
            <p>
              Sign in with your Vesper account. Your changes are kept as drafts until they’re
              published.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onPress={signIn}>
                Sign in with Vesper
              </Button>
              {github && (
                <Button onPress={() => void startGitHubSignIn(github, window.location.hash)}>
                  Sign in with GitHub
                </Button>
              )}
            </div>
          </>
        )}
        {state.kind === 'unreachable' && (
          <>
            <p role="alert">
              Vesper can’t be reached. Check the connection and try again. Anything you were editing
              is kept on this device.
            </p>
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
    case 'unreachable':
      return 'Vesper couldn’t be reached';
    default:
      return 'Sign in to edit this site';
  }
}
