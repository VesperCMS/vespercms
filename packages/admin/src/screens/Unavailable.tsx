import { useEffect } from 'react';

/**
 * Shown when this build of the studio has no storage back end: a deployed
 * site before GitHub mode (Phase 3) exists. It's outside the studio context,
 * so it draws its own landmarks.
 */
export function Unavailable({ siteName }: { siteName: string }) {
  useEffect(() => {
    document.title = `Editing unavailable · ${siteName}`;
  }, [siteName]);
  return (
    <div className="afterglow min-h-screen">
      <main id="main" className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="mb-4 text-heading-1 text-content">Editing isn’t available here yet</h1>
        <p className="mb-3">
          This copy of {siteName} was built without a way to save changes. For now, content is
          edited while the site runs on a developer’s computer.
        </p>
        <p className="text-content-muted">
          Developers: run <code className="font-mono text-small">astro dev</code> and open{' '}
          <code className="font-mono text-small">/admin</code> there.
        </p>
      </main>
    </div>
  );
}
