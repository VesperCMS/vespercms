import type { Diagnostic, FieldConstraints, FieldModel } from '../field-model.ts';
import { humanize } from './humanize.ts';

/*
 * Turns a site's Zod 4 schema into field models (spec §6.2, §6.3.1).
 *
 * Core can't import Zod (it would be a second copy, and core runs in
 * browsers and Workers), so schemas are read structurally through Zod 4's
 * `_zod.def`, the surface Zod documents for library authors. `.meta()` is
 * read by calling each layer's own `meta()`, which works whichever Zod copy
 * built the schema.
 *
 * The walker never throws. Anything it can't map becomes `kind: 'unknown'`
 * (the raw YAML field) with a reason, and real failures become diagnostics.
 */

type ZodDef = { type: string } & Record<string, unknown>;
export type ZodLike = {
  _zod: { def: ZodDef };
  meta?: () => unknown;
  safeParse?: (value: unknown) => { success: boolean; data?: unknown };
};

export function isZodLike(value: unknown): value is ZodLike {
  if (typeof value !== 'object' || value === null || !('_zod' in value)) return false;
  const internals = value._zod;
  if (typeof internals !== 'object' || internals === null || !('def' in internals)) return false;
  const def = internals.def;
  return (
    typeof def === 'object' && def !== null && typeof (def as { type?: unknown }).type === 'string'
  );
}

/** Meta keys copied into the field model. Anything else stays out of the manifest. */
const META_KEYS = [
  'label',
  'description',
  'widget',
  'widgetOptions',
  'placeholder',
  'hidden',
  'readOnly',
  'autocomplete',
  'placement',
  'safeToEcho',
  'search',
  'summary',
] as const;

/** Marker meta Vesper puts on the `image()` it hands to schema functions. Never copied out. */
export const VESPER_META_KEY = 'vesper';
export const IMAGE_MARKER = { kind: 'image' } as const;

const REFERENCE_PROBE = '__vesper_reference_probe__';

type Peeled = {
  core: ZodLike;
  meta: Record<string, unknown>;
  optional: boolean;
  nullable: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
  defaultDynamic: boolean;
  recursive: boolean;
  /** Lazy schemas already expanded on this path; children inherit them to stop recursion. */
  visited: ReadonlySet<ZodLike>;
};

const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'catch',
  'readonly',
  'nonoptional',
]);

