import { withOffset } from '@vesper/core';

/*
 * Times in the site's time zone (spec §6.17): shown and entered as wall
 * time there, stored as an instant with that zone's offset on that day.
 * Plain Intl, no time zone library.
 */

/** The site's zone when it's set and valid, otherwise the editor's own. */
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
 * The instant a wall time in the zone names, marked with that day's offset
 * so it's written as `…-05:00`. Times skipped by a DST change move forward;
 * repeated times take the first.
 */
export function fromWallTime(text: string, zone: string): Date | null {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = offsetMinutes(new Date(guess), zone);
  let instant = guess - first * 60_000;
  const second = offsetMinutes(new Date(instant), zone);
  if (second !== first) instant = guess - second * 60_000;
  return withOffset(new Date(instant), offsetMinutes(new Date(instant), zone));
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
