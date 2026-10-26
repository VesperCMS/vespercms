import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Hash routing (spec §6.1): `/admin/#/c/blog/e/…`. Deep links and reloads
 * work on any static host without rewrite rules (D16). Entry IDs can contain
 * slashes, so they are encoded as one segment.
 */

export type Route =
  | { screen: 'home' }
  | { screen: 'list'; collection: string }
  | { screen: 'edit'; collection: string; id: string }
  | { screen: 'new'; collection: string; parent?: string }
  /** A new entry that starts as a copy of another (Duplicate, spec §10.3). */
  | { screen: 'copy'; collection: string; id: string }
  | { screen: 'media' }
  | { screen: 'redirects' }
  /** Every change still to come across the site (spec §6.17). */
  | { screen: 'scheduled' }
  /** Home with the cloud's Changes open: review emails link here. Home alone elsewhere. */
  | { screen: 'changes' }
  | { screen: 'not-found'; path: string };

export type KnownRoute = Exclude<Route, { screen: 'not-found' }>;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { screen: 'home' };
  if (parts[0] === 'media' && parts.length === 1) return { screen: 'media' };
  if (parts[0] === 'redirects' && parts.length === 1) return { screen: 'redirects' };
  if (parts[0] === 'scheduled' && parts.length === 1) return { screen: 'scheduled' };
  if (parts[0] === 'changes' && parts.length === 1) return { screen: 'changes' };
  if (parts[0] === 'c' && parts[1]) {
    if (parts.length === 2) return { screen: 'list', collection: parts[1] };
    if (parts[2] === 'new' && parts.length === 3) return { screen: 'new', collection: parts[1] };
    // A new page under a parent in a tree collection (spec §6.15.2: "Add child page").
    if (parts[2] === 'new' && parts[3] !== undefined && parts.length === 4) {
      return { screen: 'new', collection: parts[1], parent: parts[3] };
    }
    if (parts[2] === 'e' && parts[3] !== undefined && parts.length === 4) {
      return { screen: 'edit', collection: parts[1], id: parts[3] };
    }
    if (parts[2] === 'e' && parts[3] !== undefined && parts[4] === 'copy' && parts.length === 5) {
      return { screen: 'copy', collection: parts[1], id: parts[3] };
    }
  }
  return { screen: 'not-found', path };
}

export function hrefFor(route: KnownRoute): string {
  const enc = encodeURIComponent;
  switch (route.screen) {
    case 'home':
      return '#/';
    case 'media':
      return '#/media';
    case 'redirects':
      return '#/redirects';
    case 'scheduled':
      return '#/scheduled';
    case 'changes':
      return '#/changes';
    case 'list':
      return `#/c/${enc(route.collection)}`;
    case 'new':
      return route.parent !== undefined
        ? `#/c/${enc(route.collection)}/new/${enc(route.parent)}`
        : `#/c/${enc(route.collection)}/new`;
    case 'edit':
      return `#/c/${enc(route.collection)}/e/${enc(route.id)}`;
    case 'copy':
      return `#/c/${enc(route.collection)}/e/${enc(route.id)}/copy`;
  }
}

/** Goes to a route. `replace` swaps the current history entry (after creating an entry, say). */
export function navigate(route: KnownRoute, options: { replace?: boolean } = {}): void {
  if (options.replace) {
    window.location.replace(hrefFor(route));
  } else {
    window.location.hash = hrefFor(route);
  }
}

/**
 * The open screen's unsaved-changes check. Only one screen holds one at a
 * time. Returns a function that removes it.
 */
let leaveGuard: (() => boolean) | null = null;

export function setLeaveGuard(hasUnsavedChanges: () => boolean): () => void {
  leaveGuard = hasUnsavedChanges;
  return () => {
    if (leaveGuard === hasUnsavedChanges) leaveGuard = null;
  };
}

export type RouterState = {
  route: Route;
  /** A navigation held back because the open screen has unsaved changes. */
  pending: string | null;
  /** Leave anyway, discarding the changes. */
  leave: () => void;
  /** Stay on the current screen. */
  stay: () => void;
};

/**
 * The current route. Every in-app navigation is a hash change, so this is
 * also where unsaved changes are protected: when the guard says so, the
 * hash is put back and the navigation waits for `leave()` or `stay()`.
 */
export function useRouter(): RouterState {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [pending, setPending] = useState<string | null>(null);
  const current = useRef(window.location.hash);
  const allowNext = useRef(false);

  useEffect(() => {
    const update = () => {
      const next = window.location.hash;
      // Browsers can report one change twice (and tests dispatch their own); nothing moved.
      if (next === current.current) return;
      if (!allowNext.current && leaveGuard?.()) {
        // replaceState doesn't fire hashchange, so this doesn't loop.
        window.history.replaceState(null, '', current.current || '#/');
        setPending(next);
        return;
      }
      allowNext.current = false;
      current.current = next;
      setRoute(parseRoute(next));
    };
    window.addEventListener('hashchange', update);
    return () => {
      window.removeEventListener('hashchange', update);
    };
  }, []);

  const leave = useCallback(() => {
    if (pending === null) return;
    allowNext.current = true;
    leaveGuard = null;
    setPending(null);
    window.location.hash = pending;
  }, [pending]);
  const stay = useCallback(() => {
    setPending(null);
  }, []);

  return { route, pending, leave, stay };
}
