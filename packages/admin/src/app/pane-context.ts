import { createContext, useContext } from 'react';

/** Where a screen sits among the panes (app/panes.tsx), or null one screen at a time. */
export type PaneInfo = {
  /**
   * `main` for the deepest pane, `nav` for the ones that lead to it, and
   * `region` for a pane beside the deepest that leads nowhere (the cloud's
   * waiting drafts on Home).
   */
  landmark: 'main' | 'nav' | 'region';
  /** The deepest pane's title is the page's `h1`; the others are `h2`s. */
  level: 1 | 2;
  /** The deepest pane takes focus after a navigation, and names the browser tab. */
  focusTarget: boolean;
  /** How wide it is: the narrow panes get tighter padding and a smaller heading. */
  width: 'structure' | 'list' | 'flex';
  /** Folds the pane into a strip, when people may: every pane but the deepest. */
  onCollapse?: () => void;
};

export const PaneContext = createContext<PaneInfo | null>(null);

export function usePane(): PaneInfo | null {
  return useContext(PaneContext);
}
