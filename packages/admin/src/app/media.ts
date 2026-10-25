import { useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, kept current as the window changes.
 * False where there's no `matchMedia` (and so in jsdom's stub).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Wide enough that Details opens as a drawer at the side instead of closing
 * the editor's column (Vesper's design system: about 1100px). At 200% zoom a
 * laptop's window is narrower than this.
 */
export const WIDE_EDITOR = '(min-width: 68.75rem)';

/**
 * Wide enough for the collection's list beside the editor's column (DECISIONS.md,
 * "The entry list sits beside the editor on wide screens"): 18rem, a gap and
 * the 45rem column inside the top bar's 72rem.
 */
export const LIST_PANE = '(min-width: 80rem)';
