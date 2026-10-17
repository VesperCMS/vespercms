import { describe, expect, it } from 'vitest';
import { decodeValue, encodeValue } from '../studio/protocol.ts';
import { isoWithOffset, offsetOf, parseIsoWithOffset, withOffset } from './date-offset.ts';
import { writeYaml } from './yaml/write.ts';

describe('date offsets', () => {
  it('formats and parses ISO times at an offset', () => {
    const date = new Date('2026-11-07T15:00:00Z');
    expect(isoWithOffset(date, -300)).toBe('2026-11-07T10:00:00-05:00');
    expect(isoWithOffset(date, 330)).toBe('2026-11-07T20:30:00+05:30');
    const parsed = parseIsoWithOffset('2026-11-07T10:00:00-05:00');
    expect(parsed.getTime()).toBe(date.getTime());
    expect(offsetOf(parsed)).toBe(-300);
    expect(offsetOf(parseIsoWithOffset('2026-11-07T15:00:00.000Z'))).toBeUndefined();
  });

  it('travel through the studio protocol', () => {
    const date = withOffset(new Date('2026-11-07T15:00:00Z'), -300);
    const encoded = JSON.parse(JSON.stringify(encodeValue({ startsAt: date }))) as unknown;
    expect(encoded).toEqual({ startsAt: { $date: '2026-11-07T10:00:00-05:00' } });
    const decoded = decodeValue(encoded) as { startsAt: Date };
    expect(offsetOf(decoded.startsAt)).toBe(-300);
  });

  it('let the writer use the offset the editor meant, across a DST change', () => {
    const raw = 'startsAt: 2026-10-24T10:00:00-04:00\nendsAt: 2026-10-24T12:00:00Z\n';
    // 10:00 in New York on Nov 7 is after the clocks change: -05:00.
    const next = {
      startsAt: withOffset(new Date('2026-11-07T15:00:00Z'), -300),
      endsAt: withOffset(new Date('2026-11-07T17:00:00Z'), -300),
    };
    expect(writeYaml(raw, next).text).toBe(
      // A file that stores UTC keeps UTC.
      'startsAt: 2026-11-07T10:00:00-05:00\nendsAt: 2026-11-07T17:00:00Z\n',
    );
  });
});
