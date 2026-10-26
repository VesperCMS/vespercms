import type { SchedulePresentation } from '@vesper/core';
import { isPublished, scheduleStatus } from '@vesper/core/schedule';

/*
 * `vesper:content`'s loaders in a build (spec §6.17, D18): an entry of a
 * scheduled collection outside its publish window at the build's instant is
 * left out, as if it didn't exist, so its page isn't built and no list
 * shows it. Other collections pass through untouched, and nothing is
 * recorded. The site helpers read through `getCollection`, so they follow.
 */

export type ScheduleData = {
  /** The build's instant, ISO: one for every check in the build. */
  instant: string;
  /** Each scheduled collection's schedule, by name. */
  schedules: Record<string, SchedulePresentation>;
};

type Entry = { collection?: unknown; data?: unknown };
type Content = {
  getCollection: (name: string, filter?: (entry: never) => unknown) => Promise<Entry[]>;
  getEntry: (...args: never[]) => Promise<Entry | undefined>;
  getEntries: (refs: never[]) => Promise<Entry[]>;
};

/**
 * In dev, what an entry's schedule says now (spec §6.17's dev marker): its
 * status words, and whether visitors would see it in a build now. Nothing
 * for an entry of an unscheduled collection, or one live with no end.
 */
export function scheduleNote(
  entry: Entry,
  data: { schedules: Record<string, SchedulePresentation>; zone: string },
): { status?: string; outside?: true } {
  if (typeof entry.collection !== 'string') return {};
  const schedule = data.schedules[entry.collection];
  if (!schedule) return {};
  const now = new Date();
  const status = scheduleStatus(schedule, entry.data as never, now, data.zone);
  return {
    ...(status ? { status } : {}),
    ...(isPublished(schedule, entry.data as never, now) ? {} : { outside: true as const }),
  };
}

export function scheduledLoaders(content: Content, data: ScheduleData) {
  const at = new Date(data.instant);
  const live = (entry: Entry | undefined): boolean => {
    if (!entry || typeof entry.collection !== 'string') return true;
    const schedule = data.schedules[entry.collection];
    return !schedule || isPublished(schedule, entry.data as never, at);
  };
  return {
    /** After the site's own filter, as Astro runs it. */
    async getCollection(name: string, filter?: (entry: never) => unknown) {
      const list = await content.getCollection(name, filter);
      return data.schedules[name] ? list.filter(live) : list;
    },
    /** `undefined` for an entry outside its window, as Astro answers for one that doesn't exist. */
    async getEntry(...args: never[]) {
      const entry = await content.getEntry(...args);
      return live(entry) ? entry : undefined;
    },
    async getEntries(refs: never[]) {
      return (await content.getEntries(refs)).filter(live);
    },
  };
}
