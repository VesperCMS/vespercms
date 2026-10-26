import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * Phase 4.5's second and fourth "Done when" (spec §11), at build: an entry
 * appears at the first build after its time, and the build compares
 * instants only, across a daylight-saving change.
 *
 * A copy of the playground is built as of four instants (VESPER_BUILD_TIME):
 * a minute before and a minute after harvest-concert goes live (8:00 AM EDT
 * on 31 October 2026), then inside and at the end of night-owl-study-hall,
 * which is live from 1:30 AM EDT to 1:30 AM EST on 1 November, the hour the
 * clocks repeat. Each build's pages, events list, search index and
 * schedule.json are kept for the tests.
 */

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const playground = join(repo, 'apps', 'playground');
const site = join(repo, 'e2e', '.schedule-site');
const SKIP = new Set(['node_modules', 'dist', '.astro', '.vesper']);

type Built = {
  log: string;
  pages: Set<string>;
  /** Event pages the events list links to. */
  listed: string[];
  indexed: Set<string>;
  schedule: { builtAt: string; next: string | null };
};

/** Every page in Pagefind's index, by URL: its fragments are gzipped JSON. */
function indexedUrls(dist: string): Set<string> {
  const folder = join(dist, '_vesper/search/fragment');
  if (!existsSync(folder)) return new Set();
  return new Set(
    readdirSync(folder).map((file) => {
      const text = gunzipSync(readFileSync(join(folder, file)))
        .toString('utf8')
        .replace(/^pagefind_dcd/, '');
      return (JSON.parse(text) as { url: string }).url;
    }),
  );
}

function buildAt(instant: string): Built {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(VITEST.*|NODE_ENV|DEV|PROD|MODE|SSR|BASE_URL|TEST)$/.test(key),
    ),
  );
  const result = spawnSync(
    process.execPath,
    [
      '--conditions=@vesper/source',
      join(repo, 'node_modules/astro/bin/astro.mjs'),
      'build',
      '--root',
      site,
    ],
    { cwd: repo, encoding: 'utf8', env: { ...env, VESPER_BUILD_TIME: instant } },
  );
  const log = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) throw new Error(`The build as of ${instant} failed:\n${log}`);
  const dist = join(site, 'dist');
  const events = join(dist, 'events');
  const list = readFileSync(join(events, 'index.html'), 'utf8');
  return {
    log,
    pages: new Set(
      readdirSync(events).filter((name) => existsSync(join(events, name, 'index.html'))),
    ),
    listed: [...list.matchAll(/href="\/events\/([^"/]+)\/"/g)].map((m) => m[1] ?? ''),
    indexed: indexedUrls(dist),
    schedule: JSON.parse(readFileSync(join(dist, '_vesper/schedule.json'), 'utf8')) as {
      builtAt: string;
      next: string | null;
    },
  };
}

let before: Built;
let after: Built;
let overnight: Built;
let morning: Built;

beforeAll(() => {
  rmSync(site, { recursive: true, force: true });
  cpSync(playground, site, {
    recursive: true,
    filter: (path) => !path.split(/[\\/]/).some((part) => SKIP.has(part)),
  });
  before = buildAt('2026-10-31T07:59:00-04:00');
  after = buildAt('2026-10-31T08:01:00-04:00');
  // 1:00 AM EST, between the two 1:30s.
  overnight = buildAt('2026-11-01T06:00:00Z');
  // The second 1:30, when it comes down.
  morning = buildAt('2026-11-01T01:30:00-05:00');
}, 300_000);

afterAll(() => {
  rmSync(site, { recursive: true, force: true });
});

describe('a scheduled publish, at build', () => {
  it('leaves an event out until its time: no page, not listed, not searched', () => {
    expect(before.log).toContain(
      'Building the site as of 2026-10-31T11:59:00.000Z (VESPER_BUILD_TIME).',
    );
    expect(before.pages.has('harvest-concert')).toBe(false);
    expect(before.listed).not.toContain('harvest-concert');
    expect(before.indexed.has('/events/harvest-concert/')).toBe(false);
    expect(before.schedule).toEqual({
      version: 1,
      builtAt: '2026-10-31T11:59:00.000Z',
      next: '2026-10-31T12:00:00.000Z',
    });
  });

  it('builds it at the first build after its time, and moves next on', () => {
    expect(after.pages.has('harvest-concert')).toBe(true);
    expect(after.listed).toContain('harvest-concert');
    expect(after.indexed.has('/events/harvest-concert/')).toBe(true);
    expect(after.schedule.next).toBe('2026-11-01T05:30:00.000Z');
  });

  it('warns about no page: the playground reads vesper:content', () => {
    for (const built of [before, after, overnight, morning])
      expect(built.log).not.toContain("which isn't filtered");
  });
});

describe('across the hour the clocks repeat', () => {
  it('keeps an event live for exactly the hour between its two 1:30s', () => {
    expect(after.pages.has('night-owl-study-hall')).toBe(false);
    expect(overnight.pages.has('night-owl-study-hall')).toBe(true);
    expect(overnight.listed).toContain('night-owl-study-hall');
    expect(overnight.schedule.next).toBe('2026-11-01T06:30:00.000Z');
    // It comes down with no redirect, so its address is simply gone.
    expect(morning.pages.has('night-owl-study-hall')).toBe(false);
    expect(morning.listed).not.toContain('night-owl-study-hall');
  });
});

describe('unpublished events', () => {
  it('leave a redirect page to where their entry says, and the list goes on without them', () => {
    const page = readFileSync(join(site, 'dist/events/fall-open-house/index.html'), 'utf8');
    expect(page).toContain('<meta http-equiv="refresh" content="0;url=/events/">');
    expect(morning.listed).not.toContain('fall-open-house');
    expect(morning.indexed.has('/events/fall-open-house/')).toBe(false);
  });
});
