import {
  cx,
  Icon,
  IconButton,
  Menu,
  Tooltip,
  VesperMark,
  type IconName,
  type IconNode,
} from '@vesper/ui';
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
  type UIEvent,
} from 'react';
import { shownTo } from '../cloud/access.ts';
import { ChangesButton } from '../cloud/changes.tsx';
import { useStudio, VESPER_NAME } from './context.tsx';
import { NavigationContext } from './navigation.ts';
import { collectionIcon } from './collection-icon.ts';
import { hrefFor, navigate, parseRoute } from './router.ts';
import { usePane } from './pane-context.ts';
import { UserMenu } from './UserMenu.tsx';

export type ScreenProps = {
  /** The screen's one `h1`, and the start of the page title. */
  title: string;
  /** Visually hide the `h1` when the screen shows its title another way (the editor's title field). */
  hideTitle?: boolean;
  /** Replaces the top bar's middle and right side (the editor's bar, spec §10.3). */
  bar?: ReactNode;
  /** The accent's wash at the top of a welcoming screen: home and empty states, never a form. */
  afterglow?: boolean;
  /** Line the heading up with the editor's 720px column. */
  column?: boolean;
  /** An icon before the heading: a collection's. */
  icon?: { node: IconNode } | { name: IconName };
  children: ReactNode;
};

/**
 * Every screen's frame: the skip link, the top bar, and `<main>` with one
 * `h1` (spec §10.6). After an in-app navigation, focus moves to the new
 * screen's heading, so keyboard and screen-reader users land on the content
 * they asked for instead of at the top of the page.
 *
 * Inside the pane shell (app/panes.tsx) a screen is the deepest pane
 * instead: its heading and bar head the pane, and it scrolls on its own,
 * beneath them.
 */
export function Screen({
  title,
  hideTitle = false,
  bar,
  afterglow = false,
  column = false,
  icon,
  children,
}: ScreenProps) {
  const pane = usePane();
  const heading = useRef<HTMLHeadingElement>(null);
  useLeadHeading(title, heading);
  const [header, headerHeight] = useMeasure('height', 56);

  if (pane) {
    return (
      <PaneFrame
        title={title}
        headingRef={heading}
        hideTitle={hideTitle}
        icon={icon}
        actions={bar}
        className={cx(afterglow && 'afterglow')}
      >
        <div className={pane.width === 'flex' ? 'px-6 pt-8 pb-16' : 'px-3 pt-3 pb-6'}>
          {children}
        </div>
      </PaneFrame>
    );
  }

  return (
    <div
      className={cx('min-h-screen', afterglow && 'afterglow')}
      // What sticks inside the screen (the formatting toolbar) sticks below the top bar.
      style={{ '--sticky-top': `${String(headerHeight)}px` } as CSSProperties}
    >
      {/* The editor's bar has its own way back, so on a narrow screen it needs the room. */}
      <StudioHeader bar={bar ?? <DefaultBar />} headerRef={header} homeLink={bar === undefined} />
      <main
        id="main"
        tabIndex={-1}
        className={cx('mx-auto max-w-6xl px-4 pb-16 outline-none', hideTitle ? 'pt-8' : 'pt-12')}
      >
        <h1
          ref={heading}
          tabIndex={-1}
          className={
            hideTitle
              ? 'sr-only'
              : cx(
                  'mb-8 text-heading-1 text-content outline-none',
                  icon && 'flex items-center gap-3',
                  column && 'mx-auto max-w-editor',
                )
          }
        >
          {icon && !hideTitle && <Icon {...icon} size={24} className="text-content-muted" />}
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}

/**
 * The pane, or the screen, that leads names the browser tab, and takes focus
 * after an in-app navigation (spec §10.6). Among panes that's the deepest.
 */
export function useLeadHeading(title: string, heading: RefObject<HTMLElement | null>): void {
  const { siteName } = useStudio();
  const navigation = useContext(NavigationContext);
  const pane = usePane();
  const leads = !pane || pane.focusTarget;

  useEffect(() => {
    if (leads) document.title = `${title} · ${siteName}`;
  }, [title, siteName, leads]);

  useEffect(() => {
    if (leads && navigation.count > 0) heading.current?.focus({ preventScroll: false });
  }, [navigation.count, leads, heading]);
}

/**
 * An element's width or height in pixels, kept current as it wraps or the
 * window changes: give it the returned ref. A callback ref, never a ref
 * object, because what's measured may be replaced or come and go: the top
 * bar among panes leaves as the window narrows and comes back new as it
 * widens, and a ref object went on measuring the bar that left, at 0, so
 * every pane's header sat beneath the new one. The editor's bar moves from
 * the top bar into a pane's header the same way.
 */
export function useMeasure(
  side: 'width' | 'height',
  fallback: number,
): [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // A detached element measures 0 on its way out.
      if (!element.isConnected) return;
      setSize(side === 'width' ? element.offsetWidth : element.offsetHeight);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
    };
  }, [element, side]);
  return [setElement, size];
}

