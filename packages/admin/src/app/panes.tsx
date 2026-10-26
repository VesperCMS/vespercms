import type { CollectionManifest } from '@vesper/core';
import { cx, focusRing, Icon } from '@vesper/ui';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { shownTo } from '../cloud/access.ts';
import { DraftsWaiting, useDraftsWaiting } from '../cloud/changes.tsx';
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
import { PaneFrame, Screen, StudioHeader, useLeadHeading } from './Screen.tsx';

/*
 * The studio on wide screens, full width: panes side by side, Sanity-style
 * (DECISIONS.md, "The studio is panes, full width"). The structure pane
 * lists the site's collections and is always there, so getting back to them
 * is one click. A collection's list is always a pane of its own, with all of
 * the list's tools, and an entry opens beside it. Each pane scrolls on its
 * own. People can collapse any pane but the deepest into a strip, and the
 * studio folds the earlier ones itself when they don't all fit; a strip
 * opens again with a click. With nothing chosen, the structure pane is the
 * page itself. Narrower than 48rem the studio is one screen at a time, as
 * before.
 */

/** Wide enough for panes: below it, one screen at a time. */
export const PANES = '(min-width: 48rem)';

type Width = PaneInfo['width'];

/** Least widths in rem. A folded pane is a strip. */
const WIDTH: Record<Width, number> = { structure: 15, list: 22, flex: 30 };
const STRIP = 2.75;

