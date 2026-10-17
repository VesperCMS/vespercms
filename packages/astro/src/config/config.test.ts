import { describe, expect, it } from 'vitest';
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
