import { slug as githubSlug } from 'github-slugger';
import type { BodyIssue } from '../body/validate.ts';
import { defaultEntryId, globMatcher } from '../collections/entries.ts';
import {
  dataFormatOf,
  readCollectionFile,
  readDataFile,
  writeCollectionEntry,
  writeDataFile,
  type DataFormat,
} from '../files/data-file.ts';
import { isPlainObject, type DataObject, type DataValue } from '../files/equal.ts';
import { readEntryFile, writeEntryFile } from '../files/entry-file.ts';
import { SerializationError } from '../files/errors.ts';
import { splitFrontmatter, withRaw } from '../files/frontmatter.ts';
import { decodeUtf8, encodeUtf8 } from '../files/text.ts';
import { readYaml } from '../files/yaml/read.ts';
import { writeYaml } from '../files/yaml/write.ts';
import { canonicalJson } from '../manifest/hash.ts';
import type { CollectionManifest, Manifest } from '../manifest/types.ts';
import { gitBlobSha } from '../storage/git-blob-sha.ts';
import type { FileChange, StorageAdapter, StorageEntry, StoredFile } from '../storage/types.ts';
import { DEFAULT_URL_SETTINGS, type UrlSettings } from '../urls/pattern.ts';
import { rewriteBody, rewriteValues } from './links.ts';
import { dirOf } from './media.ts';
import {
  decodeData,
  encodeValue,
  type CollectionSummary,
  type EntryDocument,
  type EntryFormat,
  type EntryStatus,
  type EntrySummary,
  type FieldIssue,
  type SaveRequest,
  type SaveResponse,
} from './protocol.ts';

/*
 * The studio's content operations over any storage adapter: list, read,
 * create, save and delete entries, exactly as Astro's glob() and file()
 * loaders see them. Local mode runs it in the dev server; GitHub mode
 * (Phase 3) runs the same code in the browser over the GitHub adapter.
 *
 * Every save checks the version the editor started from, so an entry that
 * changed underneath it is a conflict, never an overwrite.
 */

/** Checks values against the collection's real schema. Returns no issues when they're valid. */
export type Validator = (collection: string, data: DataObject) => Promise<FieldIssue[]>;

/**
 * Checks a body before it's written (Markdoc tags, MDX props). Issues at
 * `error` level stop the save: the site couldn't be built with them.
 */
export type BodyValidator = (input: {
  collection: string;
  format: 'md' | 'mdx' | 'mdoc';
  body: string;
  /** The entry's file, site-relative, for resolving partials. */
  path: string;
}) => Promise<BodyIssue[]>;

/**
 * Where a new page goes in a tree collection, and what else changes with it
 * (a leaf parent becoming a section, the parent's `_order.yaml`). Provided by
 * `PageService`, which knows the tree; a refusal is a `SaveResponse`.
 */
export type TreeHooks = {
  placeNew: (
    collection: CollectionManifest,
    request: {
      parent: string;
      slug: string;
      data: DataObject;
      /** A copy's original (its entry ID): the copy goes right after it among its siblings. */
      after?: string;
      /** The new file's extension, when it isn't the collection's first format (a copy's). */
      extension?: string;
    },
  ) => Promise<
    { ok: true; relative: string; changes: FileChange[] } | { ok: false; response: SaveResponse }
  >;
  /** Changes that go with deleting an entry (its line in `_order.yaml`). */
  deleteChanges: (collection: CollectionManifest, entry: StoredEntry) => Promise<FileChange[]>;
};

export type ContentServiceOptions = {
  validate?: Validator;
  validateBody?: BodyValidator;
  now?: () => Date;
  /** Tree collections' placement and order rules (spec §6.15). Without them, trees are plain folders. */
  tree?: () => TreeHooks | undefined;
};

const CONTENT_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'mdoc']);

type GlobSource = Extract<CollectionManifest['source'], { loader: 'glob' }>;
type FileSource = Extract<CollectionManifest['source'], { loader: 'file' }>;

/** An entry found in storage, with everything a read or a save needs. */
export type StoredEntry = Located;

type Located = {
  id: string;
  path: string;
  file: StoredFile;
  version: string;
  format: EntryFormat;
  status: EntryStatus;
  message?: string;
  data: DataValue;
  body?: string;
  rawFrontmatter?: string;
  modifiedAt?: string;
};

