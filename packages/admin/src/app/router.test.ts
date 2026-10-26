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
    { screen: 'copy', collection: 'blog', id: 'harbor-at-dawn' },
    { screen: 'copy', collection: 'pages', id: 'academics/nursing/clinical-placements' },
    // An entry may be called "copy" too.
    { screen: 'edit', collection: 'blog', id: 'copy' },
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

describe('fieldId', () => {
  it('can’t collide with the ids widgets derive from another field’s id', async () => {
    const { fieldId } = await import('../editor/values.ts');
    // A group's legend is `${id}-label`; a child field may be called `label`.
    expect(`${fieldId(['nav'])}-label`).not.toBe(fieldId(['nav', 'label']));
    expect(fieldId(['cta-label'])).not.toBe(`${fieldId(['cta'])}-label`);
    expect(fieldId(['sections', 0, 'body'])).toBe('field.sections.0.body');
  });
});
