import type { CollectionManifest } from '@vesper/core';
import { cx, focusRing, Icon } from '@vesper/ui';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { shownTo } from '../cloud/access.ts';
import { EntryEditor } from '../screens/EntryEditor.tsx';
import { EntryList } from '../screens/EntryList.tsx';
import { Home } from '../screens/Home.tsx';
import { ListPane } from '../screens/ListPane.tsx';
import { MediaBrowser } from '../screens/MediaBrowser.tsx';
import { NotFound } from '../screens/NotFound.tsx';
import { PageTree } from '../screens/PageTree.tsx';
import { Redirects } from '../screens/Redirects.tsx';
import { collectionIcon } from './collection-icon.ts';
import type { Studio } from './context.tsx';
import { useLoad } from './load.ts';
import { hrefFor, type Route } from './router.ts';
import { PaneContext, usePane, type PaneInfo } from './pane-context.ts';
import { StudioHeader } from './Screen.tsx';

/*
 * The studio on wide screens, full width: panes side by side, Sanity-style
 * (DECISIONS.md, "The studio is panes, full width"). The structure pane
 * lists the site's collections and is always there, so getting back to them
 * is one click; a collection's list comes next; an entry opens beside it.
 * Each pane scrolls on its own. When they don't all fit, the earlier panes
 * fold into narrow strips, and a strip opens again with a click. Narrower
 * than 48rem the studio is one screen at a time, as before.
 */

/** Wide enough for panes: below it, one screen at a time. */
export const PANES = '(min-width: 48rem)';

type Width = 'structure' | 'list' | 'flex';

/** Least widths in rem. A folded pane is a strip. */
const WIDTH: Record<Width, number> = { structure: 15, list: 20, flex: 30 };
const STRIP = 2.75;

const widthClass: Record<Width, string> = {
  structure: 'w-60 shrink-0',
  list: 'w-80 shrink-0',
  flex: 'min-w-0 flex-1',
};

function useWindowRem(): number {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('resize', onChange);
      return () => {
        window.removeEventListener('resize', onChange);
      };
    },
    () => window.innerWidth / 16,
    () => 80,
  );
}

type PaneSpec = {
  id: string;
  title: string;
  width: Width;
  content: ReactNode;
};

/** Which panes fold, earliest first, keeping the last one and the one asked for open. */
function folded(panes: PaneSpec[], room: number, keep: string | null): Set<string> {
  const out = new Set<string>();
  const need = () =>
    panes.reduce((sum, pane) => sum + (out.has(pane.id) ? STRIP : WIDTH[pane.width]), 0);
  for (const pane of panes.slice(0, -1)) {
    if (need() <= room) break;
    if (pane.id !== keep) out.add(pane.id);
  }
  // Still too wide with the asked-for pane open: fold it too, rather than the last.
  for (const pane of panes.slice(0, -1)) {
    if (need() <= room) break;
    out.add(pane.id);
  }
  return out;
}

/**
 * The studio's screens. Wide, they're panes; narrow, the deepest pane alone
 * is the screen. Both are the same tree, so crossing the width keeps the
 * open entry as it is, unsaved changes included.
 */
