import { isPlainObject, type DataValue } from '../files/equal.ts';
import type { SchedulePresentation } from '../manifest/types.ts';

/*
 * An entry's publish window (spec §6.17, D18): live from `publishAt`, when
 * set, until `unpublishAt`, when set and the collection unpublishes. The
 * search index leaves out entries outside it (Phase 2.9), and Phase 4.5's
 * build-time filtering uses this same check, so the two never disagree.
 */

/** The window's ends, from the fields the collection's `schedule` names. */
export function publishWindow(
  schedule: SchedulePresentation | undefined,
  data: DataValue,
): { publishAt?: Date; unpublishAt?: Date } {
  if (!schedule || !isPlainObject(data)) return {};
  const publishAt = dateOf(data[schedule.publishAt]);
  const unpublishAt = schedule.unpublish ? dateOf(data[schedule.unpublishAt]) : undefined;
  return { ...(publishAt ? { publishAt } : {}), ...(unpublishAt ? { unpublishAt } : {}) };
}

/** Whether the entry is live at `now`. Entries of collections without scheduling always are. */
export function isPublished(
  schedule: SchedulePresentation | undefined,
  data: DataValue,
  now: Date,
): boolean {
  const { publishAt, unpublishAt } = publishWindow(schedule, data);
  if (publishAt && publishAt.getTime() > now.getTime()) return false;
  if (unpublishAt && unpublishAt.getTime() <= now.getTime()) return false;
  return true;
}

/** A date as YAML reads it (a Date) or as JSON holds it (a string). Anything else is no date. */
export function dateOf(value: DataValue): Date | undefined {
  const date =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}
