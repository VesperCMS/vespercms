import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FieldModel } from '../field-model.ts';
import { IMAGE_MARKER, VESPER_META_KEY, walkSchema } from './walk.ts';

/** Astro's `reference()` as written in astro/dist/content/runtime.js (Astro 7). */
const reference = (collection: string) =>
  z
    .union([
      z.number().transform((n) => n.toString(10)),
      z.string(),
      z.object({ id: z.string(), collection: z.string() }),
      z.object({ slug: z.string(), collection: z.string() }),
    ])
    .transform((lookup) => (typeof lookup === 'object' ? lookup : { id: lookup, collection }));

/** Astro 6's shape: no number option. The walker must recognize both. */
const reference6 = (collection: string) =>
  z
    .union([
      z.string(),
      z.object({ id: z.string(), collection: z.string() }),
      z.object({ slug: z.string(), collection: z.string() }),
    ])
    .transform((lookup) => (typeof lookup === 'object' ? lookup : { id: lookup, collection }));

const image = () => z.string().meta({ [VESPER_META_KEY]: IMAGE_MARKER });

function fields(shape: z.ZodRawShape): FieldModel[] {
  const walk = walkSchema(z.object(shape));
  if (!walk.fields) throw new Error('expected fields');
  return walk.fields;
}
const field = (schema: z.ZodType) => fields({ x: schema })[0] as FieldModel;

describe('walkSchema: the spec §6.2 mapping', () => {
  it.each([
    ['string', z.string(), 'string'],
    ['number', z.number(), 'number'],
    ['boolean', z.boolean(), 'boolean'],
    ['date', z.date(), 'date'],
    ['enum', z.enum(['a', 'b']), 'enum'],
    ['string array', z.array(z.string()), 'array'],
    ['object', z.object({ a: z.string() }), 'object'],
    ['image', image(), 'image'],
    ['reference (Astro 7)', reference('authors'), 'reference'],
    ['reference (Astro 6)', reference6('authors'), 'reference'],
  ])('%s → %s', (_name, schema, kind) => {
    expect(field(schema as z.ZodType).kind).toBe(kind);
  });

  it('records the referenced collection', () => {
    expect(field(reference('authors')).reference).toEqual({ collection: 'authors' });
    expect(field(z.array(reference('blog'))).children?.[0]?.reference).toEqual({
      collection: 'blog',
    });
  });

  it('marks z.coerce.date() as coercing', () => {
    expect(field(z.coerce.date())).toMatchObject({ kind: 'date', coerce: true });
  });

  it('nests object children and array items with paths', () => {
    const [geo, list] = fields({
      geo: z.object({ lat: z.number(), lng: z.number() }),
      list: z.array(z.object({ name: z.string() })),
    });
    expect(geo?.children?.map((c) => c.path)).toEqual([
      ['geo', 'lat'],
      ['geo', 'lng'],
    ]);
    expect(list?.children?.[0]).toMatchObject({
      path: ['list', '[]'],
      kind: 'object',
      label: 'Item',
    });
    expect(list?.children?.[0]?.children?.[0]?.path).toEqual(['list', '[]', 'name']);
  });

  it('keeps a list’s summary hint, which names its items’ rows in the editor', () => {
    const faq = field(
      z.array(z.object({ question: z.string(), answer: z.string() })).meta({ summary: 'question' }),
    );
    expect(faq).toMatchObject({ kind: 'array', summary: 'question' });
  });

  it('labels fields from meta, or by humanizing the key', () => {
    const [a, b, c] = fields({
      publishedAt: z.date(),
      seoTitle: z.string(),
      t: z.string().meta({ label: 'Title' }),
    });
    expect([a?.label, b?.label, c?.label]).toEqual(['Published at', 'SEO title', 'Title']);
  });
});

describe('walkSchema: required, defaults and nullability', () => {
  it('treats optional and defaulted fields as not required', () => {
    expect(field(z.string()).required).toBe(true);
    expect(field(z.string().optional()).required).toBe(false);
    expect(field(z.string().default('x'))).toMatchObject({ required: false, default: 'x' });
    expect(field(z.array(z.string()).default([]))).toMatchObject({ required: false, default: [] });
  });

  it('does not store a Date default; it is computed when an entry is created', () => {
    const f = field(z.date().default(() => new Date()));
    expect(f.defaultDynamic).toBe(true);
    expect('default' in f).toBe(false);
  });

  it('reads .nullable() and union-with-null the same way', () => {
    expect(field(z.string().nullable())).toMatchObject({
      kind: 'string',
      nullable: true,
      required: true,
    });
    expect(field(z.union([z.string(), z.null()]))).toMatchObject({
      kind: 'string',
      nullable: true,
    });
  });
});

