import { Menu } from '@vesper/ui';
import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { useStudio } from './context.tsx';
import { NavigationContext } from './navigation.ts';
import { hrefFor, navigate } from './router.ts';

export type ScreenProps = {
  /** The screen's one `h1`, and the start of the page title. */
  title: string;
  /** Visually hide the `h1` when the screen shows its title another way (the editor's title field). */
  hideTitle?: boolean;
  /** Replaces the top bar's middle and right side (the editor's bar, spec §10.3). */
  bar?: ReactNode;
  children: ReactNode;
};

/**
 * Every screen's frame: the skip link, the top bar, and `<main>` with one
 * `h1` (spec §10.6). After an in-app navigation, focus moves to the new
 * screen's heading, so keyboard and screen-reader users land on the content
 * they asked for instead of at the top of the page.
 */
export function Screen({ title, hideTitle = false, bar, children }: ScreenProps) {
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
    <>
      <a
        href="#main"
        onClick={(event) => {
          // A plain `#main` link would replace the route in the hash.
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only rounded-md bg-surface-raised px-3 py-2 text-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <a
            href={hrefFor({ screen: 'home' })}
            className="rounded-sm font-semibold text-content no-underline focus-visible:outline-2"
          >
            {siteName}
          </a>
          {bar ?? <DefaultBar />}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none">
        <h1
          ref={heading}
          tabIndex={-1}
          className={hideTitle ? 'sr-only' : 'mb-6 text-2xl outline-none'}
        >
          {title}
        </h1>
        {children}
      </main>
    </>
  );
}

/** The top bar on every screen but the editor: the Content menu and the site menu. */
function DefaultBar() {
  const { manifest, siteUrl } = useStudio();
  const items = manifest.collections.map((collection) => ({
    id: collection.name,
    label: collection.label,
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
          ...(siteUrl ? [{ id: 'view', label: 'View site' }] : []),
        ]}
        onAction={(id) => {
          if (id === 'media') navigate({ screen: 'media' });
          if (id === 'view' && siteUrl) window.open(siteUrl, '_blank', 'noopener');
        }}
      />
    </nav>
  );
}
