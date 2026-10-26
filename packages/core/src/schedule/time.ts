import { withOffset } from '../files/date-offset.ts';

/*
 * Times in the site's time zone (spec §6.17): shown and entered as wall
 * time there, stored as an instant with that zone's offset on that day.
 * Plain Intl, no time zone library, so the same code runs in the studio,
 * the build and the cloud.
 */

const DAY = 86_400_000;

/** The site's zone when it's set and valid, otherwise the viewer's own. */
export function resolveTimeZone(site: string | undefined): { zone: string; isSite: boolean } {
  if (site) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: site });
      return { zone: site, isSite: true };
    } catch {
      // Invalid names are reported to the developer when the config loads.
    }
  }
  return { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, isSite: false };
}

function parts(instant: Date, zone: string): Record<string, number> {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const part of format.formatToParts(instant)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

/** The zone's offset from UTC at that instant, in minutes east. */
export function offsetMinutes(instant: Date, zone: string): number {
  const p = parts(instant, zone);
  const asUtc = Date.UTC(
    p.year ?? 1970,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` in the zone, for a datetime-local input. */
export function wallTime(instant: Date, zone: string): string {
  const p = parts(instant, zone);
  return `${String(p.year)}-${pad(p.month ?? 1)}-${pad(p.day ?? 1)}T${pad(p.hour ?? 0)}:${pad(p.minute ?? 0)}`;
}

/**
 * Every instant a wall time names in the zone: one, two in the hour a DST
 * change repeats, none in the hour it skips. Candidates come from the
 * offsets a day either side, which differ only across a change.
 */
function instantsOf(wall: string, zone: string): { exact: number[]; candidates: number[] } {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(wall);
  if (!match) return { exact: [], candidates: [] };
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = new Set([
    offsetMinutes(new Date(guess - DAY), zone),
    offsetMinutes(new Date(guess + DAY), zone),
  ]);
  const candidates = [...offsets].map((offset) => guess - offset * 60_000);
  const text = wall.slice(0, 16);
  return {
    exact: candidates
      .filter((instant) => wallTime(new Date(instant), zone) === text)
      .sort((a, b) => a - b),
    candidates,
  };
}

/**
 * The instant a wall time in the zone names, marked with that day's offset
 * so it's written as `…-05:00`. A time a DST change skips moves forward by
 * the gap, as the clocks do (2:30 becomes 3:30); a repeated one takes the
 * first.
 */
export function fromWallTime(text: string, zone: string): Date | null {
  const { exact, candidates } = instantsOf(text, zone);
  if (candidates.length === 0) return null;
  const instant = exact[0] ?? Math.max(...candidates);
  return withOffset(new Date(instant), offsetMinutes(new Date(instant), zone));
}

/** Whether the instant's wall time happens twice in the zone, in the hour a DST change repeats. */
export function isRepeatedTime(instant: Date, zone: string): boolean {
  return instantsOf(wallTime(instant, zone), zone).exact.length > 1;
}

/** "Eastern Time", or the zone's own name when there's no friendlier one. */
export function zoneName(zone: string, instant: Date = new Date(), locale?: string): string {
  for (const style of ['longGeneric', 'long'] as const) {
    try {
      const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: style })
        .formatToParts(instant)
        .find((part) => part.type === 'timeZoneName')?.value;
      if (name && !/^GMT[+-]/.test(name)) return name;
    } catch {
      // Older engines lack longGeneric; try the next style.
    }
  }
  return zone;
}
