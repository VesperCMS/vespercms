import { gitBlobSha } from './git-blob-sha.ts';
import { normalizePath } from './paths.ts';
import { validateChangeSet } from './validate.ts';
import type { ChangeSet, CommitResult, StorageAdapter, StorageEntry, StoredFile } from './types.ts';

type Stored = { bytes: Uint8Array; version: string };

const encoder = new TextEncoder();

/**
 * An in-memory adapter: the reference implementation of the storage
 * contract, and the store used by tests. Commits are atomic: every change
 * is checked before any is applied. Each successful commit is kept in
 * `commits` so tests can assert what a save did.
 */
export class MemoryStorage implements StorageAdapter {
  readonly kind = 'memory' as const;
  readonly commits: ChangeSet[] = [];
  private readonly files = new Map<string, Stored>();
  private version = '';

  /** Builds a store from `{ path: contents }`. Strings are stored as UTF-8. */
  static async create(initial: Record<string, string | Uint8Array> = {}): Promise<MemoryStorage> {
    const store = new MemoryStorage();
    for (const [path, contents] of Object.entries(initial)) {
      const bytes = typeof contents === 'string' ? encoder.encode(contents) : contents;
      store.files.set(normalizePath(path), { bytes, version: await gitBlobSha(bytes) });
    }
    store.version = await store.treeVersion();
    return store;
  }

  head(): Promise<{ version: string }> {
    return Promise.resolve({ version: this.version });
  }

  list(options: { prefix?: string } = {}): Promise<StorageEntry[]> {
    const prefix = options.prefix ? normalizePrefix(options.prefix) : '';
    const entries = [...this.files]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, file]) => ({ path, version: file.version, size: file.bytes.length }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
    return Promise.resolve(entries);
  }

  read(path: string): Promise<StoredFile | null> {
    const normalized = normalizePath(path);
    const file = this.files.get(normalized);
    return Promise.resolve(
      file ? { path: normalized, bytes: file.bytes.slice(), version: file.version } : null,
    );
  }

  async commit(changeSet: ChangeSet): Promise<CommitResult> {
    const checked = validateChangeSet(changeSet, (path) => this.files.get(path)?.version ?? null);
    if (!checked.ok) return checked.result;

    const next = new Map(this.files);
    for (const change of checked.changes) {
      if (change.op === 'put') {
        next.set(change.path, {
          bytes: change.bytes.slice(),
          version: await gitBlobSha(change.bytes),
        });
      } else if (change.op === 'delete') {
        next.delete(change.path);
      } else {
        const source = next.get(change.from);
        if (!source) throw new Error('validated move lost its source');
        next.delete(change.from);
        const bytes = change.bytes ?? source.bytes;
        next.set(change.to, {
          bytes: bytes.slice(),
          version: change.bytes ? await gitBlobSha(bytes) : source.version,
        });
      }
    }
    this.files.clear();
    for (const [path, file] of next) this.files.set(path, file);
    this.version = await this.treeVersion();
    this.commits.push(changeSet);
    return { ok: true, version: this.version };
  }

  private async treeVersion(): Promise<string> {
    const listing = [...this.files]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([path, file]) => `${file.version} ${path}`)
      .join('\n');
    return gitBlobSha(encoder.encode(listing));
  }
}

function normalizePrefix(prefix: string): string {
  return prefix.endsWith('/') ? `${normalizePath(prefix.slice(0, -1))}/` : normalizePath(prefix);
}
