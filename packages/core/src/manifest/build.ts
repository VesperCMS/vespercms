import { isContrastUse, parseHexColor } from '../a11y/contrast.ts';
import { isA11yRuleId } from '../a11y/rules.ts';
import type { A11ySettings } from '../a11y/types.ts';
import { dataFormatOf } from '../files/data-file.ts';
import { entryKindOf, patternExtensions } from '../collections/entries.ts';
import type { Diagnostic, FieldModel } from '../field-model.ts';
import { extractMarkdocSchema, type MarkdocConfigLike } from '../markdoc/extract.ts';
import { markdocFields } from '../markdoc/fields.ts';
import type {
  MarkdocManifest,
  MarkdocTagHint,
  MdxComponentConfig,
  MdxManifest,
} from '../markdoc/types.ts';
import { RATIO_NAME, isRatio, siteRatios } from '../images/ratios.ts';
import { humanize } from '../schema/humanize.ts';
import { globMatcher } from '../collections/entries.ts';
import type { NativeTarget } from '../urls/hosts.ts';
import { DEFAULT_URL_SETTINGS, type UrlSettings } from '../urls/pattern.ts';
import { walkSchema } from '../schema/walk.ts';
import { resolveWidgets, type WidgetDefinition } from '../widgets/resolve.ts';
import { manifestHash } from './hash.ts';
import type {
  CollectionManifest,
  CollectionPresentation,
  CollectionSource,
  FormManifest,
  Manifest,
  SchedulePresentation,
} from './types.ts';

/** How a collection's entries are loaded, as Vesper's config loader observed it. */
export type LoaderInfo =
  | { kind: 'glob'; base: string; pattern: string | string[]; customId: boolean }
  | { kind: 'file'; path: string; customParser: boolean }
  | { kind: 'other'; name?: string };

export type CollectionInput = {
  name: string;
  loader: LoaderInfo;
  /** The collection's Zod schema, already called with Vesper's `image()` if it was a function. */
  schema: unknown;
  /** Set when the config couldn't be evaluated for this collection. */
  error?: string;
};

/** The presentation part of `vesper.config.ts` for one collection. Never field definitions (D2). */
export type CollectionConfig = {
  label?: string;
  singleton?: boolean;
  tree?: boolean;
  url?: string | ((entry: unknown) => string);
  listFields?: string[];
  newEntryPath?: string;
  schedule?: boolean | { unpublish?: boolean; publishAt?: string; unpublishAt?: string };
  search?: boolean;
  /** Editor placement per top-level field key, overriding `.meta({ placement })`. */
  placement?: Record<string, 'main' | 'details'>;
  /** For tree collections: the deepest a page may be (spec §6.15.4). No default. */
  maxDepth?: number;
  /** The level the body's top headings should have (spec §6.18). 2 by default. */
  headingStart?: number;
};

export type ManifestInput = {
  site: {
    srcDir: string;
    contentConfig?: string;
    /** Astro's URL settings, when the manifest is built inside Astro. */
    urls?: Partial<Omit<UrlSettings, 'timeZone'>>;
  };
  collections: CollectionInput[];
  config?: {
    collections?: Record<string, CollectionConfig>;
    widgets?: Record<string, WidgetDefinition>;
    timeZone?: string;
    /** Native redirect rules (spec §6.15.5). */
    redirects?: { native?: NativeTarget[] };
    /** UI hints for Markdoc tags (spec §6.5.1). */
    markdoc?: { tags?: Record<string, MarkdocTagHint> };
    /** Declared MDX components (spec §6.5.2). */
    mdx?: { components?: Record<string, MdxComponentConfig> };
    /** Aspect ratios and the upload size limit (spec §6.6.3, §6.6.6). */
    images?: { ratios?: Record<string, number>; maxUploadEdge?: number };
    /** Accessibility settings (spec §6.18): the publish gate and the declared backgrounds. */
    a11y?: { blockPublishOn?: string[]; backgrounds?: Record<string, string> };
  };
  /**
   * The site's Markdoc config, merged the way @astrojs/markdoc merges it, and
   * the integration's parse options. Absent when the site doesn't use Markdoc.
   */
  markdoc?: {
    config: MarkdocConfigLike;
    options: { allowHTML?: boolean; ignoreIndentation?: boolean };
  };
  forms?: { name: string; schema: unknown; options?: Record<string, unknown> }[];
  /** Problems found while loading the site's configs. */
  diagnostics?: Diagnostic[];
  generator?: { name: string; version: string };
};

