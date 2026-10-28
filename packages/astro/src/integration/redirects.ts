import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ContentService,
  PageService,
  REDIRECTS_FILE,
  activeRedirects,
  cleanRedirects,
  formatUrl,
  hostRedirects,
  htaccessRules,
  isExternal,
  isRedirect,
  mergeMarkedBlock,
  nginxRules,
  readDataFile,
  redirectKey,
  redirectsFileRules,
  vercelRules,
  type NativeTarget,
  type Redirect,
  type RedirectWarning,
  type StaticRoutes,
  type UrlSettings,
} from '@vespercms/core';
import type { SiteModel } from '../node/manifest.ts';
import { LocalStorage } from '../node/storage-local.ts';

/*
 * How `vesper.redirects.yaml` reaches the built site (spec §6.15.5), with
 * the redirects unpublished pages leave behind (spec §6.17).
 *
 * The file is cleaned against every page the build will have, then each
 * redirect goes to Astro's `redirects`, so a static build writes an HTML
 * redirect page at the old URL: that works on any host (D16). Where the
 * host has its own rules (detected, or set in vesper.config.ts), they're
 * written into `dist` too, and those URLs get no HTML page, so a file can
 * never shadow a rule.
 */

export type BuildRedirects = {
  /** The cleaned, valid redirects. */
  redirects: Redirect[];
  warnings: RedirectWarning[];
  /** Hosts whose rules are written. */
  targets: NativeTarget[];
  /** For Astro's `redirects`: the ones no native rule covers. */
  astro: Record<string, { status: 301 | 302 | 303 | 307 | 308; destination: string }>;
};

/** Hosts detected from the build environment, plus those vesper.config.ts asks for. */
export function nativeTargets(
  env: Readonly<Record<string, string | undefined>>,
  configured: readonly NativeTarget[] = [],
): NativeTarget[] {
  const found = new Set<NativeTarget>(configured);
  if (env.NETLIFY === 'true') found.add('netlify');
  // Pages sets CF_PAGES and Workers Builds WORKERS_CI. Workers static assets
  // read `_redirects` from the assets folder as Pages does, so both are one target.
  if (env.CF_PAGES === '1' || env.WORKERS_CI === '1') found.add('cloudflare');
  if (env.VERCEL === '1') found.add('vercel');
  return [...found];
}

/**
 * The redirects a build serves. `existing` is the site's own Astro
 * `redirects`, which win over the file's. `at` is the build's instant:
 * entries past their `unpublishAt` then leave their redirects, and a
 * redirect gives way only to a page the build will have.
 */
export async function buildRedirects(options: {
  root: string;
  model: SiteModel;
  routes: StaticRoutes;
  env: Readonly<Record<string, string | undefined>>;
  existing: Readonly<Record<string, unknown>>;
  at: Date;
}): Promise<BuildRedirects> {
  const { root, model } = options;
  const settings = urlSettings(model);
  const targets = nativeTargets(options.env, model.manifest.site.redirects?.native);
  const warnings: RedirectWarning[] = [];
  let file: unknown[] = [];
  const path = join(root, REDIRECTS_FILE);
  if (existsSync(path)) {
    const read = readDataFile(new Uint8Array(readFileSync(path)), 'yaml');
    if (read.status === 'editable' && (Array.isArray(read.value) || read.value === null)) {
      file = read.value ?? [];
    } else {
      warnings.push({
        kind: 'invalid',
        from: '',
        message:
          `${REDIRECTS_FILE} isn't a list of redirects, so none were added. ${read.status === 'editable' ? '' : read.message}`.trim(),
      });
    }
  }

  const storage = new LocalStorage(root);
  const content = new ContentService(storage, model.manifest);
  const pages = new PageService(storage, model.manifest, content, {
    routes: () => options.routes,
    urlFunctions: model.urlFunctions,
  });
  // The file wins over an unpublished entry's own redirect, so a developer can override one.
  const inFile = new Set(file.filter(isRedirect).map((r) => redirectKey(r.from)));
  const unpublished: Redirect[] = [];
  for (const redirect of await pages.unpublishRedirects(options.at)) {
    if (!inFile.has(redirectKey(redirect.from))) unpublished.push(redirect);
    else
      warnings.push({
        kind: 'duplicate',
        from: redirect.from,
        to: redirect.to,
        message: `${formatUrl(redirect.from, settings)} is unpublished and asks to send visitors to ${redirect.to}, but ${REDIRECTS_FILE} has a redirect from it too, which is used instead.`,
      });
  }
  if (file.length === 0 && unpublished.length === 0) {
    return { redirects: [], warnings, targets, astro: {} };
  }
  // Only pages this build has win over a redirect, so an unpublished one's isn't dropped.
  const keys = await pages.pageKeys({ at: options.at });
  const cleaned = cleanRedirects([...unpublished, ...file], { isPage: (key) => keys.has(key) });
  warnings.push(...cleaned.warnings);
  const redirects = activeRedirects(cleaned.redirects);

  const covered = new Set<string>();
  if (targets.some((t) => t !== 'vercel')) {
    for (const r of redirects) covered.add(redirectKey(r.from));
  } else if (targets.includes('vercel')) {
    for (const key of vercelCovered(root, redirects, settings)) covered.add(key);
  }

  const astro: BuildRedirects['astro'] = {};
  const theirs = new Set(Object.keys(options.existing).map((from) => redirectKey(from)));
  for (const redirect of redirects) {
    const key = redirectKey(redirect.from);
    if (covered.has(key) || theirs.has(key)) continue;
    astro[key] = {
      status: redirect.status,
      destination: isExternal(redirect.to) ? redirect.to : formatUrl(redirect.to, settings),
    };
  }
  return { redirects, warnings, targets, astro };
}

