import picomatch from 'picomatch/posix.js';
import type { CollectionManifest, Manifest } from '../manifest/types.ts';
import type { FileChange } from '../storage/types.ts';
import { REDIRECTS_FILE } from '../studio/pages.ts';

/*
 * Who may change what on a cloud site (spec §7.5). The API and the studio
 * both call these functions, so a grant means the same thing on each side:
 * the API refuses what they refuse, and the studio hides it.
 *
 * Grants are matched against file paths, never entry IDs. An entry's ID can
 * come from a `slug` in its own data, so an ID-based grant could be
 * escaped by editing that field; a file's folder can't be changed without a
 * move, and a move needs a grant at both ends (spec §6.15.4).
 */

export type SiteRole = 'admin' | 'editor' | 'contributor' | 'viewer';

/** A grant scopes a member to one collection, optionally to one folder or pattern inside it. */
export type Grant = {
  collection: string;
  /**
   * A glob over entry keys: the file's path inside the collection's folder,
   * without its extension and without a trailing `/index`. `admissions/**`
   * covers the Admissions section page and everything under it.
   */
  match?: string;
  /** `false`: changes need an approver to publish them. */
  publish?: boolean;
};

export type Member = {
  role: SiteRole;
  /** `null` or absent: the whole site. An array: only what the grants cover. */
  grants?: readonly Grant[] | null;
};

export type FileAccess = {
  edit: boolean;
  /** May publish changes to this file without review. */
  publish: boolean;
};

const NONE: FileAccess = { edit: false, publish: false };

/** Folders where media lives (spec §6.6.1), relative to the site root. */
export function mediaRoots(manifest: Manifest): string[] {
  return [`${manifest.site.srcDir}/assets/`, 'public/'];
}

/** True when the member's grants cover the whole site. */
export function wholeSite(member: Member): boolean {
  if (member.role === 'admin') return true;
  if (member.role === 'viewer') return false;
  return member.grants === null || member.grants === undefined;
}

function rolePublishes(member: Member): boolean {
  return member.role === 'admin' || member.role === 'editor';
}

/**
 * The key a grant's `match` is tested against: the path inside the
 * collection's folder, without its extension or a trailing `/index`.
 * `admissions/apply.md` is `admissions/apply`; `admissions/index.md` is
 * `admissions`. An order file stands for its folder.
 */
export function grantKey(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  const name = relativePath.slice(slash + 1);
  const folder = slash === -1 ? '' : relativePath.slice(0, slash);
  if (name === '_order.yaml') return folder;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  if (stem === 'index') return folder;
  return folder ? `${folder}/${stem}` : stem;
}

const matchers = new Map<string, (key: string) => boolean>();

/** `x/**` covers `x` itself as well as everything under it: the section page is part of its branch. */
export function grantMatches(match: string | undefined, key: string): boolean {
  if (match === undefined || match === '' || match === '**') return true;
  let test = matchers.get(match);
  if (!test) {
    const glob = picomatch(match, { dot: true });
    const branch = match.endsWith('/**') ? match.slice(0, -3) : null;
    test = (k) => glob(k) || (branch !== null && k === branch);
    matchers.set(match, test);
  }
  return test(key);
}

/** The collection a site file belongs to, and its path inside the collection's folder. */
export function collectionOf(
  manifest: Manifest,
  path: string,
): { collection: CollectionManifest; relative: string | null } | null {
  for (const collection of manifest.collections) {
    const source = collection.source;
    if (source.loader === 'glob') {
      const base = source.base.replace(/\/+$/, '');
      if (path.startsWith(`${base}/`)) return { collection, relative: path.slice(base.length + 1) };
    } else if (source.loader === 'file' && path === source.path) {
      // One file holds every entry, so only a grant for the whole collection reaches it.
      return { collection, relative: null };
    }
  }
  return null;
}

/** What a member may do to one file of the site. */
export function fileAccess(member: Member, manifest: Manifest, path: string): FileAccess {
  if (member.role === 'viewer') return NONE;
  if (wholeSite(member)) return { edit: true, publish: rolePublishes(member) };
  const owner = collectionOf(manifest, path);
  // Outside every collection (the redirects file, settings, media): the whole site's to change.
  if (!owner) return NONE;
  let access: FileAccess = NONE;
  for (const grant of member.grants ?? []) {
    if (grant.collection !== owner.collection.name) continue;
    const covered =
      owner.relative === null
        ? grant.match === undefined || grant.match === '' || grant.match === '**'
        : grantMatches(grant.match, grantKey(owner.relative));
    if (!covered) continue;
    const publish = rolePublishes(member) && grant.publish !== false;
    access = { edit: true, publish: access.publish || publish };
  }
  return access;
}

/** True when the member may edit at least one thing, which is what a new upload needs. */
export function editsAnything(member: Member): boolean {
  if (member.role === 'viewer') return false;
  return wholeSite(member) || (member.grants?.length ?? 0) > 0;
}

/** True when some of what the member edits may be published without review. */
function publishesAnything(member: Member): boolean {
  if (!rolePublishes(member)) return false;
  return wholeSite(member) || (member.grants ?? []).some((g) => g.publish !== false);
}

/** True when the member may change some entry in the collection. */
export function editsInCollection(member: Member, collection: string): boolean {
  if (member.role === 'viewer') return false;
  return wholeSite(member) || (member.grants ?? []).some((g) => g.collection === collection);
}

export type ChangeAccess =
  { ok: true; publish: boolean } | { ok: false; path: string; message: string };

/**
 * Whether a member may make a whole change set, and whether they may
 * publish it without review. One file outside their grants refuses all of it.
 *
 * A new file under the media folders is allowed to anyone who can edit
 * something, since editors add images to their own pages. Changing or
 * removing an existing media file, or anything else outside the
 * collections (the redirects file among them), needs the whole site.
 */
export function changeAccess(
  member: Member,
  manifest: Manifest,
  changes: readonly FileChange[],
): ChangeAccess {
  if (member.role === 'viewer') {
    return {
      ok: false,
      path: firstPath(changes),
      message: 'You can view this site, not change it.',
    };
  }
  let publish = rolePublishes(member);
  const roots = mediaRoots(manifest);
  const isMedia = (path: string) => roots.some((root) => path.startsWith(root));
  for (const change of changes) {
    const paths = change.op === 'move' ? [change.from, change.to] : [change.path];
    for (const path of paths) {
      if (change.op === 'put' && change.expectedVersion === null && isMedia(path)) {
        if (!editsAnything(member)) return refuse(path);
        publish &&= publishesAnything(member);
        continue;
      }
      const access = fileAccess(member, manifest, path);
      if (!access.edit) return refuse(path, path === REDIRECTS_FILE);
      publish &&= access.publish;
    }
  }
  return { ok: true, publish };
}

function refuse(path: string, redirects = false): ChangeAccess {
  return {
    ok: false,
    path,
    message: redirects
      ? 'Moving pages changes the site’s redirects, which needs access to the whole site. Ask a site admin.'
      : 'This is outside what you can edit on this site. Ask a site admin.',
  };
}

function firstPath(changes: readonly FileChange[]): string {
  const first = changes[0];
  if (!first) return '';
  return first.op === 'move' ? first.from : first.path;
}
