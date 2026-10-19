import { isPlainObject, type DataValue } from '../files/equal.ts';
import type { FieldModel } from '../field-model.ts';
import type { CollectionManifest, Manifest } from '../manifest/types.ts';
import { dateOf as dateValue } from '../schedule/window.ts';
import { titleOf } from '../studio/service.ts';

/*
 * What site search knows about an entry's page beyond its text (spec §6.19):
 * the result's title and date, the filters it belongs to, and its sort
 * keys. The build writes these into the copy of the page Pagefind reads, as
 * `<meta>` tags; the page in `dist/` is never changed.
 */

/** Per collection: the fields offered as filters, and those results can be sorted by. */
export type SearchFieldSettings = { filters?: readonly string[]; sort?: readonly string[] };

export type SearchAnnotations = {
  title: string;
  /** The date shown with the result, in words, and as `<time datetime>` wants it. */
  date?: { text: string; iso: string };
  /** Filter name and values, in order; `Section` (the collection's label) comes first. */
  filters: [name: string, values: string[]][];
  /** Sort key and a value that sorts correctly: an ISO date and time in UTC, or a number. */
  sort: [key: string, value: string][];
};

/** The filter every entry page has: its collection's label. Static pages have none. */
export const SECTION_FILTER = 'Section';

export type SearchAnnotationInput = {
  collection: CollectionManifest;
  id: string;
  data: DataValue;
  settings: SearchFieldSettings;
  /** The page's language (`<html lang>`), for the date. */
  locale: string;
  /** The site's IANA time zone, for dates with a time. */
  timeZone?: string;
  /** The title of a referenced entry, for reference filters. */
  referenceTitle: (collection: string, id: string) => string | undefined;
};

export function searchAnnotations(input: SearchAnnotationInput): SearchAnnotations {
  const { collection, data, settings } = input;
  const fields = collection.fields;
  const filters: [string, string[]][] = [[SECTION_FILTER, [collection.label]]];
  for (const name of settings.filters ?? []) {
    const field = fieldFor(fields, name);
    if (!field || !filterItem(field)) continue;
    const values = filterValues(field, valueAt(data, field.path), input.referenceTitle);
    if (values.length > 0) filters.push([field.label, values]);
  }
  const sort: [string, string][] = [];
  for (const name of settings.sort ?? []) {
    const field = fieldFor(fields, name);
    const value = field ? sortValue(field, valueAt(data, field.path)) : undefined;
    if (value !== undefined) sort.push([name, value]);
  }
  const date = resultDate(collection, data, settings, input.locale, input.timeZone);
  return {
    title: titleOf(collection, data, input.id),
    ...(date ? { date } : {}),
    filters,
    sort,
  };
}

/**
 * The first image an entry has: the search result's thumbnail, cut with the
 * square crop (spec §6.6.3). A `fields.image()` value carries its focal
 * point and crops; Astro's bare `image()` is just the file's path.
 */
export function firstImage(
  collection: CollectionManifest,
  data: DataValue,
): { path: string[]; value: { [key: string]: DataValue } } | undefined {
  for (const field of collection.fields ?? []) {
    const value = valueAt(data, field.path);
    if (field.widget === 'image' && isPlainObject(value)) {
      if (typeof value.src === 'string' && value.src !== '')
        return { path: [...field.path], value };
    } else if (field.kind === 'image' && typeof value === 'string' && value !== '') {
      return { path: [...field.path], value: { src: value } };
    }
  }
  return undefined;
}

/**
 * What's wrong with `search.filters` and `search.sort`, once per field, so
 * the build can warn: unknown collections and fields, and kinds that can't
 * be filters or sort keys.
 */
export function searchSettingsProblems(
  manifest: Manifest,
  settings: {
    filters?: Readonly<Record<string, readonly string[]>>;
    sort?: Readonly<Record<string, readonly string[]>>;
  },
): string[] {
  const problems: string[] = [];
  for (const kind of ['filters', 'sort'] as const) {
    for (const [name, list] of Object.entries(settings[kind] ?? {})) {
      const collection = manifest.collections.find((c) => c.name === name);
      if (!collection) {
        problems.push(`search.${kind} names "${name}", but there's no collection by that name.`);
        continue;
      }
      for (const key of list) {
        const field = fieldFor(collection.fields, key);
        if (!field) {
          problems.push(`search.${kind}.${name} names "${key}", which ${name} doesn't have.`);
        } else if (kind === 'filters' && !filterItem(field)) {
          problems.push(
            `search.filters.${name}: "${key}" can't be a filter, so it's left out. Filters can be text, lists of text, selects and references.`,
          );
        } else if (kind === 'sort' && !SORTABLE.has(field.kind)) {
          problems.push(
            `search.sort.${name}: "${key}" can't sort results, so it's left out. Sort keys can be dates, numbers and text.`,
          );
        }
      }
    }
  }
  return problems;
}