export class ContentService {
  private readonly storage: StorageAdapter;
  private readonly collections: Map<string, CollectionManifest>;
  private readonly validate: Validator | undefined;
  private readonly validateBody: BodyValidator | undefined;
  private readonly srcDir: string;
  private readonly now: () => Date;
  private readonly tree: () => TreeHooks | undefined;
  private readonly urls: UrlSettings;

  constructor(storage: StorageAdapter, manifest: Manifest, options: ContentServiceOptions = {}) {
    this.storage = storage;
    this.collections = new Map(manifest.collections.map((c) => [c.name, c]));
    this.validate = options.validate;
    this.validateBody = options.validateBody;
    this.srcDir = manifest.site.srcDir;
    this.now = options.now ?? (() => new Date());
    this.tree = options.tree ?? (() => undefined);
    this.urls = manifest.site.urls ?? DEFAULT_URL_SETTINGS;
  }

  /** Every entry of a collection as stored: file, version, values and body. */
  async entriesOf(name: string): Promise<StoredEntry[]> {
    return this.locateAll(this.require(name));
  }

  /** One entry as stored, or null. */
  async entryOf(name: string, id: string): Promise<StoredEntry | null> {
    return this.locate(this.require(name), id);
  }

  /** Checks values with the collection's real schema, as a save would. */
  async check(collection: string, data: DataObject): Promise<FieldIssue[]> {
    return this.validate ? this.validate(collection, data) : [];
  }

  async summary(): Promise<CollectionSummary[]> {
    const summaries: CollectionSummary[] = [];
    for (const collection of this.collections.values()) {
      const { source } = collection;
      if (source.loader === 'glob') {
        const files = await this.globFiles(source);
        summaries.push({ collection: collection.name, count: files.length, ...newest(files) });
      } else if (source.loader === 'file') {
        const entries = await this.fileLocated(collection, source);
        const listed = (await this.storage.list({ prefix: source.path })).filter(
          (e) => e.path === source.path,
        );
        summaries.push({
          collection: collection.name,
          count: entries?.length ?? 0,
          ...newest(listed),
        });
      } else {
        summaries.push({ collection: collection.name, count: 0 });
      }
    }
    return summaries;
  }

  async listEntries(name: string): Promise<EntrySummary[]> {
    const collection = this.require(name);
    const located = await this.locateAll(collection);
    return located.map((entry) => this.summarize(collection, entry));
  }

  /**
   * Every entry of every collection with the text that holds it: the file's
   * text for glob() entries, the entry's values as JSON for file() entries.
   * The media browser scans it to show where a file is used.
   */
  async scanEntries(): Promise<
    { collection: string; id: string; title: string; path: string; text: string }[]
  > {
    const found: { collection: string; id: string; title: string; path: string; text: string }[] =
      [];
    for (const collection of this.collections.values()) {
      for (const entry of await this.locateAll(collection)) {
        const text =
          collection.source.loader === 'file'
            ? JSON.stringify(encodeValue(entry.data))
            : (decodeUtf8(entry.file.bytes) ?? '');
        found.push({
          collection: collection.name,
          id: entry.id,
          title: titleOf(collection, entry.data, entry.id),
          path: entry.path,
          text,
        });
      }
    }
    return found;
  }

  /**
   * Markdoc and Markdown files under the source folder, site-relative: what a
   * `{% partial file %}` can point at. The studio offers the ones named like
   * partials (`_name.mdoc`, or in a `partials` folder) and checks the rest.
   */
  async listPartials(): Promise<string[]> {
    const prefix = this.srcDir === '.' || this.srcDir === '' ? '' : `${this.srcDir}/`;
    const files = await this.storage.list(prefix ? { prefix } : {});
    return files
      .map((file) => file.path)
      .filter((path) => /\.(mdoc|md)$/.test(path))
      .sort();
  }

  async readEntry(name: string, id: string): Promise<EntryDocument | null> {
    const collection = this.require(name);
    const entry = await this.locate(collection, id);
    if (!entry) return null;
    const status: EntryStatus = collection.editable ? entry.status : 'read-only';
    return {
      collection: name,
      id: entry.id,
      path: entry.path,
      version: entry.version,
      format: entry.format,
      status,
      ...(entry.message !== undefined || !collection.editable
        ? { message: entry.message ?? readOnlyMessage(collection) }
        : {}),
      data: encodeValue(entry.data),
      ...(entry.body !== undefined ? { body: entry.body } : {}),
      ...(entry.rawFrontmatter !== undefined ? { rawFrontmatter: entry.rawFrontmatter } : {}),
    };
  }