function metaOf(schema: ZodLike): Record<string, unknown> {
  try {
    const meta = schema.meta?.();
    return typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Peels wrappers (`.optional()`, `.default()`, `.nullable()`…) off a schema,
 * merging `.meta()` from each layer. Wrappers are new schema instances that
 * don't inherit meta, so every layer is read; where layers disagree, the
 * outermost wins. That makes `.meta().optional()` and `.optional().meta()`
 * identical.
 */
function peel(schema: ZodLike, seen: ReadonlySet<ZodLike>): Peeled {
  const layers: ZodLike[] = [];
  let current = schema;
  let optional = false;
  let nullable = false;
  let hasDefault = false;
  let defaultValue: unknown;
  let defaultCaptured = false;
  let recursive = false;
  const visited = new Set(seen);

  for (;;) {
    layers.push(current);
    const def = current._zod.def;
    if (def.type === 'lazy') {
      if (visited.has(current)) {
        recursive = true;
        break;
      }
      visited.add(current);
      const getter = def.getter;
      const inner: unknown = typeof getter === 'function' ? (getter as () => unknown)() : undefined;
      if (!isZodLike(inner)) break;
      current = inner;
      continue;
    }
    if (!WRAPPERS.has(def.type) || !isZodLike(def.innerType)) break;
    if (def.type === 'optional') optional = true;
    if (def.type === 'nonoptional') optional = false;
    if (def.type === 'nullable') nullable = true;
    if (def.type === 'default' || def.type === 'prefault' || def.type === 'catch') {
      hasDefault = true;
      if (!defaultCaptured && def.type !== 'catch') {
        defaultCaptured = true;
        try {
          defaultValue = def.defaultValue;
        } catch {
          defaultValue = undefined;
        }
      }
    }
    current = def.innerType;
  }

  // A union with `null` is `.nullable()` spelled differently.
  const def = current._zod.def;
  if (def.type === 'union' && Array.isArray(def.options)) {
    const options = (def.options as unknown[]).filter(isZodLike);
    const nonNull = options.filter((option) => option._zod.def.type !== 'null');
    if (
      options.length === def.options.length &&
      nonNull.length === 1 &&
      options.length === 2 &&
      nonNull[0]
    ) {
      const inner = peel(nonNull[0], visited);
      return mergePeeled(layers, inner, {
        optional,
        nullable: true,
        hasDefault,
        defaultValue,
        defaultCaptured,
      });
    }
  }

  const meta: Record<string, unknown> = {};
  for (const layer of [...layers].reverse()) Object.assign(meta, metaOf(layer));
  return {
    core: current,
    meta,
    optional,
    nullable,
    hasDefault,
    ...(defaultCaptured ? { defaultValue } : {}),
    defaultDynamic: defaultValue instanceof Date,
    recursive,
    visited,
  };
}

function mergePeeled(
  outerLayers: ZodLike[],
  inner: Peeled,
  outer: {
    optional: boolean;
    nullable: boolean;
    hasDefault: boolean;
    defaultValue: unknown;
    defaultCaptured: boolean;
  },
): Peeled {
  const meta: Record<string, unknown> = { ...inner.meta };
  for (const layer of [...outerLayers].reverse()) Object.assign(meta, metaOf(layer));
  const defaultValue = outer.defaultCaptured ? outer.defaultValue : inner.defaultValue;
  return {
    ...inner,
    meta,
    optional: outer.optional || inner.optional,
    nullable: true,
    hasDefault: outer.hasDefault || inner.hasDefault,
    ...(outer.defaultCaptured || 'defaultValue' in inner ? { defaultValue } : {}),
    defaultDynamic: defaultValue instanceof Date,
  };
}

/** Astro's `reference(collection)`, recognized by what it does rather than its shape (it differs between Astro 6 and 7). */
export function referenceCollection(schema: ZodLike): string | null {
  const def = schema._zod.def;
  if (def.type !== 'pipe' || !isZodLike(def.in) || !isZodLike(def.out)) return null;
  if (def.in._zod.def.type !== 'union' || def.out._zod.def.type !== 'transform') return null;
  try {
    const result = schema.safeParse?.(REFERENCE_PROBE);
    const data = result?.success ? result.data : undefined;
    if (typeof data === 'object' && data !== null) {
      const { id, collection } = data as { id?: unknown; collection?: unknown };
      if (id === REFERENCE_PROBE && typeof collection === 'string') return collection;
    }
  } catch {
    // An async transform can't be probed synchronously; it isn't Astro's reference.
  }
  return null;
}

type WalkContext = { diagnostics: Diagnostic[]; collection?: string; seen: ReadonlySet<ZodLike> };

/** Walks one field. Never throws: failures become `unknown` plus a diagnostic. */
export function walkField(schema: unknown, path: string[], context: WalkContext): FieldModel {
  const key = path.at(-1) ?? '';
  const fallbackLabel = key === '[]' ? 'Item' : humanize(key);
  try {
    if (!isZodLike(schema)) return unknownField(path, fallbackLabel, 'not-zod');
    return buildField(schema, path, fallbackLabel, context);
  } catch (error) {
    context.diagnostics.push({
      level: 'warning',
      code: 'introspection-error',
      message: `Couldn't read the schema for ${path.join('.')}: ${error instanceof Error ? error.message : String(error)}. It is shown as a raw YAML field.`,
      path,
      ...(context.collection ? { collection: context.collection } : {}),
    });
    return unknownField(path, fallbackLabel, 'introspection-error');
  }
}

function unknownField(path: string[], label: string, reason: string): FieldModel {
  return { path, kind: 'unknown', required: false, label, unknownReason: reason };
}

function buildField(
  schema: ZodLike,
  path: string[],
  fallbackLabel: string,
  context: WalkContext,
): FieldModel {
  const peeled = peel(schema, context.seen);
  const { core, meta } = peeled;
  const def = core._zod.def;

  const field: FieldModel = {
    path,
    kind: 'unknown',
    required: !(peeled.optional || peeled.hasDefault),
    label: typeof meta.label === 'string' ? meta.label : fallbackLabel,
  };
  if (peeled.nullable) field.nullable = true;
  if (peeled.hasDefault) {
    if (peeled.defaultDynamic) field.defaultDynamic = true;
    else if (isJsonSafe(peeled.defaultValue)) field.default = peeled.defaultValue;
  }
  copyMeta(field, meta, context, path);

  const marker = meta[VESPER_META_KEY];
  if (
    typeof marker === 'object' &&
    marker !== null &&
    (marker as { kind?: unknown }).kind === 'image'
  ) {
    field.kind = 'image';
    return field;
  }
  if (peeled.recursive) return { ...field, kind: 'unknown', unknownReason: 'recursive' };
  const childContext: WalkContext = { ...context, seen: new Set(peeled.visited).add(core) };

  const collection = referenceCollection(core);
  if (collection !== null) {
    field.kind = 'reference';
    field.reference = { collection };
    return field;
  }

  switch (def.type) {
    case 'string':
      return stringField(field, def);
    case 'number':
      return numberField(field, def);
    case 'boolean':
      field.kind = 'boolean';
      return field;
    case 'date':
      field.kind = 'date';
      if (def.coerce === true) field.coerce = true;
      return field;
    case 'enum':
      return enumField(field, Object.values((def.entries ?? {}) as Record<string, unknown>), meta);
    case 'literal':
      return enumField(field, Array.isArray(def.values) ? def.values : [], meta);
    case 'union':
      return unionField(field, def, meta);
    case 'array':
      return arrayField(field, def, path, childContext);
    case 'object':
      return objectField(field, def, path, childContext);
    case 'pipe':
    case 'transform':
      return { ...field, kind: 'unknown', unknownReason: 'transform' };
    default:
      return { ...field, kind: 'unknown', unknownReason: def.type };
  }
}

function copyMeta(
  field: FieldModel,
  meta: Record<string, unknown>,
  context: WalkContext,
  path: string[],
): void {
  for (const key of META_KEYS) {
    const value = meta[key];
    if (value === undefined || key === 'label') continue;
    if (!isJsonSafe(value)) {
      context.diagnostics.push({
        level: 'warning',
        code: 'meta-not-serializable',
        message: `meta.${key} on ${path.join('.')} isn't plain data (for example, it holds a function), so the studio can't use it.`,
        path,
        ...(context.collection ? { collection: context.collection } : {}),
      });
      continue;
    }
    (field as Record<string, unknown>)[key] = value;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function checksOf(def: ZodDef): Record<string, unknown>[] {
  const checks = Array.isArray(def.checks) ? (def.checks as unknown[]) : [];
  return checks.flatMap((check) => {
    const checkDef = (check as { _zod?: { def?: unknown } } | null)?._zod?.def;
    return isRecord(checkDef) ? [checkDef] : [];
  });
}

function setConstraint<K extends keyof FieldConstraints>(
  field: FieldModel,
  key: K,
  value: FieldConstraints[K],
): void {
  field.constraints = { ...field.constraints, [key]: value };
}

function stringField(field: FieldModel, def: ZodDef): FieldModel {
  field.kind = 'string';
  if (typeof def.format === 'string') field.format = def.format;
  for (const check of checksOf(def)) {
    if (check.check === 'min_length' && typeof check.minimum === 'number')
      setConstraint(field, 'min', check.minimum);
    if (check.check === 'max_length' && typeof check.maximum === 'number')
      setConstraint(field, 'max', check.maximum);
    if (check.check === 'length_equals' && typeof check.length === 'number') {
      setConstraint(field, 'min', check.length);
      setConstraint(field, 'max', check.length);
    }
    if (check.check === 'string_format') {
      if (check.format === 'regex' && check.pattern instanceof RegExp) {
        setConstraint(field, 'pattern', check.pattern.source);
        if (check.pattern.flags) setConstraint(field, 'patternFlags', check.pattern.flags);
      } else if (typeof check.format === 'string' && field.format === undefined) {
        field.format = check.format;
      }
    }
  }
  return field;
}

function numberField(field: FieldModel, def: ZodDef): FieldModel {
  field.kind = 'number';
  for (const check of checksOf(def)) {
    if (
      check.check === 'number_format' &&
      typeof check.format === 'string' &&
      /int|safeint/.test(check.format)
    ) {
      setConstraint(field, 'integer', true);
    }
    if (check.check === 'greater_than' && typeof check.value === 'number') {
      setConstraint(field, 'min', check.value);
      if (check.inclusive === false) setConstraint(field, 'minInclusive', false);
    }
    if (check.check === 'less_than' && typeof check.value === 'number') {
      setConstraint(field, 'max', check.value);
      if (check.inclusive === false) setConstraint(field, 'maxInclusive', false);
    }
    if (check.check === 'multiple_of' && typeof check.value === 'number')
      setConstraint(field, 'step', check.value);
  }
  return field;
}

function enumField(
  field: FieldModel,
  values: unknown[],
  meta: Record<string, unknown>,
): FieldModel {
  if (values.length === 0 || !values.every((value) => typeof value === 'string')) {
    return { ...field, kind: 'unknown', unknownReason: 'non-string-enum' };
  }
  const options = meta.widgetOptions as { labels?: Record<string, unknown> } | undefined;
  const labels = options?.labels ?? {};
  field.kind = 'enum';
  setConstraint(
    field,
    'options',
    values.map((value) => ({
      value,
      label: typeof labels[value] === 'string' ? labels[value] : value,
    })),
  );
  return field;
}

/** A union of string literals is an enum. Anything else is shown raw. */
function unionField(field: FieldModel, def: ZodDef, meta: Record<string, unknown>): FieldModel {
  const options = Array.isArray(def.options) ? (def.options as unknown[]).filter(isZodLike) : [];
  const literals = options.every((option) => option._zod.def.type === 'literal');
  if (literals && options.length > 0) {
    const values = options.flatMap((option): unknown[] => {
      const optionValues: unknown = option._zod.def.values;
      return Array.isArray(optionValues) ? (optionValues as unknown[]) : [];
    });
    return enumField(field, values, meta);
  }
  return { ...field, kind: 'unknown', unknownReason: 'union' };
}

function arrayField(
  field: FieldModel,
  def: ZodDef,
  path: string[],
  context: WalkContext,
): FieldModel {
  field.kind = 'array';
  field.children = [walkField(def.element, [...path, '[]'], context)];
  for (const check of checksOf(def)) {
    if (check.check === 'min_length' && typeof check.minimum === 'number')
      setConstraint(field, 'min', check.minimum);
    if (check.check === 'max_length' && typeof check.maximum === 'number')
      setConstraint(field, 'max', check.maximum);
  }
  return field;
}

function objectField(
  field: FieldModel,
  def: ZodDef,
  path: string[],
  context: WalkContext,
): FieldModel {
  field.kind = 'object';
  const shape = (typeof def.shape === 'object' && def.shape !== null ? def.shape : {}) as Record<
    string,
    unknown
  >;
  field.children = Object.keys(shape).map((key) => walkField(shape[key], [...path, key], context));
  const catchall = isZodLike(def.catchall) ? def.catchall._zod.def.type : undefined;
  field.extraKeys =
    catchall === 'never'
      ? 'strict'
      : catchall === 'unknown' || catchall === 'any'
        ? 'passthrough'
        : 'strip';
  return field;
}

function isJsonSafe(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value as Record<string, unknown>).every(
      (v) => v === undefined || isJsonSafe(v),
    );
  }
  return false;
}

export type SchemaWalk = {
  /** Top-level fields, or `null` when the schema isn't an object (the whole frontmatter is then edited raw). */
  fields: FieldModel[] | null;
  extraKeys?: FieldModel['extraKeys'];
  diagnostics: Diagnostic[];
};

/** Walks a collection's root schema, which should be an object. */
export function walkSchema(schema: unknown, options: { collection?: string } = {}): SchemaWalk {
  const diagnostics: Diagnostic[] = [];
  const context: WalkContext = {
    diagnostics,
    seen: new Set(),
    ...(options.collection ? { collection: options.collection } : {}),
  };
  const root = walkField(schema, [], context);
  if (root.kind !== 'object' || !root.children) {
    diagnostics.push({
      level: 'warning',
      code: 'schema-not-object',
      message:
        "This collection's schema isn't a z.object(), so its frontmatter is edited as raw YAML.",
      ...(options.collection ? { collection: options.collection } : {}),
    });
    return { fields: null, diagnostics };
  }
  return {
    fields: root.children,
    ...(root.extraKeys ? { extraKeys: root.extraKeys } : {}),
    diagnostics,
  };
}
