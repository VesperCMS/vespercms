/*
 * A small key-value store in IndexedDB. Without IndexedDB (a private window,
 * blocked storage, jsdom) it keeps values in memory for the visit, so the
 * studio still works; it only forgets them on reload.
 */

export type KeyValueStore<T> = {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
};

export function keyValueStore<T>(database: string, store: string): KeyValueStore<T> {
  const memory = new Map<string, T>();
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = () => {
    opened ??= new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }
        const request = indexedDB.open(database, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(store);
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
  const run = <R>(
    mode: IDBTransactionMode,
    act: (objects: IDBObjectStore) => IDBRequest<R>,
  ): Promise<{ ok: true; value: R } | { ok: false }> =>
    open().then(
      (db) =>
        new Promise((resolve) => {
          if (!db) {
            resolve({ ok: false });
            return;
          }
          try {
            const request = act(db.transaction(store, mode).objectStore(store));
            request.onsuccess = () => {
              resolve({ ok: true, value: request.result });
            };
            request.onerror = () => {
              resolve({ ok: false });
            };
          } catch {
            resolve({ ok: false });
          }
        }),
    );
  return {
    get: async (key) => {
      const found = await run<unknown>('readonly', (objects) => objects.get(key));
      return found.ok ? (found.value as T | undefined) : memory.get(key);
    },
    put: async (key, value) => {
      const done = await run('readwrite', (objects) => objects.put(value, key));
      if (!done.ok) memory.set(key, value);
    },
    delete: async (key) => {
      memory.delete(key);
      await run('readwrite', (objects) => objects.delete(key));
    },
    keys: async () => {
      const found = await run('readonly', (objects) => objects.getAllKeys());
      return found.ok ? found.value.map(String) : [...memory.keys()];
    },
  };
}
