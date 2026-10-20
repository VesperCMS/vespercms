import { editsInCollection, grantMatches, type CollectionManifest } from '@vesper/core';
import type { CloudConnection } from './connection.ts';

/*
 * What the studio shows a member of a cloud site (spec §7.5): it hides what
 * they can't do instead of showing it disabled. Viewers see everything,
 * read-only. Without the cloud, everything is shown.
 */

/** True when a collection belongs on this member's menus and home screen. */
export function shownTo(cloud: CloudConnection | undefined, collection: string): boolean {
  if (!cloud || cloud.member.role === 'viewer') return true;
  return editsInCollection(cloud.member, collection);
}

/** True when an entry file belongs in this member's lists. */
export function entryShownTo(cloud: CloudConnection | undefined, path: string): boolean {
  if (!cloud || cloud.member.role === 'viewer' || cloud.wholeSite) return true;
  return cloud.access(path).edit;
}

/** True when the member may start a new entry at the top of a collection (or in `parent`, in a tree). */
export function mayCreateIn(
  cloud: CloudConnection | undefined,
  collection: CollectionManifest,
  parent?: string,
): boolean {
  if (!cloud) return true;
  const source = collection.source;
  if (source.loader === 'file') return cloud.access(source.path).edit;
  if (source.loader !== 'glob') return false;
  const folder = [source.base === '.' ? '' : source.base, parent ?? ''].filter(Boolean).join('/');
  return cloud.access(`${folder ? `${folder}/` : ''}new-entry.${source.formats[0] ?? 'md'}`).edit;
}

/**
 * True when the member may change a page at this place in a tree (spec
 * §6.15.2, §7.5). A tree path is a grant key: `admissions` is the
 * Admissions section page, `admissions/apply` a page under it.
 */
export function treeCovered(
  cloud: CloudConnection | undefined,
  collection: string,
  path: string,
): boolean {
  if (!cloud) return true;
  if (cloud.member.role === 'viewer') return false;
  if (cloud.wholeSite) return true;
  return (cloud.member.grants ?? []).some(
    (grant) => grant.collection === collection && grantMatches(grant.match, path),
  );
}
