import { InvalidPathError, normalizePath } from './paths.ts';
import type { ChangeSet, CommitResult, Conflict, FileChange } from './types.ts';

export type ValidatedChange =
  | { op: 'put'; path: string; bytes: Uint8Array }
  | { op: 'delete'; path: string }
  | { op: 'move'; from: string; to: string; bytes?: Uint8Array };

/**
 * Checks a change set against the current versions before anything is
 * written. Every adapter uses it, so conflict rules are identical
 * everywhere:
 * - `put` with `expectedVersion: null` needs the file to be absent;
 *   with a version, it needs that version.
 * - `delete` needs the file to exist, at `expectedVersion` if given.
 * - `move` needs the source (at `expectedVersion` if given), and the
 *   destination must be free.
 * - A path may appear only once per change set; paths must be valid.
 */
export function validateChangeSet(
  changeSet: ChangeSet,
  versionOf: (path: string) => string | null,
): { ok: true; changes: ValidatedChange[] } | { ok: false; result: CommitResult } {
  let changes: ValidatedChange[];
  try {
    changes = changeSet.changes.map(normalizeChange);
  } catch (error) {
    if (error instanceof InvalidPathError)
      return { ok: false, result: { ok: false, reason: 'rejected', message: error.message } };
    throw error;
  }
  if (changes.length === 0)
    return { ok: false, result: { ok: false, reason: 'rejected', message: 'Nothing to save.' } };

  const touched = changes.flatMap((change) =>
    change.op === 'move' ? [change.from, change.to] : [change.path],
  );
  const duplicate = touched.find((path, i) => touched.indexOf(path) !== i);
  if (duplicate) {
    return {
      ok: false,
      result: {
        ok: false,
        reason: 'rejected',
        message: `"${duplicate}" appears more than once in one save.`,
      },
    };
  }

  const conflicts: Conflict[] = [];
  changeSet.changes.forEach((change, i) => {
    const normalized = changes[i];
    if (!normalized) return;
    if (normalized.op === 'put') {
      const actual = versionOf(normalized.path);
      const expected = (change as Extract<FileChange, { op: 'put' }>).expectedVersion;
      if (expected !== undefined && expected !== actual)
        conflicts.push({ path: normalized.path, expected, actual });
    } else if (normalized.op === 'delete') {
      const actual = versionOf(normalized.path);
      const expected = (change as Extract<FileChange, { op: 'delete' }>).expectedVersion ?? null;
      if (actual === null || (expected !== null && expected !== actual)) {
        conflicts.push({ path: normalized.path, expected, actual });
      }
    } else {
      const actual = versionOf(normalized.from);
      const expected = (change as Extract<FileChange, { op: 'move' }>).expectedVersion ?? null;
      if (actual === null || (expected !== null && expected !== actual)) {
        conflicts.push({ path: normalized.from, expected, actual });
      }
      const occupant = versionOf(normalized.to);
      if (occupant !== null)
        conflicts.push({ path: normalized.to, expected: null, actual: occupant });
    }
  });
  if (conflicts.length > 0)
    return { ok: false, result: { ok: false, reason: 'conflict', conflicts } };
  return { ok: true, changes };
}

function normalizeChange(change: FileChange): ValidatedChange {
  if (change.op === 'put')
    return { op: 'put', path: normalizePath(change.path), bytes: change.bytes };
  if (change.op === 'delete') return { op: 'delete', path: normalizePath(change.path) };
  const move: ValidatedChange = {
    op: 'move',
    from: normalizePath(change.from),
    to: normalizePath(change.to),
  };
  return change.bytes ? { ...move, bytes: change.bytes } : move;
}
