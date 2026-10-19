import { describe, expect, it } from 'vitest';
import type { Manifest } from '../manifest/types.ts';
import { MemoryStorage } from '../storage/memory.ts';
import { MediaService, mediaReference, relativePath, resolveMediaPath } from './media.ts';
import { ContentService } from './service.ts';

const manifest: Manifest = {
  manifestVersion: 1,
  generator: { name: 'test', version: '0' },
  hash: 'x',
  site: { srcDir: 'src' },
  collections: [
    {
      name: 'blog',
      label: 'Blog posts',
      editable: true,
      source: {
        loader: 'glob',
        base: 'src/content/blog',
        pattern: '**/*.md',
        generateId: 'default',
        formats: ['md'],
      },
      entryKind: 'content',
      fields: [{ path: ['title'], kind: 'string', required: true, label: 'Title' }],
      presentation: {},
    },
    {
      name: 'authors',
      label: 'People',
      editable: true,
      source: {
        loader: 'file',
        path: 'src/data/authors.json',
        format: 'json',
        customParser: false,
      },
      entryKind: 'data',
      fields: [{ path: ['name'], kind: 'string', required: true, label: 'Name' }],
      presentation: {},
    },
  ],
  forms: [],
  diagnostics: [],
};

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

async function setup() {
  const storage = await MemoryStorage.create({
    'src/content/blog/harbor.md':
      '---\ntitle: Harbor\nhero:\n  src: ../../assets/blog/harbor.jpg\n---\n![Map](/images/map.png)\n',
    'src/content/blog/2026/market/index.md':
      '---\ntitle: Market\nhero: { src: ../../../../assets/blog/harbor.jpg }\n---\n',
    'src/data/authors.json': '[{ "id": "ana", "name": "Ana", "photo": "/images/ana.png" }]\n',
    'src/assets/blog/harbor.jpg': new Uint8Array([255, 216, 255, 1]),
    'src/assets/blog/unused.webp': new Uint8Array([82, 73, 70, 70]),
    'public/images/map.png': png,
    'public/images/ana.png': new Uint8Array([137, 80, 78, 71, 9]),
    'public/robots.txt': 'User-agent: *\n',
  });
  const content = new ContentService(storage, manifest);
  return { storage, media: new MediaService(storage, content) };
}

describe('paths', () => {
  it('resolves values the way Astro does, and writes them back the same way', () => {
    expect(resolveMediaPath('../../assets/blog/a.jpg', 'src/content/blog/post.md')).toBe(
      'src/assets/blog/a.jpg',
    );
    expect(resolveMediaPath('./a.jpg', 'src/content/blog/post/index.md')).toBe(
      'src/content/blog/post/a.jpg',
    );
    expect(resolveMediaPath('/images/a.png', 'src/content/blog/post.md')).toBe(
      'public/images/a.png',
    );
    expect(resolveMediaPath('https://cdn.example/a.jpg', 'x.md')).toBeNull();
    expect(resolveMediaPath('~/assets/a.jpg', 'x.md')).toBeNull();
    expect(mediaReference('src/assets/blog/a.jpg', 'src/content/blog/post.md')).toBe(
      '../../assets/blog/a.jpg',
    );
    expect(mediaReference('public/images/a.png', 'src/content/blog/post.md')).toBe('/images/a.png');
    expect(relativePath('src/content', 'src/content/a.jpg')).toBe('./a.jpg');
  });
});

describe('MediaService', () => {
  it('lists media with hashes and where each file is used', async () => {
    const { media } = await setup();
    const items = await media.list();
    expect(items.map((i) => i.path)).toEqual([
      'public/images/ana.png',
      'public/images/map.png',
      'src/assets/blog/harbor.jpg',
      'src/assets/blog/unused.webp',
    ]);
    const used = Object.fromEntries(items.map((i) => [i.path, i.usedBy.map((u) => u.title)]));
    expect(used).toEqual({
      'public/images/ana.png': ['Ana'],
      'public/images/map.png': ['Harbor'],
      'src/assets/blog/harbor.jpg': ['Market', 'Harbor'],
      'src/assets/blog/unused.webp': [],
    });
    // The git blob SHA, which every storage mode has without reading the file.
    expect(items[1]?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(items[1]?.hash).toBe(items[1]?.version);
  });

  it('reuses an identical file and never overwrites a different one', async () => {
    const { media, storage } = await setup();
    expect(await media.upload(png, 'Map.PNG', 'public/images')).toEqual({
      ok: true,
      path: 'public/images/map.png',
      reused: true,
    });
    const other = new Uint8Array([137, 80, 78, 71, 42]);
    expect(await media.upload(other, 'map.png', 'public/images')).toEqual({
      ok: true,
      path: 'public/images/map-2.png',
      reused: false,
    });
    expect((await storage.read('public/images/map-2.png'))?.bytes).toEqual(other);
  });

  it('refuses unknown types, oversized files and folders outside the site', async () => {
    const { media } = await setup();
    expect(await media.upload(png, 'run.exe', 'src/assets')).toMatchObject({ ok: false });
    expect(
      await media.upload(new Uint8Array(21 * 1024 * 1024), 'big.jpg', 'src/assets'),
    ).toMatchObject({
      ok: false,
    });
    expect(await media.upload(png, 'a.png', '../outside')).toMatchObject({ ok: false });
  });

  it('deletes only files nothing uses', async () => {
    const { media, storage } = await setup();
    expect(await media.remove('src/assets/blog/harbor.jpg')).toMatchObject({
      ok: false,
      message: 'It’s still used on “Market”, “Harbor”.',
    });
    expect(await media.remove('src/assets/blog/unused.webp')).toMatchObject({ ok: true });
    expect(await storage.read('src/assets/blog/unused.webp')).toBeNull();
  });
});
