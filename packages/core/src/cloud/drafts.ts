import { gitBlobSha } from '../storage/git-blob-sha.ts';
import type {
  ChangeSet,
  Conflict,
  FileChange,
  StorageEntry,
  StoredFile,
} from '../storage/types.ts';
import type { Draft, DraftFile } from './protocol.ts';

/*
 * Cloud drafts (spec §7.4, D13): changes saved to the cloud, never committed
 * until someone publishes them. The cloud keeps them per site; the studio
 * sees the site through them. Both sides use this file, so "what the site
 * looks like with its drafts" means the same thing in each.
 *
 * A draft holds the exact bytes a save would have written (DECISIONS.md, "A
 * draft is the file the save would write"), with the published version each
 * file started from. Versions are git blob SHAs, as in every storage mode,
 * so a drafted file's version is the SHA of its drafted bytes.
 */

/** A draft as the cloud keeps it: its files' bytes travel with it. */
export type StoredDraft = Draft & { bytes: Record<string, Uint8Array> };

export type DraftState = { version: number; drafts: StoredDraft[] };

export function emptyDraftState(): DraftState {
  return { version: 0, drafts: [] };
}

/** The published site, as the drafts need to read it. */
export type PublishedFiles = {
  read(path: string): Promise<StoredFile | null>;
};

/** Where a path stands with the drafts applied: a drafted version, deleted, or untouched. */
function draftedFile(
  state: DraftState,
  path: string,
): { draft: StoredDraft; file: DraftFile } | null {
  for (const draft of state.drafts) {
    const file = draft.files.find((f) => f.path === path);
    if (file) return { draft, file };
  }
  return null;
}

/** The published entries with the drafts applied: drafted versions, new files, deletions. */
export function overlayEntries(
  published: readonly StorageEntry[],
  drafts: readonly Draft[],
): StorageEntry[] {
  const byPath = new Map(published.map((entry) => [entry.path, entry]));
  for (const draft of drafts) {
    for (const file of draft.files) {
      if (file.op === 'delete') byPath.delete(file.path);
      else
        byPath.set(file.path, {
          path: file.path,
          version: file.version,
          size: file.size,
          modifiedAt: draft.updatedAt,
        });
    }
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** A file as the site with its drafts would read it. */
export async function readOverlay(
  state: DraftState,
  published: PublishedFiles,
  path: string,
): Promise<StoredFile | null> {
  const drafted = draftedFile(state, path);
  if (!drafted) return published.read(path);
  if (drafted.file.op === 'delete') return null;
  const bytes = drafted.draft.bytes[drafted.file.version];
  return bytes ? { path, bytes, version: drafted.file.version } : null;
}

type Pending = { path: string; bytes: Uint8Array | null };

export type SaveResult =
  | { ok: true; draft: StoredDraft | null }
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] };

/**
 * Saves a change set as a draft. Expected versions are checked against the
 * site as its drafts show it, exactly as a storage adapter checks them, so
 * two editors on one entry get a conflict rather than an overwrite.
 *
 * Files already in a draft keep their draft: a save touching files of
 * several drafts joins them into one, since a move and the links it
 * rewrote must publish together. A file drafted back to its published bytes
 * leaves the draft, and an empty draft is gone.
 */
