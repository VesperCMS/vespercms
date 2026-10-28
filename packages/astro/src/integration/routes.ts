import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { StaticRoutes } from '@vespercms/core';

/*
 * The site's own routes, from Astro's resolved route list
 * (`astro:routes:resolved`, Astro 5 and later): which addresses a page in
 * `src/pages` already owns (spec §6.15.4: no collision with static routes),
 * and which route renders each collection (spec §6.15.1).
 */

/** The parts of Astro's `IntegrationResolvedRoute` Vesper reads. */
export type ResolvedRoute = {
  pattern: string;
  patternRegex: RegExp;
  entrypoint: string;
  params: string[];
  type: string;
  origin: string;
};

const toPosix = (path: string) => path.split(sep).join('/');

/**
 * Static routes: the project's own pages and endpoints with no parameters,
 * keyed by URL key (`/contact`), with the file that owns each. Redirect
 * routes are left out: Vesper's own move aside for a page.
 */
export function staticRoutesOf(
  routes: readonly ResolvedRoute[],
  root: string,
): Map<string, string> {
  const found = new Map<string, string>();
  for (const route of routes) {
    if (route.origin !== 'project' || route.params.length > 0) continue;
    if (route.type !== 'page' && route.type !== 'endpoint') continue;
    const key = route.pattern.length > 1 ? route.pattern.replace(/\/$/, '') : '/';
    const file = toPosix(route.entrypoint);
    found.set(
      key,
      file.startsWith('/') || /^[A-Za-z]:/.test(file) ? toPosix(relative(root, file)) : file,
    );
  }
  return found;
}

const PAGE_EXTENSIONS = /\.(astro|md|mdx|markdoc|mdoc|html|ts|js|mts|mjs)$/;

/**
 * The same, read from `src/pages` before Astro has resolved its routes (at
 * config setup, where redirects are handed to Astro). Files and folders
 * starting with `_` and anything with `[params]` are left out, as Astro does.
 */
export function staticRoutesFromFiles(root: string, srcDir: string): Map<string, string> {
  const pages = join(root, srcDir, 'pages');
  const found = new Map<string, string>();
  if (!existsSync(pages)) return found;
  const visit = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.includes('[')) continue;
      if (entry.isDirectory()) {
        visit(join(dir, entry.name), [...segments, entry.name]);
      } else if (PAGE_EXTENSIONS.test(entry.name)) {
        const name = entry.name.replace(PAGE_EXTENSIONS, '');
        const path = name === 'index' ? segments : [...segments, name];
        const key = `/${path.join('/')}`;
        found.set(key, toPosix(relative(root, join(dir, entry.name))));
      }
    }
  };
  visit(pages, []);
  return found;
}

export type CollectionRoute = { pattern: string; entrypoint: string };

/**
 * Which route renders a collection's URLs: the route (in Astro's priority
 * order) that matches most of them. `unmatched` lists URLs no route can
 * produce, for a warning.
 */
export function routeFor(
  routes: readonly ResolvedRoute[],
  urls: readonly string[],
  root: string,
): { route?: CollectionRoute; unmatched: string[] } {
  const counts = new Map<ResolvedRoute, number>();
  const unmatched: string[] = [];
  for (const url of urls) {
    const route = routes.find(
      (r) =>
        r.origin === 'project' &&
        (r.type === 'page' || r.type === 'endpoint') &&
        (r.patternRegex.test(url) || r.patternRegex.test(url.replace(/\/$/, '') || '/')),
    );
    if (route) counts.set(route, (counts.get(route) ?? 0) + 1);
    else unmatched.push(url);
  }
  let best: ResolvedRoute | undefined;
  for (const [route, count] of counts) if (!best || count > (counts.get(best) ?? 0)) best = route;
  if (!best) return { unmatched };
  const file = toPosix(best.entrypoint);
  return {
    route: {
      pattern: best.pattern,
      entrypoint:
        file.startsWith('/') || /^[A-Za-z]:/.test(file) ? toPosix(relative(root, file)) : file,
    },
    unmatched,
  };
}

/** A holder the hooks fill in and the dev API reads. */
export type RouteState = {
  resolved: ResolvedRoute[] | null;
  /** The static routes: from Astro's list once it's known, from src/pages before that. */
  statics: () => StaticRoutes;
};
