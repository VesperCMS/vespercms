import { describe, expect, it } from 'vitest';
import { isoWithOffset, offsetOf } from '../files/date-offset.ts';
import { scheduledEvents } from './events.ts';
import { fromWallTime, isRepeatedTime, offsetMinutes, wallTime } from './time.ts';
import { scheduleState, scheduleStatus, scheduleTime } from './words.ts';
import type { CollectionManifest } from '../manifest/types.ts';

/*
 * Times in the site's zone across a daylight-saving change (Phase 4.5,
 * "Done when" 4): America/New_York falls back on 1 November 2026 (1:00 to
 * 2:00 AM happens twice) and springs forward on 14 March 2027 (2:00 to
 * 3:00 AM never happens).
 */

const NY = 'America/New_York';
const iso = (date: Date | null) =>
  date ? isoWithOffset(date, offsetOf(date) ?? offsetMinutes(date, NY)) : null;

describe('wall time in the site’s zone', () => {
  it('keeps the offset of the day chosen, not of the day it was chosen on', () => {
    // Chosen in October (EDT) for a day in November (EST).
    expect(iso(fromWallTime('2026-11-13T00:00', NY))).toBe('2026-11-13T00:00:00-05:00');
    expect(iso(fromWallTime('2026-10-31T08:00', NY))).toBe('2026-10-31T08:00:00-04:00');
  });

  it('takes the first of a repeated time, and tells the two apart in words', () => {
    const first = fromWallTime('2026-11-01T01:30', NY);
    expect(iso(first)).toBe('2026-11-01T01:30:00-04:00');
    const second = new Date('2026-11-01T06:30:00Z');
    expect(wallTime(second, NY)).toBe('2026-11-01T01:30');
    expect(first && isRepeatedTime(first, NY)).toBe(true);
    const now = new Date('2026-10-20T12:00:00Z');
    expect(first && scheduleTime(first, NY, now)).toBe('Sun, Nov 1, 1:30 AM EDT');
    expect(scheduleTime(second, NY, now)).toBe('Sun, Nov 1, 1:30 AM EST');
    // Outside that hour the zone isn't named.
    expect(scheduleTime(new Date('2026-11-01T08:30:00Z'), NY, now)).toBe('Sun, Nov 1, 3:30 AM');
  });

  it('moves a skipped time forward by the gap, as the clocks do', () => {
    expect(iso(fromWallTime('2027-03-14T02:30', NY))).toBe('2027-03-14T03:30:00-04:00');
    expect(iso(fromWallTime('2027-03-14T01:59', NY))).toBe('2027-03-14T01:59:00-05:00');
    expect(iso(fromWallTime('2027-03-14T03:00', NY))).toBe('2027-03-14T03:00:00-04:00');
  });

  it('takes the first of a repeated time east of Greenwich too', () => {
    // Paris falls back from 3:00 CEST to 2:00 CET on 25 October 2026.
    const first = fromWallTime('2026-10-25T02:30', 'Europe/Paris');
    expect(first?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(fromWallTime('2027-03-28T02:30', 'Europe/Paris')?.toISOString()).toBe(
      '2027-03-28T01:30:00.000Z',
    );
  });

  it('refuses text that isn’t a wall time', () => {
    expect(fromWallTime('next tuesday', NY)).toBeNull();
  });
});

describe('the schedule in words', () => {
  const schedule = { unpublish: true, publishAt: 'publishAt', unpublishAt: 'unpublishAt' };
  const now = new Date('2026-10-26T16:00:00Z');

  it('says when an entry goes live, until when it’s live, and when it came down', () => {
    expect(scheduleStatus(schedule, { publishAt: new Date('2026-10-31T12:00:00Z') }, now, NY)).toBe(
      'Scheduled · Sat, Oct 31, 8:00 AM',
    );
    expect(
      scheduleStatus(schedule, { unpublishAt: new Date('2026-11-13T05:00:00Z') }, now, NY),
    ).toBe('Live until Fri, Nov 13, 12:00 AM');
    expect(
      scheduleStatus(schedule, { unpublishAt: new Date('2026-10-25T16:00:00Z') }, now, NY),
    ).toBe('Unpublished · Sun, Oct 25');
  });

  it('names the year only when it isn’t this one, and says nothing for an entry with no end', () => {
    expect(scheduleStatus(schedule, { publishAt: new Date('2027-01-04T14:00:00Z') }, now, NY)).toBe(
      'Scheduled · Mon, Jan 4, 2027, 9:00 AM',
    );
    expect(
      scheduleStatus(schedule, { publishAt: new Date('2026-10-01T12:00:00Z') }, now, NY),
    ).toBeNull();
    expect(scheduleStatus(undefined, { publishAt: new Date('2027-01-04') }, now, NY)).toBeNull();
  });

  it('splits the words into the status word, coloured by its phase, and the rest', () => {
    expect(
      scheduleState(schedule, { publishAt: new Date('2026-10-31T12:00:00Z') }, now, NY),
    ).toEqual({ phase: 'scheduled', word: 'Scheduled', rest: ' · Sat, Oct 31, 8:00 AM' });
    expect(
      scheduleState(schedule, { unpublishAt: new Date('2026-11-13T05:00:00Z') }, now, NY),
    ).toEqual({ phase: 'live', word: 'Live', rest: ' until Fri, Nov 13, 12:00 AM' });
    expect(
      scheduleState(schedule, { unpublishAt: new Date('2026-10-25T16:00:00Z') }, now, NY),
    ).toEqual({ phase: 'unpublished', word: 'Unpublished', rest: ' · Sun, Oct 25' });
  });
});

describe('scheduledEvents', () => {
  const collection = (
    name: string,
    schedule?: CollectionManifest['presentation']['schedule'],
  ): CollectionManifest => ({
    name,
    label: name,
    editable: true,
    source: { loader: 'glob', base: name, pattern: '*.md', generateId: 'default', formats: ['md'] },
    entryKind: 'content',
    fields: null,
    presentation: schedule ? { schedule } : {},
  });
  const events = collection('events', {
    unpublish: true,
    publishAt: 'publishAt',
    unpublishAt: 'unpublishAt',
  });
  const news = collection('news', { unpublish: false, publishAt: 'goesLive', unpublishAt: 'x' });
  const pages = collection('pages');
  const now = new Date('2026-10-26T16:00:00Z');
  const entry = (c: string, id: string, data: Record<string, unknown>) => ({
    collection: c,
    id,
    path: `${c}/${id}.md`,
    data: data as never,
  });

  it('lists every change still to come, soonest first, from the fields each collection names', () => {
    const found = scheduledEvents(
      [events, news, pages],
      [
        entry('events', 'harvest-concert', { publishAt: new Date('2026-10-31T12:00:00Z') }),
        // Both its times are in the hour 1 November repeats.
        entry('events', 'night-owl-study-hall', {
          publishAt: '2026-11-01T01:30:00-04:00',
          unpublishAt: '2026-11-01T01:30:00-05:00',
        }),
        entry('events', 'fall-open-house', { unpublishAt: new Date('2026-10-18T04:00:00Z') }),
        entry('news', 'launch', { goesLive: new Date('2026-10-28T13:00:00Z'), x: '2027-01-01' }),
        entry('pages', 'about', { publishAt: new Date('2027-01-01') }),
        entry('events', 'spring-commencement', { title: 'Commencement' }),
      ],
      now,
    );
    expect(found.map((e) => [e.at.toISOString(), e.change, e.id])).toEqual([
      ['2026-10-28T13:00:00.000Z', 'publish', 'launch'],
      ['2026-10-31T12:00:00.000Z', 'publish', 'harvest-concert'],
      ['2026-11-01T05:30:00.000Z', 'publish', 'night-owl-study-hall'],
      ['2026-11-01T06:30:00.000Z', 'unpublish', 'night-owl-study-hall'],
    ]);
    expect(found[0]).toMatchObject({ collection: 'news', path: 'news/launch.md' });
  });
});
