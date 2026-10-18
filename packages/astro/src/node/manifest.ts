import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  buildManifest,
  issuesFromZod,
  partialChecker,
  validateMarkdocBody,
  validateMdxBody,
  type BodyValidator,
  type Manifest,
  type MarkdocConfigLike,
  type MdxComponentCheck,
  type UrlEntry,
  type Validator,
} from '@vesper/core';
import { loadSite, packageVersion, type LoadSiteOptions } from './load-site.ts';

/** A site as the studio's back end sees it: the manifest, plus the real schemas to validate saves with. */
export type SiteModel = {
  manifest: Manifest;
  /** Each collection's Zod schema (`null` when it has none or couldn't be loaded). */
  schemas: Map<string, unknown>;
  /** The site's Markdoc config, merged as Astro merges it: custom types and `validate` functions included. */
  markdocConfig?: MarkdocConfigLike;
  /** Each declared MDX component's Zod props schema. */
  mdxProps: Map<string, unknown>;
  /** Names of the custom widgets vesper.config.ts registers. */
  widgetNames: string[];
  /** Function-form URL patterns from vesper.config.ts (spec §6.15.1), by collection. */
  urlFunctions?: Record<string, (entry: UrlEntry) => unknown>;
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
  const components = input.config?.mdx?.components ?? {};
  return {
    manifest,
    schemas: new Map(input.collections.map((c) => [c.name, c.schema])),
    ...(input.markdoc ? { markdocConfig: input.markdoc.config } : {}),
    widgetNames: Object.keys(input.config?.widgets ?? {}),
    urlFunctions: Object.fromEntries(
      Object.entries(input.config?.collections ?? {}).flatMap(([name, collection]) =>
        typeof collection.url === 'function' ? [[name, collection.url]] : [],
      ),
    ),
    mdxProps: new Map(
      Object.entries(components).flatMap(([name, component]) =>
        component.props === undefined ? [] : [[name, component.props] as const],
      ),
    ),
  };
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

/**
 * Checks bodies on save with the site's real Markdoc config (so custom
 * attribute classes and `validate` functions run, which the browser can't)
 * and the declared components' real props schemas (spec §6.5.1, §6.5.2).
 */
export function bodyValidator(
  model: SiteModel,
  listPartials: () => Promise<string[]>,
): BodyValidator {
  const { manifest } = model;
  const checks = new Map<string, MdxComponentCheck>();
  for (const component of manifest.mdx?.components ?? []) {
    const schema = model.mdxProps.get(component.name) as
      { safeParseAsync?: SafeParseAsync } | undefined;
    if (typeof schema?.safeParseAsync !== 'function') continue;
    const parse = schema.safeParseAsync.bind(schema);
    checks.set(component.name, {
      label: component.label,
      fields: component.fields,
      validate: async (props) => {
        const result = await parse(props, { reportInput: true });
        return result.success ? [] : issuesFromZod(result.error?.issues ?? []);
      },
    });
  }
  return async ({ format, body, path }) => {
    if (format === 'mdoc' && model.markdocConfig && manifest.markdoc) {
      return validateMarkdocBody(body, {
        config: model.markdocConfig as never,
        parse: manifest.markdoc.options,
        tags: manifest.markdoc.tags,
        partialExists: partialChecker(path, await listPartials()),
      });
    }
    if (format === 'mdx' && checks.size > 0) return validateMdxBody(body, checks);
    return [];
  };
}

/** Writes a manifest as stable, readable JSON (2-space indent, final newline). */
export function writeManifest(manifest: Manifest, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
