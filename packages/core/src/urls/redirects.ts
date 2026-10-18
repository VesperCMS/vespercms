import { isReservedPath, urlKey } from './pattern.ts';

/*
 * The redirects file (spec §6.15.5): `vesper.redirects.yaml` at the site
 * root, a list of `{ from, to, status, reason, at }`. Every move adds a
 * redirect for each page that moved, and site admins add their own.
 *
 * `cleanRedirects` runs every time the file is written and at every build,
 * so what reaches the live site never has chains, loops or redirects that
 * would hide a real page.
 */

export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

export const REDIRECT_STATUSES: readonly RedirectStatus[] = [301, 302, 303, 307, 308];

/**
 * One redirect. `from` is a key (a site path without base or trailing
 * slash); `to` is a key or an absolute URL elsewhere. Other keys a person
 * added to the file are kept as they are.
 */
export type Redirect = {
  from: string;
  to: string;
  status: RedirectStatus;
  /** `move` (written by a move), `manual`, `import`, or anything a person wrote. */
  reason?: string;
  /** When it was added. */
  at?: Date | string;
  [key: string]: unknown;
};

export type RedirectWarning = {
  kind: 'invalid' | 'duplicate' | 'onto-page' | 'loop' | 'missing-target';
  from: string;
  to?: string;
  message: string;
};

export type CleanResult = {
  /** The cleaned list, in the file's order. */
  redirects: Redirect[];
  /** What was changed or needs a look, in plain language. */
  warnings: RedirectWarning[];
};

export type CleanOptions = {
  /** Whether a key belongs to a real page (content or a static route). */
  isPage: (key: string) => boolean;
};

const PERMANENT = new Set<number>([301, 308]);

/** Whether a value read from the file is a usable redirect. */
export function isRedirect(value: unknown): value is Redirect {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { from, to, status } = value as Record<string, unknown>;
  return (
    typeof from === 'string' &&
    from.startsWith('/') &&
    typeof to === 'string' &&
    to.trim() !== '' &&
    (status === undefined || REDIRECT_STATUSES.includes(status as RedirectStatus))
  );
}

/** A `to` that leaves the site (`https://…`), as opposed to a path on it. */
export function isExternal(to: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(to) || to.startsWith('//');
}

/** The comparable key of a `from` or internal `to`, ignoring a trailing slash, query and hash. */
export function redirectKey(url: string): string {
  return urlKey(url) ?? url;
}

/**
 * Cleans a redirects list:
 * 1. entries that aren't redirects are kept untouched but not used, with a warning;
 * 2. a repeated `from` keeps the later entry;
 * 3. a redirect whose `from` is now a real page is dropped: the page wins;
 * 4. loops are removed (a redirect to itself, or a cycle of them);
 * 5. chains collapse, A→B→C becoming A→C. The result is temporary if any
 *    hop was, since the final address isn't permanent then;
 * 6. a `to` on this site that's neither a page nor a redirect is flagged,
 *    not removed: it may be a file or a route Vesper can't see.
 */