/** Builds the manifest from a site's evaluated configs. Never throws for content problems; it reports them. */
export async function buildManifest(input: ManifestInput): Promise<Manifest> {
  const diagnostics: Diagnostic[] = [...(input.diagnostics ?? [])];
  const widgets = input.config?.widgets ?? {};
  const configured = input.config?.collections ?? {};

  for (const name of Object.keys(configured)) {
    if (!input.collections.some((c) => c.name === name)) {
      diagnostics.push({
        level: 'warning',
        code: 'unknown-collection',
        message: `vesper.config.ts configures "${name}", but content.config.ts has no collection by that name.`,
        collection: name,
      });
    }
  }

  const collections = input.collections.map((collection) =>
    buildCollection(collection, configured[collection.name] ?? {}, widgets, diagnostics),
  );

  const forms: FormManifest[] = (input.forms ?? []).map((form) => {
    const walk = walkSchema(form.schema, { collection: `form:${form.name}` });
    diagnostics.push(...walk.diagnostics);
    return {
      name: form.name,
      fields: walk.fields
        ? resolveWidgets(walk.fields, diagnostics, {
            custom: widgets,
            collection: `form:${form.name}`,
          })
        : null,
      options: plainData(form.options ?? {}),
    };
  });

  const images = imagesOf(input.config?.images);
  diagnostics.push(...ratioDiagnostics(collections, images.ratios));
  const a11y = a11yOf(input.config?.a11y);
  diagnostics.push(...contrastDiagnostics(collections, a11y));

  const markdoc = input.markdoc ? markdocOf(input, widgets, diagnostics) : undefined;
  const mdx = mdxOf(input.config?.mdx?.components, widgets, diagnostics);

  const content = {
    manifestVersion: 1 as const,
    site: {
      srcDir: input.site.srcDir,
      ...(input.site.contentConfig ? { contentConfig: input.site.contentConfig } : {}),
      ...(input.config?.timeZone ? { timeZone: input.config.timeZone } : {}),
      ...(input.site.urls ? { urls: urlSettingsOf(input.site.urls, input.config?.timeZone) } : {}),
      ...(input.config?.redirects?.native?.length
        ? { redirects: { native: [...input.config.redirects.native] } }
        : {}),
      images,
      ...(a11y ? { a11y } : {}),
    },
    collections,
    forms,
    ...(markdoc ? { markdoc } : {}),
    ...(mdx ? { mdx } : {}),
    diagnostics,
  };
  return {
    ...content,
    generator: input.generator ?? { name: '@vesper/core', version: '0.0.0' },
    hash: await manifestHash(content),
  };
}

function markdocOf(
  input: ManifestInput,
  widgets: Record<string, WidgetDefinition>,
  diagnostics: Diagnostic[],
): MarkdocManifest {
  const { config, options } = input.markdoc ?? { config: {}, options: {} };
  return extractMarkdocSchema(config, {
    options,
    ...(input.config?.markdoc?.tags ? { hints: input.config.markdoc.tags } : {}),
    diagnostics,
    fields: (tag, hint) =>
      resolveWidgets(markdocFields(tag, hint), diagnostics, {
        custom: widgets,
        collection: `markdoc:${tag.name}`,
      }),
  });
}

/** Declared MDX components, with field models from their Zod props schemas. */
function mdxOf(
  components: Record<string, MdxComponentConfig> | undefined,
  widgets: Record<string, WidgetDefinition>,
  diagnostics: Diagnostic[],
): MdxManifest | undefined {
  if (!components) return undefined;
  return {
    components: Object.entries(components).map(([name, component]) => {
      let fields: MdxManifest['components'][number]['fields'] = [];
      if (component.props !== undefined) {
        const walk = walkSchema(component.props, { collection: `mdx:${name}` });
        diagnostics.push(...walk.diagnostics);
        fields = walk.fields
          ? resolveWidgets(walk.fields, diagnostics, { custom: widgets, collection: `mdx:${name}` })
          : null;
      }
      return {
        name,
        // Component names are already written for people ("YouTube"); humanizing would mangle them.
        label: component.label ?? name,
        ...(component.description ? { description: component.description } : {}),
        ...(component.summary ? { summary: component.summary } : {}),
        children: component.children === true,
        inline: component.inline === true,
        fields,
      };
    }),
  };
}

/**
 * The site's aspect ratios (with the built-in `og`) and upload limit. Values
 * vesper.config.ts gets wrong are left out here; loading the config reports them.
 */
function imagesOf(
  config: { ratios?: Record<string, number>; maxUploadEdge?: number } | undefined,
): { ratios: Record<string, number>; maxUploadEdge?: number } {
  const declared = Object.fromEntries(
    Object.entries(config?.ratios ?? {}).filter(
      ([name, ratio]) => RATIO_NAME.test(name) && isRatio(ratio),
    ),
  );
  const edge = config?.maxUploadEdge;
  return {
    ratios: siteRatios(declared),
    ...(typeof edge === 'number' && Number.isInteger(edge) && edge > 0
      ? { maxUploadEdge: edge }
      : {}),
  };
}

