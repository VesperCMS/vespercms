import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Manifest } from '../manifest/types.ts';
import { MemoryStorage } from '../storage/memory.ts';
import { PageService, type StaticRoutes } from './pages.ts';
import { ContentService, type TreeHooks } from './service.ts';

/*
 * PageService over a copy of the playground in memory: the same content, the
 * same manifest (the snapshot the astro package keeps current) and the
 * static routes in apps/playground/src/pages.
 */

const playground = fileURLToPath(new URL('../../../../apps/playground/', import.meta.url));
const snapshot = fileURLToPath(
  new URL('../../../astro/test/__snapshots__/playground.manifest.json', import.meta.url),
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function playgroundFiles(): Record<string, Uint8Array> {
  const found: Record<string, Uint8Array> = {};
  for (const path of [
    ...files(join(playground, 'src/content')),
    ...files(join(playground, 'src/data')),
    join(playground, 'vesper.redirects.yaml'),
  ]) {
    found[relative(playground, path).replaceAll('\\', '/')] = new Uint8Array(readFileSync(path));
  }
  return found;
}

const routes: StaticRoutes = new Map([
  ['/', 'src/pages/index.astro'],
  ['/404', 'src/pages/404.astro'],
  ['/blog', 'src/pages/blog/index.astro'],
  ['/contact', 'src/pages/contact.astro'],
  ['/docs', 'src/pages/docs/index.astro'],
  ['/events', 'src/pages/events/index.astro'],
  ['/locations', 'src/pages/locations.astro'],
]);

async function setup(
  options: { extra?: Record<string, string>; maxDepth?: number; manifest?: Partial<Manifest> } = {},
) {
  const base = JSON.parse(readFileSync(snapshot, 'utf8')) as Manifest;
  const manifest: Manifest = {
    ...base,
    ...options.manifest,
    collections: base.collections.map((c) =>
      c.name === 'pages' && options.maxDepth !== undefined
        ? { ...c, presentation: { ...c.presentation, maxDepth: options.maxDepth } }
        : c,
    ),
  };
  // MemoryStorage records every change set it commits.
  const storage = await MemoryStorage.create({ ...playgroundFiles(), ...options.extra });
  const content: ContentService = new ContentService(storage, manifest, {
    // Called only once both exist.
    tree: (): TreeHooks => pages.hooks(),
    now: () => new Date('2026-10-18T15:00:00Z'),
  });
  const pages: PageService = new PageService(storage, manifest, content, {
    routes: () => routes,
    now: () => new Date('2026-10-18T15:00:00Z'),
  });
  const text = async (path: string) => {
    const file = await storage.read(path);
    return file ? new TextDecoder().decode(file.bytes) : null;
  };
  return { storage, content, pages, text };
}

const P = 'src/content/pages/';

describe('PageService.tree', () => {
  it('outlines the playground’s pages in their _order.yaml order', async () => {
    const { pages } = await setup();
    const tree = await pages.tree('pages');
    const lines = (nodes: typeof tree.nodes): string[] =>
      nodes.flatMap((n) => [
        `${'  '.repeat(Math.max(0, n.depth - 1))}${n.title} ${n.url ?? '(no page)'}`,
        ...lines(n.children),
      ]);
    expect(lines(tree.nodes)).toEqual([
      'Vesper playground /',
      'About the college /about/',
      'Academics /academics/',
      '  Nursing /academics/nursing/',
      '    Clinical placements /academics/nursing/clinical-placements/',
      '      Partner hospitals /academics/nursing/clinical-placements/partner-hospitals/',
      '    RN to BSN bridge /academics/nursing/rn-to-bsn/',
      '  Business /academics/business/',
      '    Accounting /academics/business/accounting/',
      '  General studies /academics/general-studies/',
      'Admissions (no page)',
      '  How to apply /admissions/apply/',
      '  Tuition and fees /admissions/tuition/',
      'Campus life /campus-life/',
    ]);
    const academics = tree.nodes[2];
    expect(academics).toMatchObject({
      file: `${P}academics/index.md`,
      section: true,
      status: 'editable',
    });
  });
});

describe('PageService.move: Nursing and its pages to the top level', () => {
  it('is one change set with the moved files, both order files, redirects and every link', async () => {
    const { storage, pages, text } = await setup();
    const result = await pages.move({ collection: 'pages', path: 'academics/nursing', parent: '' });
    expect(result).toEqual({
      ok: true,
      path: 'nursing',
      id: 'nursing',
      title: 'Nursing',
      pages: 4,
      links: 8,
      redirects: 4,
      from: '/academics/nursing/',
      to: '/nursing/',
      parent: null,
      position: { index: 5, of: 5 },
    });

    expect(storage.commits).toHaveLength(1);
    const [commit] = storage.commits;
    expect(commit?.message.summary).toBe('Move “Nursing” and 3 pages under it to the top level');
    const summary = (commit?.changes ?? []).map((c) =>
      c.op === 'move'
        ? `move ${c.from} → ${c.to}${c.bytes ? ' (edited)' : ''}`
        : `${c.op} ${c.path}`,
    );
    expect(summary.sort()).toEqual(
      [
        `move ${P}academics/nursing/_order.yaml → ${P}nursing/_order.yaml`,
        `move ${P}academics/nursing/clinical-placements/index.md → ${P}nursing/clinical-placements/index.md`,
        `move ${P}academics/nursing/clinical-placements/partner-hospitals.md → ${P}nursing/clinical-placements/partner-hospitals.md`,
        `move ${P}academics/nursing/index.md → ${P}nursing/index.md`,
        `move ${P}academics/nursing/rn-to-bsn.md → ${P}nursing/rn-to-bsn.md`,
        `put ${P}_order.yaml`,
        `put ${P}academics/_order.yaml`,
        `put ${P}academics/index.md`,
        `put ${P}admissions/apply.md`,
        `put ${P}campus-life.mdx`,
        'put src/content/docs/_support-hours.mdoc',
        'put src/content/events/nursing-info-session.md',
        'put vesper.redirects.yaml',
      ].sort(),
    );

    expect(await text(`${P}_order.yaml`)).toBe(
      '# Top-level page order (spec §6.15.3). Unlisted pages sort by title after these.\n- about\n- academics\n- admissions\n- campus-life\n- nursing\n',
    );
    expect(await text(`${P}academics/_order.yaml`)).toBe('- business\n- general-studies\n');
    expect(await text('vesper.redirects.yaml')).toBe(
      [
        '# Redirects for the playground (spec §6.15.5). The build cleans them and hands',
        '# them to Astro. The first two entries form a chain on purpose, which the build',
        '# collapses: /programs/nursing → /academics/nursing-old → /academics/nursing.',
        '- { from: /programs/nursing, to: /nursing, status: 301, reason: move, at: 2026-09-02 }',
        '- { from: /academics/nursing-old, to: /nursing, status: 301, reason: move, at: 2026-10-01 }',
        '- { from: /apply-now, to: /admissions/apply, status: 302, reason: manual, at: 2026-10-01 }',
        '- { from: /academics/nursing, to: /nursing, status: 301, reason: move, at: 2026-10-18 }',
        '- { from: /academics/nursing/clinical-placements, to: /nursing/clinical-placements, status: 301, reason: move, at: 2026-10-18 }',
        '- { from: /academics/nursing/clinical-placements/partner-hospitals, to: /nursing/clinical-placements/partner-hospitals, status: 301, reason: move, at: 2026-10-18 }',
        '- { from: /academics/nursing/rn-to-bsn, to: /nursing/rn-to-bsn, status: 301, reason: move, at: 2026-10-18 }',
        '',
      ].join('\n'),
    );

    expect(await text(`${P}academics/index.md`)).toContain(
      "Start with [Nursing](/nursing/), our largest program, or the [RN to BSN bridge](/nursing/rn-to-bsn/) if you're already a registered nurse. [General studies](general-studies/) transfers",
    );
    expect(await text(`${P}admissions/apply.md`)).toContain(
      '[clinical placements](/nursing/clinical-placements/)',
    );
    expect(await text(`${P}campus-life.mdx`)).toContain('[clinical lab](/nursing/)');
    expect(await text('src/content/docs/_support-hours.mdoc')).toContain(
      '[nursing office](/nursing/)',
    );
    const event = await text('src/content/events/nursing-info-session.md');
    expect(event).toContain('unpublishRedirect: /nursing/\n');
    expect(event).toContain(
      '[clinical placements](/nursing/clinical-placements/) and the [RN to BSN bridge](/nursing/rn-to-bsn/)',
    );
    // The section's own relative link still points inside it, so its file moves unchanged.
    expect(await text(`${P}nursing/index.md`)).toContain('[RN to BSN bridge](rn-to-bsn/)');

    const tree = await pages.tree('pages');
    expect(tree.nodes.map((n) => n.slug)).toEqual([
      '',
      'about',
      'academics',
      'admissions',
      'campus-life',
      'nursing',
    ]);
  });

  it('changes only the addresses in each file, byte for byte', async () => {
    const { storage, pages, text } = await setup();
    const before = await text(`${P}admissions/apply.md`);
    await pages.move({ collection: 'pages', path: 'academics/nursing', parent: '' });
    expect(await text(`${P}admissions/apply.md`)).toBe(
      before?.replace('/academics/nursing/clinical-placements/', '/nursing/clinical-placements/'),
    );
    expect(storage.commits).toHaveLength(1);
  });

  it('describes the move first without writing anything', async () => {
    const { storage, pages } = await setup();
    const plan = await pages.planMove({
      collection: 'pages',
      path: 'academics/nursing',
      parent: '',
    });
    expect(plan).toMatchObject({ ok: true, pages: 4, links: 8, redirects: 4 });
    expect(storage.commits).toHaveLength(0);
  });

  it('converts a page with no folder into a section to hold the moved page', async () => {
    const { pages, text, storage } = await setup();
    const result = await pages.move({
      collection: 'pages',
      path: 'academics/business',
      parent: 'academics/general-studies',
    });
    expect(result).toMatchObject({
      ok: true,
      path: 'academics/general-studies/business',
      pages: 2,
    });
    const paths = (storage.commits[0]?.changes ?? []).map((c) => (c.op === 'move' ? c.to : c.path));
    expect(paths).toContain(`${P}academics/general-studies/index.md`);
    expect(paths).toContain(`${P}academics/general-studies/business/index.md`);
    expect(await text(`${P}academics/general-studies.md`)).toBeNull();
  });

  it('renames a page in place, keeping its spot in the order', async () => {
    const { pages, text } = await setup();
    const result = await pages.move({
      collection: 'pages',
      path: 'academics/business',
      parent: 'academics',
      slug: 'business-programs',
    });
    expect(result).toMatchObject({ ok: true, position: { index: 2, of: 3 } });
    expect(await text(`${P}academics/_order.yaml`)).toBe(
      '- nursing\n- business-programs\n- general-studies\n',
    );
    expect(await text(`${P}academics/business-programs/accounting.md`)).not.toBeNull();
  });
});

describe('PageService.move: refused in plain language, with nothing written', () => {
  const cases: [string, Parameters<PageService['move']>[0], string][] = [
    [
      'a static route in src/pages',
      { collection: 'pages', path: 'about', parent: '', slug: 'contact' },
      '/contact/ is already a page on this site that isn’t edited here (src/pages/contact.astro). Choose a different address.',
    ],
    [
      'the studio’s own address',
      { collection: 'pages', path: 'about', parent: '', slug: 'admin' },
      '/admin/ belongs to the studio, so no page can use it. Choose a different address.',
    ],
    [
      'another page',
      { collection: 'pages', path: 'academics/general-studies', parent: '', slug: 'about' },
      'There’s already a page at /about/ (“About the college”). Choose a different address.',
    ],
    [
      'a bad address',
      { collection: 'pages', path: 'about', parent: '', slug: 'About Us' },
      'Use lower-case letters, numbers and single dashes for the address, like “nursing-programs”.',
    ],
    [
      'itself',
      { collection: 'pages', path: 'academics', parent: 'academics/nursing' },
      '“Academics” can’t be moved inside itself.',
    ],
    [
      'the home page',
      { collection: 'pages', path: '', parent: 'academics' },
      'The home page can’t be moved.',
    ],
  ];
  for (const [what, request, message] of cases) {
    it(`refuses ${what}`, async () => {
      const { pages, storage } = await setup();
      expect(await pages.move(request)).toEqual({ ok: false, reason: 'invalid', message });
      expect(storage.commits).toHaveLength(0);
    });
  }

  it('refuses a move past maxDepth', async () => {
    const { pages, storage } = await setup({ maxDepth: 4 });
    expect(
      await pages.move({
        collection: 'pages',
        path: 'academics/business',
        parent: 'academics/nursing/clinical-placements',
      }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
      message:
        'Pages can be at most 4 levels deep here, and this move would put “Accounting” 5 levels deep.',
    });
    expect(storage.commits).toHaveLength(0);
  });

  it('refuses a page that moved since the outline was loaded', async () => {
    const { pages } = await setup();
    expect(await pages.move({ collection: 'pages', path: 'gone', parent: '' })).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
  });
});

describe('PageService.reorder', () => {
  it('rewrites the folder’s _order.yaml and reports the new position', async () => {
    const { pages, text } = await setup();
    expect(
      await pages.reorder({ collection: 'pages', path: 'academics/business', direction: 'up' }),
    ).toEqual({ ok: true, position: { index: 1, of: 3 } });
    expect(await text(`${P}academics/_order.yaml`)).toBe(
      '- business\n- nursing\n- general-studies\n',
    );
  });

  it('puts a page at a given position (a drag and drop)', async () => {
    const { pages, text } = await setup();
    expect(await pages.reorder({ collection: 'pages', path: 'about', index: 2 })).toEqual({
      ok: true,
      position: { index: 3, of: 4 },
    });
    expect(await text(`${P}_order.yaml`)).toBe(
      '# Top-level page order (spec §6.15.3). Unlisted pages sort by title after these.\n- academics\n- admissions\n- about\n- campus-life\n',
    );
  });

  it('keeps the top-level file’s comment', async () => {
    const { pages, text } = await setup();
    await pages.reorder({ collection: 'pages', path: 'campus-life', direction: 'up' });
    expect(await text(`${P}_order.yaml`)).toBe(
      '# Top-level page order (spec §6.15.3). Unlisted pages sort by title after these.\n- about\n- academics\n- campus-life\n- admissions\n',
    );
  });

  it('creates an _order.yaml for a folder that had none', async () => {
    const { pages, text } = await setup();
    expect(
      await pages.reorder({ collection: 'pages', path: 'admissions/tuition', direction: 'up' }),
    ).toEqual({ ok: true, position: { index: 1, of: 2 } });
    expect(await text(`${P}admissions/_order.yaml`)).toBe('- tuition\n- apply\n');
  });

  it('says when a page is already at the end', async () => {
    const { pages } = await setup();
    expect(await pages.reorder({ collection: 'pages', path: 'about', direction: 'up' })).toEqual({
      ok: false,
      reason: 'invalid',
      message: '“About the college” is already first.',
    });
  });
});

describe('new pages and deletes in a tree', () => {
  it('adds a child page under a page with no folder, in one change set', async () => {
    const { content, storage, text } = await setup();
    const result = await content.saveEntry({
      collection: 'pages',
      id: '',
      version: null,
      parent: 'academics/general-studies',
      data: { title: 'Transfer agreements' },
    });
    expect(result).toMatchObject({
      ok: true,
      id: 'academics/general-studies/transfer-agreements',
      path: `${P}academics/general-studies/transfer-agreements.md`,
    });
    expect(storage.commits).toHaveLength(1);
    expect(await text(`${P}academics/general-studies/index.md`)).toContain(
      'title: General studies',
    );
  });

  it('adds a child to a section with an _order.yaml at the end of its order', async () => {
    const { content, text } = await setup();
    await content.saveEntry({
      collection: 'pages',
      id: '',
      version: null,
      parent: 'academics',
      data: { title: 'Welding' },
    });
    expect(await text(`${P}academics/_order.yaml`)).toBe(
      '- nursing\n- business\n- general-studies\n- welding\n',
    );
  });

  it('refuses a new page whose address a static route owns', async () => {
    const { content, storage } = await setup();
    expect(
      await content.saveEntry({
        collection: 'pages',
        id: '',
        version: null,
        data: { title: 'Contact' },
      }),
    ).toEqual({
      ok: false,
      reason: 'error',
      message:
        '/contact/ is already a page on this site that isn’t edited here (src/pages/contact.astro). Choose a different address.',
    });
    expect(storage.commits).toHaveLength(0);
  });

  it('creates a missing section page', async () => {
    const { pages, text } = await setup();
    expect(await pages.createSection('pages', 'admissions')).toMatchObject({
      ok: true,
      id: 'admissions',
    });
    expect(await text(`${P}admissions/index.md`)).toBe('---\ntitle: Admissions\n---\n\n');
  });

  it('removes a deleted page’s line from _order.yaml in the same change set', async () => {
    const { content, storage, text } = await setup();
    const entry = await content.readEntry('pages', 'academics/nursing/rn-to-bsn');
    const result = await content.deleteEntry(
      'pages',
      'academics/nursing/rn-to-bsn',
      entry?.version ?? '',
    );
    expect(result.ok).toBe(true);
    expect(storage.commits).toHaveLength(1);
    expect(storage.commits[0]?.changes.map((c) => c.op)).toEqual(['delete', 'put']);
    expect(await text(`${P}academics/nursing/_order.yaml`)).toBe('- clinical-placements\n');
  });
});

describe('redirects', () => {
  it('reads the file with the build’s warnings', async () => {
    const { pages } = await setup();
    const doc = await pages.redirects();
    expect(doc.version).not.toBeNull();
    expect(doc.redirects).toHaveLength(3);
    expect(doc.redirects[0]).toEqual({
      from: '/programs/nursing',
      to: '/academics/nursing-old',
      status: 301,
      reason: 'move',
      at: { $date: '2026-09-02T00:00:00.000Z' },
    });
    expect(doc.warnings).toEqual([]);
  });

  it('saves a new list cleaned, keeping untouched lines byte for byte', async () => {
    const { pages, text } = await setup();
    const doc = await pages.redirects();
    const result = await pages.saveRedirects({
      version: doc.version,
      redirects: [
        ...doc.redirects,
        {
          from: '/visit',
          to: '/campus-life',
          status: 302,
          reason: 'manual',
          at: { $date: '2026-10-18T00:00:00.000Z' },
        },
        { from: '/about', to: '/academics', status: 301 },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    expect(await text('vesper.redirects.yaml')).toBe(
      [
        '# Redirects for the playground (spec §6.15.5). The build cleans them and hands',
        '# them to Astro. The first two entries form a chain on purpose, which the build',
        '# collapses: /programs/nursing → /academics/nursing-old → /academics/nursing.',
        '- { from: /programs/nursing, to: /academics/nursing, status: 301, reason: move, at: 2026-09-02 }',
        '- { from: /academics/nursing-old, to: /academics/nursing, status: 301, reason: move, at: 2026-10-01 }',
        '- { from: /apply-now, to: /admissions/apply, status: 302, reason: manual, at: 2026-10-01 }',
        '- { from: /visit, to: /campus-life, status: 302, reason: manual, at: 2026-10-18 }',
        '',
      ].join('\n'),
    );
    if (result.ok) {
      expect(result.warnings.map((w) => w.kind)).toEqual([]);
    }
  });

  it('refuses a stale save and the studio’s own addresses', async () => {
    const { pages } = await setup();
    expect(await pages.saveRedirects({ version: 'old', redirects: [] })).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
    const doc = await pages.redirects();
    expect(
      await pages.saveRedirects({ version: doc.version, redirects: [{ from: '/admin', to: '/' }] }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
      message: '/admin belongs to the studio, so it can’t be redirected.',
    });
  });

  it('starts a new file one redirect per line', async () => {
    const { pages, storage, text } = await setup();
    await storage.commit({
      changes: [{ op: 'delete', path: 'vesper.redirects.yaml' }],
      message: { summary: 'x' },
    });
    await pages.saveRedirects({
      version: null,
      redirects: [{ from: '/a', to: '/about', status: 301 }],
    });
    expect(await text('vesper.redirects.yaml')).toBe(
      '# Redirects for this site (spec §6.15.5). Moves in the studio add to it; the Redirects screen edits it.\n- { from: /a, to: /about, status: 301 }\n',
    );
  });

  it('keeps vercel.json’s redirects in step, leaving its other settings alone', async () => {
    const { pages, text } = await setup({
      extra: {
        'vercel.json':
          '{\n  "cleanUrls": false,\n  "redirects": [\n    { "source": "/own", "destination": "/about/", "permanent": true }\n  ]\n}\n',
      },
    });
    const doc = await pages.redirects();
    await pages.saveRedirects({
      version: doc.version,
      redirects: doc.redirects.filter((r) => (r as { from: string }).from !== '/apply-now'),
    });
    const vercel = JSON.parse((await text('vercel.json')) ?? '{}') as {
      cleanUrls: boolean;
      redirects: { source: string; destination: string }[];
    };
    expect(vercel.cleanUrls).toBe(false);
    expect(vercel.redirects.map((r) => `${r.source} → ${r.destination}`)).toEqual([
      '/own → /about/',
      '/programs/nursing → /academics/nursing/',
      '/programs/nursing/ → /academics/nursing/',
      '/academics/nursing-old → /academics/nursing/',
      '/academics/nursing-old/ → /academics/nursing/',
    ]);
  });
});
