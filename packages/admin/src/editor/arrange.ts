import type { CollectionManifest, FieldModel } from '@vesper/core';
import { keyOf } from './values.ts';

/*
 * Where each field goes in the editor (spec §10.3): the title as the
 * document heading, the main fields beneath it in schema order, and
 * secondary frontmatter in the Details section at the bottom. A field's
 * `placement` (from `.meta()` or vesper.config.ts) always wins; otherwise
 * slugs, dates, tags, ordering, SEO fields and scheduling go to Details.
 * "Hide from site search" is absent, not disabled, where the collection
 * isn't searched or has no pages (spec §6.19): the manifest then names no
 * `searchHidden` field.
 */

const TITLE_KEYS = ['title', 'name', 'heading', 'label'];

const DETAIL_KEYS = new Set([
  'slug',
  'tags',
  'draft',
  'order',
  'weight',
  'sort',
  'layout',
  'template',
  'permalink',
  'canonical',
  'canonicalurl',
  'noindex',
  'nofollow',
  'aliases',
  'redirects',
  'seo',
  'meta',
]);

const DETAIL_WIDGETS = new Set(['slug', 'date', 'datetime', 'tags']);

export type ArrangedFields = {
  title: FieldModel | undefined;
  main: FieldModel[];
  details: FieldModel[];
};

export function arrangeFields(collection: CollectionManifest): ArrangedFields {
  const searched = collection.presentation.searchHidden !== undefined;
  const fields = (collection.fields ?? []).filter(
    (field) => !field.hidden && (searched || field.search !== 'hide'),
  );
  const title = fields.find(
    (field) =>
      field.kind === 'string' && TITLE_KEYS.includes(keyOf(field)) && field.placement !== 'details',
  );
  const schedule = collection.presentation.schedule;
  const scheduled = new Set(schedule ? [schedule.publishAt, schedule.unpublishAt] : []);

  const main: FieldModel[] = [];
  const details: FieldModel[] = [];
  for (const field of fields) {
    if (field === title) continue;
    if (field.placement === 'main') main.push(field);
    else if (field.placement === 'details' || isDetail(field, scheduled)) details.push(field);
    else main.push(field);
  }
  return { title, main, details };
}

function isDetail(field: FieldModel, scheduled: ReadonlySet<string>): boolean {
  const key = keyOf(field);
  const lower = key.toLowerCase();
  return (
    scheduled.has(key) ||
    DETAIL_KEYS.has(lower) ||
    field.kind === 'date' ||
    DETAIL_WIDGETS.has(field.widget ?? '') ||
    /^(seo|meta|og)[A-Z_]|^seo$|Seo$/.test(key) ||
    /(At|On|Date)$/.test(key)
  );
}
