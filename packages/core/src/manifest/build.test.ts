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
      'schedule-fields-missing',
      'unknown-collection',
      'unknown-widget',
    ]);
  });

  it('warns when a scheduled collection’s schema lacks its times, with the lines to add', async () => {
    const found = (await buildManifest(input)).diagnostics.find(
      (d) => d.code === 'schedule-fields-missing',
    );
    expect(found).toEqual({
      level: 'warning',
      code: 'schedule-fields-missing',
      collection: 'blog',
      message:
        "This collection is scheduled, but its schema has no publishAt or unpublishAt field. Astro drops values the schema doesn't list, so the build can't read those times. Add `publishAt: fields.datetime().optional(),` and `unpublishAt: fields.datetime().optional(),` to its schema.",
    });
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

describe('buildManifest: URLs and trees (spec §6.15)', () => {
  const pages = (pattern: string) => ({
    name: 'pages',
    loader: { kind: 'glob' as const, base: 'src/content/pages', pattern, customId: false },
    schema: z.object({ title: z.string() }),
  });

  it('records Astro’s URL settings, the time zone, maxDepth and native redirect targets', async () => {
    const manifest = await buildManifest({
      site: {
        srcDir: 'src',
        urls: { base: 'college', trailingSlash: 'always', buildFormat: 'directory' },
      },
      collections: [pages('**/[^_]*.md')],
      config: {
        timeZone: 'America/New_York',
        rebuildEvery: 60,
        redirects: { native: ['apache'] },
        collections: { pages: { url: '/:path', tree: true, maxDepth: 4 } },
      },
    });
    expect(manifest.site.rebuildEvery).toBe(60);
    expect(manifest.site.urls).toEqual({
      base: '/college/',
      trailingSlash: 'always',
      buildFormat: 'directory',
      timeZone: 'America/New_York',
    });
    expect(manifest.site.redirects).toEqual({ native: ['apache'] });
    expect(manifest.collections[0]?.presentation).toEqual({
      tree: true,
      url: '/:path',
      maxDepth: 4,
    });
    expect(manifest.diagnostics).toEqual([]);
  });

  it('warns when a pattern would pick up _order.yaml, or a tree isn’t made of folders', async () => {
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [
        pages('**/*'),
        {
          name: 'people',
          loader: { kind: 'file', path: 'src/data/people.json', customParser: false },
          schema: z.object({ name: z.string() }),
        },
      ],
      config: { collections: { pages: { tree: true }, people: { tree: true } } },
    });
    expect(manifest.diagnostics.map((d) => [d.collection, d.code])).toEqual([
      ['pages', 'order-file-matched'],
      ['people', 'tree-not-glob'],
    ]);
  });
});

describe('buildManifest: images (spec §6.6.3)', () => {
  const blog = (ratios: unknown) => ({
    name: 'blog',
    loader: { kind: 'glob', base: './src/content/blog', pattern: '**/*.md', customId: false },
    schema: z.object({
      hero: z
        .object({ src: image(), alt: z.string() })
        .meta({ widget: 'image', widgetOptions: { ratios } }),
    }),
  });

  it('lists the site’s ratios with the built-in og, and the upload limit', async () => {
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [],
      config: { images: { ratios: { wide: 16 / 9, square: 1 }, maxUploadEdge: 2400 } },
    });
    expect(manifest.site.images).toEqual({
      ratios: { wide: 16 / 9, square: 1, og: 1.91 },
      maxUploadEdge: 2400,
    });
    const plain = await buildManifest({ site: { srcDir: 'src' }, collections: [] });
    expect(plain.site.images).toEqual({ ratios: { og: 1.91 } });
  });

  it('leaves out ratios the config gets wrong (loading the config reports them)', async () => {
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [],
      config: { images: { ratios: { wide: 16 / 9, '4x3': 4 / 3, flat: 0 }, maxUploadEdge: 0 } },
    });
    expect(manifest.site.images).toEqual({ ratios: { wide: 16 / 9, og: 1.91 } });
  });

  it('warns about an image field that lists a ratio the site doesn’t declare', async () => {
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [blog(['wide', 'wdie', 'og'])] as ManifestInput['collections'],
      config: { images: { ratios: { wide: 16 / 9 } } },
    });
    expect(manifest.diagnostics.filter((d) => d.code === 'unknown-ratio')).toEqual([
      {
        level: 'warning',
        code: 'unknown-ratio',
        message:
          'hero lists the ratio "wdie", which vesper.config.ts doesn\'t declare. Declared: wide, og.',
        collection: 'blog',
        path: ['hero'],
      },
    ]);
  });
});

