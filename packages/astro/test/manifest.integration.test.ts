import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultEntryId,
  globMatcher,
  type CollectionManifest,
  type FieldModel,
  type Manifest,
} from '@vesper/core';
import { parse as parseDevalue } from 'devalue';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateManifest } from '../src/node/manifest.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const playground = join(repo, 'apps', 'playground');
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

const collection = (manifest: Manifest, name: string) => {
  const found = manifest.collections.find((c) => c.name === name);
  if (!found) throw new Error(`no collection ${name}`);
  return found;
};
const field = (c: CollectionManifest, ...path: string[]): FieldModel => {
  let list = c.fields ?? [];
  let found: FieldModel | undefined;
  for (const key of path) {
    found = list.find((f) => f.path.at(-1) === key);
    list = found?.children ?? [];
  }
  if (!found) throw new Error(`no field ${path.join('.')}`);
  return found;
};

describe('playground manifest (Phase 1: every collection produces a correct manifest)', () => {
  let manifest: Manifest;
  beforeAll(async () => {
    manifest = await generateManifest({ root: playground });
  });

  it('matches the committed snapshot', async () => {
    const { generator: _generator, ...stable } = manifest;
    await expect(`${JSON.stringify(stable, null, 2)}\n`).toMatchFileSnapshot(
      '__snapshots__/playground.manifest.json',
    );
  });

  it('is identical across runs', async () => {
    const again = await generateManifest({ root: playground });
    expect(JSON.stringify(again)).toBe(JSON.stringify(manifest));
  });

  it('has no diagnostics', () => {
    expect(manifest.diagnostics).toEqual([]);
  });

  it('lists every collection as editable, with the right source and kind', () => {
    expect(
      manifest.collections.map((c) => [c.name, c.editable, c.entryKind, c.source.loader]),
    ).toEqual([
      ['blog', true, 'content', 'glob'],
      ['authors', true, 'data', 'file'],
      ['pages', true, 'content', 'glob'],
      ['docs', true, 'content', 'glob'],
      ['settings', true, 'data', 'glob'],
      ['locations', true, 'data', 'file'],
      ['events', true, 'content', 'glob'],
      ['fixtures', true, 'content', 'glob'],
    ]);
  });

  it('maps the blog schema per spec §6.2', () => {
    const blog = collection(manifest, 'blog');
    expect(field(blog, 'title')).toMatchObject({
      kind: 'string',
      label: 'Title',
      required: true,
      widget: 'text',
    });
    expect(field(blog, 'summary')).toMatchObject({
      widget: 'textarea',
      description: 'One or two sentences for cards and search.',
    });
    expect(field(blog, 'hero')).toMatchObject({
      kind: 'object',
      widget: 'image',
      required: false,
      widgetOptions: { ratios: ['wide', 'square'] },
    });
    expect(field(blog, 'hero', 'src')).toMatchObject({ kind: 'image' });
    expect(field(blog, 'author')).toMatchObject({
      kind: 'reference',
      reference: { collection: 'authors' },
      widget: 'reference',
    });
    expect(field(blog, 'related')).toMatchObject({ kind: 'array', widget: 'references' });
    expect(field(blog, 'tags')).toMatchObject({
      kind: 'array',
      widget: 'tags',
      default: [],
      required: false,
    });
    expect(field(blog, 'category')).toMatchObject({ kind: 'enum', widget: 'radio' });
    expect(field(blog, 'publishedAt')).toMatchObject({ kind: 'date', coerce: true });
    expect(field(blog, 'series')).toMatchObject({
      kind: 'unknown',
      unknownReason: 'union',
      widget: 'raw',
    });
  });

  it('maps the other collections’ notable fields', () => {
    expect(field(collection(manifest, 'authors'), 'email')).toMatchObject({
      format: 'email',
      widget: 'email',
      autocomplete: 'email',
    });
    expect(field(collection(manifest, 'locations'), 'geo')).toMatchObject({
      kind: 'object',
      widget: 'geo',
      label: 'Map location',
    });
    expect(field(collection(manifest, 'locations'), 'color')).toMatchObject({
      widget: 'color',
      constraints: { pattern: '^#[0-9a-f]{6}$', patternFlags: 'i' },
    });
    expect(field(collection(manifest, 'settings'), 'brandColor').widgetOptions).toEqual({
      palette: { Indigo: '#28335f', Pine: '#2f5d50', Brick: '#8a3b3b' },
    });
    expect(field(collection(manifest, 'pages'), 'sections')).toMatchObject({
      kind: 'array',
      widget: 'repeater',
    });
    expect(field(collection(manifest, 'pages'), 'sections', '[]', 'body')).toMatchObject({
      widget: 'markdown',
    });
    expect(field(collection(manifest, 'events'), 'publishAt')).toMatchObject({
      kind: 'date',
      widget: 'datetime',
      required: false,
    });
    expect(field(collection(manifest, 'events'), 'location')).toMatchObject({
      reference: { collection: 'locations' },
    });
  });

  it('includes the contact form', () => {
    const [contact] = manifest.forms;
    expect(contact?.name).toBe('contact');
    expect(contact?.options).toMatchObject({ confirmation: { emailField: 'email' } });
    expect(contact?.fields?.map((f) => [f.path[0], f.widget])).toEqual([
      ['name', 'text'],
      ['email', 'email'],
      ['department', 'radio'],
      ['message', 'textarea'],
      ['attachment', 'upload'],
    ]);
    expect(contact?.fields?.[0]).toMatchObject({ safeToEcho: true });
  });
});

