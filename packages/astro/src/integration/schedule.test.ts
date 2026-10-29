import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Manifest } from '@vespercms/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SiteModel } from '../node/manifest.ts';
import { scheduledLoaders } from '../runtime/schedule.ts';
import { buildInstant, unfilteredPages, writeSchedule } from './schedule.ts';

const schedule = {
  unpublish: true,
  publishAt: 'publishAt',
  unpublishAt: 'unpublishAt',
  unpublishRedirect: 'unpublishRedirect',
};
const manifest: Manifest = {
  manifestVersion: 1,
  generator: { name: 'test', version: '0' },
  hash: 'x',
  site: {
    srcDir: 'src',
    timeZone: 'America/New_York',
    urls: { base: '/', trailingSlash: 'ignore', buildFormat: 'directory' },
  },
  collections: [
    {
      name: 'events',
      label: 'Events',
      editable: true,
      source: {
        loader: 'glob',
        base: 'src/content/events',
        pattern: '*.md',
        generateId: 'default',
        formats: ['md'],
      },
      entryKind: 'content',
      fields: null,
      presentation: { url: '/events/:id', schedule },
    },
  ],
  forms: [],
  diagnostics: [],
};
const model: SiteModel = { manifest, schemas: new Map(), mdxProps: new Map(), widgetNames: [] };
const NOW = new Date('2026-10-26T16:00:00Z');

let root: string;
let dist: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'vesper-schedule-'));
  dist = join(root, 'dist');
  mkdirSync(join(root, 'src/content/events'), { recursive: true });
  const event = (name: string, lines: string[]) => {
    writeFileSync(
      join(root, `src/content/events/${name}.md`),
      ['---', `title: ${name}`, ...lines, '---', ''].join('\n'),
    );
  };
  event('concert', ['publishAt: 2026-10-31T08:00:00-04:00']);
  event('open-house', ['unpublishAt: 2026-10-25T00:00:00-04:00', 'unpublishRedirect: /events/']);
  event('lecture', ['unpublishAt: 2026-11-13T00:00:00-05:00']);
  event('commencement', []);
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the build’s instant', () => {
  it('is VESPER_BUILD_TIME when set, and now otherwise', () => {
    expect(buildInstant('2026-10-31T07:59:00-04:00').toISOString()).toBe(
      '2026-10-31T11:59:00.000Z',
    );
    expect(buildInstant(undefined, NOW)).toBe(NOW);
    expect(buildInstant('  ', NOW)).toBe(NOW);
  });

  it('refuses a value that isn’t a time, saying how to write one', () => {
    expect(() => buildInstant('next friday')).toThrow(
      'VESPER_BUILD_TIME is "next friday", which isn\'t a time. Write it as an ISO time, such as 2026-10-31T08:00:00-04:00, or leave it unset to build the site as it is now.',
    );
  });
});

describe('schedule.json', () => {
  it('says when the site next changes, and never what', async () => {
    const written = await writeSchedule({ root, dist, model, at: NOW });
    expect(written.next?.toISOString()).toBe('2026-10-31T12:00:00.000Z');
    expect(JSON.parse(readFileSync(join(dist, '_vesper/schedule.json'), 'utf8'))).toEqual({
      version: 1,
      builtAt: '2026-10-26T16:00:00.000Z',
      next: '2026-10-31T12:00:00.000Z',
    });
  });

  it('has no next change once every time has passed', async () => {
    await writeSchedule({ root, dist, model, at: new Date('2027-01-01T00:00:00Z') });
    expect(JSON.parse(readFileSync(join(dist, '_vesper/schedule.json'), 'utf8'))).toMatchObject({
      next: null,
    });
  });
});

describe('pages built from astro:content', () => {
  it('warns about a page whose entry is outside its window, but not a redirect page', async () => {
    const page = (path: string, html: string) => {
      mkdirSync(join(dist, path), { recursive: true });
      writeFileSync(join(dist, path, 'index.html'), html);
    };
    page('events/concert', '<!doctype html><title>Concert</title>');
    page(
      'events/open-house',
      '<!doctype html><meta http-equiv="refresh" content="0;url=/events/"><title>Redirecting</title>',
    );
    page('events/lecture', '<!doctype html><title>Lecture</title>');
    expect(
      await unfilteredPages({
        root,
        dist,
        model,
        settings: { base: '/', trailingSlash: 'ignore', buildFormat: 'directory' },
        routes: () => new Map(),
        at: NOW,
      }),
    ).toEqual([
      "/events/concert/ was built, but it's scheduled for Sat, Oct 31, 8:00 AM. The page reads astro:content, which isn't filtered; import from vesper:content instead.",
    ]);
  });
});

describe('vesper:content’s loaders in a build', () => {
  const entries = [
    { collection: 'events', id: 'concert', data: { publishAt: new Date('2026-10-31T12:00:00Z') } },
    {
      collection: 'events',
      id: 'lecture',
      data: { unpublishAt: new Date('2026-11-13T05:00:00Z') },
    },
    { collection: 'blog', id: 'welcome', data: { publishAt: new Date('2099-01-01') } },
    { collection: 'blog', id: 'notes', data: { draft: true } },
    { collection: 'docs', id: 'intro', data: { draft: true } },
  ];
  const content = {
    getCollection: (name: string) =>
      Promise.resolve(entries.filter((entry) => entry.collection === name)),
    getEntry: (collection: string, id: string) =>
      Promise.resolve(entries.find((e) => e.collection === collection && e.id === id)),
    getEntries: (refs: { collection: string; id: string }[]) =>
      Promise.resolve(
        refs.flatMap((ref) =>
          entries.filter((e) => e.collection === ref.collection && e.id === ref.id),
        ),
      ),
  };
  const loaders = scheduledLoaders(content, {
    instant: NOW.toISOString(),
    schedules: { events: schedule },
    // Blog posts have a `draft` field; docs don't.
    drafts: ['blog'],
  });

  it('leave out scheduled entries outside their window, and nothing else', async () => {
    expect((await loaders.getCollection('events')).map((e) => (e as { id: string }).id)).toEqual([
      'lecture',
    ]);
    // An unscheduled collection passes through, whatever its schedule fields say.
    expect((await loaders.getCollection('blog')).map((e) => (e as { id: string }).id)).toEqual([
      'welcome',
    ]);
    expect(await loaders.getEntry(...(['events', 'concert'] as never[]))).toBeUndefined();
    expect(await loaders.getEntry(...(['events', 'lecture'] as never[]))).toMatchObject({
      id: 'lecture',
    });
    expect(
      await loaders.getEntries([
        { collection: 'events', id: 'concert' },
        { collection: 'events', id: 'lecture' },
      ] as never[]),
    ).toHaveLength(1);
  });

  it('leave out drafts where the collection has a `draft` field, and only there', async () => {
    expect(await loaders.getEntry(...(['blog', 'notes'] as never[]))).toBeUndefined();
    expect(
      await loaders.getEntries([
        { collection: 'blog', id: 'notes' },
        { collection: 'blog', id: 'welcome' },
      ] as never[]),
    ).toHaveLength(1);
    // `draft` means nothing to Vesper in a collection without the field.
    expect(await loaders.getCollection('docs')).toHaveLength(1);
  });
});
