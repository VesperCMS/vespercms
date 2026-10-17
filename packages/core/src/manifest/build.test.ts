import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { IMAGE_MARKER, VESPER_META_KEY } from '../schema/walk.ts';
import { buildManifest, type ManifestInput } from './build.ts';
import { canonicalJson } from './hash.ts';

const image = () => z.string().meta({ [VESPER_META_KEY]: IMAGE_MARKER });

const input: ManifestInput = {
  site: { srcDir: 'src', contentConfig: 'src/content.config.ts' },
  collections: [
    {
      name: 'blog',
      loader: { kind: 'glob', base: './src/content/blog', pattern: '**/[^_]*.md', customId: false },
      schema: z.object({
        title: z.string(),
        hero: image().optional(),
        summary: z.string().meta({ widget: 'nope' }),
      }),
    },
    {
      name: 'authors',
      loader: { kind: 'file', path: 'src/data/authors.json', customParser: false },
      schema: z.object({ name: z.string() }),
    },
    {
      name: 'docs',
      loader: { kind: 'other', name: 'starlight-docs' },
      schema: z.object({ title: z.string() }),
    },
    {
      name: 'broken',
      loader: { kind: 'other' },
      schema: null,
      error: 'astro:env is not available while Vesper reads your config.',
    },
  ],
  config: {
    collections: {
      blog: { label: 'Blog posts', url: '/blog/:slug', listFields: ['title'], schedule: true },
      settings: { singleton: true },
    },
  },
  forms: [
    {
      name: 'contact',
      schema: z.object({ email: z.email() }),
      options: { confirmation: { emailField: 'email' }, onSubmit: () => 1 },
    },
  ],
};

describe('buildManifest', () => {
  it('describes each collection: source, kind, editability, fields and presentation', async () => {
    const manifest = await buildManifest(input);
    const [blog, authors, docs, broken] = manifest.collections;
    expect(blog).toMatchObject({
      name: 'blog',
      label: 'Blog posts',
      editable: true,
      entryKind: 'content',
      source: {
        loader: 'glob',
        base: 'src/content/blog',
        pattern: '**/[^_]*.md',
        generateId: 'default',
        formats: ['md'],
      },
      presentation: {
        url: '/blog/:slug',
        listFields: ['title'],
        schedule: { unpublish: true, publishAt: 'publishAt', unpublishAt: 'unpublishAt' },
      },
    });
    expect(blog?.fields?.map((f) => [f.path[0], f.kind, f.widget])).toEqual([
      ['title', 'string', 'text'],
      ['hero', 'image', 'image'],
      ['summary', 'string', 'text'],
    ]);
    expect(authors).toMatchObject({
      entryKind: 'data',
      editable: true,
      source: { loader: 'file', format: 'json' },
    });
    expect(docs).toMatchObject({ editable: false, readOnlyReason: 'custom-loader', label: 'Docs' });
    expect(broken).toMatchObject({ editable: false, readOnlyReason: 'config-error', fields: null });
  });

  it('collects diagnostics: unknown widget, unconfigured names, custom loaders, config errors', async () => {
    const codes = (await buildManifest(input)).diagnostics.map((d) => d.code).sort();
    expect(codes).toEqual([
      'config-error',
      'custom-loader',
      'unknown-collection',
      'unknown-widget',
    ]);
  });

  it('includes forms with plain-data options only', async () => {
    const manifest = await buildManifest(input);
    expect(manifest.forms).toEqual([
      expect.objectContaining({
        name: 'contact',
        options: { confirmation: { emailField: 'email' } },
      }),
    ]);
    expect(manifest.forms[0]?.fields?.[0]).toMatchObject({
      kind: 'string',
      format: 'email',
      widget: 'email',
    });
  });

  it('is deterministic and JSON-safe, and its hash tracks content only', async () => {
    const a = await buildManifest(input);
    const b = await buildManifest({
      ...input,
      generator: { name: '@vesper/core', version: '9.9.9' },
    });
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    const c = await buildManifest({ ...input, config: {} });
    expect(c.hash).not.toBe(a.hash);
  });

  it('canonicalJson sorts keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[{"y":2,"z":1}]},"b":1}',
    );
  });
});
