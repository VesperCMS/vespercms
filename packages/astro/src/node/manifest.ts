import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildManifest, issuesFromZod, type Manifest, type Validator } from '@vesper/core';
import { loadSite, packageVersion, type LoadSiteOptions } from './load-site.ts';

/** A site as the studio's back end sees it: the manifest, plus the real schemas to validate saves with. */
export type SiteModel = {
  manifest: Manifest;
  /** Each collection's Zod schema (`null` when it has none or couldn't be loaded). */
  schemas: Map<string, unknown>;
};

/** Reads a site's configs and builds its manifest (spec §6.2). */
export async function generateManifest(options: LoadSiteOptions): Promise<Manifest> {
  return (await loadSiteModel(options)).manifest;
}

export async function loadSiteModel(options: LoadSiteOptions): Promise<SiteModel> {
  const { root: _root, ...input } = await loadSite(options);
  const manifest = await buildManifest({
    ...input,
    generator: { name: '@vesper/astro', version: packageVersion() },
  });
  return { manifest, schemas: new Map(input.collections.map((c) => [c.name, c.schema])) };
}

type SafeParseAsync = (
  value: unknown,
  params?: { reportInput?: boolean },
) => Promise<{ success: boolean; error?: { issues: unknown[] } }>;

/**
 * Validates with the site's own Zod schemas, the ones Astro builds with, so
 * the studio accepts exactly what the site accepts (spec §6.3.3: widgets
 * never validate).
 */
export function schemaValidator(schemas: Map<string, unknown>): Validator {
  return async (collection, data) => {
    const schema = schemas.get(collection) as { safeParseAsync?: SafeParseAsync } | null;
    if (typeof schema?.safeParseAsync !== 'function') return [];
    const result = await schema.safeParseAsync(data, { reportInput: true });
    return result.success ? [] : issuesFromZod(result.error?.issues ?? []);
  };
}

/** Writes a manifest as stable, readable JSON (2-space indent, final newline). */
export function writeManifest(manifest: Manifest, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
