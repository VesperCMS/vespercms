import {
  encodeChange,
  fromBase64,
  overlayEntries,
  type BlobCache,
  type ChangeSet,
  type CloudClient,
  type CommitResult,
  type Draft,
  type FileChange,
  type StorageAdapter,
  type StorageEntry,
  type StoredFile,
} from '@vesper/core';
import { gitBlobSha } from '@vesper/core';

/*
 * The cloud's storage (spec §7.4): the site as its drafts show it, read
 * through the cloud's git proxy, and every save a draft rather than a
 * commit. Core's services run over it unchanged, so a draft is exactly what
 * a local save would have written (DECISIONS.md, "A draft is the file the
 * save would write").
 *
 * Bytes are read by version (a git blob SHA), from IndexedDB when this
 * browser has them and otherwise in batches from the API. A SHA always means
 * the same bytes, so nothing cached goes stale.
 */

type Waiter = { resolve: (bytes: Uint8Array | null) => void; reject: (error: unknown) => void };

type Snapshot = {
  commit: string;
  published: StorageEntry[];
  drafts: Draft[];
  draftsVersion: string;
  at: number;
};

export type CloudStorageOptions = {
  client: CloudClient;
  cache?: BlobCache;
  /** How long a snapshot of the tree and drafts is trusted. */
  snapshotTtlMs?: number;
  /** Told whenever the drafts change, here or as the API reports them. */
  onDrafts?: (drafts: readonly Draft[], version: string) => void;
  now?: () => number;
};

export class CloudStorage implements StorageAdapter {
  readonly kind = 'cloud' as const;
  private readonly client: CloudClient;
  private readonly cache: BlobCache | undefined;
  private readonly ttl: number;
  private readonly onDrafts: CloudStorageOptions['onDrafts'];
  private readonly now: () => number;
  private snapshotting: Promise<Snapshot> | null = null;
  private current: Snapshot | null = null;
  /** New files waiting for the next save (`ChangeSet.defer`): an upload goes out with its entry. */
  private readonly pending = new Map<string, { bytes: Uint8Array; version: string }>();
  private wanted = new Map<string, Waiter[]>();
  private batch: Promise<void> | null = null;

  constructor(options: CloudStorageOptions) {
    this.client = options.client;
    this.cache = options.cache;
    this.ttl = options.snapshotTtlMs ?? 10_000;
    this.onDrafts = options.onDrafts;
    this.now = options.now ?? (() => Date.now());
  }

  /** Forgets the snapshot, so the next read asks the cloud again. */
  invalidate(): void {
    this.current = null;
  }

  private async snapshot(): Promise<Snapshot> {
    if (this.current && this.now() - this.current.at < this.ttl) return this.current;
    this.snapshotting ??= (async () => {
      try {
        const [tree, drafts] = await Promise.all([this.client.tree(), this.client.drafts()]);
        const next: Snapshot = {
          commit: tree.commit,
          published: tree.entries,
          drafts: drafts.drafts,
          draftsVersion: drafts.version,
          at: this.now(),
        };
        const changed = this.current?.draftsVersion !== next.draftsVersion;
        this.current = next;
        if (changed) this.onDrafts?.(next.drafts, next.draftsVersion);
        return next;
      } finally {
        this.snapshotting = null;
      }
    })();
    return this.snapshotting;
  }

  /** The drafts as of the latest snapshot, asking the cloud when that's old. */
  async drafts(): Promise<{ drafts: Draft[]; version: string; commit: string }> {
    const snap = await this.snapshot();
    return { drafts: snap.drafts, version: snap.draftsVersion, commit: snap.commit };
  }

  async head(): Promise<{ version: string }> {
    const snap = await this.snapshot();
    return { version: `${snap.commit}:${snap.draftsVersion}` };
  }