  async saveEntry(request: SaveRequest): Promise<SaveResponse> {
    const collection = this.collections.get(request.collection);
    if (!collection) return failure(`There's no collection called "${request.collection}".`);
    if (!collection.editable) return failure(readOnlyMessage(collection));

    try {
      // Values from the raw YAML editor are parsed here, so they're validated like any other.
      let data = request.data === undefined ? undefined : decodeData(request.data);
      if (request.rawFrontmatter !== undefined) {
        const read = readYaml(request.rawFrontmatter);
        if (!read.editable) return failure(read.message);
        data = isPlainObject(read.value) ? read.value : {};
      }
      if (data !== undefined && this.validate) {
        const issues = await this.validate(collection.name, data);
        if (issues.length > 0) return { ok: false, reason: 'invalid', issues };
      }
      if (request.version === null) return await this.create(collection, request, data);
      return await this.update(collection, request, data);
    } catch (error) {
      if (error instanceof SerializationError) return failure(error.message);
      throw error;
    }
  }

  async deleteEntry(name: string, id: string, version: string): Promise<SaveResponse> {
    const collection = this.collections.get(name);
    if (!collection) return failure(`There's no collection called "${name}".`);
    if (!collection.editable) return failure(readOnlyMessage(collection));
    const entry = await this.locate(collection, id);
    if (!entry) return { ok: false, reason: 'conflict', message: GONE };
    if (entry.version !== version) return { ok: false, reason: 'conflict', message: CHANGED };

    let change: FileChange;
    if (collection.source.loader === 'file') {
      const format = dataFormat(collection.source);
      const next = writeCollectionEntry(entry.file.bytes, format, id, null);
      change = {
        op: 'put',
        path: entry.path,
        bytes: next.bytes,
        expectedVersion: entry.file.version,
      };
    } else {
      change = { op: 'delete', path: entry.path, expectedVersion: entry.file.version };
    }
    const hooks = collection.presentation.tree ? this.tree() : undefined;
    const extra = hooks ? await hooks.deleteChanges(collection, entry) : [];
    return this.commit(
      [change, ...extra],
      `Delete "${titleOf(collection, entry.data, id)}" from ${collection.label}`,
      { id, path: entry.path, version: '', reformatted: false },
      collection.name,
    );
  }

  // --- Saves -----------------------------------------------------------

  private async update(
    collection: CollectionManifest,
    request: SaveRequest,
    data: DataObject | undefined,
  ): Promise<SaveResponse> {
    const entry = await this.locate(collection, request.id);
    if (!entry) return { ok: false, reason: 'conflict', message: GONE };
    if (entry.version !== request.version) {
      return { ok: false, reason: 'conflict', message: CHANGED };
    }
    if (request.body !== undefined) {
      const refused = await this.checkBody(collection, entry.format, request.body, entry.path);
      if (refused) return refused;
    }

    let result: { bytes: Uint8Array; changed: boolean; reformatted: boolean };
    const { source } = collection;
    if (source.loader === 'file') {
      if (data === undefined) return this.unchanged(entry);
      result = writeCollectionEntry(entry.file.bytes, dataFormat(source), entry.id, data);
    } else if (entry.format === 'json' || entry.format === 'yaml') {
      if (data === undefined) return this.unchanged(entry);
      result = writeDataFile(entry.file.bytes, entry.format, data);
    } else if (request.rawFrontmatter !== undefined) {
      const text = decodeUtf8(entry.file.bytes) ?? '';
      const split = splitFrontmatter(text);
      const withFrontmatter = split.format === null ? text : withRaw(split, request.rawFrontmatter);
      result = writeEntryFile(encodeUtf8(withFrontmatter), {
        ...(request.body !== undefined ? { body: request.body } : {}),
      });
      result = { ...result, changed: result.changed || withFrontmatter !== text };
    } else {
      result = writeEntryFile(entry.file.bytes, {
        ...(data !== undefined ? { data } : {}),
        ...(request.body !== undefined ? { body: request.body } : {}),
      });
    }

    if (!result.changed) return this.unchanged(entry);
    const id = entry.id;
    const title = titleOf(collection, data ?? entry.data, id);
    const response = await this.commit(
      [{ op: 'put', path: entry.path, bytes: result.bytes, expectedVersion: entry.file.version }],
      `Update "${title}" in ${collection.label}`,
      { id, path: entry.path, version: '', reformatted: result.reformatted },
      collection.name,
    );
    if (!response.ok) return response;
    // The version the editor continues from: re-locate, since a slug edit can change the id.
    const after =
      (await this.locate(collection, id)) ?? (await this.locateByPath(collection, entry.path));
    return after ? { ...response, id: after.id, version: after.version } : response;
  }

