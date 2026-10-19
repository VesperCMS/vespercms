import type { BlobCache } from '@vesper/core';

/*
 * File bytes by git blob SHA, kept in IndexedDB between visits. A SHA always
 * means the same bytes, so nothing here ever goes stale: a later visit reads
 * from GitHub only the files that changed. Without IndexedDB (a private
 * window, blocked storage) it quietly does nothing.
 */

const DB = 'vesper-github';
const STORE = 'blobs';

export function indexedDbCache(): BlobCache {
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = () => {
    opened ??= new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
    return opened;
  };
  const run = <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) =>
    open().then(
      (db) =>
        new Promise<T | undefined>((resolve) => {
          if (!db) {
            resolve(undefined);
            return;
          }
          try {
            const request = act(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => {
              resolve(request.result);
            };
            request.onerror = () => {
              resolve(undefined);
            };
          } catch {
            resolve(undefined);
          }
        }),
    );
  return {
    get: async (sha) => {
      const found = await run<unknown>('readonly', (store) => store.get(sha));
      return found instanceof Uint8Array ? found : undefined;
    },
    put: async (sha, bytes) => {
      await run('readwrite', (store) => store.put(bytes, sha));
    },
  };
}
