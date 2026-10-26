/**
 * The normalized field model (spec §6.3.1). `core` turns each Zod field into
 * one of these plain, serializable objects. Widgets, the manifest and
 * validation messages consume this model, never raw Zod internals.
 *
 * Validation always runs against the real Zod schema; this model only drives
 * the UI. Keys after `reference` extend the spec's shape. They are all
 * optional, and each one is recorded in DECISIONS.md.
 */
export type FieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'array'
  | 'object'
  | 'image'
  | 'reference'
  | 'union'
  | 'unknown';

export type FieldOption = { value: string; label: string };

/**
 * One kind of a discriminated union (`kind: 'union'`): the object whose
 * discriminator holds `value`. Its `children` leave the discriminator out,
 * since the kind itself is that value (DECISIONS.md, "Blocks are a
 * discriminated union of objects").
 */
export type FieldVariant = {
  value: string;
  /** `meta.label` on the kind's object, or its value in sentence case. */
  label: string;
  description?: string;
  /** The field that names an item of this kind in a list ("heading"). */
  summary?: string;
  children: FieldModel[];
};

export type FieldConstraints = {
  min?: number;
  max?: number;
  /** Source of a regular expression the value must match. */
  pattern?: string;
  /** Flags for `pattern`, such as `i`. */
  patternFlags?: string;
  options?: FieldOption[];
  /** Numbers: the value must be a multiple of this. */
  step?: number;
  /** Numbers: whole numbers only. */
  integer?: boolean;
  /** Numbers: whether `min` / `max` themselves are allowed (default true). */
  minInclusive?: boolean;
  maxInclusive?: boolean;
};

export type FieldModel = {
  /** Key path from the entry root, e.g. `['location', 'lat']`. Array items use `'[]'`. */
  path: string[];
  kind: FieldKind;
  required: boolean;
  default?: unknown;
  /** `meta.label`, or the humanized key. */
  label: string;
  description?: string;
  /** The widget to render, after resolution (spec §6.3). */
  widget?: string;
  widgetOptions?: Record<string, unknown>;
  constraints?: FieldConstraints;
  /** Object fields' properties, or an array's item model. */
  children?: FieldModel[];
  reference?: { collection: string };

  /** `null` is an allowed value (`.nullable()`). */
  nullable?: boolean;
  /** A Zod string format, such as `email` or `url`. */
  format?: string;
  /** Dates: input is coerced (`z.coerce.date()`), so strings in the file are fine. */
  coerce?: boolean;
  /** The default is computed when the entry is created (a Date), so no value is stored here. */
  defaultDynamic?: boolean;
  /** What base-type inference picks (spec §6.3 step 3): the fallback when `widget` can't be used. */
  inferredWidget?: string;
  /** For `kind: 'unknown'`: why the field is shown as raw YAML (a Zod type name, or `transform`). */
  unknownReason?: string;
  /** Objects: what happens to keys the schema doesn't list. */
  extraKeys?: 'strip' | 'passthrough' | 'strict';
  hidden?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  autocomplete?: string;
  /**
   * The editor tab the field is on: Content (`main`), Details (`details`), or
   * a tab the collection declares in vesper.config.ts, such as `seo`
   * (DECISIONS.md, "The entry editor has tabs").
   */
  placement?: string;
  /** Forms: the value may be repeated in a confirmation email (D20). */
  safeToEcho?: boolean;
  /** `hide`: the boolean from `fields.hideFromSearch()`, which keeps the entry out of site search (spec §6.19). */
  search?: 'hide';
  /** Lists of objects: the item field that names each item's row in the editor ("question"). */
  summary?: string;
  /** Unions: the key whose value says which kind an object is (`type`). */
  discriminator?: string;
  /** Unions: each kind, in schema order. A union has no `children`; see `childrenFor`. */
  variants?: FieldVariant[];
};

export type DiagnosticLevel = 'error' | 'warning' | 'info';

/** Something the developer should know about a schema or config. Shown in dev, never to editors. */
export type Diagnostic = {
  level: DiagnosticLevel;
  code: string;
  message: string;
  collection?: string;
  path?: string[];
};