  private async create(
    collection: CollectionManifest,
    request: SaveRequest,
    data: DataObject | undefined,
  ): Promise<SaveResponse> {
    const values = data ?? {};
    const { source } = collection;
    const slug = slugify(request.slug ?? stringValue(values.title) ?? stringValue(values.name));
    if (!slug) return failure('Give the entry a title or a file name first.');

    if (source.loader === 'file') {
      const existing = await this.storage.read(source.path);
      if (!existing) return failure(`${source.path} doesn't exist.`);
      const format = dataFormat(source);
      const file = readCollectionFile(existing.bytes, format);
      if (file.status !== 'editable') return failure(file.message);
      if (file.entries.some((e) => e.id === slug)) {
        return {
          ok: false,
          reason: 'conflict',
          message: `An entry called "${slug}" already exists.`,
        };
      }
      const item = file.shape === 'array' ? { id: slug, ...values } : values;
      const next = writeCollectionEntry(existing.bytes, format, slug, item);
      const response = await this.commit(
        [{ op: 'put', path: source.path, bytes: next.bytes, expectedVersion: existing.version }],
        `Add "${titleOf(collection, values, slug)}" to ${collection.label}`,
        { id: slug, path: source.path, version: '', reformatted: next.reformatted },
        collection.name,
      );
      if (!response.ok) return response;
      const after = await this.locate(collection, slug);
      return after ? { ...response, version: after.version } : response;
    }

    if (source.loader !== 'glob') return failure(readOnlyMessage(collection));
    // A copy (Duplicate) keeps the original's format. If the original has gone
    // since the copy was opened, the copy is saved as any new entry would be.
    const original = request.copyOf ? await this.locate(collection, request.copyOf.id) : null;
    const extension = original
      ? original.path.slice(original.path.lastIndexOf('.') + 1)
      : newEntryExtension(source);
    let relative = `${expandNewEntryPath(collection.presentation.newEntryPath, slug, this.now())}.${extension}`;
    let placement: FileChange[] = [];
    const hooks = collection.presentation.tree ? this.tree() : undefined;
    if (hooks) {
      const placed = await hooks.placeNew(collection, {
        parent: request.parent ?? '',
        slug,
        data: values,
        ...(original ? { after: original.id, extension } : {}),
      });
      if (!placed.ok) return placed.response;
      relative = placed.relative;
      placement = placed.changes;
    }
    if (!globMatcher(source.pattern)(relative)) {
      return failure(
        `New entries would be saved as ${relative}, which this collection's pattern (${String(source.pattern)}) doesn't include. Set newEntryPath in vesper.config.ts.`,
      );
    }
    const path = joinBase(source.base, relative);
    const id = defaultEntryId(relative, values);
    if (await this.locate(collection, id)) {
      return { ok: false, reason: 'conflict', message: `An entry called "${id}" already exists.` };
    }
    // A copy in another folder: paths relative to the file (images, imports,
    // partials) are rewritten to point at the same files from there, as a move does.
    let copied = values;
    let body = request.body;
    if (original && dirOf(original.path) !== dirOf(path)) {
      const context = { settings: this.urls, pages: new Map(), files: new Map() };
      const place = { path: { from: original.path, to: path } };
      const rewritten = rewriteValues(values, collection.fields, context, place).data;
      if (isPlainObject(rewritten)) copied = rewritten;
      if (
        body !== undefined &&
        (extension === 'md' || extension === 'mdx' || extension === 'mdoc')
      ) {
        body = rewriteBody(body, extension, context, place).text;
      }
    }
    if (body !== undefined) {
      const refused = await this.checkBody(collection, extension, body, path);
      if (refused) return refused;
    }
    const written = original
      ? copiedFile(original, copied, body)
      : { bytes: newFileBytes(relative, values, body), reformatted: false };
    const response = await this.commit(
      [...placement, { op: 'put', path, bytes: written.bytes, expectedVersion: null }],
      `Add "${titleOf(collection, values, id)}" to ${collection.label}`,
      { id, path, version: await gitBlobSha(written.bytes), reformatted: written.reformatted },
      collection.name,
    );
    return response;
  }