export function PaneShell({
  route,
  studio,
  wide,
}: {
  route: Route;
  studio: Studio;
  wide: boolean;
}) {
  const room = useWindowRem();
  const [opened, setOpened] = useState<{ key: string; pane: string } | null>(null);
  const routeKey = JSON.stringify(route);
  const all = panesFor(route, studio);
  const panes = wide ? all : all.slice(-1);
  // A strip opened by hand stays open until the next navigation.
  const keep = opened?.key === routeKey ? opened.pane : null;
  const fold = wide ? folded(panes, room, keep) : new Set<string>();

  return (
    <div className={wide ? 'flex h-dvh flex-col' : undefined}>
      {wide && <StudioHeader />}
      <div className={wide ? 'flex min-h-0 flex-1' : undefined}>
        {panes.map((pane, index) => {
          const last = index === panes.length - 1;
          const info: PaneInfo | null = wide
            ? { landmark: last ? 'main' : 'nav', level: last ? 1 : 2, focusTarget: last }
            : null;
          return fold.has(pane.id) ? (
            <PaneStrip
              key={pane.id}
              title={pane.title}
              onOpen={() => {
                setOpened({ key: routeKey, pane: pane.id });
              }}
            />
          ) : (
            <div
              key={pane.id}
              className={
                wide
                  ? cx(
                      'flex min-h-0 flex-col border-r border-border last:border-r-0',
                      widthClass[pane.width],
                    )
                  : undefined
              }
            >
              <PaneContext.Provider value={info}>{pane.content}</PaneContext.Provider>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A folded pane: its name, sideways, and a button that opens it again. */
function PaneStrip({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Show ${title}`}
      className={cx(
        'flex w-11 shrink-0 flex-col items-center gap-3 border-r border-border pt-4 text-small text-content-muted hover:bg-surface-sunken hover:text-content',
        focusRing,
      )}
    >
      <Icon name="list-pane" size={18} />
      <span aria-hidden="true" className="[writing-mode:vertical-rl]">
        {title}
      </span>
    </button>
  );
}

/** The panes a route shows, from the structure pane to the deepest. */
function panesFor(route: Route, studio: Studio): PaneSpec[] {
  const structure: PaneSpec = {
    id: 'structure',
    title: 'Content',
    width: 'structure',
    content: <StructurePane route={route} studio={studio} />,
  };
  const flex = (id: string, title: string, content: ReactNode): PaneSpec => ({
    id,
    title,
    width: 'flex',
    content,
  });
  if (route.screen === 'home' || route.screen === 'changes') {
    return [structure, flex('home', 'Content', <Home />)];
  }
  if (route.screen === 'media') return [structure, flex('media', 'Media', <MediaBrowser />)];
  if (route.screen === 'redirects') {
    return [structure, flex('redirects', 'Redirects', <Redirects />)];
  }
  if (route.screen === 'list' || route.screen === 'edit' || route.screen === 'new') {
    const collection = studio.collection(route.collection);
    if (!collection) {
      return [
        structure,
        flex(
          'missing',
          'Not found',
          <NotFound message={`This site has no collection called “${route.collection}”.`} />,
        ),
      ];
    }
    const tree = collection.presentation.tree === true && collection.source.loader === 'glob';
    if (route.screen === 'list') {
      // Nothing open yet: the whole list, with its columns, filters and the outline's moves.
      return [
        structure,
        flex(
          `list:${collection.name}`,
          collection.label,
          tree ? <PageTree collection={collection} /> : <EntryList collection={collection} />,
        ),
      ];
    }
    const editor = (
      <EntryEditor
        key={JSON.stringify(route)}
        collection={collection}
        id={route.screen === 'edit' ? route.id : null}
        {...(route.screen === 'new' && route.parent !== undefined ? { parent: route.parent } : {})}
      />
    );
    if (collection.presentation.singleton) {
      return [structure, flex(`entry`, collection.label, editor)];
    }
    return [
      structure,
      {
        id: `pane-list:${collection.name}`,
        title: collection.label,
        width: 'list',
        content: (
          <ListPane collection={collection} currentId={route.screen === 'edit' ? route.id : null} />
        ),
      },
      flex('entry', 'Entry', editor),
    ];
  }
  return [structure, flex('missing', 'Not found', <NotFound />)];
}

/** Where a route is, for the structure pane's current item. */
function hereOf(route: Route): string | null {
  if ('collection' in route) return `c:${route.collection}`;
  if (route.screen === 'media') return 'media';
  if (route.screen === 'redirects') return 'redirects';
  return null;
}

/**
 * The structure pane: every collection, then settings, then the site's own
 * places. Always on screen, so the site's content is one click away.
 */
function StructurePane({ route, studio }: { route: Route; studio: Studio }) {
  const { manifest, api, cloud, siteUrl } = studio;
  const [summary] = useLoad(() => api.summary(), 'structure');
  const counts = new Map(
    summary.state === 'ready' ? summary.value.map((s) => [s.collection, s.count]) : [],
  );
  const shown = manifest.collections.filter((c) => shownTo(cloud, c.name));
  const collections = shown.filter((c) => !c.presentation.singleton);
  const singletons = shown.filter((c) => c.presentation.singleton);
  const here = hereOf(route);
  const pane = usePane();

  const item = (
    key: string,
    href: string,
    label: string,
    icon: ReactNode,
    detail?: string,
  ): ReactNode => {
    const current = here === key;
    return (
      <li key={key}>
        <a
          href={href}
          aria-current={current ? 'page' : undefined}
          className={cx(
            'flex min-h-10 items-center gap-2 rounded-md px-2 text-body text-content no-underline hover:bg-surface-sunken',
            current && 'bg-accent-subtle font-semibold hover:bg-accent-subtle',
            focusRing,
          )}
        >
          <span className="shrink-0 text-content-muted">{icon}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {detail && <span className="shrink-0 text-caption text-content-muted">{detail}</span>}
        </a>
      </li>
    );
  };
  const collectionItem = (collection: CollectionManifest) => {
    const icon = collectionIcon(collection);
    const count = counts.get(collection.name);
    return item(
      `c:${collection.name}`,
      hrefFor({ screen: 'list', collection: collection.name }),
      collection.label,
      <Icon {...icon} size={18} />,
      count !== undefined && !collection.presentation.singleton
        ? new Intl.NumberFormat().format(count)
        : undefined,
    );
  };
  const Heading = pane?.level === 1 ? 'h1' : 'h2';

  return (
    <nav aria-labelledby="structure-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-14 items-center border-b border-border px-4">
        <Heading id="structure-heading" className="text-label text-content">
          Content
        </Heading>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-0.5">{collections.map(collectionItem)}</ul>
        {singletons.length > 0 && (
          <>
            <h3 className="mt-6 mb-1 px-2 text-small text-content-muted">Settings</h3>
            <ul className="flex flex-col gap-0.5">{singletons.map(collectionItem)}</ul>
          </>
        )}
        <h3 className="mt-6 mb-1 px-2 text-small text-content-muted">Site</h3>
        <ul className="flex flex-col gap-0.5">
          {item('media', hrefFor({ screen: 'media' }), 'Media', <Icon name="media" size={18} />)}
          {/* Redirects belong to the whole site (spec §7.5): a folder grant doesn't reach them. */}
          {(!cloud || cloud.wholeSite) &&
            item(
              'redirects',
              hrefFor({ screen: 'redirects' }),
              'Redirects',
              <Icon name="redirects" size={18} />,
            )}
          {siteUrl && (
            <li>
              <a
                href={siteUrl}
                target="_blank"
                rel="noopener"
                className={cx(
                  'flex min-h-10 items-center gap-2 rounded-md px-2 text-body text-content no-underline hover:bg-surface-sunken',
                  focusRing,
                )}
              >
                <Icon name="view-on-site" size={18} className="text-content-muted" />
                View site
              </a>
            </li>
          )}
        </ul>
      </div>
    </nav>
  );
}
