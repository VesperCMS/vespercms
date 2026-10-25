import { useCallback, useState } from 'react';

/*
 * Whether the editor's list pane shows, kept per viewer in this browser
 * (DECISIONS.md, "The entry list sits beside the editor on wide screens").
 * It shows until someone hides it (call L2).
 */

const PANE_KEY = 'vesper:list-pane';

function readShown(): boolean {
  try {
    return localStorage.getItem(PANE_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

export function usePaneShown(): [boolean, (shown: boolean) => void] {
  const [shown, setShown] = useState(readShown);
  const choose = useCallback((next: boolean) => {
    setShown(next);
    try {
      if (next) localStorage.removeItem(PANE_KEY);
      else localStorage.setItem(PANE_KEY, 'hidden');
    } catch {
      // Kept for this visit only.
    }
  }, []);
  return [shown, choose];
}
