import { describe, expect, it } from 'vitest';
import { formatCount, formatRelative } from './format.ts';

describe('formatRelative', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  it.each([
    ['2026-10-17T11:59:40Z', 'just now'],
    ['2026-10-17T11:55:00Z', '5 minutes ago'],
    ['2026-10-17T09:00:00Z', '3 hours ago'],
    ['2026-10-16T10:00:00Z', 'yesterday'],
    ['2026-09-26T12:00:00Z', '3 weeks ago'],
    ['2025-10-17T12:00:00Z', 'last year'],
  ])('%s is "%s"', (iso, expected) => {
    expect(formatRelative(iso, now, 'en')).toBe(expected);
  });

  it('gives nothing for a date it cannot read', () => {
    expect(formatRelative('not a date', now, 'en')).toBe('');
  });
});

describe('formatCount', () => {
  it('picks singular or plural', () => {
    expect(formatCount(1, 'entry', 'entries', 'en')).toBe('1 entry');
    expect(formatCount(1200, 'entry', 'entries', 'en')).toBe('1,200 entries');
  });
});
