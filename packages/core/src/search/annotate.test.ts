import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CollectionManifest, Manifest } from '../manifest/types.ts';
import { firstImage, searchAnnotations, searchSettingsProblems } from './annotate.ts';
import { isHiddenFromSearch, searchHiddenField } from './fields.ts';

// The playground's manifest, which the astro package's tests keep current.
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../astro/test/__snapshots__/playground.manifest.json', import.meta.url),
    ),
    'utf8',
  ),
) as Manifest;
const collection = (name: string) =>
  manifest.collections.find((c) => c.name === name) as CollectionManifest;
const authors: Record<string, string> = { 'ada-moreno': 'Ada Moreno' };
const referenceTitle = (name: string, id: string) => (name === 'authors' ? authors[id] : undefined);

describe('search annotations', () => {
  it('gives a blog post its title, Section, tags, category, author and date', () => {
    const annotations = searchAnnotations({
      collection: collection('blog'),
      id: 'harbor-at-dawn',
      data: {
        title: 'Harbor at dawn',
        tags: ['fieldwork', 'surveys', 'fieldwork'],
        category: 'stories',
        author: 'ada-moreno',
        publishedAt: new Date('2026-08-22T00:00:00Z'),
      },
      settings: { filters: ['tags', 'category', 'author'], sort: ['publishedAt'] },
      locale: 'en',
      timeZone: 'America/New_York',
      referenceTitle,
    });
    expect(annotations).toEqual({
      title: 'Harbor at dawn',
      // A day with no time is that day everywhere, not the evening before in New York.
      date: { text: 'August 22, 2026', iso: '2026-08-22' },
      filters: [
        ['Section', ['Blog posts']],
        ['Tags', ['fieldwork', 'surveys']],
        ['Category', ['Stories']],
        ['Author', ['Ada Moreno']],
      ],
      sort: [['publishedAt', '2026-08-22T00:00:00.000Z']],
    });
  });

  it('shows an event’s time in the site’s time zone, and never the schedule’s own dates', () => {
    const annotations = searchAnnotations({
      collection: collection('events'),
      id: 'harvest-concert',
      data: {
        title: 'Harvest concert',
        publishAt: new Date('2026-10-31T12:00:00Z'),
        startsAt: new Date('2026-11-08T00:00:00Z'),
      },
      settings: {},
      locale: 'en-US',
      timeZone: 'America/New_York',
      referenceTitle,
    });
    expect(annotations.date).toEqual({
      text: 'November 7, 2026 at 7:00 PM',
      iso: '2026-11-08T00:00:00.000Z',
    });
    expect(annotations.filters).toEqual([['Section', ['Events']]]);
  });

  it('leaves out empty values and fields that can’t be filters or sort keys', () => {
    const annotations = searchAnnotations({
      collection: collection('blog'),
      id: 'welcome',
      data: { tags: [], draft: true },
      settings: { filters: ['tags', 'draft', 'missing'], sort: ['publishedAt', 'draft'] },
      locale: 'en',
      referenceTitle,
    });
    expect(annotations).toEqual({
      title: 'welcome',
      filters: [['Section', ['Blog posts']]],
      sort: [],
    });
  });

  it('formats the date in the page’s language, and falls back on one Intl doesn’t know', () => {
    const input = {
      collection: collection('blog'),
      id: 'x',
      data: { publishedAt: '2026-08-22' },
      settings: {},
      referenceTitle,
    };
    expect(searchAnnotations({ ...input, locale: 'fr' }).date?.text).toBe('22 août 2026');
    expect(searchAnnotations({ ...input, locale: 'not a language!' }).date?.text).toBe(
      'August 22, 2026',
    );
  });

  it('finds the first image field with a picture', () => {
    expect(firstImage(collection('blog'), { hero: { src: './a.jpg', alt: 'A' } })).toEqual({
      path: ['hero'],
      value: { src: './a.jpg', alt: 'A' },
    });
    expect(firstImage(collection('blog'), { hero: { src: '' } })).toBeUndefined();
    expect(firstImage(collection('docs'), { title: 'x' })).toBeUndefined();
  });

  it('names what’s wrong with the search settings, once per field', () => {
    expect(
      searchSettingsProblems(manifest, {
        filters: { blog: ['tags', 'tagz', 'publishedAt'], nope: ['x'] },
        sort: { events: ['startsAt', 'location'] },
      }),
    ).toEqual([
      'search.filters.blog names "tagz", which blog doesn\'t have.',
      'search.filters.blog: "publishedAt" can\'t be a filter, so it\'s left out. Filters can be text, lists of text, selects and references.',
      'search.filters names "nope", but there\'s no collection by that name.',
      'search.sort.events: "location" can\'t sort results, so it\'s left out. Sort keys can be dates, numbers and text.',
    ]);
  });
});

describe('the hide-from-search field', () => {
  const boolean = (path: string[], extra = {}) => ({
    path,
    kind: 'boolean' as const,
    required: false,
    label: path.join('.'),
    ...extra,
  });

  it('is the field marked by fields.hideFromSearch(), at the top or in an object', () => {
    expect(
      searchHiddenField([boolean(['noindex']), boolean(['hide'], { search: 'hide' })]),
    ).toEqual(['hide']);
    expect(
      searchHiddenField([
        {
          path: ['seo'],
          kind: 'object',
          required: false,
          label: 'SEO',
          children: [boolean(['seo', 'hidden'], { search: 'hide' })],
        },
      ]),
    ).toEqual(['seo', 'hidden']);
  });

  it('or a boolean named noindex, at the top level or under seo', () => {
    expect(searchHiddenField([boolean(['noindex'])])).toEqual(['noindex']);
    expect(
      searchHiddenField([
        {
          path: ['seo'],
          kind: 'object',
          required: false,
          label: 'SEO',
          children: [boolean(['seo', 'noindex'])],
        },
      ]),
    ).toEqual(['seo', 'noindex']);
    expect(
      searchHiddenField([{ path: ['noindex'], kind: 'string', required: false, label: 'x' }]),
    ).toBeUndefined();
    expect(searchHiddenField(null)).toBeUndefined();
  });

  it('hides an entry only when the value is true', () => {
    const blog = { ...collection('blog'), presentation: { searchHidden: ['seo', 'noindex'] } };
    expect(isHiddenFromSearch(blog, { seo: { noindex: true } })).toBe(true);
    expect(isHiddenFromSearch(blog, { seo: { noindex: 'yes' } })).toBe(false);
    expect(isHiddenFromSearch(blog, { seo: null })).toBe(false);
    expect(isHiddenFromSearch(collection('docs'), { noindex: true })).toBe(false);
  });
});
