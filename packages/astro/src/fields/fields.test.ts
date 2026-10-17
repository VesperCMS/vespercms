import { walkSchema } from '@vesper/core';
import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';
import { color, datetime, email, file, geo, markdown, select, slug, url } from './index.ts';

const model = (schema: z.ZodType) => walkSchema(z.object({ x: schema })).fields?.[0];

describe('fields helpers: values', () => {
  it.each([
    ['color', color(), ['#1a73e8', '#ABCDEF'], ['1a73e8', '#123', '#1a73e8ff']],
    ['color alpha', color({ alpha: true }), ['#1a73e8ff'], ['#1a73e8']],
    ['geo', geo(), [{ lat: 36.69, lng: -81.97 }], [{ lat: 91, lng: 0 }, { lat: 0 }]],
    ['slug', slug({ from: 'title' }), ['my-post', 'a1'], ['My Post', '-x', 'a--b']],
    ['url', url(), ['https://example.com/a'], ['not a url']],
    ['email', email(), ['a@b.com'], ['nope']],
    ['select', select(['news', 'events']), ['news'], ['other']],
    ['markdown', markdown({ inline: true }), ['*hi*'], [1]],
    ['file', file({ accept: 'application/pdf' }), ['../files/a.pdf'], [null]],
  ] as [string, z.ZodType, unknown[], unknown[]][])(
    '%s accepts and rejects the right values',
    (_name, schema, good, bad) => {
      for (const value of good)
        expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(true);
      for (const value of bad)
        expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    },
  );

  it('datetime coerces ISO strings', () => {
    expect(datetime().parse('2026-10-24T10:00:00-04:00')).toEqual(new Date('2026-10-24T14:00:00Z'));
  });
});

describe('fields helpers: each equals its documented raw Zod', () => {
  // The raw equivalents shown in the helpers' docs (spec §6.3.2). If these
  // drift, sites that drop the import would silently change behavior.
  it.each([
    [
      'color',
      color({ palette: { Indigo: '#28335f' } }),
      z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .meta({ widget: 'color', widgetOptions: { palette: { Indigo: '#28335f' } } }),
    ],
    [
      'geo',
      geo(),
      z
        .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
        .meta({ widget: 'geo' }),
    ],
    [
      'slug',
      slug({ from: 'title' }),
      z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .meta({ widget: 'slug', widgetOptions: { from: 'title' } }),
    ],
    ['url', url(), z.url().meta({ widget: 'url' })],
    ['email', email(), z.email().meta({ widget: 'email', autocomplete: 'email' })],
    ['datetime', datetime(), z.coerce.date().meta({ widget: 'datetime' })],
    [
      'select',
      select({ a: 'Alpha', b: 'Beta' }),
      z.enum(['a', 'b']).meta({ widgetOptions: { labels: { a: 'Alpha', b: 'Beta' } } }),
    ],
    [
      'markdown',
      markdown({ inline: true }),
      z.string().meta({ widget: 'markdown', widgetOptions: { inline: true } }),
    ],
    [
      'file',
      file({ accept: 'application/pdf' }),
      z.string().meta({ widget: 'file', widgetOptions: { accept: 'application/pdf' } }),
    ],
  ] as [string, z.ZodType, z.ZodType][])('%s', (_name, helper, raw) => {
    expect(model(helper)).toEqual(model(raw));
  });
});

describe('fields helpers: field models', () => {
  it('select keeps labels and stores values', () => {
    expect(model(select([{ value: 'news', label: 'News' }]))?.constraints?.options).toEqual([
      { value: 'news', label: 'News' },
    ]);
  });

  it('can be chained with more meta, which wins', () => {
    expect(model(color().meta({ label: 'Brand colour' }))).toMatchObject({
      label: 'Brand colour',
      widget: 'color',
    });
  });

  it('refuses an empty select', () => {
    expect(() => select([])).toThrow(/at least one option/);
  });
});
