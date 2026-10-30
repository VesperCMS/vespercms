import type { CollectionManifest, Draft } from '@vespercms/core';
import { describe, expect, it } from 'vitest';
import { playgroundManifest } from '../test/helpers.tsx';
import { entryState, isNewInDraft, stateText } from './status.tsx';

/*
 * An entry's state word and its colour (DECISIONS.md, "Status words have
 * colour"), on 26 October 2026 in the playground's zone.
 */

const collection = (name: string) =>
  playgroundManifest.collections.find((c) => c.name === name) as CollectionManifest;
const options = { zone: 'America/New_York', cloud: false, now: new Date('2026-10-26T16:00:00Z') };

describe('an entry’s state', () => {
  it('takes its word and colour from the schedule, and keeps the schedule’s words', () => {
    const events = collection('events');
    const state = (times: Record<string, string>) =>
      entryState(events, { draft: false, times }, options);
    expect(state({ publishAt: '2026-10-31T12:00:00.000Z' })).toEqual({
      tone: 'scheduled',
      word: 'Scheduled',
      rest: ' · Sat, Oct 31, 8:00 AM',
    });
    expect(state({ unpublishAt: '2026-11-13T05:00:00.000Z' })).toMatchObject({
      tone: 'live',
      word: 'Live',
    });
    expect(stateText(state({ unpublishAt: '2026-11-13T05:00:00.000Z' }))).toBe(
      'Live until Fri, Nov 13, 12:00 AM',
    );
    expect(state({ unpublishAt: '2026-10-25T04:00:00.000Z' })).toMatchObject({
      tone: 'neutral',
      word: 'Unpublished',
    });
    // Gone live, with no end: simply live.
    expect(state({ publishAt: '2026-10-01T12:00:00.000Z' })).toEqual({
      tone: 'live',
      word: 'Live',
      rest: '',
    });
  });

  it('says Draft first, in grey, with any schedule after it as words', () => {
    expect(
      entryState(
        collection('events'),
        { draft: true, times: { publishAt: '2026-10-31T12:00:00.000Z' } },
        options,
      ),
    ).toEqual({ tone: 'neutral', word: 'Draft', rest: ' · Scheduled · Sat, Oct 31, 8:00 AM' });
    expect(entryState(collection('blog'), { draft: true, times: {} }, options)?.word).toBe('Draft');
  });

  it('says Live only where an entry could be something else', () => {
    // A `draft` field, a schedule, or the cloud, where a new entry starts as a draft.
    expect(entryState(collection('blog'), { draft: false, times: {} }, options)?.word).toBe('Live');
    expect(entryState(collection('locations'), { draft: false, times: {} }, options)).toBeNull();
    expect(
      entryState(collection('locations'), { draft: false, times: {} }, { ...options, cloud: true })
        ?.word,
    ).toBe('Live');
    // Times not known: a scheduled collection's row can't say Live.
    expect(entryState(collection('events'), { draft: false, times: null }, options)).toBeNull();
  });

  it('calls an entry only in a cloud draft a draft, and one already published live', () => {
    const draft = (base: string | null): Draft => ({
      id: 'd1',
      summary: 'Add “Ferry times” in Locations',
      files: [
        { op: 'put', path: 'src/content/locations/ferry.yaml', version: 'v2', size: 10, base },
      ],
      authors: [{ id: 'u1', name: 'Sam' }],
      updatedBy: { id: 'u1', name: 'Sam' },
      updatedAt: '2026-10-26T15:00:00.000Z',
    });
    const path = 'src/content/locations/ferry.yaml';
    expect(isNewInDraft([draft(null)], path)).toBe(true);
    expect(isNewInDraft([draft('v1')], path)).toBe(false);
    const cloud = { ...options, cloud: true };
    expect(
      entryState(
        collection('locations'),
        { draft: false, times: {}, newDraft: isNewInDraft([draft(null)], path) },
        cloud,
      )?.word,
    ).toBe('Draft');
    expect(
      entryState(
        collection('locations'),
        { draft: false, times: {}, newDraft: isNewInDraft([draft('v1')], path) },
        cloud,
      )?.word,
    ).toBe('Live');
  });
});
