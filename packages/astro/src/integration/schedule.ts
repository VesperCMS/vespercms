import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ContentService,
  PageService,
  urlKey,
  type DataValue,
  type StaticRoutes,
  type UrlSettings,
} from '@vesper/core';
import {
  isPublished,
  publishWindow,
  resolveTimeZone,
  scheduleDay,
  scheduleTime,
  scheduledEvents,
  type ScheduledEntry,
} from '@vesper/core/schedule';
import type { SiteModel } from '../node/manifest.ts';
import { LocalStorage } from '../node/storage-local.ts';
import { builtPages, skipReason } from './a11y.ts';

/*
 * Scheduling at build (spec §6.17, D18): any build at or after a time gives
 * the right site, on any host. Every check in one build uses one instant,
 * read once when the build starts: `vesper:content`, redirects, search and
 * `schedule.json`. A page built a second after a time can't then show an
 * entry that another page of the same build leaves out.
 */

/** Where every build says when the site next changes. */
export const SCHEDULE_PATH = '_vesper/schedule.json';

/**
 * The build's instant: `VESPER_BUILD_TIME` when it's set, to build the site
 * as it will be (or as it was, for tests), otherwise now.
 */
export function buildInstant(value: string | undefined, now: Date = new Date()): Date {
  if (value === undefined || value.trim() === '') return now;
  const instant = new Date(value.trim());
  if (Number.isNaN(instant.getTime())) {
    throw new Error(
      `VESPER_BUILD_TIME is "${value}", which isn't a time. Write it as an ISO time, such as 2026-10-31T08:00:00-04:00, or leave it unset to build the site as it is now.`,
    );
  }
  return instant;
}

/** Every entry of the site's scheduled collections, as stored. */
async function scheduledEntries(root: string, model: SiteModel): Promise<ScheduledEntry[]> {
  const content = new ContentService(new LocalStorage(root), model.manifest);
  const entries: ScheduledEntry[] = [];
  for (const collection of model.manifest.collections) {
    if (!collection.presentation.schedule) continue;
    for (const entry of await content.entriesOf(collection.name)) {
      entries.push({
        collection: collection.name,
        id: entry.id,
        path: entry.path,
        data: entry.data,
      });
    }
  }
  return entries;
}

/**
 * `dist/_vesper/schedule.json`: the build's instant and the first change
 * after it, or null. It says when the site next changes, never what: the
 * free tier's scheduled rebuild reads `next`, and the cloud reads `builtAt`
 * to tell when a scheduled change is live, on any host.
 */
export async function writeSchedule(options: {
  root: string;
  dist: string;
  model: SiteModel;
  at: Date;
}): Promise<{ next: Date | null }> {
  const events = scheduledEvents(
    options.model.manifest.collections,
    await scheduledEntries(options.root, options.model),
    options.at,
  );
  const next = events[0]?.at ?? null;
  const path = join(options.dist, SCHEDULE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      { version: 1, builtAt: options.at.toISOString(), next: next ? next.toISOString() : null },
      null,
      2,
    )}\n`,
  );
  return { next };
}

/**
 * Built pages that belong to an entry outside its window: the page read
 * `astro:content` directly, which isn't filtered. Found through the
 * collections' `url`, as the accessibility check traces pages, and said
 * plainly, since the page is live before its time or after it came down.
 */
export async function unfilteredPages(options: {
  root: string;
  dist: string;
  model: SiteModel;
  settings: UrlSettings;
  routes: () => StaticRoutes;
  at: Date;
}): Promise<string[]> {
  const { root, model, at } = options;
  const storage = new LocalStorage(root);
  const content = new ContentService(storage, model.manifest);
  const pages = new PageService(storage, model.manifest, content, {
    routes: options.routes,
    ...(model.urlFunctions ? { urlFunctions: model.urlFunctions } : {}),
  });
  const outside = new Map<string, DataValue>();
  for (const collection of model.manifest.collections) {
    const schedule = collection.presentation.schedule;
    if (!schedule) continue;
    for (const entry of await content.entriesOf(collection.name)) {
      if (!isPublished(schedule, entry.data, at))
        outside.set(`${collection.name}/${entry.id}`, entry.data);
    }
  }
  if (outside.size === 0) return [];
  const keys = new Map<string, { collection: string; data: DataValue }>();
  for (const page of await pages.pageEntries()) {
    const data = outside.get(`${page.collection}/${page.id}`);
    if (data !== undefined) keys.set(page.key, { collection: page.collection, data });
  }
  const zone = resolveTimeZone(model.manifest.site.timeZone).zone;
  const warnings: string[] = [];
  for (const page of builtPages(options.dist, options.settings.base)) {
    const key = urlKey(page.url, options.settings);
    const found = key === null ? undefined : keys.get(key);
    if (!found) continue;
    // An unpublished page with a redirect is Astro's redirect page, as it should be.
    if (skipReason(page.file, readFileSync(join(options.dist, page.file), 'utf8'))) continue;
    const schedule = model.manifest.collections.find((c) => c.name === found.collection)
      ?.presentation.schedule;
    const { publishAt, unpublishAt } = publishWindow(schedule, found.data);
    const when =
      publishAt && publishAt.getTime() > at.getTime()
        ? `it's scheduled for ${scheduleTime(publishAt, zone, at)}`
        : unpublishAt
          ? `it was unpublished on ${scheduleDay(unpublishAt, zone, at)}`
          : 'it’s outside its publish window';
    warnings.push(
      `${page.url} was built, but ${when}. The page reads astro:content, which isn't filtered; import from vesper:content instead.`,
    );
  }
  return warnings;
}
