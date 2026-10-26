import type { DataValue } from '../files/equal.ts';
import type { SchedulePresentation } from '../manifest/types.ts';
import { isRepeatedTime } from './time.ts';
import { publishWindow } from './window.ts';

/*
 * The schedule in words (spec §6.17; §10.4: status is text). They come from
 * core so the editor's bar, the entry list, the Scheduled view and the dev
 * toolbar say the same thing. Times are the site's wall time; the zone's
 * short name follows only in the hour a DST change repeats, where the time
 * alone would name two moments.
 */

function yearIn(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric' }).format(instant);
}

/** "Sat, Oct 31", with the year when it isn't `now`'s. */
export function scheduleDay(instant: Date, zone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(yearIn(instant, zone) === yearIn(now, zone) ? {} : { year: 'numeric' }),
  }).format(instant);
}

/** "Sat, Oct 31, 8:00 AM", with the year when it isn't `now`'s, and "1:30 AM EDT" in a repeated hour. */
export function scheduleTime(instant: Date, zone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(yearIn(instant, zone) === yearIn(now, zone) ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
    ...(isRepeatedTime(instant, zone) ? { timeZoneName: 'short' } : {}),
  }).format(instant);
}

/**
 * An entry's schedule as status words at `now`: "Scheduled · Sat, Oct 31,
 * 8:00 AM" before it goes live, "Live until Fri, Nov 13, 12:00 AM" while a
 * time to come down waits, "Unpublished · Sun, Oct 25" after. Null when
 * there's nothing to say: no schedule, or live with no end.
 */
export function scheduleStatus(
  schedule: SchedulePresentation | undefined,
  data: DataValue,
  now: Date,
  zone: string,
): string | null {
  const { publishAt, unpublishAt } = publishWindow(schedule, data);
  if (unpublishAt && unpublishAt.getTime() <= now.getTime()) {
    return `Unpublished · ${scheduleDay(unpublishAt, zone, now)}`;
  }
  if (publishAt && publishAt.getTime() > now.getTime()) {
    return `Scheduled · ${scheduleTime(publishAt, zone, now)}`;
  }
  if (unpublishAt) return `Live until ${scheduleTime(unpublishAt, zone, now)}`;
  return null;
}
