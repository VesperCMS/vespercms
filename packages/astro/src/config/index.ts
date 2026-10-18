import {
  NATIVE_TARGETS,
  type CollectionConfig,
  type FieldModel,
  type MarkdocTagHint,
  type MdxComponentConfig,
  type NativeTarget,
} from '@vesper/core';

/** What a custom widget component receives (spec §6.3.3). */
export type { WidgetProps } from '@vesper/core';

/*
 * `vesper.config.ts` (spec §6.4): presentation, URLs, widgets and permissions.
 * It never holds field definitions; those come from content.config.ts (D2).
 * Every key is optional.
 */

/** A custom editor control (spec §6.3.3). */
export type CustomWidget = {
  /** The React component, loaded lazily into /admin (Phase 2). */
  component: () => Promise<unknown>;
  /** Where it may be used. Defaults to anywhere. */
  accepts?: (field: FieldModel) => boolean;
  /** Claims fields automatically, without `.meta({ widget })`. */
  match?: (field: FieldModel) => boolean;
};

export type VesperCollectionConfig = CollectionConfig;

/** A declared MDX component. `props` is a Zod object schema made with astro/zod. */
export type MdxComponent = MdxComponentConfig;

export type { MarkdocTagHint };

export type VesperConfig = {
  collections?: Record<string, VesperCollectionConfig>;
  widgets?: Record<string, CustomWidget>;
  /** Image ratios and upload limits (spec §6.6.3). Used from Phase 2.7. */
  images?: { ratios?: Record<string, number>; maxUploadEdge?: number };
  /**
   * UI hints for Markdoc tags (spec §6.5.1): a friendly name, help text, the
   * attribute the block's header summarizes, value labels and a widget per
   * attribute. The tags themselves stay in markdoc.config.mjs.
   */
  markdoc?: { tags?: Record<string, MarkdocTagHint> };
  /**
   * MDX components the body editor may show as blocks (spec §6.5.2), each
   * with a Zod props schema (from astro/zod). Undeclared components stay
   * protected source chips.
   */
  mdx?: { components?: Record<string, MdxComponent> };
  /**
   * The site's time zone, as an IANA name such as `America/New_York`. Times
   * are shown and entered in it, and stored as ISO 8601 with an offset
   * (spec §6.17). Defaults to each editor's own time zone.
   */
  timeZone?: string;
  /** Role grants (spec §7.5). Cloud only, Phase 4. */
  roles?: Record<string, unknown>;
  /**
   * How redirects from `vesper.redirects.yaml` reach the live site (spec
   * §6.15.5). By default Astro writes an HTML redirect page at each old URL,
   * which works on any host. `native` adds the host's own rules too (true
   * 301s): `netlify`, `cloudflare` and `vercel` are detected from the
   * build environment; `apache` (most shared hosting) and `nginx` are set
   * here.
   */
  redirects?: { native?: NativeTarget[] };
};

/** Typed identity for `vesper.config.ts`. Validation happens when Vesper loads the file. */
export function defineConfig(config: VesperConfig): VesperConfig {
  return config;
}

const KNOWN_TOP_LEVEL = new Set([
  'collections',
  'widgets',
  'images',
  'markdoc',
  'mdx',
  'roles',
  'timeZone',
  'redirects',
]);
const KNOWN_COLLECTION = new Set([
  'label',
  'singleton',
  'tree',
  'url',
  'listFields',
  'newEntryPath',
  'schedule',
  'search',
  'placement',
  'maxDepth',
]);

/**
 * Checks a loaded config for mistakes Vesper can explain: unknown keys (often
 * typos) and values of the wrong type. It returns plain-language problems
 * and never throws. Unknown keys warn rather than fail, so a config written
 * for a newer Vesper still loads.
 */
export function checkConfig(config: unknown): { level: 'warning' | 'error'; message: string }[] {
  const problems: { level: 'warning' | 'error'; message: string }[] = [];
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return [
      {
        level: 'error',
        message: 'vesper.config.ts must export a config object (use defineConfig).',
      },
    ];
  }
  const record = config as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_TOP_LEVEL.has(key))
      problems.push({
        level: 'warning',
        message: `Unknown setting "${key}" in vesper.config.ts is ignored.`,
      });
  }
  const collections = record.collections;
  if (collections !== undefined) {
    if (typeof collections !== 'object' || collections === null) {
      problems.push({
        level: 'error',
        message: '"collections" must be an object keyed by collection name.',
      });
    } else {
      for (const [name, value] of Object.entries(collections as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null) {
          problems.push({ level: 'error', message: `collections.${name} must be an object.` });
          continue;
        }
        for (const key of Object.keys(value)) {
          if (!KNOWN_COLLECTION.has(key)) {
            problems.push({
              level: 'warning',
              message: `Unknown setting "collections.${name}.${key}" is ignored.`,
            });
          }
        }
        const { url, maxDepth } = value as { url?: unknown; maxDepth?: unknown };
        if (url !== undefined && typeof url !== 'string' && typeof url !== 'function') {
          problems.push({
            level: 'error',
            message: `collections.${name}.url must be a pattern string or a function.`,
          });
        }
        if (
          maxDepth !== undefined &&
          !(typeof maxDepth === 'number' && Number.isInteger(maxDepth) && maxDepth >= 1)
        ) {
          problems.push({
            level: 'error',
            message: `collections.${name}.maxDepth must be a whole number of levels, 1 or more.`,
          });
        }
      }
    }
  }
  const timeZone = record.timeZone;
  if (timeZone !== undefined && !isTimeZone(timeZone)) {
    problems.push({
      level: 'error',
      message: `timeZone must be an IANA time zone name such as "America/New_York", not ${JSON.stringify(timeZone)}.`,
    });
  }
  problems.push(
    ...checkMarkdoc(record.markdoc),
    ...checkMdx(record.mdx),
    ...checkRedirects(record.redirects),
  );
  const widgets = record.widgets;
  if (widgets !== undefined && typeof widgets === 'object' && widgets !== null) {
    for (const [name, widget] of Object.entries(widgets)) {
      const component = (widget as { component?: unknown } | null)?.component;
      if (typeof component !== 'function') {
        problems.push({
          level: 'error',
          message: `widgets.${name} needs a component: () => import('./YourWidget.tsx').`,
        });
      }
    }
  }
  return problems;
}

