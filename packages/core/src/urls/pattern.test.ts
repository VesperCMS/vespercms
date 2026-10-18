import { describe, expect, it } from 'vitest';
import {
  entryPath,
  entryUrlKey,
  expandUrlPattern,
  formatUrl,
  isReservedPath,
  parseSiteUrl,
  reshapeUrl,
  urlKey,
  type UrlSettings,
} from './pattern.ts';

const settings = (overrides: Partial<UrlSettings> = {}): UrlSettings => ({
  base: '/',
  trailingSlash: 'ignore',
  buildFormat: 'directory',
  ...overrides,
});

describe('entryPath', () => {
  it('drops a trailing /index, and makes a top-level index the root', () => {
    expect(entryPath('academics/nursing')).toBe('academics/nursing');
    expect(entryPath('academics/nursing/index')).toBe('academics/nursing');
    expect(entryPath('index')).toBe('');
    expect(entryPath('about')).toBe('about');
  });
});

describe('expandUrlPattern', () => {
  it('expands :id, :path and :slug', () => {
    const entry = { id: 'academics/nursing/rn-to-bsn' };
    expect(expandUrlPattern('/:path', entry)).toBe('/academics/nursing/rn-to-bsn');
    expect(expandUrlPattern('/docs/:id', entry)).toBe('/docs/academics/nursing/rn-to-bsn');
    expect(expandUrlPattern('/p/:slug', entry)).toBe('/p/rn-to-bsn');
  });

  it('gives the root page the collection’s own address', () => {
    expect(expandUrlPattern('/:path', { id: 'index' })).toBe('/');
    expect(expandUrlPattern('/guides/:path', { id: 'index' })).toBe('/guides');
  });

  it('reads frontmatter values and parts of dates', () => {
    const entry = {
      id: 'post',
      data: { category: 'news', publishedAt: new Date('2026-03-07T00:00:00Z') },
    };
    expect(expandUrlPattern('/:category/:publishedAt|yyyy/:publishedAt|mm/:slug', entry)).toBe(
      '/news/2026/03/post',
    );
    expect(expandUrlPattern('/:publishedAt/:slug', entry)).toBe('/2026-03-07/post');
  });

  it('keeps a calendar date’s day in any time zone, and reads times in the site’s zone', () => {
    const calendar = { id: 'a', data: { at: new Date('2026-10-17T00:00:00Z') } };
    expect(expandUrlPattern('/:at|dd', calendar, { timeZone: 'America/New_York' })).toBe('/17');
    const evening = { id: 'a', data: { at: new Date('2026-10-18T02:30:00Z') } };
    expect(expandUrlPattern('/:at|dd', evening, { timeZone: 'America/New_York' })).toBe('/17');
    expect(expandUrlPattern('/:at|dd', evening)).toBe('/18');
  });

  it('returns null when a token has no value', () => {
    expect(expandUrlPattern('/:category/:slug', { id: 'x', data: {} })).toBeNull();
    expect(expandUrlPattern('/:at|yyyy', { id: 'x', data: { at: 'soon' } })).toBeNull();
  });
});

describe('entryUrlKey', () => {
  it('runs the function form and normalizes what it returns', () => {
    const pattern = (entry: { id: string }) => `/people/${entry.id}/`;
    expect(entryUrlKey(pattern, { id: 'ada' })).toBe('/people/ada');
    expect(entryUrlKey(() => 42, { id: 'ada' })).toBeNull();
    expect(
      entryUrlKey(
        () => {
          throw new Error('nope');
        },
        { id: 'ada' },
      ),
    ).toBeNull();
    expect(entryUrlKey(undefined, { id: 'ada' })).toBeNull();
  });
});

describe('formatUrl', () => {
  it('follows trailingSlash and build.format', () => {
    expect(formatUrl('/academics', settings())).toBe('/academics/');
    expect(formatUrl('/academics', settings({ buildFormat: 'file' }))).toBe('/academics');
    expect(formatUrl('/academics', settings({ trailingSlash: 'never' }))).toBe('/academics');
    expect(
      formatUrl('/academics', settings({ trailingSlash: 'always', buildFormat: 'file' })),
    ).toBe('/academics/');
    expect(formatUrl('/', settings({ trailingSlash: 'never' }))).toBe('/');
  });

  it('puts the base in front and keeps a query or hash', () => {
    const sub = settings({ base: '/college/' });
    expect(formatUrl('/academics', sub)).toBe('/college/academics/');
    expect(formatUrl('/', sub)).toBe('/college/');
    expect(formatUrl('/', { ...sub, trailingSlash: 'never' })).toBe('/college');
    expect(formatUrl('/admissions/apply#steps', sub)).toBe('/college/admissions/apply/#steps');
  });
});

describe('urlKey and parseSiteUrl', () => {
  it('reads links to pages on this site', () => {
    expect(urlKey('/academics/nursing/')).toBe('/academics/nursing');
    expect(urlKey('/academics/nursing?x=1#top')).toBe('/academics/nursing');
    expect(urlKey('/')).toBe('/');
    expect(urlKey('/college/academics/', { base: '/college/' })).toBe('/academics');
    expect(urlKey('/college', { base: '/college/' })).toBe('/');
    expect(
      urlKey('https://example.edu/academics/', { base: '/', site: 'https://example.edu' }),
    ).toBe('/academics');
  });

  it('ignores links that leave the site or are relative', () => {
    expect(urlKey('https://elsewhere.org/academics/')).toBeNull();
    expect(urlKey('../academics/')).toBeNull();
    expect(urlKey('mailto:a@b.c')).toBeNull();
    expect(urlKey('#top')).toBeNull();
    expect(urlKey('/other/academics/', { base: '/college/' })).toBeNull();
  });

  it('rewrites a link to a new key in its original shape', () => {
    const s = settings({ base: '/college/', site: 'https://example.edu' });
    const link = parseSiteUrl('https://example.edu/college/academics/nursing/#top', s);
    if (!link) throw new Error('expected a site link');
    expect(reshapeUrl(link, '/nursing', s)).toBe('https://example.edu/college/nursing/#top');
    const bare = parseSiteUrl('/academics/nursing', settings());
    if (!bare) throw new Error('expected a site link');
    expect(reshapeUrl(bare, '/nursing', settings())).toBe('/nursing');
  });
});

describe('isReservedPath', () => {
  it('keeps pages off the studio and Vesper’s own files', () => {
    expect(isReservedPath('/admin')).toBe(true);
    expect(isReservedPath('/admin/settings')).toBe(true);
    expect(isReservedPath('/_vesper')).toBe(true);
    expect(isReservedPath('/administration')).toBe(false);
  });
});
