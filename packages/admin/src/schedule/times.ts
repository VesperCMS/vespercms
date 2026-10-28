import {
  isoWithOffset,
  offsetOf,
  publishWindow,
  resolveTimeZone,
  scheduleStatus,
  type CollectionManifest,
  type DataObject,
  type DataValue,
  type Manifest,
  type SchedulePresentation,
} from '@vespercms/core';

/*
 * An entry's schedule in the studio (spec §6.17): when it goes live, when it
 * comes down and where visitors go then, read from and written to the fields
 * its collection's `schedule` names. The words and the times come from core,
 * so the editor, the lists and the Scheduled view say the same thing.
 */

/** When an entry goes live and comes down, and where its page sends visitors after. */
export type ScheduleTimes = { publishAt?: Date; unpublishAt?: Date; redirect?: string };

/** The site's zone, for showing and entering times, or the viewer's own when it has none. */
export function siteZone(manifest: Manifest): { zone: string; isSite: boolean } {
  return resolveTimeZone(manifest.site.timeZone);
}

/** The field that holds where visitors go after, when the collection's schema has one. */
export function redirectField(collection: CollectionManifest): string | null {
  const schedule = collection.presentation.schedule;
  if (!schedule?.unpublish) return null;
  const name = schedule.unpublishRedirect ?? 'unpublishRedirect';
  return collection.fields?.some((field) => field.path.length === 1 && field.path[0] === name)
    ? name
    : null;
}

/** The schedule's field names, the redirect's when the schema has it. */
export function scheduleKeys(collection: CollectionManifest): string[] {
  const schedule = collection.presentation.schedule;
  if (!schedule) return [];
  const redirect = redirectField(collection);
  return [
    schedule.publishAt,
    ...(schedule.unpublish ? [schedule.unpublishAt] : []),
    ...(redirect ? [redirect] : []),
  ];
}

export function timesOf(collection: CollectionManifest, values: DataObject): ScheduleTimes {
  const { publishAt, unpublishAt } = publishWindow(collection.presentation.schedule, values);
  const field = redirectField(collection);
  const redirect = field ? values[field] : undefined;
  return {
    ...(publishAt ? { publishAt } : {}),
    ...(unpublishAt ? { unpublishAt } : {}),
    ...(typeof redirect === 'string' && redirect.trim() !== '' ? { redirect } : {}),
  };
}

/**
 * The values with these times in place of the old ones: a time left out is
 * removed. A time stored as a quoted string stays a string, with its offset
 * written out, as the date-time field keeps it.
 */
export function withTimes(
  collection: CollectionManifest,
  values: DataObject,
  times: ScheduleTimes,
): DataObject {
  const schedule = collection.presentation.schedule;
  if (!schedule) return values;
  const changes = new Map<string, DataValue | undefined>();
  const put = (key: string, value: DataValue | undefined) => {
    changes.set(key, value);
  };
  const time = (key: string, date: Date | undefined) =>
    date && typeof values[key] === 'string' ? isoWithOffset(date, offsetOf(date) ?? 0) : date;
  put(schedule.publishAt, time(schedule.publishAt, times.publishAt));
  if (schedule.unpublish) put(schedule.unpublishAt, time(schedule.unpublishAt, times.unpublishAt));
  const field = redirectField(collection);
  if (field) put(field, times.redirect?.trim() ? times.redirect.trim() : undefined);
  // A time left out goes; the rest keep their place in the entry's values.
  const next: DataObject = {};
  for (const [key, value] of Object.entries(values)) {
    const changed = changes.has(key) ? changes.get(key) : value;
    if (changed !== undefined) next[key] = changed;
  }
  for (const [key, value] of changes) if (value !== undefined && !(key in next)) next[key] = value;
  return next;
}

/** The entry's schedule as status words, or null when there's nothing to say. */
export function scheduleWords(
  schedule: SchedulePresentation | undefined,
  data: DataValue,
  zone: string,
  now: Date = new Date(),
): string | null {
  return scheduleStatus(schedule, data, now, zone);
}

/** An entry row's schedule (ISO times) as values under the schedule's field names. */
export function rowData(
  schedule: SchedulePresentation | undefined,
  times: { publishAt?: string; unpublishAt?: string } | undefined,
): DataObject {
  if (!schedule || !times) return {};
  return {
    ...(times.publishAt ? { [schedule.publishAt]: times.publishAt } : {}),
    ...(times.unpublishAt ? { [schedule.unpublishAt]: times.unpublishAt } : {}),
  };
}

/** Whether a row has a change still to come: it goes live or comes down later. */
export function hasUpcoming(
  times: { publishAt?: string; unpublishAt?: string } | undefined,
  now: Date = new Date(),
): boolean {
  const later = (iso: string | undefined) =>
    iso !== undefined && new Date(iso).getTime() > now.getTime();
  return later(times?.publishAt) || later(times?.unpublishAt);
}

/** "every hour", "every 15 minutes", "every 2 hours". */
export function everyText(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? 'every hour' : `every ${String(hours)} hours`;
  }
  return `every ${String(minutes)} minutes`;
}