  /** A save refused for a body the site couldn't be built with, or null to go ahead. */
  private async checkBody(
    collection: CollectionManifest,
    format: string,
    body: string,
    path: string,
  ): Promise<SaveResponse | null> {
    if (!this.validateBody || (format !== 'md' && format !== 'mdx' && format !== 'mdoc'))
      return null;
    const bodyIssues = await this.validateBody({ collection: collection.name, format, body, path });
    if (!bodyIssues.some((issue) => issue.level === 'error')) return null;
    return { ok: false, reason: 'invalid', issues: [], bodyIssues };
  }

  /**
   * Commits a change set, answering in the studio's terms. Adapters with
   * history record the collection as a `Vesper-Collection` trailer.
   */
  async commit(
    changes: FileChange[],
    summary: string,
    success: { id: string; path: string; version: string; reformatted: boolean },
    collection?: string,
  ): Promise<SaveResponse> {
    const result = await this.storage.commit({
      changes,
      message: {
        summary,
        ...(collection ? { trailers: { 'Vesper-Collection': collection } } : {}),
      },
    });
    if (result.ok) {
      const put = changes.find(
        (c): c is Extract<FileChange, { op: 'put' }> => c.op === 'put' && c.path === success.path,
      );
      const version = success.version || (put ? await gitBlobSha(put.bytes) : '');
      return { ok: true, ...success, version };
    }
    if (result.reason === 'conflict') {
      const exists = result.conflicts.some((c) => c.expected === null && c.actual !== null);
      return {
        ok: false,
        reason: 'conflict',
        message: exists ? 'A file with that name already exists.' : CHANGED,
      };
    }
    return failure(result.message);
  }

  private unchanged(entry: Located): SaveResponse {
    return { ok: true, id: entry.id, path: entry.path, version: entry.version, reformatted: false };
  }

  // --- Finding entries -------------------------------------------------

  private require(name: string): CollectionManifest {
    const collection = this.collections.get(name);
    if (!collection) throw new Error(`There's no collection called "${name}".`);
    return collection;
  }

  private async globFiles(source: GlobSource): Promise<StorageEntry[]> {
    const prefix = source.base === '.' ? '' : `${source.base}/`;
    const matches = globMatcher(source.pattern);
    const files = await this.storage.list(prefix ? { prefix } : {});
    return files.filter((file) => matches(file.path.slice(prefix.length)));
  }

  private async locateAll(collection: CollectionManifest): Promise<Located[]> {
    const { source } = collection;
    if (source.loader === 'glob') {
      const found: Located[] = [];
      for (const entry of await this.globFiles(source)) {
        const located = await this.readGlobFile(source, entry);
        if (located) found.push(located);
      }
      return found;
    }
    if (source.loader === 'file') {
      return (await this.fileLocated(collection, source)) ?? [];
    }
    return [];
  }

  private async locate(collection: CollectionManifest, id: string): Promise<Located | null> {
    const { source } = collection;
    if (source.loader === 'glob') {
      // Most IDs are their path: try the files an ID can come from before reading every entry.
      for (const relative of candidatePaths(id, source.formats)) {
        const entry = await this.storage.read(joinBase(source.base, relative));
        if (!entry || !globMatcher(source.pattern)(relative)) continue;
        const located = await this.readGlobFile(source, { path: entry.path }, entry);
        if (located?.id === id) return located;
      }
    }
    return (await this.locateAll(collection)).find((entry) => entry.id === id) ?? null;
  }

  private async locateByPath(
    collection: CollectionManifest,
    path: string,
  ): Promise<Located | null> {
    return (await this.locateAll(collection)).find((entry) => entry.path === path) ?? null;
  }

