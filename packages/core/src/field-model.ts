/**
 * The normalized field model (spec §6.3.1). `core` turns each Zod field into
 * one of these plain, serializable objects. Widgets, the manifest and
 * validation messages consume this model, never raw Zod internals.
 *
 * Validation always runs against the real Zod schema; this model only drives
 * the UI. Phase 1 adds optional keys (nullable, format, hidden, …) as the
 * walker needs them; this is the spec's baseline shape.
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
  | 'unknown';

export type FieldOption = { value: string; label: string };

export type FieldConstraints = {
  min?: number;
  max?: number;
  pattern?: string;
  options?: FieldOption[];
};

export type FieldModel = {
  /** Key path from the entry root, e.g. `['location', 'lat']`. */
  path: string[];
  kind: FieldKind;
  required: boolean;
  default?: unknown;
  /** `meta.label`, or the humanized key. */
  label: string;
  description?: string;
  widget?: string;
  widgetOptions?: Record<string, unknown>;
  constraints?: FieldConstraints;
  /** Object fields' properties, or an array's item model. */
  children?: FieldModel[];
  reference?: { collection: string };
};
