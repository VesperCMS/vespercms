/*
 * Words for numbers and times (spec §10.2: words over badges). Everything
 * takes `now` and a locale so tests are deterministic.
 */

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago". */
export function formatRelative(iso: string, now: Date = new Date(), locale?: string): string {
  const then = new Date(iso);
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
  if (Number.isNaN(seconds)) return '';
  if (Math.abs(seconds) < 45) return 'just now';
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === 'minute') {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return 'just now';
}

/** "1 entry", "12 entries". */
export function formatCount(
  count: number,
  singular: string,
  plural: string,
  locale?: string,
): string {
  const number = new Intl.NumberFormat(locale).format(count);
  return `${number} ${count === 1 ? singular : plural}`;
}
