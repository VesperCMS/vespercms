import {
  A11Y_RULE_IDS,
  NATIVE_TARGETS,
  RATIO_NAME,
  isA11yRuleId,
  isRatio,
  parseHexColor,
  type A11yRuleId,
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
  /**
   * Images (spec §6.6.3, §6.6.6). `ratios` names the crops the site renders,
   * as width / height: `{ wide: 16 / 9, square: 1 }`. The studio previews
   * them and `<Img ratio="wide">` renders them; `og` (1.91:1, for social
   * images) is built in. `maxUploadEdge` scales down uploads whose long
   * edge is larger, in pixels (3000 by default).
   */
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
  /**
   * How redirects from `vesper.redirects.yaml` reach the live site (spec
   * §6.15.5). By default Astro writes an HTML redirect page at each old URL,
   * which works on any host. `native` adds the host's own rules too (true
   * 301s): `netlify`, `cloudflare` and `vercel` are detected from the
   * build environment; `apache` (most shared hosting) and `nginx` are set
   * here.
   */
  redirects?: { native?: NativeTarget[] };
  /**
   * Accessibility checks (spec §6.18). `blockPublishOn` lists the rules whose
   * notes refuse a save, such as `['missing-alt']`; by default every note only
   * warns. `backgrounds` names the colours the site draws text on, so text
   * colours from `fields.color({ contrast: 'text' })` can be checked against
   * each: `{ 'Page': '#ffffff', 'Footer': '#1d2433' }`.
   */
  a11y?: { blockPublishOn?: A11yRuleId[]; backgrounds?: Record<string, string> };
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
  'timeZone',
  'redirects',
  'a11y',
]);
/** A Lucide icon name: lower-case words and numbers joined by hyphens. */
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  'headingStart',
  'icon',
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
    if (key === 'roles') {
      // Grants left the config on 2026-10-20 (DECISIONS.md, "Grants are set in the dashboard").
      problems.push({
        level: 'warning',
        message:
          '"roles" in vesper.config.ts is ignored. Site admins give each person a role and what they can edit in the dashboard.',
      });
    } else if (!KNOWN_TOP_LEVEL.has(key))
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
        const { url, maxDepth, headingStart, icon } = value as {
          url?: unknown;
          maxDepth?: unknown;
          headingStart?: unknown;
          icon?: unknown;
        };
        if (icon !== undefined && !(typeof icon === 'string' && ICON_NAME.test(icon))) {
          problems.push({
            level: 'error',
            message: `collections.${name}.icon must be a Lucide icon name as lucide.dev/icons lists it, such as "newspaper" or "calendar-days".`,
          });
        }
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
        if (
          headingStart !== undefined &&
          !(
            typeof headingStart === 'number' &&
            Number.isInteger(headingStart) &&
            headingStart >= 1 &&
            headingStart <= 6
          )
        ) {
          problems.push({
            level: 'error',
            message: `collections.${name}.headingStart must be a heading level from 1 to 6: usually 2, when the page's title is its h1.`,
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
    ...checkImages(record.images),
    ...checkA11y(record.a11y),
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
            ['label', 'description', 'labels', 'widget', 'schema'],
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

function checkImages(images: unknown): Problem[] {
  if (images === undefined) return [];
  if (!isObject(images)) return [{ level: 'error', message: '"images" must be an object.' }];
  const problems = unknownKeys(images, ['ratios', 'maxUploadEdge'], 'images');
  const { ratios, maxUploadEdge } = images;
  if (ratios !== undefined && !isObject(ratios)) {
    problems.push({
      level: 'error',
      message: 'images.ratios must be an object of names and ratios, such as { wide: 16 / 9 }.',
    });
  } else if (ratios !== undefined) {
    for (const [name, ratio] of Object.entries(ratios)) {
      if (!RATIO_NAME.test(name)) {
        problems.push({
          level: 'error',
          message: `images.ratios: ${JSON.stringify(name)} can't be a ratio's name. Use a word, such as wide or square.`,
        });
      } else if (!isRatio(ratio)) {
        problems.push({
          level: 'error',
          message: `images.ratios.${name} must be a number above zero, width / height, such as 16 / 9.`,
        });
      }
    }
  }
  if (
    maxUploadEdge !== undefined &&
    !(typeof maxUploadEdge === 'number' && Number.isInteger(maxUploadEdge) && maxUploadEdge > 0)
  ) {
    problems.push({
      level: 'error',
      message: 'images.maxUploadEdge must be a whole number of pixels, such as 3000.',
    });
  }
  return problems;
}

function checkA11y(a11y: unknown): Problem[] {
  if (a11y === undefined) return [];
  if (!isObject(a11y)) return [{ level: 'error', message: '"a11y" must be an object.' }];
  const problems = unknownKeys(a11y, ['blockPublishOn', 'backgrounds'], 'a11y');
  const { blockPublishOn, backgrounds } = a11y;
  if (blockPublishOn !== undefined && !Array.isArray(blockPublishOn)) {
    problems.push({
      level: 'error',
      message: "a11y.blockPublishOn must be a list of rule names, such as ['missing-alt'].",
    });
  } else if (blockPublishOn !== undefined) {
    for (const rule of blockPublishOn as unknown[]) {
      if (!isA11yRuleId(rule)) {
        problems.push({
          level: 'warning',
          message: `a11y.blockPublishOn: ${JSON.stringify(rule)} isn't a rule, so it blocks nothing. The rules are ${A11Y_RULE_IDS.join(', ')}.`,
        });
      }
    }
  }
  if (backgrounds !== undefined && !isObject(backgrounds)) {
    problems.push({
      level: 'error',
      message: "a11y.backgrounds must name each background colour, such as { Page: '#ffffff' }.",
    });
  } else if (backgrounds !== undefined) {
    for (const [name, color] of Object.entries(backgrounds)) {
      if (typeof color !== 'string' || parseHexColor(color) === null) {
        problems.push({
          level: 'error',
          message: `a11y.backgrounds.${name} must be a hex colour such as '#ffffff', not ${JSON.stringify(color)}.`,
        });
      }
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
