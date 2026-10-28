import type { CollectionManifest, FieldModel } from '@vespercms/core';
import { keyOf } from './values.ts';

/*
 * Where each field goes in the editor (spec §10.3, and DECISIONS.md, "The
 * entry editor has tabs"): the title as the document heading, above the
 * tabs; the main fields on Content, in schema order; secondary frontmatter
 * on Details; and fields placed on a tab vesper.config.ts declares, on that
 * tab. A field's `placement` (from `.meta()` or vesper.config.ts) always
 * wins; otherwise slugs, dates, tags, ordering, SEO fields and scheduling
 * go to Details.
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
  /** The collection's own tabs, in the order it declares them, each with its fields. */
  tabs: { id: string; label: string; fields: FieldModel[] }[];
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
  // Where visitors go once it comes down belongs with the times.
  const scheduled = new Set(
    schedule
      ? [
          schedule.publishAt,
          schedule.unpublishAt,
          schedule.unpublishRedirect ?? 'unpublishRedirect',
        ]
      : [],
  );

  const main: FieldModel[] = [];
  const details: FieldModel[] = [];
  const tabs = (collection.presentation.tabs ?? []).map((tab) => ({
    ...tab,
    fields: [] as FieldModel[],
  }));
  for (const field of fields) {
    if (field === title) continue;
    const own = tabs.find((tab) => tab.id === field.placement);
    if (own) own.fields.push(field);
    else if (field.placement === 'main') main.push(field);
    else if (field.placement === 'details' || isDetail(field, scheduled)) details.push(field);
    else main.push(field);
  }
  return { title, main, details, tabs: tabs.filter((tab) => tab.fields.length > 0) };
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
