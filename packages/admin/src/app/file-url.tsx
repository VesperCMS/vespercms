import { useEffect, useState } from 'react';
import { useStudio } from './context.tsx';

/**
 * A URL the studio can show a site file from, or `''` until it's ready. In
 * local mode it's the dev API's `/file`; in GitHub mode an object URL for
 * the blob, since a private repository's files have no address a browser
 * can load without the token.
 */
export function useFileUrl(path: string | null): string {
  const { api } = useStudio();
  const [found, setFound] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api.fileUrl(path).then(
      (url) => {
        if (live) setFound({ path, url });
      },
      () => {
        // No preview; the field still works.
      },
    );
    return () => {
      live = false;
    };
  }, [api, path]);
  return path && found?.path === path ? found.url : '';
}

/** A site image, shown once its URL is ready. Decorative: whatever lists it names it. */
export function FileImage({
  path,
  className,
  loading,
}: {
  path: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  const url = useFileUrl(path);
  if (!url) return <span aria-hidden="true" className={className} />;
  return <img src={url} alt="" loading={loading} className={className} />;
}
