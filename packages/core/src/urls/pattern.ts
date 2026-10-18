/*
 * URL patterns (spec §6.15.1): one source of truth for where an entry lives
 * on the site. "View on site", the link picker, redirects, breadcrumbs and
 * the `vesper:content` helpers all go through here, in the studio, the dev
 * server and the build alike, so they can't disagree.
 *
 * Two forms of a URL appear throughout:
 * - a *key* is the comparable form: a site path with no base, query, hash or
 *   trailing slash (`/academics/nursing`, and `/` for the home page). The
 *   redirects file stores keys.
 * - a *URL* is what a visitor's browser asks for: the key with Astro's
 *   `base` in front and the trailing slash Astro's settings imply
 *   (`/academics/nursing/`).
 */

export type TrailingSlash = 'always' | 'never' | 'ignore';
export type BuildFormat = 'directory' | 'file' | 'preserve';

/** Astro's URL settings, plus the site's time zone for date tokens. */
export type UrlSettings = {
  /** Astro's `base`, with a leading and trailing slash: `/` or `/college/`. */
  base: string;
  trailingSlash: TrailingSlash;
  buildFormat: BuildFormat;
  /** IANA time zone for `:date|yyyy` tokens. Calendar dates and sites without one use UTC. */
  timeZone?: string;
  /** Astro's `site` (an absolute origin), so absolute links to the site itself are recognized. */
  site?: string;
};

export const DEFAULT_URL_SETTINGS: UrlSettings = {
  base: '/',
  trailingSlash: 'ignore',
  buildFormat: 'directory',
};

/** What a URL pattern can read: the entry's ID and its frontmatter values. */
export type UrlEntry = { id: string; collection?: string; data?: unknown };

/** Site paths Vesper itself owns. No page may live at or under them. */
export const RESERVED_PATHS: readonly string[] = ['/admin', '/_vesper'];

/** A page address segment: lower case letters, digits and single dashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * An entry's path inside its collection (the `:path` token): the ID minus a
 * trailing `/index`, with a top-level `index` as the collection's root ('').
 * Astro's glob loader already drops `/index` from nested IDs but keeps a
 * top-level `index.md` as `index`; either spelling gives the same path.
 */
export function entryPath(id: string): string {
  if (id === 'index') return '';
  return id.replace(/\/index$/, '');
}

const TOKEN = /:([A-Za-z_$][\w$]*)(?:\|(yyyy|mm|dd))?/g;

/**
 * Expands a string pattern (`/blog/:publishedAt|yyyy/:slug`) for an entry
 * into a key, or returns null when a token has no value for this entry.
 *
 * - `:id` is the entry ID; `:path` is `entryPath(id)`; `:slug` is the last
 *   segment of the path.
 * - `:<field>` is a frontmatter value; `:<field>|yyyy`, `|mm` and `|dd` are
 *   parts of a date field. A date at midnight UTC is a calendar date (that's
 *   how YAML's `2026-10-17` reads) and keeps its day. Other dates are read
 *   in the site's time zone, else UTC.
 */
