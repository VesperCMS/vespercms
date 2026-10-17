import { describe, expect, it } from 'vitest';
import { hrefFor, parseRoute, type Route } from './router.ts';

describe('parseRoute and hrefFor', () => {
  const routes: Exclude<Route, { screen: 'not-found' }>[] = [
    { screen: 'home' },
    { screen: 'media' },
    { screen: 'list', collection: 'blog' },
    { screen: 'new', collection: 'blog' },
    { screen: 'edit', collection: 'blog', id: 'harbor-at-dawn' },
    // Entry IDs from nested folders contain slashes; they stay one segment.
    { screen: 'edit', collection: 'pages', id: 'academics/nursing/clinical-placements' },
    { screen: 'edit', collection: 'blog', id: 'new' },
  ];

  it.each(routes)('round-trips %o', (route) => {
    expect(parseRoute(hrefFor(route))).toEqual(route);
  });

  it('treats an empty hash as home and unknown paths as not found', () => {
    expect(parseRoute('')).toEqual({ screen: 'home' });
    expect(parseRoute('#')).toEqual({ screen: 'home' });
    expect(parseRoute('#/nope')).toEqual({ screen: 'not-found', path: '/nope' });
    expect(parseRoute('#/c/blog/e')).toEqual({ screen: 'not-found', path: '/c/blog/e' });
  });
});