export async function saveDraft(
  state: DraftState,
  published: PublishedFiles,
  changeSet: ChangeSet,
  by: { id: string; name: string },
  options: { now?: Date; newId?: () => string } = {},
): Promise<SaveResult> {
  const current = async (path: string) =>
    (await readOverlay(state, published, path))?.version ?? null;
  const conflicts: Conflict[] = [];
  const check = async (path: string, expected: string | null | undefined) => {
    if (expected === undefined) return;
    const actual = await current(path);
    if (actual !== expected) conflicts.push({ path, expected, actual });
  };
  const pending: Pending[] = [];
  for (const change of changeSet.changes) {
    if (change.op === 'put') {
      await check(change.path, change.expectedVersion);
      pending.push({ path: change.path, bytes: change.bytes });
    } else if (change.op === 'delete') {
      await check(change.path, change.expectedVersion);
      pending.push({ path: change.path, bytes: null });
    } else {
      await check(change.from, change.expectedVersion);
      const bytes = change.bytes ?? (await readOverlay(state, published, change.from))?.bytes;
      if (!bytes) {
        conflicts.push({
          path: change.from,
          expected: change.expectedVersion ?? null,
          actual: null,
        });
        continue;
      }
      if ((await current(change.to)) !== null) {
        conflicts.push({ path: change.to, expected: null, actual: await current(change.to) });
      }
      pending.push({ path: change.from, bytes: null }, { path: change.to, bytes });
    }
  }
  if (conflicts.length > 0) return { ok: false, reason: 'conflict', conflicts };

  // The drafts this save touches become one.
  const touched = new Set(pending.map((p) => p.path));
  const joining = state.drafts.filter((d) => d.files.some((f) => touched.has(f.path)));
  const now = (options.now ?? new Date()).toISOString();
  const target: StoredDraft = joining[0]
    ? {
        ...joining[0],
        files: joining.flatMap((d) => d.files),
        bytes: Object.assign({}, ...joining.map((d) => d.bytes)) as Record<string, Uint8Array>,
      }
    : {
        id: options.newId?.() ?? randomId(),
        summary: changeSet.message.summary,
        files: [],
        bytes: {},
        updatedBy: by,
        updatedAt: now,
      };
  const review = joining.find((d) => d.review)?.review;

  for (const { path, bytes } of pending) {
    const index = target.files.findIndex((f) => f.path === path);
    const before = index === -1 ? null : target.files[index];
    const base = before ? before.base : ((await published.read(path))?.version ?? null);
    const next: DraftFile | null =
      bytes === null
        ? base === null
          ? null
          : { op: 'delete', path, base }
        : await (async () => {
            const version = await gitBlobSha(bytes);
            if (version === base) return null;
            target.bytes[version] = bytes;
            return { op: 'put', path, version, size: bytes.length, base } as const;
          })();
    if (index === -1) {
      if (next) target.files.push(next);
    } else if (next) target.files[index] = next;
    else target.files.splice(index, 1);
  }
  // Keep only the bytes the draft still points at.
  const live = new Set(target.files.flatMap((f) => (f.op === 'put' ? [f.version] : [])));
  target.bytes = Object.fromEntries(Object.entries(target.bytes).filter(([v]) => live.has(v)));
  target.summary = changeSet.message.summary;
  if (changeSet.message.trailers) target.trailers = changeSet.message.trailers;
  target.updatedBy = by;
  target.updatedAt = now;
  if (review) target.review = review;

  const others = state.drafts.filter((d) => !joining.includes(d));
  state.drafts = target.files.length > 0 ? [...others, target] : others;
  state.version += 1;
  return { ok: true, draft: target.files.length > 0 ? target : null };
}

/** Drops a draft. Its uploads go with it. */
export function discardDraft(state: DraftState, id: string): boolean {
  const before = state.drafts.length;
  state.drafts = state.drafts.filter((d) => d.id !== id);
  if (state.drafts.length === before) return false;
  state.version += 1;
  return true;
}

/**
 * Keeps a draft's files, now based on what's published (spec §7.4's
 * conflict: the editor keeps theirs). A file that now matches what's
 * published leaves the draft.
 */
export async function rebaseDraft(
  state: DraftState,
  published: PublishedFiles,
  id: string,
  paths: readonly string[],
): Promise<boolean> {
  const draft = state.drafts.find((d) => d.id === id);
  if (!draft) return false;
  const files: DraftFile[] = [];
  for (const file of draft.files) {
    if (!paths.includes(file.path)) {
      files.push(file);
      continue;
    }
    const now = (await published.read(file.path))?.version ?? null;
    if (file.op === 'delete') {
      if (now !== null) files.push({ ...file, base: now });
    } else if (file.version !== now) files.push({ ...file, base: now });
  }
  draft.files = files;
  if (files.length === 0) state.drafts = state.drafts.filter((d) => d.id !== id);
  state.version += 1;
  return true;
}

/**
 * The commit that publishes some drafts: every file expected at the version
 * its draft started from, so anything published since is a conflict.
 */
export function publishChangeSet(state: DraftState, ids: readonly string[]): ChangeSet | null {
  const drafts = ids.map((id) => state.drafts.find((d) => d.id === id));
  if (drafts.length === 0 || drafts.some((d) => d === undefined)) return null;
  const chosen = drafts as StoredDraft[];
  const changes: FileChange[] = chosen.flatMap((draft) =>
    draft.files.map((file): FileChange =>
      file.op === 'delete'
        ? { op: 'delete', path: file.path, expectedVersion: file.base }
        : {
            op: 'put',
            path: file.path,
            bytes: draft.bytes[file.version] ?? new Uint8Array(),
            expectedVersion: file.base,
          },
    ),
  );
  const first = chosen[0] as StoredDraft;
  const summary =
    chosen.length === 1
      ? first.summary
      : `${first.summary}, and ${String(chosen.length - 1)} more ${chosen.length === 2 ? 'change' : 'changes'}`;
  const trailers = Object.assign({}, ...chosen.map((d) => d.trailers ?? {})) as Record<
    string,
    string
  >;
  return {
    changes,
    message: { summary, ...(Object.keys(trailers).length > 0 ? { trailers } : {}) },
  };
}

/** Removes published drafts. */
export function clearDrafts(state: DraftState, ids: readonly string[]): void {
  state.drafts = state.drafts.filter((d) => !ids.includes(d.id));
  state.version += 1;
}

/** A draft without its bytes, as the API sends it. */
export function draftForWire(draft: StoredDraft): Draft {
  const { bytes: _bytes, ...rest } = draft;
  return rest;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `d_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
