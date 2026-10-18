import type { CollectionManifest } from '@vesper/core';
import type { IconName, IconNode } from '@vesper/ui';

/**
 * A collection's icon: the Lucide icon vesper.config.ts names for it,
 * resolved into the manifest at build, or a default by kind (DECISIONS.md,
 * "A collection's icon is named in vesper.config.ts").
 */
export function collectionIcon(
  collection: CollectionManifest,
): { node: IconNode } | { name: IconName } {
  const { icon, singleton, tree } = collection.presentation;
  if (icon) return { node: icon.node };
  return { name: singleton ? 'singleton' : tree ? 'tree' : 'collection' };
}