  async list(options: { prefix?: string } = {}): Promise<StorageEntry[]> {
    const snap = await this.snapshot();
    const entries = overlayEntries(snap.published, snap.drafts);
    for (const [path, held] of this.pending) {
      if (!entries.some((e) => e.path === path)) {
        entries.push({ path, version: held.version, size: held.bytes.length });
      }
    }
    const prefix = options.prefix;
    return prefix ? entries.filter((e) => e.path.startsWith(prefix)) : entries;
  }

  async read(path: string): Promise<StoredFile | null> {
    const held = this.pending.get(path);
    if (held) return { path, bytes: held.bytes, version: held.version };
    const entry = (await this.list()).find((e) => e.path === path);
    if (!entry) return null;
    const bytes = await this.bytes(entry.version);
    return bytes ? { path, bytes, version: entry.version } : null;
  }

  /** Bytes by version: the cache first, then batched requests to the API. */
  private async bytes(version: string): Promise<Uint8Array | null> {
    const cached = await this.cache?.get(version);
    if (cached) return cached;
    return new Promise((resolve, reject) => {
      const waiting = this.wanted.get(version);
      if (waiting) waiting.push({ resolve, reject });
      else this.wanted.set(version, [{ resolve, reject }]);
      this.batch ??= Promise.resolve().then(() => this.fetchWanted());
    });
  }

  private async fetchWanted(): Promise<void> {
    const wanted = this.wanted;
    this.wanted = new Map();
    this.batch = null;
    const versions = [...wanted.keys()];
    try {
      for (let i = 0; i < versions.length; i += 100) {
        const chunk = versions.slice(i, i + 100);
        const { blobs } = await this.client.blobs(chunk);
        for (const version of chunk) {
          const text = blobs[version];
          const bytes = text === undefined ? null : fromBase64(text);
          // Only bytes that match their SHA are used or kept.
          const verified = bytes && (await gitBlobSha(bytes)) === version ? bytes : null;
          if (verified) await this.cache?.put(version, verified);
          for (const waiter of wanted.get(version) ?? []) waiter.resolve(verified);
          wanted.delete(version);
        }
      }
    } catch (error) {
      // A file the cloud couldn't send isn't a missing file: every read waiting on it fails.
      for (const waiters of wanted.values()) {
        for (const waiter of waiters) waiter.reject(error);
      }
    }
  }

  async commit(changeSet: ChangeSet): Promise<CommitResult> {
    if (changeSet.defer) {
      for (const change of changeSet.changes) {
        if (change.op === 'put') {
          this.pending.set(change.path, {
            bytes: change.bytes,
            version: await gitBlobSha(change.bytes),
          });
        }
      }
      return { ok: true, version: (await this.head()).version };
    }
    // Held uploads go out with this save, unless it deletes them.
    const deleted = new Set(
      changeSet.changes.flatMap((c) =>
        c.op === 'delete' ? [c.path] : c.op === 'move' ? [c.from] : [],
      ),
    );
    const held: FileChange[] = [...this.pending]
      .filter(([path]) => !deleted.has(path))
      .map(([path, file]) => ({ op: 'put', path, bytes: file.bytes, expectedVersion: null }));
    const changes = [
      ...held,
      ...changeSet.changes.filter((c) => !(c.op === 'delete' && this.pending.has(c.path))),
    ];
    const answer = await this.client.saveDraft({
      changes: changes.map(encodeChange),
      message: changeSet.message,
    });
    if (!answer.ok) {
      if (answer.reason === 'conflict')
        return { ok: false, reason: 'conflict', conflicts: answer.conflicts };
      return { ok: false, reason: 'rejected', message: answer.message };
    }
    this.pending.clear();
    for (const change of changes) {
      if (change.op === 'put') await this.cache?.put(await gitBlobSha(change.bytes), change.bytes);
    }
    this.invalidate();
    const snap = await this.snapshot();
    return { ok: true, version: `${snap.commit}:${snap.draftsVersion}` };
  }
}
