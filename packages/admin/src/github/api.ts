import {
  GitHubError,
  GitHubStorage,
  type BlobCache,
  type Manifest,
  type UrlEntry,
} from '@vesper/core';
import { ApiError, type StudioApi } from '../app/api.ts';
import { createBrowserApi } from '../app/browser-api.ts';
import type { GitHubStudioSettings } from './session.ts';

/*
 * GitHub mode's back end (spec §6.8): core's services in the browser over
 * the repository's branch (app/browser-api.ts). Every save is a commit.
 */

export type GitHubApiOptions = {
  settings: GitHubStudioSettings;
  /** The current token. */
  token: () => string;
  manifest: Manifest;
  loadMdxProps: () => Promise<Readonly<Record<string, unknown>>>;
  loadUrlFunctions?: () => Promise<Readonly<Record<string, (entry: UrlEntry) => unknown>>>;
  /** The site's static routes at build, for collision checks. */
  routes?: readonly (readonly [string, string])[];
  cache?: BlobCache;
  /** Called when GitHub says the sign-in has expired. */
  onExpired?: () => void;
  fetch?: typeof fetch;
};

export function createGitHubApi(options: GitHubApiOptions): StudioApi {
  const { settings } = options;
  const storage = new GitHubStorage({
    owner: settings.owner,
    repo: settings.repo,
    branch: settings.branch,
    root: settings.root,
    token: options.token,
    ...(settings.apiUrl ? { apiUrl: settings.apiUrl } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return createBrowserApi({
    storage,
    manifest: options.manifest,
    schemas: settings.schemas,
    loadMdxProps: options.loadMdxProps,
    ...(options.loadUrlFunctions ? { loadUrlFunctions: options.loadUrlFunctions } : {}),
    ...(options.routes ? { routes: options.routes } : {}),
    publishesOnSave: true,
    mapError: (error) => apiError(error, options.onExpired),
  });
}

/** GitHub's errors as the studio shows them: plain words, and a status the screens understand. */
export function apiError(error: unknown, onExpired?: () => void): unknown {
  if (!(error instanceof GitHubError)) return error;
  switch (error.kind) {
    case 'auth':
      onExpired?.();
      return new ApiError(401, 'Your GitHub sign-in has expired. Sign in again to publish.');
    case 'rate-limit':
      return new ApiError(
        429,
        error.retryAt
          ? `GitHub asked the studio to slow down. Try again after ${error.retryAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
          : 'GitHub asked the studio to slow down. Try again in a few minutes.',
      );
    case 'network':
      return new ApiError(0, error.message);
    case 'forbidden':
    case 'not-found':
      return new ApiError(
        error.status,
        'Your GitHub account can’t reach this site’s repository. Ask its owner to add you.',
      );
    default:
      return new ApiError(502, 'GitHub had a problem. Try again in a moment.');
  }
}