  private async readGlobFile(
    source: GlobSource,
    entry: Pick<StorageEntry, 'path'> & { modifiedAt?: string },
    file?: StoredFile,
  ): Promise<Located | null> {
    const stored = file ?? (await this.storage.read(entry.path));
    if (!stored) return null;
    const prefix = source.base === '.' ? '' : `${source.base}/`;
    const relative = stored.path.slice(prefix.length);
    const extension = relative.slice(relative.lastIndexOf('.') + 1).toLowerCase();
    const common = {
      path: stored.path,
      file: stored,
      version: stored.version,
      ...(entry.modifiedAt !== undefined ? { modifiedAt: entry.modifiedAt } : {}),
    };

    if (CONTENT_EXTENSIONS.has(extension)) {
      const format: EntryFormat =
        extension === 'mdx' ? 'mdx' : extension === 'mdoc' ? 'mdoc' : 'md';
      const read = readEntryFile(stored.bytes);
      if (read.status === 'read-only') {
        return {
          ...common,
          id: defaultEntryId(relative),
          format,
          status: 'read-only',
          message: read.message,
          data: {},
        };
      }
      const data = read.data;
      const id = defaultEntryId(relative, isPlainObject(data) ? data : null);
      return {
        ...common,
        id,
        format,
        status: read.status,
        ...(read.status === 'source-only'
          ? { message: read.message, rawFrontmatter: read.split.raw }
          : {}),
        data,
        body: read.body,
      };
    }

    const dataFormatName = dataFormatOf(relative);
    if (dataFormatName === 'json' || dataFormatName === 'yaml') {
      const read = readDataFile(stored.bytes, dataFormatName);
      const data = read.value;
      return {
        ...common,
        id: defaultEntryId(relative, isPlainObject(data) ? data : null),
        format: dataFormatName,
        status: read.status,
        ...(read.status !== 'editable' ? { message: read.message } : {}),
        data,
      };
    }
    return {
      ...common,
      id: defaultEntryId(relative),
      format: 'yaml',
      status: 'read-only',
      message: 'TOML files can be read but not edited yet.',
      data: {},
    };
  }

  private async fileLocated(
    collection: CollectionManifest,
    source: FileSource,
  ): Promise<Located[] | null> {
    const stored = await this.storage.read(source.path);
    if (!stored) return null;
    if (source.format !== 'json' && source.format !== 'yaml') return [];
    const file = readCollectionFile(stored.bytes, source.format);
    if (file.status !== 'editable') return [];
    const [listed] = (await this.storage.list({ prefix: source.path })).filter(
      (e) => e.path === source.path,
    );
    const located: Located[] = [];
    for (const entry of file.entries) {
      located.push({
        id: entry.id,
        path: source.path,
        file: stored,
        version: await entryVersion(entry.data),
        format: source.format,
        status: collection.editable ? 'editable' : 'read-only',
        data: entry.data,
        ...(listed?.modifiedAt !== undefined ? { modifiedAt: listed.modifiedAt } : {}),
      });
    }
    return located;
  }

  private summarize(collection: CollectionManifest, entry: Located): EntrySummary {
    const data = isPlainObject(entry.data) ? entry.data : {};
    const fields: Record<string, unknown> = {};
    for (const key of collection.presentation.listFields ?? []) {
      if (data[key] !== undefined) fields[key] = encodeValue(data[key]);
    }
    return {
      id: entry.id,
      path: entry.path,
      title: titleOf(collection, data, entry.id),
      status: collection.editable ? entry.status : 'read-only',
      fields,
      ...(entry.modifiedAt !== undefined ? { updatedAt: entry.modifiedAt } : {}),
      ...(data.draft === true ? { draft: true } : {}),
    };
  }
}

const CHANGED =
  'This entry changed since you opened it. Copy your edits somewhere safe, then reload to see the new version.';
const GONE = 'This entry was deleted or renamed since you opened it.';

function failure(message: string): SaveResponse {
  return { ok: false, reason: 'error', message };
}

function readOnlyMessage(collection: CollectionManifest): string {
  switch (collection.readOnlyReason) {
    case 'custom-loader':
      return `${collection.label} uses a custom loader, so Vesper can't tell where its entries are saved.`;
    case 'unsupported-format':
      return `${collection.label} is stored in a format Vesper can read but not edit yet.`;
    case 'config-error':
      return `${collection.label} couldn't be loaded from the content config. A developer needs to fix it.`;
    default:
      return `${collection.label} is read only.`;
  }
}

function dataFormat(source: FileSource): DataFormat {
  if (source.format === 'json' || source.format === 'yaml') return source.format;
  throw new SerializationError('unsupported', `${source.path} can be read but not edited yet.`);
}