/** Image fields that list a ratio the site doesn't declare (spec §6.6.3): their previews would be missing. */
function ratioDiagnostics(
  collections: CollectionManifest[],
  ratios: Record<string, number>,
): Diagnostic[] {
  const found: Diagnostic[] = [];
  const visit = (collection: string, fields: FieldModel[]) => {
    for (const field of fields) {
      const listed = field.widget === 'image' ? field.widgetOptions?.ratios : undefined;
      if (Array.isArray(listed)) {
        for (const name of listed as unknown[]) {
          if (typeof name === 'string' && name in ratios) continue;
          found.push({
            level: 'warning',
            code: 'unknown-ratio',
            message: `${field.path.join('.')} lists the ratio ${JSON.stringify(name)}, which vesper.config.ts doesn't declare. Declared: ${Object.keys(ratios).join(', ')}.`,
            collection,
            path: field.path.map(String),
          });
        }
      }
      if (field.children) visit(collection, field.children);
    }
  };
  for (const collection of collections) visit(collection.name, collection.fields ?? []);
  return found;
}

/**
 * The site's accessibility settings (spec §6.18). Unknown rule IDs and colours
 * that aren't hex are left out here; loading the config reports them.
 */
function a11yOf(
  config: { blockPublishOn?: string[]; backgrounds?: Record<string, string> } | undefined,
): A11ySettings | undefined {
  const blockPublishOn = [...new Set((config?.blockPublishOn ?? []).filter(isA11yRuleId))];
  const backgrounds = Object.entries(config?.backgrounds ?? {})
    .filter(([, color]) => typeof color === 'string' && parseHexColor(color) !== null)
    .map(([name, color]) => ({ name, color }));
  if (blockPublishOn.length === 0 && backgrounds.length === 0) return undefined;
  return {
    ...(blockPublishOn.length > 0 ? { blockPublishOn } : {}),
    ...(backgrounds.length > 0 ? { backgrounds } : {}),
  };
}

/** Colour fields that ask for a contrast check on a site with no declared backgrounds: nothing to check against. */
function contrastDiagnostics(
  collections: CollectionManifest[],
  a11y: A11ySettings | undefined,
): Diagnostic[] {
  if (a11y?.backgrounds?.length) return [];
  const found: Diagnostic[] = [];
  const visit = (collection: string, fields: FieldModel[]) => {
    for (const field of fields) {
      if (field.widget === 'color' && isContrastUse(field.widgetOptions?.contrast)) {
        found.push({
          level: 'warning',
          code: 'contrast-no-backgrounds',
          message: `${field.path.join('.')} asks for a contrast check, but vesper.config.ts declares no a11y.backgrounds to check it against.`,
          collection,
          path: field.path.map(String),
        });
      }
      if (field.children) visit(collection, field.children);
    }
  };
  for (const collection of collections) visit(collection.name, collection.fields ?? []);
  return found;
}

function buildCollection(
  input: CollectionInput,
  config: CollectionConfig,
  widgets: Record<string, WidgetDefinition>,
  diagnostics: Diagnostic[],
): CollectionManifest {
  const source = sourceOf(input.loader);
  const formats =
    source.loader === 'glob' ? source.formats : source.loader === 'file' ? [source.format] : [];
  let readOnlyReason: CollectionManifest['readOnlyReason'];
  if (input.error) readOnlyReason = 'config-error';
  else if (source.loader === 'other') readOnlyReason = 'custom-loader';
  else if (
    source.loader === 'file' &&
    (source.customParser || source.format === 'toml' || source.format === 'unknown')
  ) {
    readOnlyReason = 'unsupported-format';
  } else if (source.loader === 'glob' && formats.length > 0 && formats.every((f) => f === 'toml')) {
    readOnlyReason = 'unsupported-format';
  }

  if (input.error) {
    diagnostics.push({
      level: 'error',
      code: 'config-error',
      message: input.error,
      collection: input.name,
    });
  } else if (source.loader === 'other') {
    diagnostics.push({
      level: 'info',
      code: 'custom-loader',
      message: `"${input.name}" uses a custom loader${source.name ? ` (${source.name})` : ''}. Only collections using glob() or file() can be edited, so it is listed read-only.`,
      collection: input.name,
    });
  }

  let fields: CollectionManifest['fields'] = null;
  let extraKeys: CollectionManifest['extraKeys'];
  if (input.schema !== undefined && input.schema !== null && !input.error) {
    const walk = walkSchema(input.schema, { collection: input.name });
    diagnostics.push(...walk.diagnostics);
    fields = walk.fields
      ? withPlacement(
          resolveWidgets(walk.fields, diagnostics, { custom: widgets, collection: input.name }),
          config.placement,
        )
      : null;
    extraKeys = walk.extraKeys;
  }

  diagnostics.push(...urlDiagnostics(input.name, source, config));

  return {
    name: input.name,
    label: config.label ?? humanize(input.name),
    editable: readOnlyReason === undefined,
    ...(readOnlyReason ? { readOnlyReason } : {}),
    source,
    entryKind: source.loader === 'file' ? 'data' : entryKindOf(formats),
    fields,
    ...(extraKeys ? { extraKeys } : {}),
    presentation: presentationOf(config),
  };
}

