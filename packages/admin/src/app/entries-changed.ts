/*
 * After a save, the lists beside the editor read their collection again, so
 * a new title or status shows there (DECISIONS.md, "The studio is panes,
 * full width").
 */

const listeners = new Set<(collection: string) => void>();

export function entriesChanged(collection: string): void {
  for (const listener of listeners) listener(collection);
}

const rewrites = new Set<(collection: string, ids: readonly string[]) => void>();

/**
 * Entries rewritten from outside their editor: a move in the list writes
 * order numbers into them, and an editor open on one reads it again, or its
 * next save would find a version it didn't start from.
 */
export function entriesRewritten(collection: string, ids: readonly string[]): void {
  for (const listener of rewrites) listener(collection, ids);
  entriesChanged(collection);
}

/** Calls `listener` with the IDs whenever entries in `collection` are rewritten; returns the way to stop. */
export function onEntriesRewritten(
  collection: string,
  listener: (ids: readonly string[]) => void,
): () => void {
  const each = (changed: string, ids: readonly string[]) => {
    if (changed === collection) listener(ids);
  };
  rewrites.add(each);
  return () => {
    rewrites.delete(each);
  };
}

/** Calls `listener` after each save in `collection`; returns the way to stop. */
export function onEntriesChanged(collection: string, listener: () => void): () => void {
  const each = (changed: string) => {
    if (changed === collection) listener();
  };
  listeners.add(each);
  return () => {
    listeners.delete(each);
  };
}