const widthClass: Record<Width, string> = {
  structure: 'w-60 shrink-0',
  list: 'w-88 shrink-0',
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

/** The panes people may collapse, by kind, so a choice holds from one collection to the next. */
type Kind = 'structure' | 'list';

type PaneSpec = {
  id: string;
  kind?: Kind;
  title: string;
  width: Width;
  content: ReactNode;
};

const COLLAPSED_KEY = 'vesper:collapsed-panes';

function readCollapsed(): Set<Kind> {
  try {
    const value = localStorage.getItem(COLLAPSED_KEY) ?? '';
    return new Set(value.split(',').filter((k): k is Kind => k === 'structure' || k === 'list'));
  } catch {
    return new Set();
  }
}

/** Panes people collapsed, kept per viewer in this browser. */
function useCollapsed(): [Set<Kind>, (kind: Kind, collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const set = useCallback((kind: Kind, value: boolean) => {
    setCollapsed((now) => {
      const next = new Set(now);
      if (value) next.add(kind);
      else next.delete(kind);
      try {
        localStorage.setItem(COLLAPSED_KEY, [...next].join(','));
      } catch {
        // Kept for this visit only.
      }
      return next;
    });
  }, []);
  return [collapsed, set];
}

/**
 * Which panes fold: the ones people collapsed, then, while they don't fit,
 * the earliest, keeping the deepest and the one opened by hand.
 */
function folded(
  panes: PaneSpec[],
  room: number,
  collapsed: Set<Kind>,
  keep: string | null,
): Set<string> {
  const last = panes.at(-1);
  const out = new Set(
    panes
      .filter((pane) => pane !== last && pane.kind !== undefined && collapsed.has(pane.kind))
      .map((pane) => pane.id),
  );
  const need = () =>
    panes.reduce((sum, pane) => sum + (out.has(pane.id) ? STRIP : WIDTH[pane.width]), 0);
  for (const pane of panes.slice(0, -1)) {
    if (need() <= room) break;
    if (pane.id !== keep) out.add(pane.id);
  }
  // Still too wide with the opened pane open: fold it too, rather than the deepest.
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
  const [collapsed, setCollapsed] = useCollapsed();
  const [opened, setOpened] = useState<{ key: string; pane: string } | null>(null);
  const routeKey = JSON.stringify(route);
  const all = panesFor(route, studio, wide);
  const panes = wide ? all : all.slice(-1);
  // A strip the studio folded, opened by hand, stays open until the next navigation.
  const keep = opened?.key === routeKey ? opened.pane : null;
  const fold = wide ? folded(panes, room, collapsed, keep) : new Set<string>();
  const last = panes.at(-1);
  const home = route.screen === 'home' || route.screen === 'changes';

  // Collapsing removes the button that was pressed, so focus goes to the strip in its place,
  // and back to the collapse button when the strip opens the pane again.
  const row = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const selector = focusNext.current;
    if (selector === null) return;
    focusNext.current = null;
    row.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  return (
    <div className={wide ? 'flex h-dvh flex-col' : undefined}>
      {wide && <StudioHeader />}
      {/* Positioned and clipped: screen-reader-only text deep in a pane's scrolling content is
          positioned absolutely, and with no positioned ancestor it lengthened the page itself. */}
      <div ref={row} className={wide ? 'relative flex min-h-0 flex-1 overflow-hidden' : undefined}>
        {panes.map((pane) => {
          const deepest = pane === last;
          const kind = pane.kind;
          const info: PaneInfo | null = wide
            ? {
                landmark: deepest ? 'main' : 'nav',
                level: deepest ? 1 : 2,
                focusTarget: deepest,
                width: pane.width,
                ...(!deepest && kind
                  ? {
                      onCollapse: () => {
                        focusNext.current = `[data-strip="${CSS.escape(pane.id)}"]`;
                        setCollapsed(kind, true);
                      },
                    }
                  : {}),
              }
            : null;
          return fold.has(pane.id) ? (
            <PaneStrip
              key={pane.id}
              id={pane.id}
              title={pane.title}
              onOpen={() => {
                focusNext.current = `[data-pane="${CSS.escape(pane.id)}"] [data-collapse]`;
                if (kind && collapsed.has(kind)) setCollapsed(kind, false);
                else setOpened({ key: routeKey, pane: pane.id });
              }}
            />
          ) : (
            <div
              key={pane.id}
              data-pane={pane.id}
              className={
                wide
                  ? cx('flex min-h-0 flex-col border-r border-border', widthClass[pane.width])
                  : undefined
              }
            >
              <PaneContext.Provider value={info}>{pane.content}</PaneContext.Provider>
            </div>
          );
        })}
        {wide && last && last.width !== 'flex' && (home ? <WaitingPane /> : <Filler />)}
      </div>
    </div>
  );
}

/** Room for the entry a list opens: empty until one is chosen. */
function Filler() {
  return <div aria-hidden="true" data-filler="" className="min-w-0 flex-1 bg-surface-sunken" />;
}

const WAITING: PaneInfo = { landmark: 'region', level: 2, focusTarget: false, width: 'flex' };

/**
 * Beside the collections on Home, the cloud's drafts waiting to be
 * published, and the filler when there are none: absent, not empty (spec
 * §6.9). A region beside the page's `main`, never the deepest pane itself:
 * drafts arrive in the background, and a pane that took the lead would move
 * the `h1` and focus with them.
 */
function WaitingPane() {
  if (useDraftsWaiting() === 0) return <Filler />;
  return (
    <div
      data-pane="changes"
      className={cx('flex min-h-0 flex-col border-r border-border', widthClass.flex)}
    >
      <PaneContext.Provider value={WAITING}>
        <Screen title="Changes" afterglow>
          <DraftsWaiting />
        </Screen>
      </PaneContext.Provider>
    </div>
  );
}

/** A folded pane: its name, sideways, and a button that opens it again. */
function PaneStrip({ id, title, onOpen }: { id: string; title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-strip={id}
      onClick={onOpen}
      aria-label={`Show ${title}`}
      title={`Show ${title}`}
      className={cx(
        'flex w-11 shrink-0 flex-col items-center gap-3 border-r border-border pt-4 text-small text-content-muted hover:bg-surface-sunken hover:text-content',
        focusRing,
      )}
    >
      <Icon name="pane-expand" size={18} />
      <span aria-hidden="true" className="[writing-mode:vertical-rl]">
        {title}
      </span>
    </button>
  );
}

/** The panes a route shows, from the structure pane to the deepest. */
function panesFor(route: Route, studio: Studio, wide: boolean): PaneSpec[] {
  const structure: PaneSpec = {
    id: 'structure',
    kind: 'structure',
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
    // Wide, Home beside the collections only repeated them, so they're the page.
    // Narrow, Home is the one place that lists them with their counts.
    return wide ? [structure] : [structure, flex('home', 'Content', <Home />)];
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
    const currentId = route.screen === 'edit' ? route.id : null;
    const editor =
      route.screen === 'list' ? null : (
        <EntryEditor
          key={JSON.stringify(route)}
          collection={collection}
          id={currentId}
          {...(route.screen === 'new' && route.parent !== undefined
            ? { parent: route.parent }
            : {})}
        />
      );
    const tree = collection.presentation.tree === true && collection.source.loader === 'glob';
    // A singleton's list only leads to its one entry, so it opens beside the collections.
    if (collection.presentation.singleton) {
      return [
        structure,
        flex('entry', collection.label, editor ?? <EntryList collection={collection} />),
      ];
    }
    // The list is a pane of its own, with all its tools, whether or not an entry is open
    // beside it. One screen at a time, a flat collection's list is its table.
    const list: PaneSpec = {
      id: `list:${collection.name}`,
      kind: 'list',
      title: collection.label,
      width: 'list',
      content: tree ? (
        <PageTree collection={collection} currentId={currentId} />
      ) : wide ? (
        <ListPane collection={collection} currentId={currentId} />
      ) : (
        <EntryList collection={collection} />
      ),
    };
    return editor ? [structure, list, flex('entry', 'Entry', editor)] : [structure, list];
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
 * A row of the structure pane: square and edge to edge, with the pane's
 * padding inside it, as the list pane's rows are. Plain links get no
 * `data-focus-visible`, so their outline is `focus-visible`'s, drawn inside
 * the row where the pane's scrolling can't clip it.
 */
const structureRow = cx(
  'flex min-h-10 items-center gap-2 px-4 text-body text-content no-underline',
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus',
);

/**
 * The structure pane: every collection, then settings, then the site's own
 * places. Always on screen, so the site's content is one click away. With
 * nothing chosen it's the deepest pane, so its heading is the page's `h1`.
 */
function StructurePane({ route, studio }: { route: Route; studio: Studio }) {
  const { manifest, api, cloud, siteUrl } = studio;
  const [summary] = useLoad(() => api.summary(), 'structure');
  const heading = useRef<HTMLHeadingElement>(null);
  useLeadHeading('Content', heading);
  const Subheading = usePane()?.level === 1 ? 'h2' : 'h3';
  const counts = new Map(
    summary.state === 'ready' ? summary.value.map((s) => [s.collection, s.count]) : [],
  );
  const shown = manifest.collections.filter((c) => shownTo(cloud, c.name));
  const collections = shown.filter((c) => !c.presentation.singleton);
  const singletons = shown.filter((c) => c.presentation.singleton);
  const here = hereOf(route);

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
            structureRow,
            current
              ? 'bg-accent-subtle font-semibold hover:bg-accent-subtle-hover'
              : 'hover:bg-surface-sunken',
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

  return (
    <PaneFrame title="Content" headingRef={heading}>
      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <ul className="flex flex-col gap-0.5">{collections.map(collectionItem)}</ul>
        {singletons.length > 0 && (
          <>
            <Subheading className="mt-6 mb-1 px-4 text-small text-content-muted">
              Settings
            </Subheading>
            <ul className="flex flex-col gap-0.5">{singletons.map(collectionItem)}</ul>
          </>
        )}
        <Subheading className="mt-6 mb-1 px-4 text-small text-content-muted">Site</Subheading>
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
                className={cx(structureRow, 'hover:bg-surface-sunken')}
              >
                <Icon name="view-on-site" size={18} className="text-content-muted" />
                View site
              </a>
            </li>
          )}
        </ul>
      </div>
    </PaneFrame>
  );
}
