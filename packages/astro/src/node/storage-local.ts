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
          const bytes = new Uint8Array(await fs.readFile(join(this.root, ...path.split('/'))));
          entries.push({ path, version: await gitBlobSha(bytes), size: bytes.length });
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
    await fs.rename(temporary, target);
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