type Problem = { level: 'warning' | 'error'; message: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function unknownKeys(
  value: Record<string, unknown>,
  known: readonly string[],
  where: string,
): Problem[] {
  return Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => ({ level: 'warning', message: `Unknown setting "${where}.${key}" is ignored.` }));
}

function checkMarkdoc(markdoc: unknown): Problem[] {
  if (markdoc === undefined) return [];
  if (!isObject(markdoc)) return [{ level: 'error', message: '"markdoc" must be an object.' }];
  const problems = unknownKeys(markdoc, ['tags'], 'markdoc');
  const { tags } = markdoc;
  if (tags === undefined) return problems;
  if (!isObject(tags)) {
    return [
      ...problems,
      { level: 'error', message: 'markdoc.tags must be an object keyed by tag name.' },
    ];
  }
  for (const [name, hint] of Object.entries(tags)) {
    const where = `markdoc.tags.${name}`;
    if (!isObject(hint)) {
      problems.push({ level: 'error', message: `${where} must be an object.` });
      continue;
    }
    problems.push(...unknownKeys(hint, ['label', 'description', 'summary', 'attributes'], where));
    const { attributes } = hint;
    if (attributes === undefined) continue;
    if (!isObject(attributes)) {
      problems.push({ level: 'error', message: `${where}.attributes must be an object.` });
      continue;
    }
    for (const [attribute, attributeHint] of Object.entries(attributes)) {
      if (!isObject(attributeHint)) {
        problems.push({
          level: 'error',
          message: `${where}.attributes.${attribute} must be an object.`,
        });
      } else {
        problems.push(
          ...unknownKeys(
            attributeHint,
            ['label', 'description', 'labels', 'widget'],
            `${where}.attributes.${attribute}`,
          ),
        );
      }
    }
  }
  return problems;
}

function checkMdx(mdx: unknown): Problem[] {
  if (mdx === undefined) return [];
  if (!isObject(mdx)) return [{ level: 'error', message: '"mdx" must be an object.' }];
  const problems = unknownKeys(mdx, ['components'], 'mdx');
  const { components } = mdx;
  if (components === undefined) return problems;
  if (!isObject(components)) {
    return [
      ...problems,
      { level: 'error', message: 'mdx.components must be an object keyed by component name.' },
    ];
  }
  for (const [name, component] of Object.entries(components)) {
    const where = `mdx.components.${name}`;
    if (!isObject(component)) {
      problems.push({ level: 'error', message: `${where} must be an object.` });
      continue;
    }
    problems.push(
      ...unknownKeys(
        component,
        ['label', 'description', 'summary', 'children', 'inline', 'props'],
        where,
      ),
    );
    const { props } = component;
    if (props !== undefined && !(isObject(props) && typeof props.safeParse === 'function')) {
      problems.push({
        level: 'error',
        message: `${where}.props must be a Zod schema, such as z.object({ … }) from astro/zod.`,
      });
    }
    for (const key of ['children', 'inline'] as const) {
      if (component[key] !== undefined && typeof component[key] !== 'boolean') {
        problems.push({ level: 'error', message: `${where}.${key} must be true or false.` });
      }
    }
  }
  return problems;
}

function checkRedirects(redirects: unknown): Problem[] {
  if (redirects === undefined) return [];
  if (!isObject(redirects)) return [{ level: 'error', message: '"redirects" must be an object.' }];
  const problems = unknownKeys(redirects, ['native'], 'redirects');
  const { native } = redirects;
  if (native === undefined) return problems;
  if (!Array.isArray(native)) {
    return [...problems, { level: 'error', message: 'redirects.native must be a list of hosts.' }];
  }
  for (const target of native) {
    if (!NATIVE_TARGETS.includes(target as NativeTarget)) {
      problems.push({
        level: 'error',
        message: `redirects.native: ${JSON.stringify(target)} isn't a host Vesper writes rules for. Use ${NATIVE_TARGETS.join(', ')}.`,
      });
    }
  }
  return problems;
}

function isTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
