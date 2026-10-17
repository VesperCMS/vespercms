/**
 * The storage adapter interface (spec §6.7, §6.8, §7.3). Local mode (disk),
 * GitHub mode (Git Data API) and cloud mode (the git proxy) all implement it,
 * so the studio saves the same way everywhere.
 *
 * Paths are POSIX, relative to the site root (`src/content/blog/a.md`).
 *
 * A file's `version` is its git blob SHA-1, the same value git and GitHub
 * use. Every adapter agrees on it, which is what lets a cloud draft remember
 * the version it was based on and detect conflicts later (spec §7.4).
 */
export interface StorageAdapter {
  readonly kind: 'memory' | 'local' | 'github' | 'cloud';
  /** The current state as a whole: a commit SHA, or a hash of the tree. Changes after every successful commit. */
  head(): Promise<{ version: string }>;
  list(options?: { prefix?: string }): Promise<StorageEntry[]>;
  read(path: string): Promise<StoredFile | null>;
  /**
   * Applies every change, or none (spec §6.8: "a multi-file save is one
   * commit"). An expected version that no longer matches is a conflict,
   * not an overwrite.
   */
  commit(changeSet: ChangeSet): Promise<CommitResult>;
}

export type StorageEntry = {
  path: string;
  version: string;
  size: number;
  /** Last change time, ISO 8601, where the adapter knows it cheaply (for "edited 2 hours ago"). */
  modifiedAt?: string;
};

export type StoredFile = { path: string; bytes: Uint8Array; version: string };

export type FileChange =
  | {
      op: 'put';
      path: string;
      bytes: Uint8Array;
      /** Omit to write unconditionally; `null` means the file must not exist yet. */
      expectedVersion?: string | null;
    }
  | { op: 'delete'; path: string; expectedVersion?: string }
  | {
      op: 'move';
      from: string;
      to: string;
      /** New contents for the moved file. Omit to keep its bytes. */
      bytes?: Uint8Array;
      expectedVersion?: string;
    };

export type ChangeSet = {
  changes: FileChange[];
  /** Plain-language summary. Adapters with history turn it into a commit message. */
  message: { summary: string; trailers?: Record<string, string> };
  /** The `head()` version the changes were prepared against, where the adapter can use it. */
  baseVersion?: string;
};

export type Conflict = { path: string; expected: string | null; actual: string | null };

export type CommitResult =
  | { ok: true; version: string }
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] }
  | { ok: false; reason: 'rejected'; message: string };
