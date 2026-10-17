import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildManifest, type Manifest } from '@vesper/core';
import { loadSite, packageVersion, type LoadSiteOptions } from './load-site.ts';

/** Reads a site's configs and builds its manifest (spec §6.2). */
export async function generateManifest(options: LoadSiteOptions): Promise<Manifest> {
  const { root: _root, ...input } = await loadSite(options);
  return buildManifest({
    ...input,
    generator: { name: '@vesper/astro', version: packageVersion() },
  });
}

/** Writes a manifest as stable, readable JSON (2-space indent, final newline). */
export function writeManifest(manifest: Manifest, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
