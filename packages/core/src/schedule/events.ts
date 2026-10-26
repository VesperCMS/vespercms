import type { DataValue } from '../files/equal.ts';
import type { CollectionManifest } from '../manifest/types.ts';
import { publishWindow } from './window.ts';

/** One change still to come in a site's files. */
export type ScheduledEvent = {
  at: Date;
  /** The entry goes live, or comes down. */
  change: 'publish' | 'unpublish';
  collection: string;
  id: string;
  /** Site-relative path of the entry's file. */
  path: string;
};

/** What `scheduledEvents` needs of an entry: where it is, and its values as stored. */
export type ScheduledEntry = { collection: string; id: string; path: string; data: DataValue };

/**
 * Every change still to come after `now`, soonest first (spec §6.17): an
 * entry going live at its `publishAt`, or coming down at its `unpublishAt`
 * where its collection unpublishes. The build's `schedule.json` takes the
 * first one's time, the studio's Scheduled view lists them, and the cloud
 * sets its alarm by them, so all three read the files the same way.
 */
export function scheduledEvents(
  collections: readonly CollectionManifest[],
  entries: readonly ScheduledEntry[],
  now: Date,
): ScheduledEvent[] {
  const schedules = new Map(
    collections.flatMap((c) =>
      c.presentation.schedule ? [[c.name, c.presentation.schedule]] : [],
    ),
  );
  const events: ScheduledEvent[] = [];
  for (const entry of entries) {
    const schedule = schedules.get(entry.collection);
    if (!schedule) continue;
    const { publishAt, unpublishAt } = publishWindow(schedule, entry.data);
    const where = { collection: entry.collection, id: entry.id, path: entry.path };
    if (publishAt && publishAt.getTime() > now.getTime()) {
      events.push({ at: publishAt, change: 'publish', ...where });
    }
    if (unpublishAt && unpublishAt.getTime() > now.getTime()) {
      events.push({ at: unpublishAt, change: 'unpublish', ...where });
    }
  }
  return events.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      a.collection.localeCompare(b.collection) ||
      a.id.localeCompare(b.id) ||
      (a.change === b.change ? 0 : a.change === 'publish' ? -1 : 1),
  );
}
