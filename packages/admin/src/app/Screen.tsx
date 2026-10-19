import { Button, cx, Icon, Menu, VesperMark, type IconName, type IconNode } from '@vesper/ui';
import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { useStudio, VESPER_NAME } from './context.tsx';
import { NavigationContext } from './navigation.ts';
import { collectionIcon } from './collection-icon.ts';
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
  /** An icon before the heading: a collection's. */
  icon?: { node: IconNode } | { name: IconName };
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
  icon,
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
              'inline-flex items-center gap-2 rounded-sm text-heading-3 tracking-tight text-content no-underline',
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
            <VesperMark size={20} className="hidden sm:block" />
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

/** The top bar on every screen but the editor: the Content menu and the site menu. */
function DefaultBar() {
  const { manifest, siteUrl, account } = useStudio();
  const route = parseRoute(window.location.hash);
  const here = 'collection' in route ? route.collection : null;
  const items = manifest.collections.map((collection) => {
    const icon = collectionIcon(collection);
    return {
      id: collection.name,
      label: collection.label,
      isCurrent: collection.name === here,
      icon: 'node' in icon ? icon.node : icon.name,
    };
  });
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
          { id: 'media', label: 'Media', icon: 'media' as const },
          { id: 'redirects', label: 'Redirects', icon: 'redirects' as const },
          ...(siteUrl ? [{ id: 'view', label: 'View site', icon: 'view-on-site' as const }] : []),
        ]}
        onAction={(id) => {
          if (id === 'media') navigate({ screen: 'media' });
          if (id === 'redirects') navigate({ screen: 'redirects' });
          if (id === 'view' && siteUrl) window.open(siteUrl, '_blank', 'noopener');
        }}
      />
      {/* GitHub mode: who is signed in, and the way out (spec §6.9). */}
      {account &&
        (account.expired ? (
          <Button variant="quiet" onPress={account.signInAgain}>
            Sign in again
          </Button>
        ) : (
          <Menu
            label={`Signed in to GitHub as @${account.login}`}
            triggerText={`@${account.login}`}
            items={[{ id: 'sign-out', label: 'Sign out of GitHub' }]}
            onAction={() => {
              account.signOut();
            }}
          />
        ))}
    </nav>
  );
}
