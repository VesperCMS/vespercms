import { describe, expect, it } from 'vitest';
import type { CollectionManifest, Manifest } from '../manifest/types.ts';
import { MemoryStorage } from '../storage/memory.ts';
import { decodeData, encodeValue, type FieldIssue } from './protocol.ts';
import { ContentService, expandNewEntryPath, slugify } from './service.ts';

const blog: CollectionManifest = {
  name: 'blog',
  label: 'Blog posts',
  editable: true,
  source: {
    loader: 'glob',
    base: 'src/content/blog',
    pattern: '**/[^_]*.md',
    generateId: 'default',
    formats: ['md'],
  },
  entryKind: 'content',
  fields: [{ path: ['title'], kind: 'string', required: true, label: 'Title' }],
  presentation: { listFields: ['title', 'publishedAt'] },
};

const authors: CollectionManifest = {
  name: 'authors',
  label: 'People',
  editable: true,
  source: { loader: 'file', path: 'src/data/authors.json', format: 'json', customParser: false },
  entryKind: 'data',
  fields: [{ path: ['name'], kind: 'string', required: true, label: 'Name' }],
  presentation: {},
};

const settings: CollectionManifest = {
  name: 'settings',
  label: 'Site settings',
  editable: true,
  source: {
    loader: 'glob',
    base: 'src/content/settings',
    pattern: '*.yaml',
    generateId: 'default',
    formats: ['yaml'],
  },
  entryKind: 'data',
  fields: null,
  presentation: { singleton: true },
};

const external: CollectionManifest = {
  name: 'external',
  label: 'Products',
  editable: false,
  readOnlyReason: 'custom-loader',
  source: { loader: 'other', name: 'shop' },
  entryKind: 'data',
  fields: null,
  presentation: {},
};

const manifest: Manifest = {
  manifestVersion: 1,
  generator: { name: 'test', version: '0' },
  hash: 'x',
  site: { srcDir: 'src' },
  collections: [blog, authors, settings, external],
  forms: [],
  diagnostics: [],
};

const HARBOR =
  '---\r\ntitle: Harbor at dawn\r\npublishedAt: 2026-10-01\r\ntags: [boats]\r\n---\r\n\r\nFog.\r\n';

async function setup(files: Record<string, string> = {}) {
  const storage = await MemoryStorage.create({
    'src/content/blog/harbor-at-dawn.md': HARBOR,
    'src/content/blog/2026/winter-market/index.md':
      '---\ntitle: Winter market\ndraft: true\n---\nStalls.\n',
    'src/content/blog/_unpublished.md': '---\ntitle: Hidden\n---\n',
    'src/content/blog/odd.md': '---\ntitle: Odd\nslug: custom-slug\n---\n',
    'src/data/authors.json':
      '[\n  { "id": "ana", "name": "Ana" },\n  { "id": "ben", "name": "Ben" }\n]\n',
    'src/content/settings/site.yaml': 'title: Playground # the site name\nsocial: []\n',
    ...files,
  });
  const service = new ContentService(storage, manifest, {
    now: () => new Date('2026-10-17T12:00:00Z'),
    validate: (_collection, data) =>
      Promise.resolve(
        typeof data.title === 'string' && data.title === ''
          ? [{ path: ['title'], message: 'This can’t be empty.' }]
          : [],
      ),
  });
  return { storage, service };
}

