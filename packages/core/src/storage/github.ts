import { gitBlobSha } from './git-blob-sha.ts';
import { normalizePath } from './paths.ts';
import { validateChangeSet, type ValidatedChange } from './validate.ts';
import type {
  ChangeSet,
  CommitResult,
  Conflict,
  StorageAdapter,
  StorageEntry,
  StoredFile,
} from './types.ts';

/*
 * GitHub mode's storage (spec §6.8): the repository's branch, read and
 * written through GitHub's API with the editor's own token. It needs only
 * `fetch`, so the studio runs it in the browser, and the cloud can run it
 * in a Worker.
 *
 * - The state is one snapshot: the branch's commit and its recursive tree,
 *   which lists every path with its blob SHA. A file's version is that SHA,
 *   as in every mode.
 * - Bytes are fetched by SHA, which never changes meaning, so a cache keyed
 *   by it never goes stale. Listing a folder prefetches its uncached text
 *   files in batches, since the services read what they list one file at a
 *   time; each batch's bytes are checked against their SHA.
 * - A commit is one commit on the branch, through the Git Data API (blobs,
 *   tree, commit, then a ref update that must fast-forward). If the branch
 *   moved meanwhile and none of the touched files changed, it's built again
 *   on the new head, once.
 */

export type GitHubStorageOptions = {
  owner: string;
  repo: string;
  branch: string;
  /** The site's folder inside the repository, POSIX, without slashes at the ends. `''` for the root. */
  root?: string;
  /** The editor's token, or a function that returns the current one. */
  token: string | (() => string | Promise<string>);
  /** `https://api.github.com` by default; GitHub Enterprise Server's is `https://host/api/v3`. */
  apiUrl?: string;
  /** GraphQL's endpoint. Defaults to `<apiUrl>/graphql`, or `https://host/api/graphql` on Enterprise Server. */
  graphqlUrl?: string;
  fetch?: typeof fetch;
  /** Bytes by blob SHA, kept between visits (the studio uses IndexedDB). */
  cache?: BlobCache;
  /** How long a snapshot of the branch is reused before it's read again. 10 seconds by default. */
  snapshotTtlMs?: number;
};

/** Bytes by git blob SHA. A SHA always means the same bytes, so entries never go stale. */
export interface BlobCache {
  get(sha: string): Promise<Uint8Array | undefined>;
  put(sha: string, bytes: Uint8Array): Promise<void>;
}

export type GitHubErrorKind =
  'auth' | 'forbidden' | 'not-found' | 'rate-limit' | 'network' | 'server';

/** What went wrong talking to GitHub, for the studio to say plainly. */
export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status: number;
  /** When a rate limit lifts, if GitHub said. */
  readonly retryAt?: Date;
  constructor(kind: GitHubErrorKind, status: number, message: string, retryAt?: Date) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
    this.status = status;
    if (retryAt) this.retryAt = retryAt;
  }
}

type TreeItem = { path: string; mode: string; type: string; sha: string; size?: number };
type Snapshot = { commit: string; tree: string; files: Map<string, TreeItem>; at: number };

/** Text worth prefetching when its folder is listed; anything else is fetched when read. */
const TEXT = /\.(md|markdown|mdx|mdoc|markdoc|ya?ml|json|jsonc|json5|toml|txt|csv|svg)$/i;
/** GraphQL's `text` is only for files it doesn't truncate; larger ones are fetched raw. */
const BATCH_MAX_BYTES = 512 * 1024;
const BATCH_SIZE = 50;

const encoder = new TextEncoder();

export class GitHubStorage implements StorageAdapter {
  readonly kind = 'github' as const;
  private readonly options: GitHubStorageOptions;
  private readonly api: string;
  private readonly graphql: string;
  private readonly root: string;
  private readonly fetcher: typeof fetch;
  private snapshot: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;
  private readonly blobs = new Map<string, Promise<Uint8Array>>();
  /** New files waiting for the next commit (`ChangeSet.defer`), by path. */
  private readonly pending = new Map<string, { bytes: Uint8Array; sha: string }>();

