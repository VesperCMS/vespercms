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
} from '@vesper/core';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { BlockKind, Catalog } from './catalog.ts';
import type { ContainerTypes } from './nodes.ts';

/*
 * What the body editor's node views share: the catalog of blocks, the
 * actions their buttons start, and validation of one block's own text, so
 * each block shows its own messages inline (spec §6.5.1, "Validation").
 */

export type BodyActions = {
  openSettings: (pos: number) => void;
  move: (pos: number, direction: -1 | 1) => void;
  remove: (pos: number) => void;
};

export type BodyChecks = {
  /** Validates a whole body, or one block's text, as the site's build would. */
  validate: (text: string) => Promise<BodyIssue[]>;
  /** The same, synchronously, for Markdoc (MDX props schemas may be async). */
  validateSync: (text: string) => BodyIssue[] | null;
};

export type BodyUi = BodyActions & {
  catalog: Catalog;
  containers: ContainerTypes;
  disabled: boolean;
  checks: BodyChecks;
  /** Site-relative paths of the files a partial can point at, once loaded. */
  partials: readonly string[] | null;
  entryPath: string;
};

export const BodyUiContext = createContext<BodyUi | null>(null);

export function useBodyUi(): BodyUi {
  const ui = useContext(BodyUiContext);
  if (!ui) throw new Error('useBodyUi() must be used inside the body editor.');
  return ui;
}

/**
 * Body validation for this studio: Markdoc with the config rebuilt from the
 * manifest (the site's real config also checks every save, in the dev API),
 * and MDX props with the components' own Zod schemas.
 */
export function bodyChecks(options: {
  manifest: Manifest;
  format: BodyFormat;
  mdxProps: Readonly<Record<string, unknown>>;
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
  if (format === 'mdx') {
    const checks = new Map<string, MdxComponentCheck>();
    for (const component of manifest.mdx?.components ?? []) {
      const schema = options.mdxProps[component.name] as
        { safeParseAsync?: (value: unknown, params?: object) => Promise<ZodResult> } | undefined;
      const parse = schema?.safeParseAsync?.bind(schema);
      if (!parse) continue;
      checks.set(component.name, {
        label: component.label,
        fields: component.fields,
        validate: async (props) => {
          const result = await parse(props, { reportInput: true });
          return result.success ? [] : issuesFromZod(result.error?.issues ?? []);
        },
      });
    }
    return {
      validate: (text) => (checks.size > 0 ? validateMdxBody(text, checks) : Promise.resolve([])),
      validateSync: () => null,
    };
  }
  return { validate: () => Promise.resolve([]), validateSync: () => [] };
}

type ZodResult = { success: boolean; error?: { issues: unknown[] } };

/** One block's issues, from its own text: synchronous for Markdoc, after a tick for MDX. */
export function useBlockIssues(text: string): BodyIssue[] {
  const { checks } = useBodyUi();
  const sync = useMemo(() => checks.validateSync(text), [checks, text]);
  const [async, setAsync] = useState<BodyIssue[]>([]);
  useEffect(() => {
    if (sync !== null) return;
    let live = true;
    void checks.validate(text).then((issues) => {
      if (live) setAsync(issues);
    });
    return () => {
      live = false;
    };
  }, [checks, text, sync]);
  return sync ?? async;
}

/** The header's summary: the summary attribute's value, shown with its option label. */
export function summaryOf(
  kind: BlockKind | undefined,
  values: Readonly<Record<string, unknown>>,
): string {
  if (!kind) return '';
  const name = kind.summary ?? (kind.builtin === 'partial' ? 'file' : undefined);
  if (!name) return '';
  const value = values[name];
  const field = kind.fields.find((f) => f.path[0] === name);
  const fallback = value === undefined ? field?.default : value;
  if (fallback === undefined || fallback === null || fallback === '') return '';
  const option = field?.constraints?.options?.find((o) => o.value === fallback);
  const text =
    option?.label ?? (typeof fallback === 'string' ? fallback : JSON.stringify(fallback));
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
