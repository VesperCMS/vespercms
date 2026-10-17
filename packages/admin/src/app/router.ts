import { useEffect, useState } from 'react';

/*
 * Hash routing (spec §6.1): `/admin/#/blog/…`. Deep links and reloads work on
 * any static host without rewrite rules (D16). Entry IDs can contain slashes,
 * so they are encoded as one segment.
 */

export type Route =
  | { screen: 'home' }
  | { screen: 'list'; collection: string }
  | { screen: 'edit'; collection: string; id: string }
  | { screen: 'new'; collection: string }
  | { screen: 'media' }
  | { screen: 'not-found'; path: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { screen: 'home' };
  if (parts[0] === 'media' && parts.length === 1) return { screen: 'media' };
  if (parts[0] === 'c' && parts[1]) {
    if (parts.length === 2) return { screen: 'list', collection: parts[1] };
    if (parts[2] === 'new' && parts.length === 3) return { screen: 'new', collection: parts[1] };
    if (parts[2] === 'e' && parts[3] !== undefined && parts.length === 4) {
      return { screen: 'edit', collection: parts[1], id: parts[3] };
    }
  }
  return { screen: 'not-found', path };
}

export function hrefFor(route: Exclude<Route, { screen: 'not-found' }>): string {
  const enc = encodeURIComponent;
  switch (route.screen) {
    case 'home':
      return '#/';
    case 'media':
      return '#/media';
    case 'list':
      return `#/c/${enc(route.collection)}`;
    case 'new':
      return `#/c/${enc(route.collection)}/new`;
    case 'edit':
      return `#/c/${enc(route.collection)}/e/${enc(route.id)}`;
  }
}

export function navigate(route: Exclude<Route, { screen: 'not-found' }>): void {
  window.location.hash = hrefFor(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => {
      setRoute(parseRoute(window.location.hash));
    };
    window.addEventListener('hashchange', update);
    return () => {
      window.removeEventListener('hashchange', update);
    };
  }, []);
  return route;
}
