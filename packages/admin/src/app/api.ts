import type {
  CollectionSummary,
  EntryDocument,
  EntrySummary,
  MediaItem,
  MoveRequest,
  MoveResult,
  PageLink,
  ScheduledChange,
  PageTree,
  RedirectsDocument,
  ReorderRequest,
  ReorderResult,
  SaveRedirectsRequest,
  SaveRedirectsResult,
  SaveRequest,
  SaveResponse,
  UploadResponse,
} from '@vespercms/core';

/**
 * Everything the studio needs from a storage back end. Local mode talks to
 * the dev middleware; GitHub and cloud modes (Phases 3 and 4) implement the
 * same interface, so screens never know which mode they're in.
 */
export interface StudioApi {
  summary(): Promise<CollectionSummary[]>;
  listEntries(collection: string): Promise<EntrySummary[]>;
  readEntry(collection: string, id: string): Promise<EntryDocument>;
  saveEntry(request: SaveRequest): Promise<SaveResponse>;
  deleteEntry(collection: string, id: string, version: string): Promise<SaveResponse>;
  listMedia(): Promise<MediaItem[]>;
  /**
   * Stores an upload. `withNextSave`: where saving publishes, the file waits
   * and goes out with the next save, so an entry and its image are one
   * commit (spec §6.8). Local mode writes it at once either way.
   */
  upload(
    file: Blob,
    name: string,
    folder: string,
    options?: { withNextSave?: boolean },
  ): Promise<UploadResponse>;
  deleteMedia(path: string): Promise<SaveResponse>;
  /** Site-relative paths of the Markdoc and Markdown files a `{% partial %}` can point at. */
  listPartials(): Promise<string[]>;
  /**
   * A URL the studio can show a file from, given its site-relative path.
   * Asynchronous: GitHub mode fetches the blob and hands back an object URL.
   */
  fileUrl(path: string): Promise<string>;
  /** Every page with a URL, in every collection, for the link picker (spec §6.15.6). */
  listPages(): Promise<PageLink[]>;
  /** Every change still to come in the site's scheduled collections, soonest first (spec §6.17). */
  listScheduled(): Promise<ScheduledChange[]>;
  /** A tree collection's outline (spec §6.15.2). */
  pageTree(collection: string): Promise<PageTree>;
  /** Moves a page and everything under it; `dryRun` only describes what would happen. */
  movePage(request: MoveRequest, options?: { dryRun?: boolean }): Promise<MoveResult>;
  reorderPage(request: ReorderRequest): Promise<ReorderResult>;
  /** Creates the missing section page of a folder in the tree. */
  createSection(collection: string, path: string): Promise<SaveResponse>;
  readRedirects(): Promise<RedirectsDocument>;
  saveRedirects(request: SaveRedirectsRequest): Promise<SaveRedirectsResult>;
  /**
   * Whether Save publishes (GitHub and cloud modes) or only writes the file on
   * this computer (local mode), where the site's publish gate can be saved past.
   */
  publishesOnSave(): boolean;
  /**
   * Local mode only: who is editing, from git's `user.name` on this computer,
   * for the user menu (DECISIONS.md, "Appearance is in the user menu").
   */
  person?(): Promise<{ name: string | null }>;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The header every studio request carries (spec §6.7). */
export const STUDIO_HEADER = 'X-Vesper';

function messageOf(body: unknown, fallback: string): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof body.message === 'string'
  ) {
    return body.message;
  }
  return fallback;
}

/**
 * The local-mode client (spec §6.7). Every request carries the `X-Vesper`
 * header: the dev middleware refuses requests without it, so another site
 * open in the same browser can't reach it with a simple cross-origin request.
 *
 * Saves answer with a `SaveResponse` even when they fail (a conflict or an
 * invalid value is an answer, not an error). Anything else that isn't 2xx
 * throws an `ApiError`.
 */
export function createLocalApi(base: string, fetcher: typeof fetch = fetch): StudioApi {
  const root = base.replace(/\/$/, '');

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set(STUDIO_HEADER, '1');
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    const response = await fetcher(`${root}${path}`, { ...init, headers });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(
        response.status,
        response.ok ? 'The server sent a response the studio couldn’t read.' : response.statusText,
      );
    }
    const isAnswer = typeof body === 'object' && body !== null && 'ok' in body;
    if (!response.ok && !isAnswer)
      throw new ApiError(response.status, messageOf(body, response.statusText));
    return body as T;
  }

  const query = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;

  return {
    publishesOnSave: () => false,
    person: () => call('/person'),
    summary: () => call('/summary'),
    listEntries: (collection) => call(`/entries${query({ collection })}`),
    readEntry: (collection, id) => call(`/entry${query({ collection, id })}`),
    saveEntry: (request) => call('/entry', { method: 'PUT', body: JSON.stringify(request) }),
    deleteEntry: (collection, id, version) =>
      call(`/entry${query({ collection, id, version })}`, { method: 'DELETE' }),
    listMedia: () => call('/media'),
    upload: (file, name, folder) =>
      call(`/media${query({ name, folder })}`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    deleteMedia: (path) => call(`/media${query({ path })}`, { method: 'DELETE' }),
    listPartials: () => call('/partials'),
    fileUrl: (path) => Promise.resolve(`${root}/file${query({ path })}`),
    listPages: () => call('/pages'),
    listScheduled: () => call('/scheduled'),
    pageTree: (collection) => call(`/tree${query({ collection })}`),
    movePage: (request, options = {}) =>
      call(`/move${options.dryRun ? query({ dryRun: '1' }) : ''}`, {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    reorderPage: (request) => call('/reorder', { method: 'POST', body: JSON.stringify(request) }),
    createSection: (collection, path) =>
      call('/section', { method: 'POST', body: JSON.stringify({ collection, path }) }),
    readRedirects: () => call('/redirects'),
    saveRedirects: (request) =>
      call('/redirects', { method: 'PUT', body: JSON.stringify(request) }),
  };
}
