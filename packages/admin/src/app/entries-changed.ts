/*
 * After a save, the lists beside the editor read their collection again, so
 * a new title or status shows there (DECISIONS.md, "The studio is panes,
 * full width").
 */

const listeners = new Set<(collection: string) => void>();

export function entriesChanged(collection: string): void {
  for (const listener of listeners) listener(collection);
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