export function cleanRedirects(list: readonly unknown[], options: CleanOptions): CleanResult {
  const warnings: RedirectWarning[] = [];
  const items = list.map((value, index) => ({ value, index, keep: true }));

  // 1. Invalid entries.
  const valid = items.filter((item) => {
    if (isRedirect(item.value)) return true;
    const from = describe(item.value, 'from');
    warnings.push({
      kind: 'invalid',
      from,
      message: `The redirect from ${from || 'an unnamed address'} is missing its "from" or "to" address, or has a status other than 301, 302, 303, 307 or 308. It’s ignored.`,
    });
    return false;
  });

  // 2. Duplicates: the later entry wins.
  const lastIndex = new Map<string, number>();
  for (const item of valid) lastIndex.set(redirectKey((item.value as Redirect).from), item.index);
  for (const item of valid) {
    const redirect = item.value as Redirect;
    if (lastIndex.get(redirectKey(redirect.from)) !== item.index) {
      item.keep = false;
      warnings.push({
        kind: 'duplicate',
        from: redirect.from,
        to: redirect.to,
        message: `${redirect.from} was redirected twice. The later redirect is kept.`,
      });
    }
  }

  // 3. A real page wins over a redirect at its address.
  for (const item of valid) {
    if (!item.keep) continue;
    const redirect = item.value as Redirect;
    if (options.isPage(redirectKey(redirect.from))) {
      item.keep = false;
      warnings.push({
        kind: 'onto-page',
        from: redirect.from,
        to: redirect.to,
        message: `${redirect.from} is a page again, so its redirect to ${redirect.to} was removed.`,
      });
    }
  }

  const live = () => valid.filter((item) => item.keep);
  const byFrom = () =>
    new Map(live().map((item) => [redirectKey((item.value as Redirect).from), item]));

  // 4. Loops: follow each redirect; a cycle removes every redirect in it.
  const lookup = byFrom();
  const inCycle = new Set<number>();
  for (const start of live()) {
    const seen: number[] = [];
    let current: typeof start | undefined = start;
    while (current && !inCycle.has(current.index)) {
      const at = seen.indexOf(current.index);
      if (at !== -1) {
        for (const index of seen.slice(at)) inCycle.add(index);
        break;
      }
      seen.push(current.index);
      const to: string = (current.value as Redirect).to;
      current = isExternal(to) ? undefined : lookup.get(redirectKey(to));
    }
  }
  for (const item of live()) {
    if (!inCycle.has(item.index)) continue;
    item.keep = false;
    const redirect = item.value as Redirect;
    warnings.push({
      kind: 'loop',
      from: redirect.from,
      to: redirect.to,
      message: `The redirect from ${redirect.from} to ${redirect.to} led back to itself, so it was removed.`,
    });
  }

  // 5. Chains collapse onto their final address.
  const chains = byFrom();
  const collapsed = new Map<number, Redirect>();
  for (const item of live()) {
    const redirect = item.value as Redirect;
    let to = redirect.to;
    let permanent = PERMANENT.has(statusOf(redirect));
    const visited = new Set<number>([item.index]);
    for (;;) {
      const next = isExternal(to) ? undefined : chains.get(redirectKey(to));
      if (!next || visited.has(next.index)) break;
      visited.add(next.index);
      const hop = next.value as Redirect;
      if (!PERMANENT.has(statusOf(hop))) permanent = false;
      to = hop.to;
    }
    if (to === redirect.to) continue;
    const own = statusOf(redirect);
    const status: RedirectStatus = permanent || !PERMANENT.has(own) ? own : own === 308 ? 307 : 302;
    collapsed.set(item.index, { ...redirect, to, status });
  }

  const redirects: Redirect[] = [];
  for (const item of items) {
    if (!isRedirect(item.value)) {
      redirects.push(item.value as Redirect);
      continue;
    }
    if (!item.keep) continue;
    redirects.push(collapsed.get(item.index) ?? item.value);
  }

  // 6. Internal targets that lead nowhere Vesper knows of.
  const sources = new Set(redirects.filter((r) => isRedirect(r)).map((r) => redirectKey(r.from)));
  for (const redirect of redirects) {
    if (!isRedirect(redirect) || isExternal(redirect.to)) continue;
    const key = redirectKey(redirect.to);
    if (!options.isPage(key) && !sources.has(key) && !isReservedPath(key)) {
      warnings.push({
        kind: 'missing-target',
        from: redirect.from,
        to: redirect.to,
        message: `${redirect.from} redirects to ${redirect.to}, which isn’t a page on this site.`,
      });
    }
  }
  return { redirects, warnings };
}

/** The redirects a site serves: the valid ones. */
export function activeRedirects(list: readonly unknown[]): Redirect[] {
  return list.filter(isRedirect).map((r) => ({ ...r, status: statusOf(r) }));
}

/**
 * Adds a redirect for each moved page, in order, as `move` redirects dated
 * `at`. A redirect already in the list from the same address is replaced.
 * Run `cleanRedirects` afterwards.
 */
export function withMoveRedirects(
  list: readonly unknown[],
  moves: readonly { from: string; to: string }[],
  at: Date,
): unknown[] {
  const moved = new Set(moves.map((m) => redirectKey(m.from)));
  const kept = list.filter((r) => !(isRedirect(r) && moved.has(redirectKey(r.from))));
  return [
    ...kept,
    ...moves.map((m): Redirect => ({
      from: m.from,
      to: m.to,
      status: 301,
      reason: 'move',
      at: calendarDate(at),
    })),
  ];
}

/** Today's date at midnight UTC: what YAML writes as a plain `2026-10-18`. */
export function calendarDate(now: Date, timeZone?: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

/** A redirect's status; the file may leave it out, meaning permanent. */
export function statusOf(redirect: Redirect): RedirectStatus {
  return REDIRECT_STATUSES.includes(redirect.status) ? redirect.status : 301;
}

function describe(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : '';
}
