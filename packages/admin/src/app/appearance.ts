import { useCallback, useState } from 'react';

/*
 * Light, dark, or the system's choice (DECISIONS.md, "Appearance is in the
 * user menu"). The tokens switch on `html[data-theme]`; with no attribute
 * they follow the system. The choice is per viewer, in this browser, for this
 * site. `admin.astro` applies it before the page paints, with the same key,
 * so a dark choice doesn't flash light while the studio loads.
 */

export type Appearance = 'system' | 'light' | 'dark';

export const APPEARANCE_KEY = 'vesper:appearance';

export const APPEARANCES: readonly { id: Appearance; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(APPEARANCE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    // Storage can be refused (a private window, a blocked site): follow the system.
    return 'system';
  }
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  if (appearance === 'system') delete root.dataset.theme;
  else root.dataset.theme = appearance;
}

export function saveAppearance(appearance: Appearance): void {
  applyAppearance(appearance);
  try {
    if (appearance === 'system') localStorage.removeItem(APPEARANCE_KEY);
    else localStorage.setItem(APPEARANCE_KEY, appearance);
  } catch {
    // Kept for this visit only.
  }
}

export function useAppearance(): [Appearance, (appearance: Appearance) => void] {
  const [appearance, setAppearance] = useState(readAppearance);
  const choose = useCallback((next: Appearance) => {
    saveAppearance(next);
    setAppearance(next);
  }, []);
  return [appearance, choose];
}
