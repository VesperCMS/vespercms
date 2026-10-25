import { createContext, useContext } from 'react';

/** Where a screen sits among the panes (app/panes.tsx), or null one screen at a time. */
export type PaneInfo = {
  /** `main` for the deepest pane, `nav` for the ones that lead to it. */
  landmark: 'main' | 'nav';
  /** The deepest pane's title is the page's `h1`; the others are `h2`s. */
  level: 1 | 2;
  /** The deepest pane takes focus after a navigation, and names the browser tab. */
  focusTarget: boolean;
};

export const PaneContext = createContext<PaneInfo | null>(null);

export function usePane(): PaneInfo | null {
  return useContext(PaneContext);
}