/**
 * A pane's frame: a landmark named by its heading, a header with the heading,
 * the pane's actions and its collapse button (and the list's tools, as
 * `toolbar`), then the pane's body. The deepest pane is the page's `main`,
 * with its `h1`; the others are navigation, or a region, with `h2`s. The
 * element stays the same as a pane's role changes, so what's in it isn't
 * drawn afresh when an entry opens beside it.
 *
 * The frame is the pane's scroller, and it starts at the window's top: its
 * body scrolls beneath its own header and the top bar, which are glass, so
 * the content stays present beneath what floats (DECISIONS.md, "Panes scroll
 * beneath glass"). Its scroll padding keeps a focused control clear of both.
 */
export function PaneFrame({
  title,
  headingRef,
  hideTitle = false,
  icon,
  actions,
  toolbar,
  scrollRef,
  onScroll,
  className,
  children,
}: {
  title: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  hideTitle?: boolean;
  icon?: { node: IconNode } | { name: IconName } | undefined;
  actions?: ReactNode;
  /** Below the heading, in the header that stays put: the list's search, Sort and Show. */
  toolbar?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  className?: string | false | undefined;
  children: ReactNode;
}) {
  const pane = usePane();
  const id = useId();
  const landmark = pane?.landmark ?? 'main';
  const main = landmark === 'main';
  const Heading = pane?.level === 2 ? 'h2' : 'h1';
  const [header, headerHeight] = useMeasure('height', 56);
  return (
    <div
      ref={scrollRef}
      role={main ? 'main' : landmark === 'nav' ? 'navigation' : 'region'}
      aria-labelledby={id}
      {...(main ? { id: 'main', tabIndex: -1 } : {})}
      onScroll={onScroll}
      className={cx('min-h-0 flex-1 overflow-y-auto outline-none', className)}
      style={
        {
          paddingTop: 'var(--studio-bar, 0px)',
          scrollPaddingTop: `calc(var(--studio-bar, 0px) + ${String(headerHeight)}px)`,
          // What sticks inside the pane (the formatting toolbar) sticks below its header.
          '--sticky-top': `${String(headerHeight)}px`,
        } as CSSProperties
      }
    >
      {/* A sticky offset counts from inside the scroller's padding, so top-0 holds it just below the bar. */}
      <div ref={header} className="glass-bar sticky top-0 z-10 border-b border-border">
        <div
          className={cx(
            'flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 py-2',
            pane?.width === 'flex' ? 'px-6' : 'px-4',
          )}
        >
          <Heading
            id={id}
            ref={headingRef}
            tabIndex={-1}
            className={
              hideTitle
                ? 'sr-only'
                : cx(
                    'min-w-0 flex-1 truncate outline-none',
                    pane?.width === 'flex' ? 'text-heading-3' : 'text-label',
                    'text-content',
                    icon && 'flex items-center gap-2',
                  )
            }
          >
            {icon && !hideTitle && <Icon {...icon} size={18} className="text-content-muted" />}
            {title}
          </Heading>
          {actions}
          {pane?.onCollapse && (
            <Tooltip text={`Collapse ${title}`}>
              <IconButton
                data-collapse=""
                icon="pane-collapse"
                label={`Collapse ${title}`}
                onPress={pane.onCollapse}
                className="-mr-2"
              />
            </Tooltip>
          )}
        </div>
        {toolbar}
      </div>
      {children}
    </div>
  );
}

/**
 * The skip link and the top bar. One screen at a time, it holds the screen's
 * bar (the menus, or the editor's own); among panes it spans the full width
 * and holds what's the person's, since the structure pane holds the site's.
 */