/**
 * Writes each host's rules into the built site, and the cleaned list to
 * `_vesper/redirects.json` (what the S3 deploy template reads).
 */
export function writeHostRules(
  dist: string,
  build: BuildRedirects,
  settings: UrlSettings,
): string[] {
  const written: string[] = [];
  const host = hostRedirects(build.redirects, settings);
  const merge = (name: string, rules: string, position: 'start' | 'end') => {
    const path = join(dist, name);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const after = mergeMarkedBlock(before, rules, position);
    if (after !== before) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, after);
      written.push(name);
    }
  };
  for (const target of build.targets) {
    if (target === 'netlify' || target === 'cloudflare') {
      merge('_redirects', redirectsFileRules(host, target), 'start');
    } else if (target === 'apache') {
      merge('.htaccess', htaccessRules(host), 'end');
    } else if (target === 'nginx') {
      const path = join(dist, '_vesper', 'nginx-redirects.conf');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        `# Written by Vesper from vesper.redirects.yaml and unpublished pages. Include it in the site's server block.\n${nginxRules(host)}\n`,
      );
      written.push('_vesper/nginx-redirects.conf');
    }
  }
  const list = join(dist, '_vesper', 'redirects.json');
  mkdirSync(dirname(list), { recursive: true });
  writeFileSync(
    list,
    `${JSON.stringify(
      host.map((r, i) => ({ ...r, key: redirectKey(build.redirects[i]?.from ?? r.from) })),
      null,
      2,
    )}\n`,
  );
  written.push('_vesper/redirects.json');
  return written;
}

/** Redirects whose every form is already in the site's vercel.json, pointing the same way. */
function vercelCovered(
  root: string,
  redirects: readonly Redirect[],
  settings: UrlSettings,
): string[] {
  const path = join(root, 'vercel.json');
  if (!existsSync(path)) return [];
  let config: { redirects?: { source?: unknown; destination?: unknown }[] };
  try {
    config = JSON.parse(readFileSync(path, 'utf8')) as typeof config;
  } catch {
    return [];
  }
  const present = new Set(
    (config.redirects ?? []).map((r) => `${String(r.source)} ${String(r.destination)}`),
  );
  return redirects
    .filter((r) =>
      vercelRules(hostRedirects([r], settings)).every((rule) =>
        present.has(`${rule.source} ${rule.destination}`),
      ),
    )
    .map((r) => redirectKey(r.from));
}

export function urlSettings(model: SiteModel): UrlSettings {
  return (
    model.manifest.site.urls ?? {
      base: '/',
      trailingSlash: 'ignore',
      buildFormat: 'directory',
      ...(model.manifest.site.timeZone ? { timeZone: model.manifest.site.timeZone } : {}),
    }
  );
}