describe('buildManifest: accessibility (spec §6.18)', () => {
  const fixtures = (contrast?: string) => ({
    name: 'fixtures',
    loader: { kind: 'glob', base: './src/content/fixtures', pattern: '**/*.mdoc', customId: false },
    schema: z.object({
      textColor: z
        .string()
        .meta({ widget: 'color', ...(contrast ? { widgetOptions: { contrast } } : {}) }),
    }),
  });

  it('records the publish gate, the backgrounds and each collection’s heading start', async () => {
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [fixtures('text')] as ManifestInput['collections'],
      config: {
        a11y: {
          blockPublishOn: ['missing-alt', 'missing-alt', 'pdf-untagged'],
          backgrounds: { 'Page, light': '#ffffff', 'Page, dark': '#12151f' },
        },
        collections: { fixtures: { headingStart: 1 } },
      },
    });
    expect(manifest.site.a11y).toEqual({
      blockPublishOn: ['missing-alt', 'pdf-untagged'],
      backgrounds: [
        { name: 'Page, light', color: '#ffffff' },
        { name: 'Page, dark', color: '#12151f' },
      ],
    });
    expect(manifest.collections[0]?.presentation.headingStart).toBe(1);
    expect(manifest.diagnostics).toEqual([]);
  });

  it('leaves out what the config gets wrong, and omits empty settings', async () => {
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [fixtures()] as ManifestInput['collections'],
      config: {
        a11y: { blockPublishOn: ['missing-alts'], backgrounds: { Page: 'white' } },
        collections: { fixtures: { headingStart: 7 } },
      },
    });
    expect(manifest.site.a11y).toBeUndefined();
    expect(manifest.collections[0]?.presentation.headingStart).toBeUndefined();
  });

  it('warns when a colour asks for a contrast check and there are no backgrounds', async () => {
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [fixtures('text')] as ManifestInput['collections'],
    });
    expect(manifest.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [
        'contrast-no-backgrounds',
        'textColor asks for a contrast check, but vesper.config.ts declares no a11y.backgrounds to check it against.',
      ],
    ]);
  });
});

describe('buildManifest: collection icons', () => {
  const blog = {
    name: 'blog',
    loader: { kind: 'glob', base: './src/content/blog', pattern: '**/*.md', customId: false },
    schema: z.object({ title: z.string() }),
  };
  const newspaper: NonNullable<ManifestInput['icons']>[string] = [
    ['path', { d: 'M15 18h-5' }],
    ['rect', { width: 8, height: 4, x: 10, y: 6, rx: 1 }],
  ];

  it('carries the drawing of the icon the config names', async () => {
    const icons = { newspaper };
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [blog] as ManifestInput['collections'],
      config: { collections: { blog: { icon: 'newspaper' } } },
      icons,
    });
    expect(manifest.collections[0]?.presentation.icon).toEqual({
      name: 'newspaper',
      node: newspaper,
    });
    expect(manifest.collections[0]?.presentation.icon?.node).not.toBe(newspaper);
  });

  it('leaves the icon out when its drawing wasn’t loaded, so the studio shows the default', async () => {
    for (const icon of ['calendar-days', 'constructor', '__proto__']) {
      const manifest = await buildManifest({
        site: { srcDir: 'src' },
        collections: [blog] as ManifestInput['collections'],
        config: { collections: { blog: { icon } } },
        icons: { newspaper },
      });
      expect(manifest.collections[0]?.presentation.icon).toBeUndefined();
    }
  });
});

