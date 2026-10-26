import { isPlainObject } from '../files/equal.ts';
import type { FieldModel, FieldVariant } from '../field-model.ts';

/*
 * A union field has no `children` of its own: which fields an object holds
 * depends on its kind. Walks over an entry ask `childrenFor` with the value
 * in hand; walks over a schema ask `fieldChildren` for every kind's. A union
 * model has no `children` on purpose, so a walker that hasn't learned kinds
 * skips them instead of misreading one kind's fields as another's.
 */

/** The kind a value names, or undefined when it names none the union has. */
export function variantFor(field: FieldModel, value: unknown): FieldVariant | undefined {
  if (field.kind !== 'union' || !field.discriminator || !isPlainObject(value)) return undefined;
  const named = value[field.discriminator];
  return field.variants?.find((variant) => variant.value === named);
}

/** The fields a value holds: an object's children, or those of the kind a union's value names. */
export function childrenFor(field: FieldModel, value: unknown): readonly FieldModel[] {
  if (field.kind === 'union') return variantFor(field, value)?.children ?? [];
  return field.children ?? [];
}

/** Every field a field can hold: its children, or every kind's. For walks over a schema. */
export function fieldChildren(field: FieldModel): readonly FieldModel[] {
  if (field.kind === 'union') return (field.variants ?? []).flatMap((variant) => variant.children);
  return field.children ?? [];
}