  constructor(options: GitHubStorageOptions) {
    this.options = options;
    this.api = (options.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.graphql =
      options.graphqlUrl ??
      (/\/api\/v3$/.test(this.api) ? this.api.replace(/\/v3$/, '/graphql') : `${this.api}/graphql`);
    this.root = (options.root ?? '').replace(/^\/+|\/+$/g, '');
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** Reads the branch again on the next call, as after someone else published. */
  refresh(): void {
    this.snapshot = null;
  }

  async head(): Promise<{ version: string }> {
    return { version: (await this.current(true)).commit };
  }

  async list(options: { prefix?: string } = {}): Promise<StorageEntry[]> {
    const snapshot = await this.current();
    const prefix = options.prefix ?? '';
    const entries: StorageEntry[] = [];
    for (const [path, item] of snapshot.files) {
      if (!path.startsWith(prefix) || this.pending.has(path)) continue;
      entries.push({ path, version: item.sha, size: item.size ?? 0 });
    }
    for (const [path, file] of this.pending) {
      if (path.startsWith(prefix))
        entries.push({ path, version: file.sha, size: file.bytes.length });
    }
    entries.sort((a, b) => (a.path < b.path ? -1 : 1));
    this.prefetch(entries);
    return entries;
  }

  async read(path: string): Promise<StoredFile | null> {
    const normalized = normalizePath(path);
    const waiting = this.pending.get(normalized);
    if (waiting) return { path: normalized, bytes: waiting.bytes.slice(), version: waiting.sha };
    const item = (await this.current()).files.get(normalized);
    if (!item) return null;
    const bytes = await this.blob(item.sha);
    return { path: normalized, bytes: bytes.slice(), version: item.sha };
  }

  async commit(changeSet: ChangeSet): Promise<CommitResult> {
    let snapshot = await this.current(true);
    if (changeSet.defer && changeSet.changes.every((change) => change.op === 'put')) {
      return this.hold(changeSet, snapshot);
    }
    // Files held for this commit go with it, unless this change set replaces or removes them.
    const touched = new Set(
      changeSet.changes.flatMap((c) => (c.op === 'move' ? [c.from, c.to] : [c.path])),
    );
    const carried = [...this.pending]
      .filter(([path]) => !touched.has(path))
      .map(([path, file]) => ({
        op: 'put' as const,
        path,
        bytes: file.bytes,
        expectedVersion: null,
      }));
    const own = changeSet.changes.filter((c) => !(c.op === 'delete' && this.pending.has(c.path)));
    if (own.length === 0 && carried.length === 0) {
      for (const path of touched) this.pending.delete(path);
      return { ok: true, version: snapshot.commit };
    }
    const checked = validateChangeSet(
      { ...changeSet, changes: [...carried, ...own] },
      (path) => snapshot.files.get(path)?.sha ?? null,
    );
    if (!checked.ok) return checked.result;
    const changes = checked.changes;
    const blobs = await this.uploadBlobs(changes);
    const message = commitMessage(changeSet);

    for (let attempt = 0; ; attempt++) {
      const tree = await this.post<{ sha: string }>('git/trees', {
        base_tree: snapshot.tree,
        tree: treeEntries(changes, snapshot, blobs, this.root),
      });
      const commit = await this.post<{ sha: string }>('git/commits', {
        message,
        tree: tree.sha,
        parents: [snapshot.commit],
      });
      const moved = await this.updateRef(commit.sha);
      if (moved === 'ok') {
        this.snapshot = await this.applied(snapshot, changes, blobs, commit.sha, tree.sha);
        this.pending.clear();
        return { ok: true, version: commit.sha };
      }
      if (moved !== 'not-fast-forward') return { ok: false, reason: 'rejected', message: moved };
      // Someone else published in between. Unless they changed these files, build on theirs.
      const before = snapshot;
      snapshot = await this.current(true);
      const changed = touchedPaths(changes).filter(
        (path) => (before.files.get(path)?.sha ?? null) !== (snapshot.files.get(path)?.sha ?? null),
      );
      if (changed.length > 0) {
        const conflicts: Conflict[] = changed.map((path) => ({
          path,
          expected: before.files.get(path)?.sha ?? null,
          actual: snapshot.files.get(path)?.sha ?? null,
        }));
        return { ok: false, reason: 'conflict', conflicts };
      }
      if (attempt >= 1) {
        return {
          ok: false,
          reason: 'rejected',
          message: 'Someone else is publishing to this site right now. Try again in a moment.',
        };
      }
    }
  }

  /** Holds new files for the next commit, checked as that commit would check them. */
  private async hold(changeSet: ChangeSet, snapshot: Snapshot): Promise<CommitResult> {
    const checked = validateChangeSet(
      changeSet,
      (path) => this.pending.get(path)?.sha ?? snapshot.files.get(path)?.sha ?? null,
    );
    if (!checked.ok) return checked.result;
    for (const change of checked.changes) {
      if (change.op !== 'put') continue;
      const bytes = change.bytes.slice();
      this.pending.set(change.path, { bytes, sha: await gitBlobSha(bytes) });
    }
    return { ok: true, version: snapshot.commit };
  }

  /** The branch as it is now: reused for a few seconds, or read again when `fresh`. */
  private async current(fresh = false): Promise<Snapshot> {
    const ttl = this.options.snapshotTtlMs ?? 10_000;
    if (!fresh && this.snapshot && Date.now() - this.snapshot.at < ttl) return this.snapshot;
    if (this.loading) return this.loading;
    this.loading = this.load().finally(() => {
      this.loading = null;
    });
    this.snapshot = await this.loading;
    return this.snapshot;
  }

  private async load(): Promise<Snapshot> {
    const ref = await this.get<{ object: { sha: string } }>(
      `git/ref/heads/${encodeURIComponent(this.options.branch)}`,
    );
    if (this.snapshot?.commit === ref.object.sha) return { ...this.snapshot, at: Date.now() };
    const commit = await this.get<{ tree: { sha: string } }>(`git/commits/${ref.object.sha}`);
    const files = await this.treeFiles(commit.tree.sha);
    return { commit: ref.object.sha, tree: commit.tree.sha, files, at: Date.now() };
  }

  /** Every blob in the tree, by site-relative path. A tree GitHub truncates is read folder by folder. */
  private async treeFiles(sha: string): Promise<Map<string, TreeItem>> {
    const files = new Map<string, TreeItem>();
    const add = (item: TreeItem, prefix: string) => {
      if (item.type !== 'blob') return;
      const full = prefix ? `${prefix}/${item.path}` : item.path;
      if (this.root && !full.startsWith(`${this.root}/`)) return;
      files.set(this.root ? full.slice(this.root.length + 1) : full, { ...item, path: full });
    };
    const whole = await this.get<{ tree: TreeItem[]; truncated: boolean }>(
      `git/trees/${sha}?recursive=1`,
    );
    if (!whole.truncated) {
      for (const item of whole.tree) add(item, '');
      return files;
    }
    const walk = async (treeSha: string, prefix: string): Promise<void> => {
      const level = await this.get<{ tree: TreeItem[] }>(`git/trees/${treeSha}`);
      for (const item of level.tree) {
        const full = prefix ? `${prefix}/${item.path}` : item.path;
        if (item.type === 'tree') {
          const inside = !this.root || full === this.root || full.startsWith(`${this.root}/`);
          const above = this.root.startsWith(`${full}/`);
          if (inside || above) await walk(item.sha, full);
        } else {
          add(item, prefix);
        }
      }
    };
    await walk(sha, '');
    return files;
  }

  /** A blob's bytes: from memory, the cache, or GitHub, checked against its SHA. */
  private blob(sha: string): Promise<Uint8Array> {
    let pending = this.blobs.get(sha);
    if (!pending) {
      pending = this.fetchBlob(sha);
      this.blobs.set(sha, pending);
      pending.catch(() => this.blobs.delete(sha));
    }
    return pending;
  }

  private async fetchBlob(sha: string): Promise<Uint8Array> {
    const cached = await this.options.cache?.get(sha);
    if (cached) return cached;
    const response = await this.request(`${this.repoUrl()}/git/blobs/${sha}`, {
      headers: { Accept: 'application/vnd.github.raw+json' },
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if ((await gitBlobSha(bytes)) !== sha) {
      throw new GitHubError('server', 200, `GitHub sent different bytes for ${sha}.`);
    }
    await this.options.cache?.put(sha, bytes);
    return bytes;
  }

  /** Starts fetching the listed text files that aren't held yet, many to a request. */
  private prefetch(entries: readonly StorageEntry[]): void {
    const wanted = entries.filter(
      (entry) =>
        TEXT.test(entry.path) && entry.size <= BATCH_MAX_BYTES && !this.blobs.has(entry.version),
    );
    const shas = [...new Set(wanted.map((entry) => entry.version))];
    for (let i = 0; i < shas.length; i += BATCH_SIZE) {
      const batch = shas.slice(i, i + BATCH_SIZE);
      const texts = this.batchTexts(batch);
      for (const sha of batch) {
        const pending = texts.then(async (found) => {
          const bytes = found.get(sha);
          // Not in the batch, or not these bytes (another encoding): fetch it raw.
          if (bytes && (await gitBlobSha(bytes)) === sha) {
            await this.options.cache?.put(sha, bytes);
            return bytes;
          }
          return this.fetchBlob(sha);
        });
        this.blobs.set(sha, pending);
        pending.catch(() => this.blobs.delete(sha));
      }
    }
  }

  /** Text of many blobs in one GraphQL request, skipping any already cached. */
  private async batchTexts(shas: readonly string[]): Promise<Map<string, Uint8Array>> {
    const found = new Map<string, Uint8Array>();
    const missing: string[] = [];
    for (const sha of shas) {
      const cached = await this.options.cache?.get(sha);
      if (cached) found.set(sha, cached);
      else missing.push(sha);
    }
    if (missing.length === 0) return found;
    const fields = missing
      .map((sha, i) => `b${String(i)}: object(oid: "${sha}") { ... on Blob { text isBinary } }`)
      .join('\n');
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
    try {
      const response = await this.request(this.graphql, {
        method: 'POST',
        body: JSON.stringify({
          query,
          variables: { owner: this.options.owner, name: this.options.repo },
        }),
      });
      const json = (await response.json()) as {
        data?: { repository?: Record<string, { text?: string | null; isBinary?: boolean } | null> };
      };
      missing.forEach((sha, i) => {
        const blob = json.data?.repository?.[`b${String(i)}`];
        if (blob && !blob.isBinary && typeof blob.text === 'string')
          found.set(sha, encoder.encode(blob.text));
      });
    } catch {
      // Each file is then fetched on its own.
    }
    return found;
  }

  /** New bytes go up as blobs, one request each; moves without new bytes reuse theirs. */
  private async uploadBlobs(changes: readonly ValidatedChange[]): Promise<Map<string, string>> {
    const shas = new Map<string, string>();
    for (const change of changes) {
      if (change.op === 'delete') continue;
      const bytes = change.bytes;
      if (!bytes) continue;
      const path = change.op === 'put' ? change.path : change.to;
      const created = await this.post<{ sha: string }>('git/blobs', {
        content: toBase64(bytes),
        encoding: 'base64',
      });
      shas.set(path, created.sha);
      // Keep what was sent: the next read of this file needs no request.
      this.blobs.set(created.sha, Promise.resolve(bytes.slice()));
      await this.options.cache?.put(created.sha, bytes.slice());
    }
    return shas;
  }

  /** `ok`, `not-fast-forward`, or why GitHub refused, in plain words. */
  private async updateRef(sha: string): Promise<string> {
    const response = await this.request(
      `${this.repoUrl()}/git/refs/heads/${encodeURIComponent(this.options.branch)}`,
      { method: 'PATCH', body: JSON.stringify({ sha, force: false }) },
      [422, 409],
    );
    if (response.ok) return 'ok';
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    if (/fast[- ]?forward/i.test(body.message ?? '')) return 'not-fast-forward';
    return `This site's GitHub settings don't allow publishing straight to ${this.options.branch}. ${body.message ?? ''}`.trim();
  }

  /** The snapshot after a commit of ours, without reading the tree again. */
  private async applied(
    snapshot: Snapshot,
    changes: readonly ValidatedChange[],
    blobs: Map<string, string>,
    commit: string,
    tree: string,
  ): Promise<Snapshot> {
    const files = new Map(snapshot.files);
    const at = (path: string) => (this.root ? `${this.root}/${path}` : path);
    for (const change of changes) {
      if (change.op === 'put') {
        const old = files.get(change.path);
        files.set(change.path, {
          path: at(change.path),
          mode: old?.mode ?? '100644',
          type: 'blob',
          sha: blobs.get(change.path) ?? '',
          size: change.bytes.length,
        });
      } else if (change.op === 'delete') {
        files.delete(change.path);
      } else {
        const old = files.get(change.from);
        files.delete(change.from);
        if (old) {
          files.set(change.to, {
            ...old,
            path: at(change.to),
            sha: blobs.get(change.to) ?? old.sha,
            ...(change.bytes ? { size: change.bytes.length } : {}),
          });
        }
      }
    }
    return Promise.resolve({ commit, tree, files, at: Date.now() });
  }

  private repoUrl(): string {
    return `${this.api}/repos/${encodeURIComponent(this.options.owner)}/${encodeURIComponent(this.options.repo)}`;
  }

  private async get<T>(path: string): Promise<T> {
    return (await (await this.request(`${this.repoUrl()}/${path}`)).json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(`${this.repoUrl()}/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return (await response.json()) as T;
  }

  /** A request with the token; statuses in `allowed` come back instead of throwing. */
  private async request(
    url: string,
    init: RequestInit = {},
    allowed: number[] = [],
  ): Promise<Response> {
    const { token } = this.options;
    const value = typeof token === 'function' ? await token() : token;
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${value}`);
    if (!headers.has('Accept')) headers.set('Accept', 'application/vnd.github+json');
    if (init.body) headers.set('Content-Type', 'application/json');
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, headers, cache: 'no-store' });
    } catch {
      throw new GitHubError(
        'network',
        0,
        'GitHub couldn’t be reached. Check the connection and try again.',
      );
    }
    if (response.ok || allowed.includes(response.status)) return response;
    throw await errorOf(response);
  }
}

async function errorOf(response: Response): Promise<GitHubError> {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  const message = body.message ?? response.statusText;
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  const after = Number(response.headers.get('retry-after'));
  if (response.status === 401)
    return new GitHubError('auth', 401, 'Your GitHub sign-in has expired. Sign in again.');
  if ((response.status === 403 || response.status === 429) && (remaining === '0' || after > 0)) {
    const retryAt =
      after > 0
        ? new Date(Date.now() + after * 1000)
        : reset > 0
          ? new Date(reset * 1000)
          : undefined;
    return new GitHubError(
      'rate-limit',
      response.status,
      'GitHub asked Vesper to slow down.',
      retryAt,
    );
  }
  if (response.status === 403) return new GitHubError('forbidden', 403, message);
  if (response.status === 404) return new GitHubError('not-found', 404, message);
  return new GitHubError('server', response.status, message);
}

function touchedPaths(changes: readonly ValidatedChange[]): string[] {
  return changes.flatMap((change) =>
    change.op === 'move' ? [change.from, change.to] : [change.path],
  );
}

/** The new tree's entries over its base: puts and moves add, deletes and moves' sources remove. */
function treeEntries(
  changes: readonly ValidatedChange[],
  snapshot: Snapshot,
  blobs: Map<string, string>,
  root: string,
): { path: string; mode: string; type: 'blob'; sha: string | null }[] {
  const at = (path: string) => (root ? `${root}/${path}` : path);
  const entries: { path: string; mode: string; type: 'blob'; sha: string | null }[] = [];
  for (const change of changes) {
    if (change.op === 'put') {
      const mode = snapshot.files.get(change.path)?.mode ?? '100644';
      entries.push({
        path: at(change.path),
        mode,
        type: 'blob',
        sha: blobs.get(change.path) ?? null,
      });
    } else if (change.op === 'delete') {
      entries.push({ path: at(change.path), mode: '100644', type: 'blob', sha: null });
    } else {
      const source = snapshot.files.get(change.from);
      entries.push({ path: at(change.from), mode: '100644', type: 'blob', sha: null });
      entries.push({
        path: at(change.to),
        mode: source?.mode ?? '100644',
        type: 'blob',
        sha: blobs.get(change.to) ?? source?.sha ?? null,
      });
    }
  }
  return entries;
}

/** The change set's summary, then its trailers, as git writes them: one line per value. */
export function commitMessage(changeSet: ChangeSet): string {
  const trailers = Object.entries(changeSet.message.trailers ?? {}).flatMap(([key, value]) =>
    (typeof value === 'string' ? [value] : value).map((one) => `${key}: ${one}`),
  );
  return trailers.length > 0
    ? `${changeSet.message.summary}\n\n${trailers.join('\n')}\n`
    : `${changeSet.message.summary}\n`;
}

/** Base64 without Node's Buffer: browsers, Workers and Node all have `btoa`. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** `owner/name` from a repository's address or slug, or null. */
export function parseRepo(value: string): { owner: string; repo: string } | null {
  const match =
    /^(?:https?:\/\/[^/]+\/|git@[^:]+:|ssh:\/\/git@[^/]+\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      value.trim(),
    );
  return match?.[1] && match[2] ? { owner: match[1], repo: match[2] } : null;
}
