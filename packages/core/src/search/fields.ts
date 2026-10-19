import { isPlainObject, type DataValue } from '../files/equal.ts';
import type { FieldModel } from '../field-model.ts';
import type { CollectionManifest } from '../manifest/types.ts';

/*
 * Which field hides an entry from site search (spec §6.19). The switch is a
 * boolean the schema declares, so Astro validates it and the site's own
 * layout can read the same value (DECISIONS.md, "Hide from site search is a
 * schema field"): `fields.hideFromSearch()`, or a boolean SEO field named
 * `noindex`, at the top level or under `seo`, found by name.
 */

/** The path of the collection's hide-from-search boolean, or undefined when it has none. */
export function searchHiddenField(fields: readonly FieldModel[] | null): string[] | undefined {
  if (!fields) return undefined;
  const isBoolean = (field: FieldModel | undefined): field is FieldModel =>
    field?.kind === 'boolean';
  const marked = (list: readonly FieldModel[]) =>
    list.find((field) => isBoolean(field) && field.search === 'hide');
  const top = marked(fields);
  if (top) return [...top.path];
  for (const field of fields) {
    if (field.kind !== 'object' || !field.children) continue;
    const nested = marked(field.children);
    if (nested) return [...nested.path];
  }
  const noindex = fields.find((field) => field.path.length === 1 && field.path[0] === 'noindex');
  if (isBoolean(noindex)) return ['noindex'];
  const seo = fields.find((field) => field.path.length === 1 && field.path[0] === 'seo');
  const nested = seo?.children?.find((field) => field.path.at(-1) === 'noindex');
  if (isBoolean(nested)) return [...nested.path];
  return undefined;
}

/** Whether the entry's data turns on its collection's hide-from-search switch. */
export function isHiddenFromSearch(collection: CollectionManifest, data: DataValue): boolean {
  const path = collection.presentation.searchHidden;
  if (!path) return false;
  let value: DataValue = data;
  for (const key of path) {
    if (!isPlainObject(value)) return false;
    value = value[key];
  }
  return value === true;
}
