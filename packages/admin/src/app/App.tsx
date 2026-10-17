import type { CollectionManifest } from '@vesper/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Home } from '../screens/Home.tsx';
import { NotFound } from '../screens/NotFound.tsx';
import { Unavailable } from '../screens/Unavailable.tsx';
import type { StudioOptions } from '../types.ts';
import { StudioContext, type Studio } from './context.tsx';
import { NavigationContext } from './navigation.ts';
import { useRoute, type Route } from './router.ts';

export function App({ manifest, api, widgets = {}, siteName = 'Vesper', siteUrl }: StudioOptions) {
  const route = useRoute();
  const navigation = useNavigationCount(route);

  const studio = useMemo<Studio | null>(() => {
    if (!api) return null;
    const byName = new Map<string, CollectionManifest>(
      manifest.collections.map((c) => [c.name, c]),
    );
    return { manifest, api, widgets, siteName, siteUrl, collection: (name) => byName.get(name) };
  }, [manifest, api, widgets, siteName, siteUrl]);

  if (!studio) return <Unavailable siteName={siteName} />;

  return (
    <StudioContext.Provider value={studio}>
      <NavigationContext.Provider value={navigation}>
        <CurrentScreen route={route} key={routeKey(route)} />
      </NavigationContext.Provider>
    </StudioContext.Provider>
  );
}

function CurrentScreen({ route }: { route: Route }) {
  switch (route.screen) {
    case 'home':
      return <Home />;
    default:
      return <NotFound />;
  }
}

/** Each route gets a fresh screen, so no state leaks from one entry to the next. */
function routeKey(route: Route): string {
  return JSON.stringify(route);
}

function useNavigationCount(route: Route): { count: number } {
  const [count, setCount] = useState(0);
  const first = useRef(true);
  const key = routeKey(route);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setCount((n) => n + 1);
  }, [key]);
  return useMemo(() => ({ count }), [count]);
}
