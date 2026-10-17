import { useCallback, useEffect, useRef, useState } from 'react';

export type Load<T> =
  { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; message: string };

/**
 * Loads data for a screen. The loader runs again when `key` changes, or when
 * `reload()` is called (after a save, for example); a reload keeps showing
 * the old value until the new one arrives. A response that arrives after
 * the key moved on is dropped.
 */
export function useLoad<T>(loader: () => Promise<T>, key = ''): [Load<T>, () => void] {
  const [result, setResult] = useState<{ key: string; load: Load<T> } | null>(null);
  const [generation, setGeneration] = useState(0);
  const latest = useRef(loader);
  useEffect(() => {
    latest.current = loader;
  });

  useEffect(() => {
    let current = true;
    latest.current().then(
      (value) => {
        if (current) setResult({ key, load: { state: 'ready', value } });
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (current) setResult({ key, load: { state: 'failed', message } });
      },
    );
    return () => {
      current = false;
    };
  }, [key, generation]);

  const reload = useCallback(() => {
    setGeneration((n) => n + 1);
  }, []);
  return [result?.key === key ? result.load : { state: 'loading' }, reload];
}