export function StudioHeader({
  bar,
  headerRef,
  homeLink = true,
}: {
  bar?: ReactNode;
  headerRef?: Ref<HTMLElement>;
  /** False drops the site's name, the link home, on a narrow screen (the editor's bar). */
  homeLink?: boolean;
}) {
  const { siteName } = useStudio();
  const pane = usePane();
  return (
    <>
      <a
        href="#main"
        onClick={(event) => {
          // A plain `#main` link would replace the route in the hash.
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only rounded-md bg-surface-raised px-3 py-2 text-accent shadow-overlay focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      {/* Sticky and frosted, so the page stays present as it scrolls beneath. */}
      <header ref={headerRef} className="glass-bar sticky top-0 z-40 shadow-glass-edge">
        <div
          className={cx(
            'flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:gap-x-4',
            bar !== undefined && !pane && 'mx-auto max-w-6xl',
          )}
        >
          {/*
           * The site's name takes no room of its own in the wrap, then grows into
           * what's left, so a long one is cut short instead of pushing the
           * person's menu onto a line of its own. Beside the editor's bar, it's
           * its own width.
           */}
          <div className={cx('min-w-0', homeLink ? 'flex flex-1 basis-0' : 'hidden sm:flex')}>
            <a
              href={hrefFor({ screen: 'home' })}
              className={cx(
                'inline-flex min-w-0 items-center gap-2 rounded-sm text-heading-3 tracking-tight text-content no-underline',
                // Only Vesper's own name is lowercase; a site's shows as the site writes it.
                siteName === VESPER_NAME && 'lowercase',
                'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus',
                'focus-visible:ring-6 focus-visible:ring-(color:--glow-focus)',
              )}
            >
              {/*
               * Decorative: the link is named by the site's name beside it. Left
               * out on a narrow screen, where the editor's bar needs the room
               * (DECISIONS.md).
               */}
              <VesperMark size={20} className="hidden shrink-0 sm:block" />
              <span className="truncate">{siteName}</span>
            </a>
          </div>
          {bar ?? (
            <div className="ml-auto flex items-center gap-2">
              <ChangesButton />
              <UserMenu />
            </div>
          )}
        </div>
      </header>
    </>
  );
}

/**
 * The top bar on every screen but the editor, one screen at a time: the
 * person's menu on the site's line, then the Content menu, the Site menu
 * and the cloud's Changes on a line of their own.
 */
function DefaultBar() {
  const { manifest, siteUrl, cloud } = useStudio();
  const route = parseRoute(window.location.hash);
  const here = 'collection' in route ? route.collection : null;
  const items = manifest.collections
    .filter((c) => shownTo(cloud, c.name))
    .map((collection) => {
      const icon = collectionIcon(collection);
      return {
        id: collection.name,
        label: collection.label,
        isCurrent: collection.name === here,
        icon: 'node' in icon ? icon.node : icon.name,
      };
    });
  // Two lines, the person's menu beside the site's name and the site's menus below, flush
  // with it: one line wrapped as it pleased, the menus pushed right under the name.
  return (
    <>
      <div className="ml-auto flex min-w-0">
        <UserMenu />
      </div>
      {/* Pulled out by a trigger's padding, so "Content" lines up with the site's name. */}
      <nav aria-label="Studio" className="-ml-3 flex basis-full items-center gap-2">
        <Menu
          label="Content"
          triggerText="Content"
          items={items}
          onAction={(name) => {
            navigate({ screen: 'list', collection: name });
          }}
        />
        <Menu
          label="Site"
          triggerText="Site"
          items={[
            { id: 'media', label: 'Media', icon: 'media' as const },
            // Redirects belong to the whole site (spec §7.5): a folder grant doesn't reach them.
            ...(!cloud || cloud.wholeSite
              ? [{ id: 'redirects', label: 'Redirects', icon: 'redirects' as const }]
              : []),
            ...(siteUrl ? [{ id: 'view', label: 'View site', icon: 'view-on-site' as const }] : []),
          ]}
          onAction={(id) => {
            if (id === 'media') navigate({ screen: 'media' });
            if (id === 'redirects') navigate({ screen: 'redirects' });
            if (id === 'view' && siteUrl) window.open(siteUrl, '_blank', 'noopener');
          }}
        />
        <ChangesButton />
      </nav>
    </>
  );
}