const SORTABLE = new Set(['date', 'number', 'string']);

/** A field by its key, or a dotted path into objects (`seo.keywords`). */
function fieldFor(fields: readonly FieldModel[] | null, name: string): FieldModel | undefined {
  let list = fields ?? [];
  let found: FieldModel | undefined;
  for (const key of name.split('.')) {
    found = list.find((field) => field.path.at(-1) === key);
    if (!found) return undefined;
    list = found.children ?? [];
  }
  return found;
}

function valueAt(data: DataValue, path: readonly string[]): DataValue {
  let value = data;
  for (const key of path) {
    if (!isPlainObject(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** The model of one filter value: the field itself, or a list's item. */
function filterItem(field: FieldModel): FieldModel | undefined {
  const item = field.kind === 'array' ? field.children?.[0] : field;
  return item && (item.kind === 'string' || item.kind === 'enum' || item.kind === 'reference')
    ? item
    : undefined;
}

function filterValues(
  field: FieldModel,
  value: DataValue,
  referenceTitle: SearchAnnotationInput['referenceTitle'],
): string[] {
  const item = filterItem(field);
  if (!item) return [];
  const raw = field.kind === 'array' ? (Array.isArray(value) ? value : []) : [value];
  const texts = raw.flatMap((one) => {
    if (item.kind === 'enum') {
      if (typeof one !== 'string') return [];
      return [item.constraints?.options?.find((o) => o.value === one)?.label ?? one];
    }
    if (item.kind === 'reference') {
      const id =
        typeof one === 'string'
          ? one
          : isPlainObject(one) && typeof one.id === 'string'
            ? one.id
            : '';
      if (!id || !item.reference) return [];
      return [referenceTitle(item.reference.collection, id) ?? id];
    }
    return typeof one === 'string' && one.trim() !== '' ? [one.trim()] : [];
  });
  return [...new Set(texts)];
}

function sortValue(field: FieldModel, value: DataValue): string | undefined {
  if (field.kind === 'date') return dateValue(value)?.toISOString();
  if (field.kind === 'number') return typeof value === 'number' ? String(value) : undefined;
  if (field.kind === 'string') return typeof value === 'string' && value !== '' ? value : undefined;
  return undefined;
}

/**
 * The result's date: its first sort field that's a date, or else its first
 * date field, leaving out the schedule's own (spec §6.17). A date with no
 * time (a day at midnight UTC, as YAML reads `2026-08-22`) is that day
 * wherever the reader is; a `fields.datetime()` value shows its time in the
 * site's time zone.
 */
function resultDate(
  collection: CollectionManifest,
  data: DataValue,
  settings: SearchFieldSettings,
  locale: string,
  timeZone: string | undefined,
): { text: string; iso: string } | undefined {
  const fields = collection.fields ?? [];
  const schedule = collection.presentation.schedule;
  const scheduled = new Set(schedule ? [schedule.publishAt, schedule.unpublishAt] : []);
  const candidates = [
    ...(settings.sort ?? []).map((name) => fieldFor(fields, name)),
    ...fields.filter((field) => field.path.length === 1 && !scheduled.has(field.path[0] ?? '')),
  ];
  for (const field of candidates) {
    if (field?.kind !== 'date') continue;
    const date = dateValue(valueAt(data, field.path));
    if (!date) continue;
    const withTime = field.widget === 'datetime';
    const dayOnly = !withTime && date.toISOString().endsWith('T00:00:00.000Z');
    const zone = dayOnly ? 'UTC' : (timeZone ?? 'UTC');
    return {
      text: formatDate(date, locale, {
        dateStyle: 'long',
        ...(withTime ? { timeStyle: 'short' } : {}),
        timeZone: zone,
      }),
      iso: dayOnly ? date.toISOString().slice(0, 10) : date.toISOString(),
    };
  }
  return undefined;
}

function formatDate(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    // A language tag or time zone Intl doesn't know.
    return new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(date);
  }
}
