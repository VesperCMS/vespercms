import type { Diagnostic, FieldModel } from '../field-model.ts';

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
  };
  collections: CollectionManifest[];
  forms: FormManifest[];
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

export type SchedulePresentation = { unpublish: boolean; publishAt: string; unpublishAt: string };

export type CollectionPresentation = {
  singleton?: boolean;
  tree?: boolean;
  /** A URL pattern (spec §6.15.1), or `function` when vesper.config.ts uses the function form. */
  url?: string | { kind: 'function' };
  listFields?: string[];
  newEntryPath?: string;
  schedule?: SchedulePresentation;
  search?: boolean;
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
};

export type FormManifest = {
  name: string;
  fields: FieldModel[] | null;
  /** Plain-data options from the form definition, such as `confirmation` and `successMessage`. */
  options: Record<string, unknown>;
};