describe('entry IDs and files match Astro’s own content layer', () => {
  type StoredEntry = { id: string; filePath?: string };
  let store: Map<string, Map<string, StoredEntry>>;
  let manifest: Manifest;

  beforeAll(async () => {
    const astro = createRequire(join(playground, 'package.json')).resolve('astro/package.json');
    execFileSync(process.execPath, [join(astro, '..', 'bin', 'astro.mjs'), 'sync'], {
      cwd: playground,
      stdio: 'pipe',
    });
    store = parseDevalue(
      readFileSync(join(playground, '.astro', 'data-store.json'), 'utf8'),
    ) as typeof store;
    manifest = await generateManifest({ root: playground });
  }, 120_000);

  function listFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
  }

  it('computes the same IDs and file paths for every glob() collection', () => {
    for (const c of manifest.collections) {
      const source = c.source;
      if (source.loader !== 'glob') continue;
      const base = join(playground, source.base);
      const matches = globMatcher(source.pattern);
      const ours = new Map(
        listFiles(base)
          .map((path) => relative(base, path).split('\\').join('/'))
          .filter(matches)
          .map((path) => [defaultEntryId(path), `${source.base}/${path}`]),
      );
      const astros = new Map(
        [...(store.get(c.name) ?? new Map<string, StoredEntry>())].map(([id, entry]) => [
          id,
          entry.filePath,
        ]),
      );
      expect(Object.fromEntries(ours), c.name).toEqual(Object.fromEntries(astros));
    }
  });

  it('lists the same entries for every file() collection', () => {
    for (const c of manifest.collections) {
      if (c.source.loader !== 'file') continue;
      const ids = [...(store.get(c.name)?.keys() ?? [])];
      expect(ids.length, c.name).toBeGreaterThan(0);
      for (const entry of store.get(c.name)?.values() ?? [])
        expect(entry.filePath).toBe(c.source.path);
    }
  });
});

describe('edge cases never crash and are explained', () => {
  it('reports unknown widgets, custom loaders, custom parsers and config typos', async () => {
    const manifest = await generateManifest({ root: join(fixtures, 'edge-site') });
    const notes = collection(manifest, 'notes');
    expect(notes).toMatchObject({
      label: 'Notes',
      editable: true,
      source: { generateId: 'custom' },
    });
    expect(field(notes, 'summary').widget).toBe('text');
    expect(field(notes, 'hours').widget).toBe('store-hours');
    expect(field(notes, 'related')).toMatchObject({ widget: 'references' });
    expect(collection(manifest, 'people')).toMatchObject({
      editable: false,
      readOnlyReason: 'unsupported-format',
    });
    expect(collection(manifest, 'remote')).toMatchObject({
      editable: false,
      readOnlyReason: 'custom-loader',
      source: { loader: 'other', name: 'remote-api' },
    });
    expect(collection(manifest, 'loose').fields).toBeNull();
    const codes = manifest.diagnostics.map((d) => d.code).sort();
    expect(codes).toEqual([
      'custom-loader',
      'schema-not-object',
      'unknown-collection',
      'unknown-widget',
      'vesper-config',
    ]);
    expect(manifest.diagnostics.find((d) => d.code === 'vesper-config')?.message).toContain(
      'scehdule',
    );
  });

  it('reports a content config that imports a runtime-only module', async () => {
    const manifest = await generateManifest({ root: join(fixtures, 'broken-site') });
    expect(manifest.collections).toEqual([]);
    expect(manifest.diagnostics).toEqual([
      expect.objectContaining({
        level: 'error',
        code: 'content-config',
        message: expect.stringContaining('astro:env/server') as string,
      }),
    ]);
  });
});
