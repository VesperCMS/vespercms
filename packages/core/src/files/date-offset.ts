/*
 * The UTC offset a date should be written with. A parsed date is only an
 * instant, so the offset the editor meant (the site's time zone on that
 * day, spec §6.17) travels with the Date as a hidden property. The YAML
 * writer uses it in place of the offset the old value had, so a November
 * time edited in New York is written `-05:00`, not October's `-04:00`.
 */

const OFFSET = Symbol.for('vesper.dateOffset');

/** A copy of `date` that should be written with this offset (minutes east of UTC). */
export function withOffset(date: Date, minutes: number): Date {
  const copy = new Date(date.getTime());
  Object.defineProperty(copy, OFFSET, { value: minutes, enumerable: false });
  return copy;
}

/** The offset a date was marked with, if any. */
export function offsetOf(date: Date): number | undefined {
  const value = (date as unknown as Record<symbol, unknown>)[OFFSET];
  return typeof value === 'number' ? value : undefined;
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

/** `+05:30`, `-04:00`. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  return `${sign}${pad(Math.trunc(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/** ISO 8601 at this offset: `2026-11-07T10:00:00-05:00` (milliseconds only when present). */
export function isoWithOffset(date: Date, minutes: number): string {
  const local = new Date(date.getTime() + minutes * 60_000);
  const ms = local.getUTCMilliseconds();
  return (
    `${String(local.getUTCFullYear())}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${ms !== 0 ? `.${pad(ms, 3)}` : ''}${formatOffset(minutes)}`
  );
}

/** Reads an ISO string, keeping an explicit offset as the date's write offset. */
export function parseIsoWithOffset(text: string): Date {
  const date = new Date(text);
  const match = /([-+])(\d\d):?(\d\d)$/.exec(text);
  if (!match || Number.isNaN(date.getTime())) return date;
  const [, sign, hours = '0', minutes = '0'] = match;
  return withOffset(date, (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes)));
}
