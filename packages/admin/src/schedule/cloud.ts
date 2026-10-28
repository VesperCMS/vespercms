import type { CloudScheduledEvent, ScheduleResponse } from '@vespercms/core';

/*
 * Scheduling connected to the cloud (spec §6.17): exact times, held drafts
 * and where each change stands. Everything here is absent when the studio
 * isn't connected (spec §6.9), where the files alone say what's scheduled.
 */

/** The time of day in the site's zone ("8:00 AM"), for a row whose day is beside it. */
function clock(at: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

/** The cloud's own word on a change in the files, matched by file, change and instant. */
export function cloudEventOf(
  schedule: ScheduleResponse | undefined,
  change: { path: string; change: 'publish' | 'unpublish'; at: string },
): CloudScheduledEvent | undefined {
  const at = Date.parse(change.at);
  return schedule?.events.find(
    (event) =>
      event.path === change.path && event.change === change.change && Date.parse(event.at) === at,
  );
}

/**
 * Where a change still to come stands, in words: "Waiting in Vesper until
 * 8:00 AM" for held drafts, "Rebuild at 8:00 AM" with a trigger, and "Next
 * build after 8:00 AM" without one.
 */
export function cloudStateWords(
  schedule: ScheduleResponse,
  event: CloudScheduledEvent | undefined,
  at: Date,
  zone: string,
): string {
  if (event?.state === 'held') return `Waiting in Vesper until ${clock(at, zone)}`;
  return schedule.trigger ? `Rebuild at ${clock(at, zone)}` : `Next build after ${clock(at, zone)}`;
}

/**
 * True when the cloud keeps the time exactly: it asks for a rebuild then,
 * or it publishes held drafts then, which starts the host's build. Only the
 * publish waits in the cloud; a time to come down is a plain field.
 */
export function cloudKeepsTime(
  schedule: ScheduleResponse | undefined,
  change: 'publish' | 'unpublish',
): boolean {
  if (!schedule) return false;
  return schedule.trigger !== null || (change === 'publish' && schedule.holdScheduledDrafts);
}

/** When the cloud should hold a draft rather than publish it: the site holds, and its time is still to come. */
export function holdUntil(
  schedule: ScheduleResponse | undefined,
  publishAt: Date | undefined,
  now: Date = new Date(),
): Date | null {
  if (!schedule?.holdScheduledDrafts || !publishAt) return null;
  return publishAt.getTime() > now.getTime() ? publishAt : null;
}
