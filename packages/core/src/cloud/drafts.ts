import { gitBlobSha } from '../storage/git-blob-sha.ts';
import { normalizePath } from '../storage/paths.ts';
import { validateChangeSet } from '../storage/validate.ts';
import type {
  ChangeSet,
  CommitTrailers,
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
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] }
  | { ok: false; reason: 'rejected'; message: string };

/**
 * Saves a change set as a draft. Paths and expected versions are checked
 * by `validateChangeSet` against the site as its drafts show it, exactly as
 * every storage adapter checks them, so two editors on one entry get a
 * conflict rather than an overwrite.
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
  // The current version of every path the change set names, for the synchronous check.
  const versions = new Map<string, string | null>();
  for (const change of changeSet.changes) {
    for (const raw of change.op === 'move' ? [change.from, change.to] : [change.path]) {
      let path: string;
      try {
        path = normalizePath(raw);
      } catch {
        continue;
      }
      if (!versions.has(path)) {
        versions.set(path, (await readOverlay(state, published, path))?.version ?? null);
      }
    }
  }
  const checked = validateChangeSet(changeSet, (path) => versions.get(path) ?? null);
  if (!checked.ok) {
    const result = checked.result;
    if (result.ok) return { ok: false, reason: 'rejected', message: 'Nothing to save.' };
    return result.reason === 'conflict'
      ? { ok: false, reason: 'conflict', conflicts: result.conflicts }
      : { ok: false, reason: 'rejected', message: result.message };
  }
  const pending: Pending[] = [];
  for (const change of checked.changes) {
    if (change.op === 'put') pending.push({ path: change.path, bytes: change.bytes });
    else if (change.op === 'delete') pending.push({ path: change.path, bytes: null });
    else {
      const bytes = change.bytes ?? (await readOverlay(state, published, change.from))?.bytes;
      if (!bytes)
        return {
          ok: false,
          reason: 'conflict',
          conflicts: [{ path: change.from, expected: null, actual: null }],
        };
      pending.push({ path: change.from, bytes: null }, { path: change.to, bytes });
    }
  }

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
        authors: [],
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
  const trailers = mergeTrailers([...joining.map((d) => d.trailers), changeSet.message.trailers]);
  if (Object.keys(trailers).length > 0) target.trailers = trailers;
  // The saver keeps their place, under the name they have now.
  target.authors = onceEach([...joining.flatMap((d) => d.authors), by]).map((person) =>
    person.id === by.id ? { id: by.id, name: by.name } : person,
  );
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
 * Who publishes, and the domain of the no-reply addresses that name people
 * in the commit (`users.noreply.vespercms.com`): a public repository's
 * history is public forever, so never anyone's email.
 */
export type PublishCredit = { by: { id: string; name: string }; noReplyDomain: string };

/** Trailers only the cloud sets, whatever a draft's own trailers say. */
const CREDIT_TRAILERS = new Set(['vesper-editor', 'co-authored-by']);

/**
 * The commit that publishes some drafts: every file expected at the version
 * its draft started from, so anything published since is a conflict.
 *
 * The commit is the app's bot's, so it names people in trailers: the
 * publisher first, then each draft's authors in the order the drafts are
 * given, each person once, with their IDs in `Vesper-Editor` in the same
 * order (DECISIONS.md, "A publish credits every draft's author").
 */
export function publishChangeSet(
  state: DraftState,
  ids: readonly string[],
  credit: PublishCredit,
): ChangeSet | null {
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
  const own = Object.entries(mergeTrailers(chosen.map((d) => d.trailers))).filter(
    ([key]) => !CREDIT_TRAILERS.has(key.toLowerCase()),
  );
  const people = onceEach([credit.by, ...chosen.flatMap((d) => d.authors)]);
  return {
    changes,
    message: {
      summary,
      trailers: {
        ...Object.fromEntries(own),
        'Vesper-Editor': people.map((person) => person.id),
        'Co-authored-by': people.map((person) => coAuthor(person, credit.noReplyDomain)),
      },
    },
  };
}

/** `Name <id@domain>`, on one line, with nothing in the name that could end the address early. */
function coAuthor(person: { id: string; name: string }, domain: string): string {
  const name = person.name.replace(/[\s<>]+/g, ' ').trim() || 'Vesper editor';
  return `${name} <${person.id}@${domain}>`;
}

/** People by ID, each once, where they first appear. */
function onceEach<T extends { id: string }>(people: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const person of people) if (!seen.has(person.id)) seen.set(person.id, person);
  return [...seen.values()];
}

/**
 * Several saves' trailers as one set: each name's values in the order they
 * came, each once. A name with one value keeps it as a string, as the
 * studio sends it.
 */
function mergeTrailers(sets: readonly (CommitTrailers | undefined)[]): CommitTrailers {
  const merged = new Map<string, string[]>();
  for (const set of sets) {
    for (const [key, value] of Object.entries(set ?? {})) {
      const values = merged.get(key) ?? [];
      for (const one of typeof value === 'string' ? [value] : value) {
        if (!values.includes(one)) values.push(one);
      }
      merged.set(key, values);
    }
  }
  return Object.fromEntries(
    [...merged].map(([key, values]) => [key, values.length === 1 ? (values[0] as string) : values]),
  );
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