export function expandUrlPattern(
  pattern: string,
  entry: UrlEntry,
  settings: Pick<UrlSettings, 'timeZone'> = {},
): string | null {
  const path = entryPath(entry.id);
  const data = isRecord(entry.data) ? entry.data : {};
  let missing = false as boolean;
  const expanded = pattern.replace(TOKEN, (_, name: string, part: string | undefined) => {
    let value: string | null;
    if (name === 'id' && !part) value = entry.id;
    else if (name === 'path' && !part) value = path;
    else if (name === 'slug' && !part) value = path.slice(path.lastIndexOf('/') + 1);
    else value = tokenValue(data[name], part, settings.timeZone);
    if (value === null) {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? null : keyOf(expanded);
}

function tokenValue(value: unknown, part: string | undefined, timeZone: string | undefined) {
  const date =
    value instanceof Date
      ? value
      : part && typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? new Date(value)
        : null;
  if (date && !Number.isNaN(date.getTime())) {
    const parts = dateParts(date, timeZone);
    if (part === 'yyyy') return parts.year;
    if (part === 'mm') return parts.month;
    if (part === 'dd') return parts.day;
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  if (part) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Year, month and day of a date, as two- and four-digit strings. */
export function dateParts(
  date: Date,
  timeZone?: string,
): { year: string; month: string; day: string } {
  const calendarDate =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  const zone = calendarDate || !timeZone ? 'UTC' : timeZone;
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => formatted.find((p) => p.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** A path as a key: one leading slash, no repeated or trailing slashes. */
function keyOf(path: string): string {
  const collapsed = `/${path}`.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/$/, '') : '/';
}

/**
 * The URL a visitor requests for a key: Astro's `base` in front, and a
 * trailing slash when `trailingSlash` is `always`, or `ignore` with
 * directory-style output (the default). Query and hash are kept as given.
 */
export function formatUrl(key: string, settings: UrlSettings = DEFAULT_URL_SETTINGS): string {
  const { path, rest } = splitSuffix(key);
  const base = settings.base.endsWith('/') ? settings.base : `${settings.base}/`;
  const slash = wantsTrailingSlash(settings);
  const relative = keyOf(path).slice(1);
  if (relative === '') {
    // The home page: the base itself.
    return (base === '/' || slash ? base : base.replace(/\/$/, '')) + rest;
  }
  return `${base}${relative}${slash ? '/' : ''}${rest}`;
}

function wantsTrailingSlash(settings: UrlSettings): boolean {
  if (settings.trailingSlash === 'always') return true;
  if (settings.trailingSlash === 'never') return false;
  return settings.buildFormat === 'directory';
}

function splitSuffix(url: string): { path: string; rest: string } {
  const cut = url.search(/[?#]/);
  return cut === -1 ? { path: url, rest: '' } : { path: url.slice(0, cut), rest: url.slice(cut) };
}

/**
 * The key a link points at, if it points inside this site: a root-relative
 * path (`/academics/nursing/`, `/college/academics/`) or an absolute URL on
 * the site's own origin. Relative paths, other sites, `mailto:` and
 * fragments return null. The query and hash are dropped; `suffix` returns
 * them so a rewritten link can keep them.
 */
export function urlKey(
  url: string,
  settings: Pick<UrlSettings, 'base' | 'site'> = DEFAULT_URL_SETTINGS,
): string | null {
  return parseSiteUrl(url, settings)?.key ?? null;
}

export type SiteUrl = {
  key: string;
  /** `?query#hash` as written. */
  suffix: string;
  /** Whether the link was written with the site's `base` in front. */
  hasBase: boolean;
  /** Whether it ended with a slash (before the suffix). */
  trailingSlash: boolean;
  /** The origin, when the link was absolute. */
  origin: string;
};

export function parseSiteUrl(
  url: string,
  settings: Pick<UrlSettings, 'base' | 'site'> = DEFAULT_URL_SETTINGS,
): SiteUrl | null {
  let rest = url.trim();
  let origin = '';
  const absolute = /^([a-z][a-z\d+.-]*:)?\/\/[^/?#]*/i.exec(rest);
  if (absolute) {
    const site = settings.site ? originOf(settings.site) : null;
    if (!site || originOf(absolute[0]) !== site) return null;
    origin = absolute[0];
    rest = rest.slice(absolute[0].length) || '/';
  } else if (/^[a-z][a-z\d+.-]*:/i.test(rest) || !rest.startsWith('/')) {
    return null;
  }
  const { path, rest: suffix } = splitSuffix(rest);
  const base = settings.base.endsWith('/') ? settings.base : `${settings.base}/`;
  let hasBase = false;
  let local = path;
  if (base !== '/') {
    if (path === base.slice(0, -1) || path.startsWith(base)) {
      hasBase = true;
      local = `/${path.slice(base.length)}`;
    } else {
      return null;
    }
  }
  let decoded: string;
  try {
    decoded = decodeURI(local);
  } catch {
    decoded = local;
  }
  return {
    key: keyOf(decoded),
    suffix,
    hasBase,
    trailingSlash: path.length > 1 && path.endsWith('/'),
    origin,
  };
}

function originOf(url: string): string | null {
  try {
    return new URL(url.startsWith('//') ? `https:${url}` : url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Writes `key` back in the shape of `original` (same origin, base and trailing slash). */
export function reshapeUrl(original: SiteUrl, key: string, settings: UrlSettings): string {
  const base = settings.base.endsWith('/') ? settings.base : `${settings.base}/`;
  const prefix = original.hasBase ? base.slice(0, -1) : '';
  const path = key === '/' ? '/' : original.trailingSlash ? `${key}/` : key;
  return `${original.origin}${prefix}${path}${original.suffix}`;
}

/** A collection's `url` from vesper.config.ts: a pattern, or a function (the escape hatch). */
export type UrlPattern = string | ((entry: UrlEntry) => unknown);

/**
 * An entry's key from its collection's pattern, or null when the collection
 * has none (data-only) or a token has no value. A function pattern returns a
 * site path; one that throws or returns something else gives null.
 */
export function entryUrlKey(
  pattern: UrlPattern | undefined,
  entry: UrlEntry,
  settings: UrlSettings = DEFAULT_URL_SETTINGS,
): string | null {
  if (pattern === undefined) return null;
  if (typeof pattern === 'string') return expandUrlPattern(pattern, entry, settings);
  let result: unknown;
  try {
    result = pattern(entry);
  } catch {
    return null;
  }
  if (typeof result !== 'string' || !result.startsWith('/')) return null;
  return urlKey(result, settings) ?? keyOf(splitSuffix(result).path);
}

/** Whether a key is Vesper's own (`/admin`, `/_vesper`) or under it. */
export function isReservedPath(key: string): boolean {
  return RESERVED_PATHS.some((reserved) => key === reserved || key.startsWith(`${reserved}/`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