function urlSettingsOf(
  urls: NonNullable<ManifestInput['site']['urls']>,
  timeZone: string | undefined,
): UrlSettings {
  const base = urls.base ?? DEFAULT_URL_SETTINGS.base;
  return {
    base: `/${base.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/'),
    trailingSlash: urls.trailingSlash ?? DEFAULT_URL_SETTINGS.trailingSlash,
    buildFormat: urls.buildFormat ?? DEFAULT_URL_SETTINGS.buildFormat,
    ...(urls.site ? { site: urls.site } : {}),
    ...(timeZone ? { timeZone } : {}),
  };
}

/** Problems with a collection's URL and tree settings that Vesper can explain (spec §6.15). */
function urlDiagnostics(
  name: string,
  source: CollectionSource,
  config: CollectionConfig,
): Diagnostic[] {
  const found: Diagnostic[] = [];
  if (config.tree && source.loader !== 'glob') {
    found.push({
      level: 'warning',
      code: 'tree-not-glob',
      message: `"${name}" sets tree: true, but only collections loaded with glob() can be shown as a tree of folders.`,
      collection: name,
    });
  }
  // Order files sit among pages; a collection of data files has none to pick up.
  if (source.loader === 'glob' && (config.tree || entryKindOf(source.formats) === 'content')) {
    const matches = globMatcher(source.pattern);
    if (matches('_order.yaml') || matches('section/_order.yaml')) {
      found.push({
        level: 'warning',
        code: 'order-file-matched',
        message: `"${name}"'s glob pattern also picks up _order.yaml files, which hold page order, not entries. Use a pattern that skips files starting with _, such as '**/[^_]*.md'.`,
        collection: name,
      });
    }
  }
  return found;
}

function withPlacement(
  fields: FieldModel[],
  placement: CollectionConfig['placement'],
): FieldModel[] {
  if (!placement) return fields;
  return fields.map((field) => {
    const where = placement[field.path[0] ?? ''];
    return where === 'main' || where === 'details' ? { ...field, placement: where } : field;
  });
}

function sourceOf(loader: LoaderInfo): CollectionSource {
  if (loader.kind === 'glob') {
    return {
      loader: 'glob',
      base: toPosix(loader.base),
      pattern: loader.pattern,
      generateId: loader.customId ? 'custom' : 'default',
      formats: patternExtensions(loader.pattern),
    };
  }
  if (loader.kind === 'file') {
    return {
      loader: 'file',
      path: toPosix(loader.path),
      format: dataFormatOf(loader.path) ?? 'unknown',
      customParser: loader.customParser,
    };
  }
  return loader.name ? { loader: 'other', name: loader.name } : { loader: 'other' };
}

function presentationOf(config: CollectionConfig): CollectionPresentation {
  const presentation: CollectionPresentation = {};
  if (config.singleton !== undefined) presentation.singleton = config.singleton;
  if (config.tree !== undefined) presentation.tree = config.tree;
  if (typeof config.url === 'string') presentation.url = config.url;
  else if (typeof config.url === 'function') presentation.url = { kind: 'function' };
  if (config.listFields) presentation.listFields = [...config.listFields];
  if (config.newEntryPath !== undefined) presentation.newEntryPath = config.newEntryPath;
  if (config.schedule) presentation.schedule = scheduleOf(config.schedule);
  if (config.search !== undefined) presentation.search = config.search;
  if (config.maxDepth !== undefined) presentation.maxDepth = config.maxDepth;
  const start = config.headingStart;
  if (typeof start === 'number' && Number.isInteger(start) && start >= 1 && start <= 6)
    presentation.headingStart = start;
  return presentation;
}

function scheduleOf(
  schedule: true | { unpublish?: boolean; publishAt?: string; unpublishAt?: string },
): SchedulePresentation {
  const options = schedule === true ? {} : schedule;
  return {
    unpublish: options.unpublish ?? true,
    publishAt: options.publishAt ?? 'publishAt',
    unpublishAt: options.unpublishAt ?? 'unpublishAt',
  };
}

const toPosix = (path: string) => path.replaceAll('\\', '/').replace(/^\.\//, '');

/** Keeps only plain data (drops functions and class instances) so options can go into JSON. */
function plainData(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'function' ? undefined : v)),
  ) as Record<string, unknown>;
}
