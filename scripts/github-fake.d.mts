// Types for github-fake.mjs, so tests import it with checking.
import type { Server } from 'node:http';

export type GitHubFakeState = {
  token: string;
  push: boolean;
  /** Whether the repository is private; tests flip it to see a public one. */
  private: boolean;
  /** Off, the repository answers 404, as before the site's GitHub App is installed there. */
  installed: boolean;
  protected: boolean;
  rateLimited: boolean;
  truncate: boolean;
  beforeRefUpdate: (() => void) | null;
  codes: Map<string, { challenge: string | null; redirect: string | null }>;
  /** `repository_dispatch` events sent to the repository. */
  dispatches: { event_type: string; client_payload: Record<string, unknown> }[];
  log: string[];
};

export type GitHubFake = {
  owner: string;
  repo: string;
  branch: string;
  login: string;
  state: GitHubFakeState;
  handle: (request: Request) => Promise<Response>;
  fetch: typeof fetch;
  head: () => string | null;
  commitFiles: (
    files: Record<string, string | Uint8Array | null>,
    message?: string,
    author?: string,
  ) => string;
  seedFolder: (folder: string, prefix?: string) => string;
  files: () => Record<string, Uint8Array>;
  log: () => { sha: string; author: string; message: string; changed: string[] }[];
};

export function createGitHubFake(options: {
  dir: string;
  owner?: string;
  repo?: string;
  branch?: string;
  token?: string;
  login?: string;
  push?: boolean;
  /** `false` for a public repository; repositories are private by default. */
  private?: boolean;
}): GitHubFake;

export function serveGitHubFake(fake: GitHubFake, port: number, host?: string): Promise<Server>;
