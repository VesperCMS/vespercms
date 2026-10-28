import {
  issuesFromZod,
  markdocConfigFromManifest,
  partialChecker,
  validateMarkdocBody,
  validateMdxBody,
  type BodyFormat,
  type BodyIssue,
  type Manifest,
  type MdxComponentCheck,
} from '@vespercms/core';

/*
 * Body validation for the studio (spec §6.5.1, "Validation"): Markdoc with
 * the config rebuilt from the manifest (the site's real config checks every
 * save again, in the dev API), and MDX props with the components' own Zod
 * schemas. Markdoc, micromark and Zod are large, so this module, like the
 * body editor, loads the first time an entry with a body is opened.
 */

export type BodyChecks = {
  /** Validates a whole body, or one block's text, as the site's build would. */
  validate: (text: string) => Promise<BodyIssue[]>;
  /** The same, synchronously, for Markdoc (MDX props schemas load on first use). */
  validateSync: (text: string) => BodyIssue[] | null;
};

type ZodResult = { success: boolean; error?: { issues: unknown[] } };
type PropsSchema = { safeParseAsync?: (value: unknown, params?: object) => Promise<ZodResult> };

export function bodyChecks(options: {
  manifest: Manifest;
  format: BodyFormat;
  /** Declared MDX components' Zod props schemas, loaded when first needed. */
  loadMdxProps: () => Promise<Readonly<Record<string, unknown>>>;
  partials: readonly string[] | null;
  entryPath: string;
}): BodyChecks {
  const { manifest, format, partials, entryPath } = options;
  if (format === 'mdoc') {
    const config = markdocConfigFromManifest(manifest.markdoc);
    const run = (text: string) =>
      validateMarkdocBody(text, {
        config,
        ...(manifest.markdoc
          ? { parse: manifest.markdoc.options, tags: manifest.markdoc.tags }
          : {}),
        ...(partials ? { partialExists: partialChecker(entryPath, partials) } : {}),
      });
    return { validate: (text) => Promise.resolve(run(text)), validateSync: run };
  }
  if (format === 'mdx' && (manifest.mdx?.components.length ?? 0) > 0) {
    let checks: Promise<Map<string, MdxComponentCheck>> | null = null;
    const load = () => {
      checks ??= options.loadMdxProps().then((schemas) => {
        const map = new Map<string, MdxComponentCheck>();
        for (const component of manifest.mdx?.components ?? []) {
          const schema = schemas[component.name] as PropsSchema | undefined;
          const parse = schema?.safeParseAsync?.bind(schema);
          if (!parse) continue;
          map.set(component.name, {
            label: component.label,
            fields: component.fields,
            validate: async (props) => {
              const result = await parse(props, { reportInput: true });
              return result.success ? [] : issuesFromZod(result.error?.issues ?? []);
            },
          });
        }
        return map;
      });
      return checks;
    };
    return {
      validate: async (text) => {
        const map = await load();
        return map.size > 0 ? validateMdxBody(text, map) : [];
      },
      validateSync: () => null,
    };
  }
  return { validate: () => Promise.resolve([]), validateSync: () => [] };
}
