import { describe, expect, it } from 'vitest';
import type { SchedulePresentation } from '../manifest/types.ts';
import { isPublished, publishWindow } from './window.ts';

const schedule: SchedulePresentation = {
  unpublish: true,
  publishAt: 'publishAt',
  unpublishAt: 'unpublishAt',
};
const now = new Date('2026-10-19T12:00:00Z');

describe('the publish window', () => {
  it('keeps entries without dates, and collections without scheduling, live', () => {
    expect(isPublished(schedule, { title: 'x' }, now)).toBe(true);
    expect(isPublished(undefined, { publishAt: new Date('2099-01-01') }, now)).toBe(true);
  });

  it('holds an entry until publishAt, as YAML (a Date) or JSON (a string) writes it', () => {
    expect(isPublished(schedule, { publishAt: new Date('2026-10-31T12:00:00Z') }, now)).toBe(false);
    expect(isPublished(schedule, { publishAt: '2026-10-31T08:00:00-04:00' }, now)).toBe(false);
    expect(isPublished(schedule, { publishAt: '2026-10-19T08:00:00-04:00' }, now)).toBe(true);
  });

  it('takes an entry down at unpublishAt, unless the collection keeps it', () => {
    const data = { unpublishAt: new Date('2026-07-16T04:00:00Z') };
    expect(isPublished(schedule, data, now)).toBe(false);
    expect(isPublished({ ...schedule, unpublish: false }, data, now)).toBe(true);
    // Exactly at the time, it's gone.
    expect(isPublished(schedule, { unpublishAt: now }, now)).toBe(false);
  });

  it('reads the fields the collection names, and ignores what isn’t a date', () => {
    const custom = { unpublish: true, publishAt: 'goesLive', unpublishAt: 'expires' };
    expect(publishWindow(custom, { goesLive: '2026-01-01', expires: 'never' })).toEqual({
      publishAt: new Date('2026-01-01'),
    });
  });
});
