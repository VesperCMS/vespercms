import { describe, expect, it } from 'vitest';
import { createHelpers, type HelperData } from './helpers.ts';

type Entry = { id: string; collection: string; data: Record<string, unknown> };

const entries: Record<string, Entry[]> = {
  pages: [
    { id: 'index', collection: 'pages', data: { title: 'Home' } },
    { id: 'academics', collection: 'pages', data: { title: 'Academics' } },
    { id: 'academics/nursing', collection: 'pages', data: { title: 'Nursing' } },
    { id: 'academics/business', collection: 'pages', data: { title: 'Business' } },
    { id: 'admissions/apply', collection: 'pages', data: { title: 'How to apply' } },
  ],
  blog: [
    {
      id: 'welcome',
      collection: 'blog',
      data: { title: 'Welcome', publishedAt: new Date('2026-10-17T00:00:00Z') },
    },
  ],
  authors: [{ id: 'ada', collection: 'authors', data: { name: 'Ada' } }],
  settings: [{ id: 'site', collection: 'settings', data: { siteName: 'Riverside' } }],
};

const data: HelperData = {
  settings: { base: '/college/', trailingSlash: 'ignore', buildFormat: 'directory' },
  collections: {
    pages: { url: '/:path', titleKeys: ['title'], orders: { academics: ['nursing', 'business'] } },
    blog: { url: '/blog/:publishedAt|yyyy/:slug', titleKeys: ['title'], orders: {} },
    authors: { titleKeys: ['name'], orders: {} },
    settings: { titleKeys: ['title'], orders: {}, singleton: true },
    empty: { titleKeys: ['title'], orders: {}, singleton: true },
  },
};

const helpers = createHelpers(data, (name) => Promise.resolve(entries[name] ?? []));

describe('vesper:content site helpers', () => {
  it('getUrl follows the pattern, the base and the trailing slash', () => {
    expect(helpers.getUrl(entries.pages?.[2] as Entry)).toBe('/college/academics/nursing/');
    expect(helpers.getUrl(entries.pages?.[0] as Entry)).toBe('/college/');
    expect(helpers.getUrl(entries.blog?.[0] as Entry)).toBe('/college/blog/2026/welcome/');
    expect(helpers.getUrl(entries.authors?.[0] as Entry)).toBeUndefined();
  });

  it('getTree nests and orders, carrying each Astro entry', async () => {
    const tree = await helpers.getTree('pages');
    expect(tree.map((n) => n.title)).toEqual(['Home', 'Academics', 'Admissions']);
    expect(tree[1]?.children.map((n) => n.title)).toEqual(['Nursing', 'Business']);
    expect(tree[1]?.entry).toBe(entries.pages?.[1]);
  });

  it('getChildren and getBreadcrumbs take an entry or its ID', async () => {
    expect((await helpers.getChildren('pages', 'academics')).map((n) => n.slug)).toEqual([
      'nursing',
      'business',
    ]);
    expect(await helpers.getBreadcrumbs('pages', entries.pages?.[4] as Entry)).toEqual([
      { title: 'Home', url: '/college/', id: 'index' },
      { title: 'Admissions', url: null },
      { title: 'How to apply', url: '/college/admissions/apply/', id: 'admissions/apply' },
    ]);
  });

  it('runs a function-form pattern', () => {
    const custom = createHelpers(data, () => Promise.resolve([]), {
      authors: (entry) => `/people/${entry.id}`,
    });
    expect(custom.getUrl(entries.authors?.[0] as Entry)).toBe('/college/people/ada/');
  });

  it('getUrl gives no URL when a function pattern returns nothing', () => {
    const custom = createHelpers(data, () => Promise.resolve([]), { authors: () => undefined });
    expect(custom.getUrl(entries.authors?.[0] as Entry)).toBeUndefined();
  });

  it('getSingleton reads a singleton’s one entry through getEntry, whatever its file is called', async () => {
    const read: string[] = [];
    const custom = createHelpers(
      data,
      (name) => Promise.resolve(entries[name] ?? []),
      {},
      (name, id) => {
        read.push(`${name}/${id}`);
        return Promise.resolve(entries[name]?.find((e) => e.id === id));
      },
    );
    expect(await custom.getSingleton('settings')).toBe(entries.settings?.[0]);
    expect(read).toEqual(['settings/site']);
    expect(await custom.getSingleton('empty')).toBeUndefined();
    await expect(custom.getSingleton('blog')).rejects.toThrow("blog isn't a singleton");
  });
});
