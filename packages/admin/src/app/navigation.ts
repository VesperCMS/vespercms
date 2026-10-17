import { createContext } from 'react';

/** How many in-app navigations have happened. 0 on the screen the studio opened on. */
export const NavigationContext = createContext<{ count: number }>({ count: 0 });
