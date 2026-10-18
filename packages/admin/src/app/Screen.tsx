import { cx, Menu } from '@vesper/ui';
import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { useStudio } from './context.tsx';
import { NavigationContext } from './navigation.ts';
import { hrefFor, navigate, parseRoute } from './router.ts';

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
  children: ReactNode;
};

/**
 * Every screen's frame: the skip link, the top bar, and `<main>` with one
 * `h1` (spec §10.6). After an in-app navigation, focus moves to the new
 * screen's heading, so keyboard and screen-reader users land on the content
 * they asked for instead of at the top of the page.
 */
export function Screen({
  title,
  hideTitle = false,
  bar,
  afterglow = false,
  column = false,
  children,
}: ScreenProps) {
  const { siteName } = useStudio();
  const navigation = useContext(NavigationContext);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${title} · ${siteName}`;
  }, [title, siteName]);

  useEffect(() => {
    if (navigation.count > 0) heading.current?.focus({ preventScroll: false });
  }, [navigation.count]);

  return (
    <div className={cx('min-h-screen', afterglow && 'afterglow')}>
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
      <header className="glass-bar sticky top-0 z-40 shadow-glass-edge">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:gap-x-4">
          <a
            href={hrefFor({ screen: 'home' })}
            className={cx(
              'rounded-sm text-heading-3 tracking-tight text-content lowercase no-underline',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              'focus-visible:ring-6 focus-visible:ring-(color:--glow-focus)',
            )}
          >
            {siteName}
          </a>
          {bar ?? <DefaultBar />}
        </div>
      </header>
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
                  column && 'mx-auto max-w-editor',
                )
          }
        >
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}

/** The top bar on every screen but the editor: the Content menu and the site menu. */
function DefaultBar() {
  const { manifest, siteUrl } = useStudio();
  const route = parseRoute(window.location.hash);
  const here = 'collection' in route ? route.collection : null;
  const items = manifest.collections.map((collection) => ({
    id: collection.name,
    label: collection.label,
    isCurrent: collection.name === here,
  }));
  return (
    <nav aria-label="Studio" className="ml-auto flex items-center gap-2">
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
          { id: 'media', label: 'Media' },
          { id: 'redirects', label: 'Redirects' },
          ...(siteUrl ? [{ id: 'view', label: 'View site' }] : []),
        ]}
        onAction={(id) => {
          if (id === 'media') navigate({ screen: 'media' });
          if (id === 'redirects') navigate({ screen: 'redirects' });
          if (id === 'view' && siteUrl) window.open(siteUrl, '_blank', 'noopener');
        }}
      />
    </nav>
  );
}
