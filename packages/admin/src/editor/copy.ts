import type { CollectionManifest, DataObject } from '@vesper/core';
import { arrangeFields } from './arrange.ts';
import { keyOf } from './values.ts';

/**
 * A copy's starting values (Duplicate, spec §10.3): every value as it is,
 * " (copy)" after the title, and the fields that hold the entry's own address
 * left empty so the copy gets its own. Those are the slug widget's, which then
 * follow the new title, and a top-level `slug`, which Astro takes as the
 * entry's ID. Images are shared, so their focal points and crops come along.
 */
export function copiedValues(collection: CollectionManifest, values: DataObject): DataObject {
  const title = arrangeFields(collection).title;
  const titleKey = title ? keyOf(title) : null;
  const addresses = new Set([
    'slug',
    ...(collection.fields ?? [])
      .filter((field) => field.path.length === 1 && field.widget === 'slug')
      .map(keyOf),
  ]);
  return Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => !addresses.has(key))
      .map(([key, value]) =>
        key === titleKey && typeof value === 'string' && value.trim() !== ''
          ? [key, `${value} (copy)`]
          : [key, value],
      ),
  );
}
