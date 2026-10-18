import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import {
  gitBlobSha,
  normalizePath,
  validateChangeSet,
  type ChangeSet,
  type CommitResult,
  type StorageAdapter,
  type StorageEntry,
  type StoredFile,
} from '@vesper/core';

/** Folders that are never content. Listing skips them; writing into them is refused. */
const SKIPPED = new Set(['node_modules', '.git', 'dist', '.astro', '.vesper']);

/** Windows refuses to replace a file while anything has it open, briefly. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_DELAYS = [10, 20, 40, 80, 160, 320, 640];

/**
 * fs.rename, retried while Windows reports the target busy. The dev server's
 * watcher reads a content file right after it changes, and antivirus scans
 * new files; either makes a rename fail with EPERM for a few milliseconds.
 * graceful-fs retries the same way. The delays add up to about a second
 * and a quarter, past which the error is real.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  rename: (from: string, to: string) => Promise<void> = (a, b) => fs.rename(a, b),
): Promise<void> {
  for (const delay of [...RENAME_DELAYS, null]) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (delay === null || !BUSY.has(code)) throw error;
      await new Promise((settle) => setTimeout(settle, delay));
    }
  }
}

/**
 * Local mode's storage (spec §6.7): files on disk under the site root.
 *
 * Commits are best-effort atomic. Every change is checked first, then new
 * contents are written to temporary files beside their targets and renamed
 * into place. If any step fails, the files already changed are restored
 * from memory. A crash mid-commit can still leave a partial change, which a
 * filesystem without transactions can't prevent; git shows exactly what
 * happened.
 */
export class LocalStorage implements StorageAdapter {
  readonly kind = 'local' as const;
  private readonly root: string;
  private readonly session = randomUUID();
  private commitCount = 0;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Changes on every commit through this instance. Per-file versions catch edits made outside it. */
  head(): Promise<{ version: string }> {
    return Promise.resolve({ version: `local:${this.session}:${String(this.commitCount)}` });
  }

  async list(options: { prefix?: string } = {}): Promise<StorageEntry[]> {
    const prefix = options.prefix ?? '';
    const start = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
    const entries: StorageEntry[] = [];
    const visit = async (relativeDir: string) => {
      const absolute = relativeDir ? join(this.root, ...relativeDir.split('/')) : this.root;
      if (!existsSync(absolute)) return;
      for (const dirent of await fs.readdir(absolute, { withFileTypes: true })) {
        const path = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
          if (!SKIPPED.has(dirent.name)) await visit(path);
        } else if (dirent.isFile() && path.startsWith(prefix)) {
          const absolutePath = join(this.root, ...path.split('/'));
          const [bytes, stat] = await Promise.all([
            fs.readFile(absolutePath),
            fs.stat(absolutePath),
          ]);
          entries.push({
            path,
            version: await gitBlobSha(new Uint8Array(bytes)),
            size: bytes.length,
            modifiedAt: stat.mtime.toISOString(),
          });
        }
      }
    };
    await visit(start ? normalizePath(start) : '');
    return entries.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  async read(path: string): Promise<StoredFile | null> {
    const normalized = normalizePath(path);
    try {
      const bytes = new Uint8Array(await fs.readFile(this.absolute(normalized)));
      return { path: normalized, bytes, version: await gitBlobSha(bytes) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async commit(changeSet: ChangeSet): Promise<CommitResult> {
    const paths = changeSet.changes.flatMap((change) =>
      change.op === 'move' ? [change.from, change.to] : [change.path],
    );
    const versions = new Map<string, string | null>();
    for (const path of paths) {
      let normalized: string;
      try {
        normalized = normalizePath(path);
      } catch {
        continue; // validateChangeSet reports it.
      }
      if (normalized.split('/').some((segment) => SKIPPED.has(segment))) {
        return {
          ok: false,
          reason: 'rejected',
          message: `"${normalized}" is inside a folder Vesper never writes to.`,
        };
      }
      versions.set(normalized, (await this.read(normalized))?.version ?? null);
    }
    const checked = validateChangeSet(changeSet, (path) => versions.get(path) ?? null);
    if (!checked.ok) return checked.result;

    // Remember originals so a failure part-way can be undone.
    const originals = new Map<string, Uint8Array | null>();
    const remember = async (path: string) => {
      if (!originals.has(path)) originals.set(path, (await this.read(path))?.bytes ?? null);
    };
    try {
      for (const change of checked.changes) {
        if (change.op === 'put') {
          await remember(change.path);
          await this.writeAtomically(change.path, change.bytes);
        } else if (change.op === 'delete') {
          await remember(change.path);
          await fs.rm(this.absolute(change.path));
        } else {
          await remember(change.from);
          await remember(change.to);
          const bytes = change.bytes ?? (await this.read(change.from))?.bytes;
          if (!bytes) throw new Error(`"${change.from}" disappeared during the save.`);
          await this.writeAtomically(change.to, bytes);
          await fs.rm(this.absolute(change.from));
        }
      }
    } catch (error) {
      await this.restore(originals);
      return {
        ok: false,
        reason: 'rejected',
        message: `Nothing was saved: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    this.commitCount++;
    return { ok: true, version: (await this.head()).version };
  }

  private absolute(path: string): string {
    const absolute = join(this.root, ...path.split('/'));
    if (!absolute.startsWith(this.root + sep)) throw new Error(`"${path}" is outside the site.`);
    return absolute;
  }

  private async writeAtomically(path: string, bytes: Uint8Array): Promise<void> {
    const target = this.absolute(path);
    await fs.mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.vesper-${randomUUID()}.tmp`;
    await fs.writeFile(temporary, bytes);
    try {
      await renameWithRetry(temporary, target);
    } catch (error) {
      // A leftover .tmp would sit in the site's content folder.
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  private async restore(originals: Map<string, Uint8Array | null>): Promise<void> {
    for (const [path, bytes] of originals) {
      try {
        if (bytes) await this.writeAtomically(path, bytes);
        else await fs.rm(this.absolute(path), { force: true });
      } catch {
        // Best effort: keep restoring the others.
      }
    }
  }
}