describe('ContentService: reading', () => {
  it('lists glob entries with Astro’s IDs, titles, list fields and drafts', async () => {
    const { service } = await setup();
    const entries = await service.listEntries('blog');
    expect(entries.map((e) => [e.id, e.title, e.draft ?? false])).toEqual([
      ['2026/winter-market', 'Winter market', true],
      ['harbor-at-dawn', 'Harbor at dawn', false],
      ['custom-slug', 'Odd', false],
    ]);
    expect(entries[1]?.fields).toEqual({
      title: 'Harbor at dawn',
      publishedAt: { $date: '2026-10-01T00:00:00.000Z' },
    });
  });

  it('lists file() entries by id', async () => {
    const { service } = await setup();
    const entries = await service.listEntries('authors');
    expect(entries.map((e) => [e.id, e.title, e.path])).toEqual([
      ['ana', 'Ana', 'src/data/authors.json'],
      ['ben', 'Ben', 'src/data/authors.json'],
    ]);
  });

  it('counts entries per collection', async () => {
    const { service } = await setup();
    expect(await service.summary()).toEqual([
      { collection: 'blog', count: 3 },
      { collection: 'authors', count: 2 },
      { collection: 'settings', count: 1 },
      { collection: 'external', count: 0 },
    ]);
  });

  it('reads an entry with its version, body and encoded dates', async () => {
    const { service } = await setup();
    const doc = await service.readEntry('blog', 'harbor-at-dawn');
    expect(doc).toMatchObject({
      id: 'harbor-at-dawn',
      path: 'src/content/blog/harbor-at-dawn.md',
      format: 'md',
      status: 'editable',
      body: '\r\n\r\nFog.\r\n',
    });
    expect(decodeData(doc?.data).publishedAt).toBeInstanceOf(Date);
    expect(doc?.version).toMatch(/^[0-9a-f]{40}$/);
    // Nested index and slug IDs resolve too.
    expect((await service.readEntry('blog', '2026/winter-market'))?.path).toBe(
      'src/content/blog/2026/winter-market/index.md',
    );
    expect((await service.readEntry('blog', 'custom-slug'))?.path).toBe('src/content/blog/odd.md');
    expect(await service.readEntry('blog', 'unpublished')).toBeNull();
  });

  it('marks frontmatter it can’t edit safely as source-only, with the raw text', async () => {
    const { service } = await setup({
      // Frontmatter must be a mapping, so a list can only be edited as YAML text.
      'src/content/blog/anchors.md': '---\n- not\n- a map\n---\nBody\n',
    });
    const doc = await service.readEntry('blog', 'anchors');
    expect(doc?.status).toBe('source-only');
    expect(doc?.rawFrontmatter).toBe('\n- not\n- a map\n');
    expect(doc?.message).toBeTruthy();
  });
});

