import type { SchedulePresentation } from '@vespercms/core';
import { isPublished, scheduleStatus } from '@vespercms/core/schedule';

/*
 * `vesper:content`'s loaders in a build (spec §6.17, D18): an entry of a
 * scheduled collection outside its publish window at the build's instant is
 * left out, as if it didn't exist, so its page isn't built and no list
 * shows it. So is a draft (`draft: true`) in a collection with a `draft`
 * field (DECISIONS.md, "Unpublishing is `draft: true`"). Other collections
 * pass through untouched, and nothing is recorded. The site helpers read
 * through `getCollection`, so they follow.
 */

export type ScheduleData = {
  /** The build's instant, ISO: one for every check in the build. */
  instant: string;
  /** Each scheduled collection's schedule, by name. */
  schedules: Record<string, SchedulePresentation>;
  /** The collections whose entries can be drafts: they have a `draft` field. */
  drafts: string[];
};

type Entry = { collection?: unknown; data?: unknown };
type Content = {
  getCollection: (name: string, filter?: (entry: never) => unknown) => Promise<Entry[]>;
  getEntry: (...args: never[]) => Promise<Entry | undefined>;
  getEntries: (refs: never[]) => Promise<Entry[]>;
};

/** A draft its collection keeps out of the build. */
function drafted(entry: Entry, drafts: readonly string[]): boolean {
  return (
    typeof entry.collection === 'string' &&
    drafts.includes(entry.collection) &&
    typeof entry.data === 'object' &&
    entry.data !== null &&
    (entry.data as { draft?: unknown }).draft === true
  );
}

/**
 * In dev, what an entry's schedule says now (spec §6.17's dev marker): its
 * status words, and whether visitors would see it in a build now. A draft
 * says "Draft", and is outside. Nothing for an entry of an unscheduled
 * collection, or one live with no end.
 */
export function scheduleNote(
  entry: Entry,
  data: { schedules: Record<string, SchedulePresentation>; drafts: string[]; zone: string },
): { status?: string; outside?: true } {
  if (typeof entry.collection !== 'string') return {};
  if (drafted(entry, data.drafts)) return { status: 'Draft', outside: true };
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
    if (drafted(entry, data.drafts)) return false;
    const schedule = data.schedules[entry.collection];
    return !schedule || isPublished(schedule, entry.data as never, at);
  };
  return {
    /** After the site's own filter, as Astro runs it. */
    async getCollection(name: string, filter?: (entry: never) => unknown) {
      const list = await content.getCollection(name, filter);
      return data.schedules[name] || data.drafts.includes(name) ? list.filter(live) : list;
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
