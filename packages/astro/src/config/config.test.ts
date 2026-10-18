import { describe, expect, it } from 'vitest';
import { A11Y_RULE_IDS } from '@vesper/core';
import { checkConfig, defineConfig } from './index.ts';

describe('defineConfig', () => {
  it('returns the config unchanged (it exists for types)', () => {
    const config = { collections: { blog: { label: 'Blog' } } };
    expect(defineConfig(config)).toBe(config);
  });
});

describe('checkConfig', () => {
  it('accepts a valid config without problems', () => {
    expect(
      checkConfig({
        collections: {
          pages: { url: '/:path', tree: true },
          events: { schedule: { unpublish: false } },
        },
        widgets: { hours: { component: () => Promise.resolve({}) } },
      }),
    ).toEqual([]);
  });

  it('warns about unknown keys instead of failing', () => {
    expect(checkConfig({ colections: {}, collections: { blog: { lable: 'x' } } })).toEqual([
      { level: 'warning', message: 'Unknown setting "colections" in vesper.config.ts is ignored.' },
      { level: 'warning', message: 'Unknown setting "collections.blog.lable" is ignored.' },
    ]);
  });

  it('reports wrong types in plain language', () => {
    expect(
      checkConfig({ collections: { blog: { url: 5 } }, widgets: { x: {} } }).map((p) => p.level),
    ).toEqual(['error', 'error']);
    expect(checkConfig(null)[0]?.message).toContain('defineConfig');
  });
});

describe('timeZone', () => {
  it('accepts IANA names and explains anything else', () => {
    expect(checkConfig({ timeZone: 'America/New_York' })).toEqual([]);
    expect(checkConfig({ timeZone: 'Eastern' })).toEqual([
      {
        level: 'error',
        message:
          'timeZone must be an IANA time zone name such as "America/New_York", not "Eastern".',
      },
    ]);
  });
});

describe('markdoc and mdx', () => {
  it('accepts tag hints and declared components', () => {
    const props = { safeParse: () => ({ success: true }) };
    expect(
      checkConfig({
        markdoc: {
          tags: {
            callout: {
              label: 'Callout',
              summary: 'type',
              attributes: { type: { labels: { tip: 'Tip' }, widget: 'radio' } },
            },
          },
        },
        mdx: { components: { Callout: { label: 'Callout', children: true, props } } },
      }),
    ).toEqual([]);
  });

  it('explains what is wrong with them', () => {
    expect(
      checkConfig({
        markdoc: { tags: { callout: { lable: 'x', attributes: { type: 'tip' } } } },
        mdx: { components: { Callout: { props: {}, children: 'yes' } } },
      }),
    ).toEqual([
      { level: 'warning', message: 'Unknown setting "markdoc.tags.callout.lable" is ignored.' },
      { level: 'error', message: 'markdoc.tags.callout.attributes.type must be an object.' },
      {
        level: 'error',
        message:
          'mdx.components.Callout.props must be a Zod schema, such as z.object({ … }) from astro/zod.',
      },
      { level: 'error', message: 'mdx.components.Callout.children must be true or false.' },
    ]);
  });
});

describe('URLs, trees and redirects', () => {
  it('accepts maxDepth and native redirect hosts', () => {
    expect(
      checkConfig({
        collections: { pages: { url: '/:path', tree: true, maxDepth: 4 } },
        redirects: { native: ['apache', 'netlify'] },
      }),
    ).toEqual([]);
  });

  it('explains a bad maxDepth or an unknown host', () => {
    expect(
      checkConfig({
        collections: { pages: { tree: true, maxDepth: 0 } },
        redirects: { native: ['iis'], nativ: true },
      }),
    ).toEqual([
      {
        level: 'error',
        message: 'collections.pages.maxDepth must be a whole number of levels, 1 or more.',
      },
      { level: 'warning', message: 'Unknown setting "redirects.nativ" is ignored.' },
      {
        level: 'error',
        message:
          'redirects.native: "iis" isn\'t a host Vesper writes rules for. Use netlify, cloudflare, vercel, apache, nginx.',
      },
    ]);
  });
});

describe('collection icons', () => {
  it('accepts a Lucide icon name', () => {
    expect(checkConfig({ collections: { events: { icon: 'calendar-days' } } })).toEqual([]);
  });

  it('explains a name that isn’t written as Lucide lists them', () => {
    const problem = (name: string) => ({
      level: 'error',
      message: `collections.${name}.icon must be a Lucide icon name as lucide.dev/icons lists it, such as "newspaper" or "calendar-days".`,
    });
    expect(
      checkConfig({
        collections: {
          blog: { icon: 'CalendarDays' },
          docs: { icon: 'book open' },
          faq: { icon: 3 },
        },
      }),
    ).toEqual([problem('blog'), problem('docs'), problem('faq')]);
  });
});

describe('images', () => {
  it('accepts ratios and an upload limit', () => {
    expect(
      checkConfig({ images: { ratios: { wide: 16 / 9, square: 1, og: 2 }, maxUploadEdge: 2400 } }),
    ).toEqual([]);
  });

  it('explains bad names, ratios and limits', () => {
    expect(
      checkConfig({
        images: { ratios: { '16x9': 16 / 9, flat: 0, tall: '9/16' }, maxUploadEdge: 1.5, max: 1 },
      }),
    ).toEqual([
      { level: 'warning', message: 'Unknown setting "images.max" is ignored.' },
      {
        level: 'error',
        message:
          'images.ratios: "16x9" can\'t be a ratio\'s name. Use a word, such as wide or square.',
      },
      {
        level: 'error',
        message: 'images.ratios.flat must be a number above zero, width / height, such as 16 / 9.',
      },
      {
        level: 'error',
        message: 'images.ratios.tall must be a number above zero, width / height, such as 16 / 9.',
      },
      {
        level: 'error',
        message: 'images.maxUploadEdge must be a whole number of pixels, such as 3000.',
      },
    ]);
    expect(checkConfig({ images: { ratios: [1] } })).toEqual([
      {
        level: 'error',
        message: 'images.ratios must be an object of names and ratios, such as { wide: 16 / 9 }.',
      },
    ]);
  });
});

describe('accessibility', () => {
  it('accepts the publish gate, backgrounds and a heading start', () => {
    expect(
      checkConfig({
        a11y: {
          blockPublishOn: ['missing-alt', 'pdf-untagged'],
          backgrounds: { Page: '#ffffff', Footer: '#1d2433' },
        },
        collections: { docs: { headingStart: 1 } },
      }),
    ).toEqual([]);
  });

  it('explains what it can’t use', () => {
    expect(
      checkConfig({
        a11y: { blockPublishOn: ['missing-alts'], backgrounds: { Page: 'white' }, strict: true },
        collections: { docs: { headingStart: 0 } },
      }),
    ).toEqual([
      {
        level: 'error',
        message:
          "collections.docs.headingStart must be a heading level from 1 to 6: usually 2, when the page's title is its h1.",
      },
      { level: 'warning', message: 'Unknown setting "a11y.strict" is ignored.' },
      {
        level: 'warning',
        message: `a11y.blockPublishOn: "missing-alts" isn't a rule, so it blocks nothing. The rules are ${A11Y_RULE_IDS.join(', ')}.`,
      },
      {
        level: 'error',
        message: 'a11y.backgrounds.Page must be a hex colour such as \'#ffffff\', not "white".',
      },
    ]);
    expect(checkConfig({ a11y: { blockPublishOn: 'missing-alt' } })).toEqual([
      {
        level: 'error',
        message: "a11y.blockPublishOn must be a list of rule names, such as ['missing-alt'].",
      },
    ]);
  });
});
