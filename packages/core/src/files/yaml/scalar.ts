import { stringify, type Scalar, type ScalarTag } from 'yaml';
import { isoWithOffset, offsetOf } from '../date-offset.ts';
import type { DataValue } from '../equal.ts';
import { readYaml } from './read.ts';
import type { YamlStyle } from './style.ts';

/**
 * YAML 1.1 timestamp, as Astro's `customTags: ['timestamp']` reads it:
 * `2026-10-17`, `2026-10-17T14:30:00Z`, `2026-10-17 14:30:00`, `…-04:00`.
 */
const TIMESTAMP_RE =
  /^(\d{4})-(\d\d?)-(\d\d?)(?:([Tt]|[ \t]+)(\d\d?):(\d\d):(\d\d)(\.\d+)?(?:[ \t]*(Z|[-+]\d\d?(?::?\d\d)?))?)?$/;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A brand-new date: date-only at UTC midnight, otherwise ISO 8601 in UTC to the second. */
export function formatNewDate(date: Date): string {
  const offset = offsetOf(date);
  if (offset !== undefined) return isoWithOffset(date, offset);
  const iso = date.toISOString();
  if (iso.endsWith('T00:00:00.000Z')) return iso.slice(0, 10);
  return date.getUTCMilliseconds() === 0 ? `${iso.slice(0, 19)}Z` : iso;
}

/**
 * Formats `date` in the same shape as an existing timestamp, so changing a
 * date keeps its style: date-only stays date-only, an offset stays that
 * offset, a space separator stays a space.
 */
export function formatDateLike(date: Date, previous: string): string {
  const match = TIMESTAMP_RE.exec(previous.trim());
  if (!match) return formatNewDate(date);
  const [, , , , separator, , , , fraction, zone] = match;
  const iso = date.toISOString();

  if (separator === undefined) {
    // Date-only. Keep it date-only unless the new value has a time of day.
    return iso.endsWith('T00:00:00.000Z') && offsetOf(date) === undefined
      ? iso.slice(0, 10)
      : formatNewDate(date);
  }
  // The offset the editor meant wins over the old one; a UTC (`Z`) file stays UTC.
  const hinted = offsetOf(date);
  if (hinted !== undefined && zone !== undefined && zone !== 'Z') {
    return isoWithOffset(date, hinted).replace('T', separator);
  }

  let offsetMinutes = 0;
  let zoneText = '';
  if (zone === 'Z') {
    zoneText = 'Z';
  } else if (zone) {
    // `+HH`, `+H`, `+HH:MM` or `+HHMM`.
    const offset = /^([-+])(\d\d?)(?::?(\d\d))?$/.exec(zone);
    if (!offset) return formatNewDate(date);
    const [, sign, hours = '0', minutes = '0'] = offset;
    offsetMinutes = (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
    zoneText = zone;
  }
  const local = new Date(date.getTime() + offsetMinutes * 60_000);
  const ms = local.getUTCMilliseconds();
  const fractionText = fraction !== undefined || ms !== 0 ? `.${pad(ms, 3)}` : '';
  const datePart = `${String(local.getUTCFullYear())}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const timePart = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
  return `${datePart}${separator}${timePart}${fractionText}${zoneText}`;
}

export function formatNumber(n: number): string {
  if (Number.isNaN(n)) return '.nan';
  if (n === Infinity) return '.inf';
  if (n === -Infinity) return '-.inf';
  return String(n);
}

/**
 * Whether `value` can be written as a plain (unquoted) scalar and read back
 * as the same string by both parsers, in block or flow context.
 */
export function isPlainSafe(value: string, inFlow: boolean): boolean {
  if (value === '' || value !== value.trim() || /[\n\r\t]/.test(value)) return false;
  const probe = inFlow ? `\nx: [${value}]\n` : `\nx: ${value}\n`;
  const read = readYaml(probe);
  if (!read.editable) return false;
  const parsed = (read.value as { x?: unknown }).x;
  return inFlow
    ? Array.isArray(parsed) && parsed.length === 1 && parsed[0] === value
    : parsed === value;
}

export type ScalarRender = { text: string; type: Scalar.Type };

/**
 * Chooses the text and style for a new scalar value. It keeps the previous
 * style where that style can hold the value, so a quoted title stays quoted
 * and a folded summary stays folded.
 */
export function renderScalar(
  value: DataValue,
  previous: { type?: Scalar.Type | undefined; source?: string | undefined; value?: unknown } | null,
  context: { inFlow: boolean; style: YamlStyle },
): ScalarRender {
  if (value === null) return { text: previous?.source === '~' ? '~' : 'null', type: 'PLAIN' };
  if (typeof value === 'boolean') return { text: String(value), type: 'PLAIN' };
  if (typeof value === 'number') return { text: formatNumber(value), type: 'PLAIN' };
  if (value instanceof Date) {
    const text =
      previous?.value instanceof Date && previous.source !== undefined
        ? formatDateLike(value, previous.source)
        : formatNewDate(value);
    return { text, type: 'PLAIN' };
  }
  if (typeof value !== 'string') throw new TypeError('renderScalar only handles scalars');

  const previousType = previous?.type;
  const isBlock = previousType === 'BLOCK_LITERAL' || previousType === 'BLOCK_FOLDED';
  if (isBlock && !context.inFlow) return { text: value, type: previousType };
  if (previousType === 'QUOTE_DOUBLE' || previousType === 'QUOTE_SINGLE') {
    return { text: value, type: previousType };
  }
  if (isPlainSafe(value, context.inFlow)) return { text: value, type: 'PLAIN' };
  return { text: value, type: context.style.quote };
}

/**
 * Writes dates the way `formatNewDate` does inside newly rendered
 * collections. yaml's built-in timestamp stringifier drops the `Z`.
 */
const timestampTag: ScalarTag = {
  identify: (value) => value instanceof Date,
  default: true,
  tag: 'tag:yaml.org,2002:timestamp',
  test: TIMESTAMP_RE,
  resolve: (source) => new Date(source),
  stringify: (item) => formatNewDate(item.value as Date),
};

/** Renders a value as standalone YAML text (block or flow), in the file's style. */
export function renderYaml(value: DataValue, style: YamlStyle, flow: boolean): string {
  return stringify(value, {
    customTags: [timestampTag],
    schema: 'core',
    indent: style.indent,
    indentSeq: style.indentSeq,
    lineWidth: 0,
    minContentWidth: 0,
    singleQuote: style.quote === 'QUOTE_SINGLE',
    flowCollectionPadding: style.flowPadding,
    collectionStyle: flow ? 'flow' : 'any',
    aliasDuplicateObjects: false,
  });
}
