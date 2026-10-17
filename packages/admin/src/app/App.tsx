import type { CollectionManifest } from '@vesper/core';
import { Button, Dialog } from '@vesper/ui';
import { lazy, useEffect, useMemo, useRef, useState } from 'react';
import { EntryEditor } from '../screens/EntryEditor.tsx';
import { EntryList } from '../screens/EntryList.tsx';
import { Home } from '../screens/Home.tsx';
import { MediaBrowser } from '../screens/MediaBrowser.tsx';
import { NotFound } from '../screens/NotFound.tsx';
import { Unavailable } from '../screens/Unavailable.tsx';
import type { StudioOptions, WidgetComponent, WidgetLoader } from '../types.ts';
import { StudioContext, type Studio } from './context.tsx';
import { NavigationContext } from './navigation.ts';
import { useRouter, type Route } from './router.ts';

const NO_WIDGETS: Record<string, WidgetLoader> = {};
const NO_PROPS: Record<string, unknown> = {};

export function App({
  manifest,
  api,
  widgets = NO_WIDGETS,
  mdxProps = NO_PROPS,
  siteName = 'Vesper',
  siteUrl,
}: StudioOptions) {
  const { route, pending, leave, stay } = useRouter();
  const navigation = useNavigationCount(route);

  const studio = useMemo<Studio | null>(() => {
    if (!api) return null;
    const byName = new Map<string, CollectionManifest>(
      manifest.collections.map((c) => [c.name, c]),
    );
    return {
      manifest,
      api,
      widgets: lazyWidgets(widgets),
      mdxProps,
      siteName,
      siteUrl,
      collection: (name) => byName.get(name),
    };
  }, [manifest, api, widgets, mdxProps, siteName, siteUrl]);

  if (!studio) return <Unavailable siteName={siteName} />;

  return (
    <StudioContext.Provider value={studio}>
      <NavigationContext.Provider value={navigation}>
        <CurrentScreen route={route} studio={studio} key={routeKey(route)} />
        <Dialog
          title="Leave without saving?"
          role="alertdialog"
          isOpen={pending !== null}
          onOpenChange={(open) => {
            if (!open) stay();
          }}
        >
          <p className="mb-6">Your changes to this entry haven’t been saved. They’ll be lost.</p>
          <div className="flex flex-wrap justify-end gap-3">
            <Button onPress={stay}>Keep editing</Button>
            <Button variant="danger" onPress={leave}>
              Leave without saving
            </Button>
          </div>
        </Dialog>
      </NavigationContext.Provider>
    </StudioContext.Provider>
  );
}

function CurrentScreen({ route, studio }: { route: Route; studio: Studio }) {
  if (route.screen === 'home') return <Home />;
  if (route.screen === 'media') return <MediaBrowser />;
  if (route.screen === 'list' || route.screen === 'edit' || route.screen === 'new') {
    const collection = studio.collection(route.collection);
    if (!collection) {
      return <NotFound message={`This site has no collection called “${route.collection}”.`} />;
    }
    if (route.screen === 'list') return <EntryList collection={collection} />;
    if (route.screen === 'new') return <EntryEditor collection={collection} id={null} />;
    return <EntryEditor collection={collection} id={route.id} />;
  }
  return <NotFound />;
}

const lazyCache = new WeakMap<WidgetLoader, WidgetComponent>();

/** Custom widget loaders as lazy components, made once per loader. */
function lazyWidgets(loaders: Record<string, WidgetLoader>): Record<string, WidgetComponent> {
  return Object.fromEntries(
    Object.entries(loaders).map(([name, loader]) => {
      let component = lazyCache.get(loader);
      if (!component) {
        component = lazy(loader);
        lazyCache.set(loader, component);
      }
      return [name, component];
    }),
  );
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