describe('buildManifest: editor tabs', () => {
  it('keeps the tabs vesper.config.ts declares, and places fields on them', async () => {
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [
        {
          name: 'blog',
          loader: { kind: 'glob', base: './src/content/blog', pattern: '**/*.md', customId: false },
          schema: z.object({
            title: z.string(),
            seoTitle: z.string().optional().meta({ placement: 'seo' }),
            ogImage: z.string().optional(),
            note: z.string().optional().meta({ placement: 'nowhere' }),
          }),
        },
      ] as ManifestInput['collections'],
      config: {
        collections: {
          blog: { tabs: { seo: 'SEO', details: 'Ignored' }, placement: { ogImage: 'seo' } },
        },
      },
    });
    const blog = manifest.collections[0];
    expect(blog?.presentation.tabs).toEqual([{ id: 'seo', label: 'SEO' }]);
    expect(blog?.fields?.map((f) => [f.path[0], f.placement])).toEqual([
      ['title', undefined],
      ['seoTitle', 'seo'],
      ['ogImage', 'seo'],
      ['note', undefined],
    ]);
    expect(manifest.diagnostics.map((d) => d.code)).toContain('unknown-tab');
  });
});

describe('buildManifest: hide from site search', () => {
  const pages = (schema: z.ZodType) => ({
    name: 'pages',
    loader: { kind: 'glob', base: './src/content/pages', pattern: '**/*.md', customId: false },
    schema,
  });
  const hide = z
    .boolean()
    .default(false)
    .meta({ label: 'Hide from site search', search: 'hide', placement: 'details' });

  it('names the switch for searched collections with pages', async () => {
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [
        pages(z.object({ title: z.string(), hidden: hide })),
      ] as ManifestInput['collections'],
      config: { collections: { pages: { url: '/:id' } } },
    });
    expect(manifest.collections[0]?.presentation.searchHidden).toEqual(['hidden']);
    expect(manifest.collections[0]?.fields?.[1]).toMatchObject({ search: 'hide', default: false });
  });

  it('has none without a URL, with search: false, or without the field', async () => {
    const build = async (schema: z.ZodType, config: object) =>
      (
        await buildManifest({
          site: { srcDir: 'src' },
          collections: [pages(schema)] as ManifestInput['collections'],
          config: { collections: { pages: config } },
        })
      ).collections[0]?.presentation.searchHidden;
    expect(await build(z.object({ hidden: hide }), {})).toBeUndefined();
    expect(await build(z.object({ hidden: hide }), { url: '/:id', search: false })).toBeUndefined();
    expect(await build(z.object({ title: z.string() }), { url: '/:id' })).toBeUndefined();
    expect(
      await build(z.object({ seo: z.object({ noindex: z.boolean() }) }), { url: '/:id' }),
    ).toEqual(['seo', 'noindex']);
  });
});

describe('buildManifest: Markdoc attribute hints (spec §6.5.1)', () => {
  it('resolves a hint’s widget against the attribute’s type, as for a schema field', async () => {
    const manifest = await buildManifest({
      site: { srcDir: 'src' },
      collections: [],
      markdoc: {
        config: {
          tags: {
            badge: { attributes: { color: { type: String }, place: { type: Object } } },
          },
        },
        options: {},
      },
      config: {
        markdoc: {
          tags: { badge: { attributes: { color: { widget: 'color' }, place: { widget: 'geo' } } } },
        },
      },
    });
    // A Markdoc Object attribute has no fields of its own, so geo can't edit it.
    expect(manifest.markdoc?.tags[0]?.fields.map((f) => [f.path[0], f.kind, f.widget])).toEqual([
      ['color', 'string', 'color'],
      ['place', 'unknown', 'raw'],
    ]);
    expect(manifest.diagnostics.map((d) => [d.code, d.collection])).toEqual([
      ['widget-rejected', 'markdoc:badge'],
    ]);
  });
});