/** A file() entry's version: the git blob SHA of its canonical JSON, so edits to other entries in the same file don't conflict. */
async function entryVersion(data: DataValue): Promise<string> {
  return `entry:${await gitBlobSha(encodeUtf8(canonicalJson(encodeValue(data))))}`;
}

function newest(files: { modifiedAt?: string }[]): { updatedAt?: string } {
  const times = files.map((f) => f.modifiedAt).filter((t): t is string => t !== undefined);
  if (times.length === 0) return {};
  return { updatedAt: times.reduce((a, b) => (a > b ? a : b)) };
}

/** The entry's display title: its title-like field, else its first list field, else its ID. */
export function titleOf(collection: CollectionManifest, data: DataValue, id: string): string {
  if (!isPlainObject(data)) return id;
  const keys = [
    ...(collection.fields ?? [])
      .filter((f) => f.path.length === 1 && f.kind === 'string')
      .map((f) => f.path[0] as string)
      .filter((key) => ['title', 'name', 'label', 'heading'].includes(key)),
    'title',
    'name',
    ...(collection.presentation.listFields ?? []).slice(0, 1),
  ];
  for (const key of keys) {
    const value = stringValue(data[key]);
    if (value) return value;
  }
  return id;
}

function stringValue(value: DataValue): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Lower-case, dash-separated, safe in any file system. Slashes keep nesting. */
export function slugify(input: string | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split('/')
    .map((segment) => githubSlug(segment).replace(/-{2,}/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .join('/');
}

/** `newEntryPath` tokens (spec §6.5): `:slug`, `:year`, `:month`, `:day`. Defaults to `:slug`. */
export function expandNewEntryPath(pattern: string | undefined, slug: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (pattern ?? ':slug')
    .replace(/^\/+|\/+$/g, '')
    .replaceAll(':slug', slug)
    .replaceAll(':year', String(now.getFullYear()))
    .replaceAll(':month', pad(now.getMonth() + 1))
    .replaceAll(':day', pad(now.getDate()));
}

/**
 * A copy's file: the original's text with the copy's values and body spliced
 * in, through the same writers as a save. The values are complete, so what
 * the original holds now doesn't leak into the copy.
 */
function copiedFile(
  original: Located,
  data: DataObject,
  body: string | undefined,
): { bytes: Uint8Array; reformatted: boolean } {
  if (original.format === 'json' || original.format === 'yaml') {
    return writeDataFile(original.file.bytes, original.format, data);
  }
  return writeEntryFile(original.file.bytes, { data, ...(body !== undefined ? { body } : {}) });
}

function newEntryExtension(source: GlobSource): string {
  return source.formats.find((ext) => ext !== 'toml') ?? 'md';
}

function joinBase(base: string, relative: string): string {
  return base === '.' || base === '' ? relative : `${base}/${relative}`;
}

/** Files an entry ID could have come from, most likely first. */
function candidatePaths(id: string, formats: readonly string[]): string[] {
  const extensions = formats.length > 0 ? formats : ['md'];
  return extensions.flatMap((ext) => [`${id}.${ext}`, `${id}/index.${ext}`]);
}

/** A new entry file's bytes: frontmatter (or a data file) in the house style, plus an optional body. */
export function newFileBytes(
  relative: string,
  data: DataObject,
  body: string | undefined,
): Uint8Array {
  const extension = relative.slice(relative.lastIndexOf('.') + 1).toLowerCase();
  if (CONTENT_EXTENSIONS.has(extension)) {
    const text =
      body === undefined || body === '' ? '\n' : body.startsWith('\n') ? body : `\n${body}`;
    return writeEntryFile(encodeUtf8(text), { data }).bytes;
  }
  if (extension === 'json') {
    return encodeUtf8(`${JSON.stringify(encodeJson(data), null, 2)}\n`);
  }
  // Block style: starting from `{}` would keep the flow map.
  const yaml = writeYaml('', data, { expect: 'any' }).text;
  return encodeUtf8(yaml.endsWith('\n') ? yaml : `${yaml}\n`);
}

/** JSON has no dates: write them as ISO strings, as a JSON data file would hold them. */
function encodeJson(value: DataValue): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(encodeJson);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, encodeJson(v)]),
    );
  }
  return value;
}
