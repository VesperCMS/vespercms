import type { A11ySettings } from '../a11y/types.ts';
import type { Diagnostic, FieldModel } from '../field-model.ts';
import type { MarkdocManifest, MdxManifest } from '../markdoc/types.ts';
import type { NativeTarget } from '../urls/hosts.ts';
import type { UrlSettings } from '../urls/pattern.ts';

/**
 * The manifest (spec §6.2): everything the studio and the cloud need to know
 * about a site's content, as plain JSON. It's generated from the site's own
 * config files, bundled into `/admin`, and emitted to
 * `dist/_vesper/manifest.json`. That's how the cloud learns the schema
 * without any secrets in the build.
 *
 * It is deterministic: the same site always produces the same bytes. There
 * are no timestamps, the config's own order is kept, and paths are POSIX.
 */
export type Manifest = {
  manifestVersion: 1;
  generator: { name: string; version: string };
  /** SHA-256 of the manifest's content (everything except `generator` and `hash`). */
  hash: string;
  site: {
    srcDir: string;
    contentConfig?: string;
    /** IANA time zone for showing and entering times (spec §6.17), from vesper.config.ts. */
    timeZone?: string;
    /**
     * How the site's URLs are written (spec §6.15.1): Astro's `base`,
     * `trailingSlash` and `build.format`, its `site`, and the time zone
     * for date tokens. Absent in manifests built outside Astro (the CLI),
     * where Astro's defaults apply.
     */
    urls?: UrlSettings;
    /** Native redirect rules the site asks for in vesper.config.ts (spec §6.15.5). */
    redirects?: { native: NativeTarget[] };
    /**
     * Aspect ratios for crops (spec §6.6.3): the site's own from vesper.config.ts,
     * then the built-in `og`. `maxUploadEdge` when the site sets one (spec §6.6.6).
     * Absent in manifests from before Phase 2.7.
     */
    images?: { ratios: Record<string, number>; maxUploadEdge?: number };
    /**
     * Accessibility settings from vesper.config.ts (spec §6.18): the rules that
     * refuse a save, and the backgrounds text colours are checked against.
     * Absent when the site sets neither.
     */
    a11y?: A11ySettings;
  };
  collections: CollectionManifest[];
  forms: FormManifest[];
  /** The site's Markdoc tags (spec §6.5.1), when it uses @astrojs/markdoc. */
  markdoc?: MarkdocManifest;
  /** Components declared for MDX bodies in vesper.config.ts (spec §6.5.2). */
  mdx?: MdxManifest;
  diagnostics: Diagnostic[];
};

export type CollectionSource =
  | {
      loader: 'glob';
      /** Relative to the site root, POSIX. */
      base: string;
      pattern: string | string[];
      /** `custom` when the site passes its own `generateId`: Vesper can't predict new entries' IDs. */
      generateId: 'default' | 'custom';
      /** File extensions the pattern spells out. */
      formats: string[];
    }
  | {
      loader: 'file';
      path: string;
      format: 'json' | 'yaml' | 'toml' | 'unknown';
      customParser: boolean;
    }
  | { loader: 'other'; name?: string };

export type ReadOnlyCollectionReason =
  /** A loader other than glob() or file(): Vesper doesn't know where its entries live. */
  | 'custom-loader'
  /** TOML, or a custom parser: no formatting-preserving writer exists. */
  | 'unsupported-format'
  /** The config couldn't be evaluated (for example, it imports a runtime-only module). */
  | 'config-error';

export type SchedulePresentation = {
  unpublish: boolean;
  publishAt: string;
  unpublishAt: string;
  /**
   * The field holding where visitors go once the entry is unpublished (spec
   * §6.17). Absent in manifests from before Phase 4.5, where it's
   * `unpublishRedirect`.
   */
  unpublishRedirect?: string;
};

/** One icon's drawing: Lucide's `[tag, attributes][]` on a 24-unit grid. */
export type IconNode = [tag: string, attributes: Record<string, string | number>][];

export type CollectionPresentation = {
  singleton?: boolean;
  tree?: boolean;
  /** A URL pattern (spec §6.15.1), or `function` when vesper.config.ts uses the function form. */
  url?: string | { kind: 'function' };
  listFields?: string[];
  newEntryPath?: string;
  schedule?: SchedulePresentation;
  search?: boolean;
  /**
   * The boolean that hides an entry from site search (spec §6.19): a field
   * from `fields.hideFromSearch()`, or one named `noindex` at the top level
   * or under `seo`. Absent when the collection has none, has no URL, or
   * isn't searched; the studio then shows no switch.
   */
  searchHidden?: string[];
  /** For tree collections: how many folders deep pages may go (spec §6.15.4). No limit when absent. */
  maxDepth?: number;
  /** The level the body's top headings should have (spec §6.18). 2 when absent: the title is the page's h1. */
  headingStart?: number;
  /** The Lucide icon vesper.config.ts names for it, with its drawing (DECISIONS.md). */
  icon?: { name: string; node: IconNode };
  /** Editor tabs vesper.config.ts declares beside Content and Details, in order ("SEO"). */
  tabs?: { id: string; label: string }[];
};

export type CollectionManifest = {
  name: string;
  label: string;
  editable: boolean;
  readOnlyReason?: ReadOnlyCollectionReason;
  source: CollectionSource;
  entryKind: 'content' | 'data';
  /** Field models, or `null` to edit each entry's whole frontmatter as raw YAML. */
  fields: FieldModel[] | null;
  extraKeys?: FieldModel['extraKeys'];
  presentation: CollectionPresentation;
  /**
   * The route in src/pages that renders this collection's entries, from
   * Astro's resolved routes (spec §6.15.1). Set by the integration in dev
   * and at build; absent when no route was found.
   */
  route?: { pattern: string; entrypoint: string };
};

export type FormManifest = {
  name: string;
  fields: FieldModel[] | null;
  /** Plain-data options from the form definition, such as `confirmation` and `successMessage`. */
  options: Record<string, unknown>;
};
