import { IMAGE_MARKER, VESPER_META_KEY, walkSchema } from '@vespercms/core';
import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';
import {
  color,
  datetime,
  email,
  file,
  geo,
  hideFromSearch,
  image,
  markdown,
  select,
  slug,
  url,
} from './index.ts';

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
      'color with a contrast check',
      color({ contrast: 'text' }),
      z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .meta({ widget: 'color', widgetOptions: { contrast: 'text' } }),
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
    [
      'hideFromSearch',
      hideFromSearch(),
      z.boolean().default(false).meta({
        label: 'Hide from site search',
        description: 'The page stays on the site. It just won’t show up in the site’s own search.',
        placement: 'details',
        search: 'hide',
      }),
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

describe('fields.image (spec §6.6.2)', () => {
  // Vesper's stand-in for Astro's image(): a marked string, as the config loader passes it.
  const astroImage = () => z.string().meta({ [VESPER_META_KEY]: IMAGE_MARKER });
  const hero = image(astroImage, { ratios: ['wide', 'square'] });
  const valid = {
    src: '../../assets/blog/harbor-at-dawn.jpg',
    alt: 'Boats leaving the harbor at dawn',
    focus: { x: 0.62, y: 0.35 },
    crops: { square: { x: 0.4, y: 0.1, w: 0.45, h: 0.675 } },
  };

  it('accepts the stored shape, with or without a focal point and crops', () => {
    expect(hero.parse(valid)).toEqual(valid);
    expect(hero.safeParse({ src: 'a.jpg', alt: 'A boat' }).success).toBe(true);
    expect(hero.safeParse({ src: 'a.jpg', alt: '', decorative: true }).success).toBe(true);
  });

  it('needs alt text unless the image is decorative', () => {
    const missing = hero.safeParse({ src: 'a.jpg', alt: ' ' });
    expect(missing.error?.issues).toMatchObject([
      { path: ['alt'], message: 'Describe this image, or mark it decorative.' },
    ]);
    expect(hero.safeParse({ src: 'a.jpg', alt: 'A boat', decorative: true }).success).toBe(false);
  });

  it('keeps focal points and crops inside the image', () => {
    expect(hero.safeParse({ ...valid, focus: { x: 1.2, y: 0 } }).success).toBe(false);
    expect(
      hero.safeParse({ ...valid, crops: { square: { x: 0.6, y: 0, w: 0.5, h: 0.5 } } }).error
        ?.issues,
    ).toMatchObject([
      { path: ['crops', 'square'], message: 'The crop must lie inside the image.' },
    ]);
    expect(
      hero.safeParse({ ...valid, crops: { square: { x: 0, y: 0, w: 0, h: 1 } } }).success,
    ).toBe(false);
  });

  it('is an image widget over an object, with the ratios it previews', () => {
    expect(model(hero)).toMatchObject({
      kind: 'object',
      widget: 'image',
      widgetOptions: { ratios: ['wide', 'square'] },
    });
    expect(model(hero)?.children?.map((child) => [child.path.at(-1), child.kind])).toEqual([
      ['src', 'image'],
      ['alt', 'string'],
      ['decorative', 'boolean'],
      ['focus', 'object'],
      ['crops', 'unknown'],
    ]);
    expect(model(image(astroImage))).not.toHaveProperty('widgetOptions');
  });

  it('equals its documented raw Zod', () => {
    const raw = z
      .object({
        src: astroImage(),
        alt: z.string(),
        decorative: z.boolean().optional(),
        focus: z
          .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
          .meta({ label: 'Focal point' })
          .optional(),
        crops: z
          .record(
            z.string(),
            z
              .object({
                x: z.number().min(0).max(1),
                y: z.number().min(0).max(1),
                w: z.number().gt(0).max(1),
                h: z.number().gt(0).max(1),
              })
              .refine((r) => r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9, {
                message: 'The crop must lie inside the image.',
              }),
          )
          .optional(),
      })
      .refine((v) => (v.decorative === true ? v.alt === '' : v.alt.trim() !== ''), {
        message: 'Describe this image, or mark it decorative.',
        path: ['alt'],
      })
      .meta({ widget: 'image', widgetOptions: { ratios: ['wide', 'square'] } });
    expect(model(hero)).toEqual(model(raw));
    for (const value of [valid, { ...valid, alt: '' }, { ...valid, focus: { x: 2, y: 0 } }]) {
      expect(hero.safeParse(value).success).toBe(raw.safeParse(value).success);
    }
  });
});
