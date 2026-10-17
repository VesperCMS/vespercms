import type { CollectionConfig, FieldModel } from '@vesper/core';

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

export type VesperConfig = {
  collections?: Record<string, VesperCollectionConfig>;
  widgets?: Record<string, CustomWidget>;
  /** Image ratios and upload limits (spec §6.6.3). Used from Phase 2.7. */
  images?: { ratios?: Record<string, number>; maxUploadEdge?: number };
  /** UI hints for Markdoc tags (spec §6.5.1). Used from Phase 2.5. */
  markdoc?: { tags?: Record<string, unknown> };
  /** Declared MDX components (spec §6.5.2). Used from Phase 2.5. */
  mdx?: { components?: Record<string, unknown> };
  /** Role grants (spec §7.5). Cloud only, Phase 4. */
  roles?: Record<string, unknown>;
};

/** Typed identity for `vesper.config.ts`. Validation happens when Vesper loads the file. */
export function defineConfig(config: VesperConfig): VesperConfig {
  return config;
}

const KNOWN_TOP_LEVEL = new Set(['collections', 'widgets', 'images', 'markdoc', 'mdx', 'roles']);
const KNOWN_COLLECTION = new Set([
  'label',
  'singleton',
  'tree',
  'url',
  'listFields',
  'newEntryPath',
  'schedule',
  'search',
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
        const { url } = value as { url?: unknown };
        if (url !== undefined && typeof url !== 'string' && typeof url !== 'function') {
          problems.push({
            level: 'error',
            message: `collections.${name}.url must be a pattern string or a function.`,
          });
        }
      }
    }
  }
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
