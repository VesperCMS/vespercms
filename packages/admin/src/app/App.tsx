import type { CollectionManifest } from '@vesper/core';
import { Button, Dialog } from '@vesper/ui';
import { lazy, useEffect, useMemo, useRef, useState } from 'react';
import { EntryEditor } from '../screens/EntryEditor.tsx';
import { EntryList } from '../screens/EntryList.tsx';
import { Home } from '../screens/Home.tsx';
import { MediaBrowser } from '../screens/MediaBrowser.tsx';
import { NotFound } from '../screens/NotFound.tsx';
import { PageTree } from '../screens/PageTree.tsx';
import { Redirects } from '../screens/Redirects.tsx';
import { Unavailable } from '../screens/Unavailable.tsx';
import type { StudioOptions, WidgetComponent, WidgetLoader } from '../types.ts';
import { StudioContext, VESPER_NAME, type Studio } from './context.tsx';
import { NavigationContext } from './navigation.ts';
import { useRouter, type Route } from './router.ts';

const NO_WIDGETS: Record<string, WidgetLoader> = {};
const NO_PROPS = (): Promise<Record<string, unknown>> => Promise.resolve({});

export function App({
  manifest,
  api,
  widgets = NO_WIDGETS,
  loadMdxProps = NO_PROPS,
  siteName = VESPER_NAME,
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
      loadMdxProps,
      siteName,
      siteUrl,
      collection: (name) => byName.get(name),
    };
  }, [manifest, api, widgets, loadMdxProps, siteName, siteUrl]);

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
  if (route.screen === 'redirects') return <Redirects />;
  if (route.screen === 'list' || route.screen === 'edit' || route.screen === 'new') {
    const collection = studio.collection(route.collection);
    if (!collection) {
      return <NotFound message={`This site has no collection called “${route.collection}”.`} />;
    }
    if (route.screen === 'list') {
      // Tree collections are an outline of pages instead of a flat list (spec §6.15.2).
      return collection.presentation.tree && collection.source.loader === 'glob' ? (
        <PageTree collection={collection} />
      ) : (
        <EntryList collection={collection} />
      );
    }
    if (route.screen === 'new') {
      return (
        <EntryEditor
          collection={collection}
          id={null}
          {...(route.parent !== undefined ? { parent: route.parent } : {})}
        />
      );
    }
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

/**
 * Counts in-app navigations, so a new screen can take focus. It compares the
 * route with the last one counted rather than skipping a "first run": React's
 * StrictMode runs effects twice on mount in development, and a first-run flag
 * then counted the load as a navigation and moved focus past the top bar.
 */
function useNavigationCount(route: Route): { count: number } {
  const [count, setCount] = useState(0);
  const key = routeKey(route);
  const counted = useRef(key);
  useEffect(() => {
    if (counted.current === key) return;
    counted.current = key;
    setCount((n) => n + 1);
  }, [key]);
  return useMemo(() => ({ count }), [count]);
}