describe('walkSchema: meta placement (Phase 1 criterion)', () => {
  const meta = { label: 'Summary', description: 'Help', widget: 'textarea' };
  const wrappers: [string, (s: z.ZodType) => z.ZodType][] = [
    ['optional', (s) => s.optional()],
    ['default', (s) => s.default('x')],
    ['nullable', (s) => s.nullable()],
    ['readonly', (s) => s.readonly()],
  ];
  const strip = ({ label, description, widget }: FieldModel) => ({ label, description, widget });

  for (const [name, wrap] of wrappers) {
    it(`meta before or after .${name}() resolves identically`, () => {
      const before = field(wrap(z.string().meta(meta)));
      const after = field(wrap(z.string()).meta(meta));
      expect(strip(before)).toEqual(meta);
      expect(strip(after)).toEqual(meta);
      expect(before).toEqual(after);
    });
  }

  it('holds for every order of several wrappers', () => {
    const variants = [
      z.string().meta(meta).optional().nullable(),
      z.string().optional().meta(meta).nullable(),
      z.string().optional().nullable().meta(meta),
      z.string().nullable().optional().meta(meta),
      z.string().nullable().meta(meta).optional(),
    ].map(field);
    for (const variant of variants) expect(variant).toEqual(variants[0]);
  });

  it('lets the outermost layer win when layers disagree', () => {
    expect(
      field(z.string().meta({ label: 'Inner' }).optional().meta({ label: 'Outer' })).label,
    ).toBe('Outer');
  });

  it('survives checks: .min() and .refine() keep the meta and the kind', () => {
    expect(field(z.string().meta({ label: 'Name' }).min(1))).toMatchObject({
      kind: 'string',
      label: 'Name',
    });
    expect(
      field(
        z
          .string()
          .refine((s) => s.length > 0)
          .meta({ label: 'Name' }),
      ),
    ).toMatchObject({
      kind: 'string',
      label: 'Name',
    });
  });

  it('never copies the internal image marker into the model', () => {
    expect(VESPER_META_KEY in field(image())).toBe(false);
  });
});

describe('walkSchema: constraints and options', () => {
  it('reads string lengths, formats and patterns', () => {
    expect(
      field(
        z
          .string()
          .min(2)
          .max(9)
          .regex(/^#[0-9a-f]{6}$/i),
      ),
    ).toMatchObject({
      constraints: { min: 2, max: 9, pattern: '^#[0-9a-f]{6}$', patternFlags: 'i' },
    });
    expect(field(z.email()).format).toBe('email');
    expect(field(z.url()).format).toBe('url');
  });

  it('reads number bounds, steps and integers', () => {
    expect(field(z.number().int().min(0).lt(10).multipleOf(2)).constraints).toEqual({
      integer: true,
      min: 0,
      max: 10,
      maxInclusive: false,
      step: 2,
    });
  });

  it('reads enum labels from widgetOptions, and string literal unions as enums', () => {
    expect(
      field(z.enum(['a', 'b']).meta({ widgetOptions: { labels: { a: 'Alpha' } } })).constraints
        ?.options,
    ).toEqual([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'b' },
    ]);
    expect(
      field(z.union([z.literal('x'), z.literal('y')])).constraints?.options?.map((o) => o.value),
    ).toEqual(['x', 'y']);
  });

  it('records how an object treats extra keys', () => {
    expect(field(z.object({ a: z.string() })).extraKeys).toBe('strip');
    expect(field(z.object({ a: z.string() }).strict()).extraKeys).toBe('strict');
    expect(field(z.looseObject({ a: z.string() })).extraKeys).toBe('passthrough');
  });
});

describe('walkSchema: unmappable parts fall back to the raw field (Phase 1 criterion)', () => {
  type Node = { id: string; children?: Node[] };
  const tree: z.ZodType<Node> = z.lazy(() =>
    z.object({ id: z.string(), children: z.array(tree).optional() }),
  );

  it.each([
    ['union', z.union([z.string(), z.number()]), 'union'],
    [
      'discriminated union',
      z.discriminatedUnion('k', [z.object({ k: z.literal('a') }), z.object({ k: z.literal('b') })]),
      'union',
    ],
    ['transform', z.string().transform((s) => s.length), 'transform'],
    ['record', z.record(z.string(), z.number()), 'record'],
    ['tuple', z.tuple([z.string(), z.number()]), 'tuple'],
    [
      'intersection',
      z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
      'intersection',
    ],
    ['any', z.any(), 'any'],
    ['numeric enum', z.literal(1), 'non-string-enum'],
  ])('%s → unknown (%s)', (_name, schema, reason) => {
    expect(field(schema as z.ZodType)).toMatchObject({ kind: 'unknown', unknownReason: reason });
  });

  it('stops at recursion instead of looping', () => {
    const f = field(tree);
    expect(f.kind).toBe('object');
    const children = f.children?.find((c) => c.path.at(-1) === 'children');
    expect(children?.children?.[0]).toMatchObject({ kind: 'unknown', unknownReason: 'recursive' });
  });

  it('turns a schema that throws while being read into a raw field plus a diagnostic', () => {
    const exploding = z.string();
    Object.defineProperty(exploding._zod.def, 'checks', {
      get() {
        throw new Error('boom');
      },
    });
    const walk = walkSchema(z.object({ x: exploding, y: z.string() }));
    expect(walk.fields?.map((f) => f.kind)).toEqual(['unknown', 'string']);
    expect(walk.diagnostics[0]).toMatchObject({ code: 'introspection-error', path: ['x'] });
  });

  it('edits a non-object root as raw YAML', () => {
    const walk = walkSchema(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]));
    expect(walk.fields).toBeNull();
    expect(walk.diagnostics[0]?.code).toBe('schema-not-object');
  });

  it('warns about meta that is not plain data and leaves it out', () => {
    const walk = walkSchema(
      z.object({ x: z.string().meta({ widgetOptions: { format: () => 'x' } }) }),
    );
    expect(walk.fields?.[0]?.widgetOptions).toBeUndefined();
    expect(walk.diagnostics[0]?.code).toBe('meta-not-serializable');
  });
});