describe('ContentService: saving', () => {
  it('splices a field edit into the file and keeps everything else byte for byte', async () => {
    const { service, storage } = await setup();
    const doc = await service.readEntry('blog', 'harbor-at-dawn');
    const data = { ...decodeData(doc?.data), title: 'Harbor at first light' };
    const result = await service.saveEntry({
      collection: 'blog',
      id: 'harbor-at-dawn',
      version: doc?.version ?? '',
      data: JSON.parse(
        JSON.stringify({ ...data, publishedAt: { $date: '2026-10-01T00:00:00.000Z' } }),
      ),
    });
    expect(result).toMatchObject({ ok: true, id: 'harbor-at-dawn', reformatted: false });
    const saved = new TextDecoder().decode(
      (await storage.read('src/content/blog/harbor-at-dawn.md'))?.bytes,
    );
    expect(saved).toBe(HARBOR.replace('Harbor at dawn', 'Harbor at first light'));
    expect(result.ok && result.version).toBe(
      (await service.readEntry('blog', 'harbor-at-dawn'))?.version,
    );
  });

  it('does not write when nothing changed', async () => {
    const { service, storage } = await setup();
    const doc = await service.readEntry('blog', 'harbor-at-dawn');
    const result = await service.saveEntry({
      collection: 'blog',
      id: 'harbor-at-dawn',
      version: doc?.version ?? '',
      data: doc?.data,
      body: doc?.body,
    });
    expect(result).toMatchObject({ ok: true, version: doc?.version });
    expect(storage.commits).toHaveLength(0);
  });

  it('refuses a save based on an old version', async () => {
    const { service } = await setup();
    const result = await service.saveEntry({
      collection: 'blog',
      id: 'harbor-at-dawn',
      version: 'old',
      body: 'x',
    });
    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('returns validation issues and writes nothing', async () => {
    const { service, storage } = await setup();
    const doc = await service.readEntry('blog', 'harbor-at-dawn');
    const result = await service.saveEntry({
      collection: 'blog',
      id: 'harbor-at-dawn',
      version: doc?.version ?? '',
      data: { title: '' },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      issues: [{ path: ['title'], message: 'This can’t be empty.' }],
    });
    expect(storage.commits).toHaveLength(0);
  });

  it('refuses a body the site couldn’t be built with, and saves one with warnings only', async () => {
    const storage = await MemoryStorage.create({ 'src/content/blog/harbor-at-dawn.md': HARBOR });
    const seen: unknown[] = [];
    const service = new ContentService(storage, manifest, {
      validateBody: (input) => {
        seen.push(input);
        return Promise.resolve(
          input.body.includes('broken')
            ? [{ line: 2, level: 'error', code: 'x', message: 'Video: Title is required.' }]
            : [{ line: 2, level: 'warning', code: 'y', message: 'Just so you know.' }],
        );
      },
    });
    const doc = await service.readEntry('blog', 'harbor-at-dawn');
    const request = { collection: 'blog', id: 'harbor-at-dawn', version: doc?.version ?? '' };
    expect(await service.saveEntry({ ...request, body: '\r\n\r\nbroken\r\n' })).toEqual({
      ok: false,
      reason: 'invalid',
      issues: [],
      bodyIssues: [{ line: 2, level: 'error', code: 'x', message: 'Video: Title is required.' }],
    });
    expect(storage.commits).toHaveLength(0);
    expect(seen[0]).toEqual({
      collection: 'blog',
      format: 'md',
      body: '\r\n\r\nbroken\r\n',
      path: 'src/content/blog/harbor-at-dawn.md',
    });
    expect(await service.saveEntry({ ...request, body: '\r\n\r\nFine.\r\n' })).toMatchObject({
      ok: true,
    });
  });

  it('lists the files a Markdoc partial can point at', async () => {
    const { service } = await setup({
      'src/content/docs/_support.mdoc': 'Hours.\n',
      'src/content/docs/guide.mdoc': 'Guide.\n',
      'public/notes.md': 'Not in src.\n',
    });
    expect(await service.listPartials()).toEqual([
      'src/content/blog/2026/winter-market/index.md',
      'src/content/blog/_unpublished.md',
      'src/content/blog/harbor-at-dawn.md',
      'src/content/blog/odd.md',
      'src/content/docs/_support.mdoc',
      'src/content/docs/guide.mdoc',
    ]);
  });

  it('edits one file() entry without conflicting with edits to another', async () => {
    const { service, storage } = await setup();
    const ana = await service.readEntry('authors', 'ana');
    const ben = await service.readEntry('authors', 'ben');
    const first = await service.saveEntry({
      collection: 'authors',
      id: 'ben',
      version: ben?.version ?? '',
      data: { id: 'ben', name: 'Benjamin' },
    });
    expect(first.ok).toBe(true);
    // Ana's version is per entry, so Ben's save doesn't make it stale.
    const second = await service.saveEntry({
      collection: 'authors',
      id: 'ana',
      version: ana?.version ?? '',
      data: { id: 'ana', name: 'Ana María' },
    });
    expect(second.ok).toBe(true);
    expect(new TextDecoder().decode((await storage.read('src/data/authors.json'))?.bytes)).toBe(
      '[\n  { "id": "ana", "name": "Ana María" },\n  { "id": "ben", "name": "Benjamin" }\n]\n',
    );
  });

  it('keeps comments in YAML data files', async () => {
    const { service, storage } = await setup();
    const doc = await service.readEntry('settings', 'site');
    await service.saveEntry({
      collection: 'settings',
      id: 'site',
      version: doc?.version ?? '',
      data: { title: 'Vesper playground', social: [] },
    });
    expect(
      new TextDecoder().decode((await storage.read('src/content/settings/site.yaml'))?.bytes),
    ).toBe('title: Vesper playground # the site name\nsocial: []\n');
  });

  it('saves raw frontmatter for a source-only entry, after validating it', async () => {
    const { service, storage } = await setup({
      'src/content/blog/anchors.md': '---\n- not\n- a map\n---\nBody\n',
    });
    const doc = await service.readEntry('blog', 'anchors');
    const invalid = await service.saveEntry({
      collection: 'blog',
      id: 'anchors',
      version: doc?.version ?? '',
      rawFrontmatter: '\ntitle: ""\n',
    });
    expect(invalid).toMatchObject({ ok: false, reason: 'invalid' });
    const saved = await service.saveEntry({
      collection: 'blog',
      id: 'anchors',
      version: doc?.version ?? '',
      rawFrontmatter: '\ntitle: Anchors\n',
    });
    expect(saved.ok).toBe(true);
    expect(
      new TextDecoder().decode((await storage.read('src/content/blog/anchors.md'))?.bytes),
    ).toBe('---\ntitle: Anchors\n---\nBody\n');
  });

  it('refuses to save into a read-only collection', async () => {
    const { service } = await setup();
    const result = await service.saveEntry({
      collection: 'external',
      id: 'x',
      version: 'v',
      data: {},
    });
    expect(result).toMatchObject({ ok: false, reason: 'error' });
    expect(!result.ok && 'message' in result && result.message).toMatch(/custom loader/);
  });
});

describe('ContentService: creating and deleting', () => {
  it('creates a Markdown entry from its title, at newEntryPath', async () => {
    const { service, storage } = await setup();
    const result = await service.saveEntry({
      collection: 'blog',
      id: '',
      version: null,
      data: { title: 'Notes from the Field!' },
      body: 'First line.\n',
    });
    expect(result).toMatchObject({
      ok: true,
      id: 'notes-from-the-field',
      path: 'src/content/blog/notes-from-the-field.md',
    });
    expect(
      new TextDecoder().decode(
        (await storage.read('src/content/blog/notes-from-the-field.md'))?.bytes,
      ),
    ).toBe('---\ntitle: Notes from the Field!\n---\n\nFirst line.\n');
    const again = await service.saveEntry({
      collection: 'blog',
      id: '',
      version: null,
      data: { title: 'Notes from the field' },
    });
    expect(again).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('copies an entry from its own text: line endings, styles and body bytes kept', async () => {
    const { service, storage } = await setup();
    const original = await service.readEntry('blog', 'harbor-at-dawn');
    const result = await service.saveEntry({
      collection: 'blog',
      id: '',
      version: null,
      data: encodeValue({ ...decodeData(original?.data), title: 'Harbor at dawn (copy)' }),
      ...(original?.body !== undefined ? { body: original.body } : {}),
      copyOf: { id: 'harbor-at-dawn' },
    });
    expect(result).toMatchObject({
      ok: true,
      id: 'harbor-at-dawn-copy',
      path: 'src/content/blog/harbor-at-dawn-copy.md',
    });
    expect(
      new TextDecoder().decode(
        (await storage.read('src/content/blog/harbor-at-dawn-copy.md'))?.bytes,
      ),
    ).toBe(HARBOR.replace('title: Harbor at dawn\r\n', 'title: Harbor at dawn (copy)\r\n'));
  });

  it('copies an entry whose ID came from its slug, with the slug left out', async () => {
    const { service, storage } = await setup();
    const result = await service.saveEntry({
      collection: 'blog',
      id: '',
      version: null,
      data: { title: 'Odd (copy)' },
      body: '\n',
      copyOf: { id: 'custom-slug' },
    });
    expect(result).toMatchObject({ ok: true, id: 'odd-copy' });
    expect(
      new TextDecoder().decode((await storage.read('src/content/blog/odd-copy.md'))?.bytes),
    ).toBe('---\ntitle: Odd (copy)\n---\n');
  });

  it('points a copy in another folder at the same files, as a move would', async () => {
    const { service, storage } = await setup({
      'src/content/blog/2026/winter-market/index.md':
        '---\ntitle: Winter market\ncover: ./stalls.jpg\n---\n\n![Stalls at dusk](./stalls.jpg)\n',
    });
    const original = await service.readEntry('blog', '2026/winter-market');
    const result = await service.saveEntry({
      collection: 'blog',
      id: '',
      version: null,
      data: encodeValue({ ...decodeData(original?.data), title: 'Winter market (copy)' }),
      ...(original?.body !== undefined ? { body: original.body } : {}),
      copyOf: { id: '2026/winter-market' },
    });
    expect(result).toMatchObject({ ok: true, path: 'src/content/blog/winter-market-copy.md' });
    expect(
      new TextDecoder().decode(
        (await storage.read('src/content/blog/winter-market-copy.md'))?.bytes,
      ),
    ).toBe(
      '---\ntitle: Winter market (copy)\ncover: ./2026/winter-market/stalls.jpg\n---\n\n![Stalls at dusk](./2026/winter-market/stalls.jpg)\n',
    );
  });

  it('saves a copy whose original has gone as any new entry', async () => {
    const { service, storage } = await setup();
    const result = await service.saveEntry({
      collection: 'blog',
      id: '',
      version: null,
      data: { title: 'Gone (copy)' },
      body: 'Text.\n',
      copyOf: { id: 'gone' },
    });
    expect(result).toMatchObject({ ok: true, path: 'src/content/blog/gone-copy.md' });
    expect(
      new TextDecoder().decode((await storage.read('src/content/blog/gone-copy.md'))?.bytes),
    ).toBe('---\ntitle: Gone (copy)\n---\n\nText.\n');
  });

  it('appends a new file() entry with its id first', async () => {
    const { service, storage } = await setup();
    const result = await service.saveEntry({
      collection: 'authors',
      id: '',
      version: null,
      slug: 'cy',
      data: { name: 'Cy' },
    });
    expect(result).toMatchObject({ ok: true, id: 'cy' });
    expect(
      new TextDecoder().decode((await storage.read('src/data/authors.json'))?.bytes),
    ).toContain('{ "id": "cy", "name": "Cy" }');
  });

  it('deletes glob entries and file() entries', async () => {
    const { service, storage } = await setup();
    const post = await service.readEntry('blog', 'harbor-at-dawn');
    expect(await service.deleteEntry('blog', 'harbor-at-dawn', post?.version ?? '')).toMatchObject({
      ok: true,
    });
    expect(await storage.read('src/content/blog/harbor-at-dawn.md')).toBeNull();

    const ben = await service.readEntry('authors', 'ben');
    expect(await service.deleteEntry('authors', 'ben', ben?.version ?? '')).toMatchObject({
      ok: true,
    });
    expect((await service.listEntries('authors')).map((e) => e.id)).toEqual(['ana']);
    expect(await service.deleteEntry('authors', 'ana', 'stale')).toMatchObject({
      reason: 'conflict',
    });
  });
});

describe('ContentService: schedules', () => {
  const events: CollectionManifest = {
    ...blog,
    name: 'events',
    label: 'Events',
    source: { ...blog.source, base: 'src/content/events' } as CollectionManifest['source'],
    presentation: {
      schedule: {
        unpublish: true,
        publishAt: 'publishAt',
        unpublishAt: 'unpublishAt',
        unpublishRedirect: 'unpublishRedirect',
      },
    },
  };
  const now = new Date('2026-10-26T16:00:00Z');
  async function scheduled() {
    const storage = await MemoryStorage.create({
      'src/content/events/concert.md':
        '---\ntitle: Harvest concert\npublishAt: 2026-10-31T08:00:00-04:00\n---\n',
      'src/content/events/lecture.md':
        '---\ntitle: Lecture\nunpublishAt: 2026-11-13T00:00:00-05:00\n---\n',
      'src/content/events/open-house.md':
        '---\ntitle: Open house\nunpublishAt: 2026-10-25T00:00:00-04:00\n---\n',
      'src/content/events/commencement.md': '---\ntitle: Commencement\n---\n',
    });
    return new ContentService(storage, { ...manifest, collections: [blog, events] });
  }

  it('gives each row of a scheduled collection its times', async () => {
    const rows = await (await scheduled()).listEntries('events');
    expect(Object.fromEntries(rows.map((r) => [r.id, r.schedule]))).toEqual({
      commencement: undefined,
      concert: { publishAt: '2026-10-31T12:00:00.000Z' },
      lecture: { unpublishAt: '2026-11-13T05:00:00.000Z' },
      'open-house': { unpublishAt: '2026-10-25T04:00:00.000Z' },
    });
  });

  it('lists the changes still to come, soonest first, with titles', async () => {
    expect(await (await scheduled()).scheduledChanges(now)).toEqual([
      {
        at: '2026-10-31T12:00:00.000Z',
        change: 'publish',
        collection: 'events',
        id: 'concert',
        path: 'src/content/events/concert.md',
        title: 'Harvest concert',
      },
      {
        at: '2026-11-13T05:00:00.000Z',
        change: 'unpublish',
        collection: 'events',
        id: 'lecture',
        path: 'src/content/events/lecture.md',
        title: 'Lecture',
      },
    ]);
  });
});

describe('helpers', () => {
  it('slugify keeps nesting and drops punctuation and accents', () => {
    expect(slugify('Crème Brûlée: A How-To')).toBe('creme-brulee-a-how-to');
    expect(slugify('2026/Winter Market')).toBe('2026/winter-market');
    expect(slugify('  ')).toBe('');
  });

  it('expandNewEntryPath fills date tokens', () => {
    const now = new Date(2026, 9, 7);
    expect(expandNewEntryPath(':year/:month/:slug', 'hi', now)).toBe('2026/10/hi');
    expect(expandNewEntryPath(undefined, 'hi', now)).toBe('hi');
  });
});

describe('ContentService: putting a flat collection in order', () => {
  const services: CollectionManifest = {
    name: 'services',
    label: 'Services',
    editable: true,
    source: {
      loader: 'glob',
      base: 'src/content/services',
      pattern: '*.yaml',
      generateId: 'default',
      formats: ['yaml'],
    },
    entryKind: 'data',
    fields: [
      { path: ['title'], kind: 'string', required: true, label: 'Title' },
      { path: ['order'], kind: 'number', required: false, label: 'Order' },
    ],
    presentation: { orderBy: 'order' },
  };
  const docs: CollectionManifest = {
    ...blog,
    name: 'docs',
    label: 'Docs',
    source: { ...blog.source, base: 'src/content/docs' } as CollectionManifest['source'],
    presentation: { orderBy: 'order' },
  };
  const people: CollectionManifest = { ...authors, presentation: { orderBy: 'order' } };

  async function ordered(validate?: (data: Record<string, unknown>) => FieldIssue[]) {
    const storage = await MemoryStorage.create({
      'src/content/services/design.yaml': 'title: Design\norder: 0 # always first\n',
      'src/content/services/wordpress.yaml': 'title: WordPress\norder: 10\n',
      'src/content/services/cannabis.yaml': '# The 420 page\ntitle: 420-friendly\norder: 420\n',
      'src/content/docs/start.md': '---\ntitle: Start\norder: 1\n---\nHello.\n',
      'src/content/docs/callouts.md': '---\ntitle: Callouts\norder: 2\n---\n',
      'src/content/docs/conditional.md': '---\ntitle: Conditional\norder: 3\n---\n',
      'src/content/docs/hours.md': '---\ntitle: Hours\norder: 3\n---\nOpen.\n',
      'src/data/authors.json':
        '[\n  { "id": "ana", "name": "Ana", "order": 1 },\n  { "id": "ben", "name": "Ben" }\n]\n',
    });
    const service = new ContentService(
      storage,
      { ...manifest, collections: [services, docs, people] },
      { validate: (_collection, data) => Promise.resolve(validate?.(data) ?? []) },
    );
    return { storage, service };
  }
  const text = async (storage: MemoryStorage, path: string) =>
    new TextDecoder().decode((await storage.read(path))?.bytes);

  it('writes only the moved entry’s number, spliced into its file', async () => {
    const { storage, service } = await ordered();
    const result = await service.reorderEntry({
      collection: 'services',
      id: 'cannabis',
      after: 'design',
    });
    expect(result).toEqual({ ok: true, position: { index: 2, of: 3 }, changed: ['cannabis'] });
    expect(await text(storage, 'src/content/services/cannabis.yaml')).toBe(
      '# The 420 page\ntitle: 420-friendly\norder: 5\n',
    );
    expect(storage.commits).toHaveLength(1);
    expect(storage.commits[0]?.changes.map((c) => ('path' in c ? c.path : c.to))).toEqual([
      'src/content/services/cannabis.yaml',
    ]);
    expect(storage.commits[0]?.message.summary).toBe(
      'Move “420-friendly” to a new place in Services',
    );
  });

  it('moves the entries below up one, in one change set, when there’s no room', async () => {
    const { storage, service } = await ordered();
    expect(
      await service.reorderEntry({ collection: 'docs', id: 'hours', after: 'callouts' }),
    ).toEqual({ ok: true, position: { index: 3, of: 4 }, changed: ['hours', 'conditional'] });
    expect(storage.commits).toHaveLength(1);
    expect(await text(storage, 'src/content/docs/hours.md')).toBe(
      '---\ntitle: Hours\norder: 3\n---\nOpen.\n',
    );
    expect(await text(storage, 'src/content/docs/conditional.md')).toBe(
      '---\ntitle: Conditional\norder: 4\n---\n',
    );
    const list = await service.listEntries('docs');
    expect(list.map((entry) => entry.id).sort()).toHaveLength(4);
  });

  it('adds the number to an entry that had none, in a shared file', async () => {
    const { storage, service } = await ordered();
    const result = await service.reorderEntry({ collection: 'authors', id: 'ana', after: 'ben' });
    expect(result.ok).toBe(true);
    const saved = JSON.parse(await text(storage, 'src/data/authors.json')) as {
      id: string;
      order?: number;
    }[];
    expect(saved.map((p) => [p.id, p.order])).toEqual([
      ['ana', 1],
      ['ben', 0],
    ]);
    expect(storage.commits).toHaveLength(1);
  });

  it('writes nothing when the entry is already there', async () => {
    const { storage, service } = await ordered();
    expect(
      await service.reorderEntry({ collection: 'services', id: 'design', after: null }),
    ).toEqual({ ok: true, position: { index: 1, of: 3 }, changed: [] });
    expect(storage.commits).toHaveLength(0);
  });

  it('refuses a number the schema won’t take, and an out-of-date list', async () => {
    const { storage, service } = await ordered((data) =>
      typeof data.order === 'number' && data.order > 100
        ? [{ path: ['order'], message: 'Too big.' }]
        : [],
    );
    expect(
      await service.reorderEntry({ collection: 'services', id: 'design', after: 'cannabis' }),
    ).toEqual({
      ok: false,
      reason: 'error',
      message: '“Design” can’t take 430 as its order, so the order wasn’t changed: Too big.',
    });
    expect(
      await service.reorderEntry({ collection: 'services', id: 'design', after: 'gone' }),
    ).toMatchObject({ ok: false, reason: 'conflict' });
    const unordered = new ContentService(storage, {
      ...manifest,
      collections: [{ ...services, label: 'Services', presentation: {} }],
    });
    expect(
      await unordered.reorderEntry({ collection: 'services', id: 'design', after: null }),
    ).toEqual({
      ok: false,
      reason: 'error',
      message: 'Services isn’t put in order by a field.',
    });
    expect(storage.commits).toHaveLength(0);
  });
});
