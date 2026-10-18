import type { BodyFormat } from '../body/types.ts';
import { defaultEntryId, folderKey, globMatcher } from '../collections/entries.ts';
import {
  readCollectionFile,
  readDataFile,
  writeCollectionEntry,
  writeDataFile,
} from '../files/data-file.ts';
import { readEntryFile, writeEntryFile } from '../files/entry-file.ts';
import { deepEqual, isPlainObject, type DataObject, type DataValue } from '../files/equal.ts';
import { SerializationError } from '../files/errors.ts';
import { decodeUtf8, encodeUtf8 } from '../files/text.ts';
import { readYaml } from '../files/yaml/read.ts';
import { renderYaml } from '../files/yaml/scalar.ts';
import { DEFAULT_STYLE } from '../files/yaml/style.ts';
import { writeYaml } from '../files/yaml/write.ts';
import type { CollectionManifest, Manifest } from '../manifest/types.ts';
import { gitBlobSha } from '../storage/git-blob-sha.ts';
import type { FileChange, StorageAdapter, StoredFile } from '../storage/types.ts';
import {
  hostRedirects,
  vercelRules,
  type NativeTarget,
  type VercelRedirect,
} from '../urls/hosts.ts';
import {
  DEFAULT_URL_SETTINGS,
  SLUG_PATTERN,
  entryPath,
  entryUrlKey,
  formatUrl,
  isReservedPath,
  type UrlEntry,
  type UrlPattern,
  type UrlSettings,
} from '../urls/pattern.ts';
import {
  activeRedirects,
  calendarDate,
  cleanRedirects,
  isRedirect,
  redirectKey,
  withMoveRedirects,
  type Redirect,
  type RedirectWarning,
} from '../urls/redirects.ts';
import { buildTree, findNode, folderTitle, pathDepth, type PageNode } from '../urls/tree.ts';
import { rewriteBody, rewriteValues, type FilePlace, type LinkContext } from './links.ts';
import { encodeValue, decodeValue, type EntryStatus, type SaveResponse } from './protocol.ts';
import {
  newFileBytes,
  titleOf,
  type ContentService,
  type StoredEntry,
  type TreeHooks,
} from './service.ts';

/*
 * Pages, trees, moves and redirects (spec §6.15), over any storage adapter.
 *
 * A move is one change set (§6.15.4): every file in the moved folder, the
 * `_order.yaml` files on both sides, a redirect for every page that moved,
 * and every file whose links pointed at the old addresses. Validation runs
 * before anything is written, and refusals are plain language.
 */

export const REDIRECTS_FILE = 'vesper.redirects.yaml';
export const ORDER_FILE = '_order.yaml';
const VERCEL_FILE = 'vercel.json';

/** Static routes from `src/pages`, keyed by URL key, with the file that owns each. */
export type StaticRoutes = ReadonlyMap<string, string>;

export type PageServiceOptions = {
  /** The site's static routes (no parameters), for collision checks. */
  routes?: () => StaticRoutes;
  /** Function-form URL patterns from vesper.config.ts, by collection. */
  urlFunctions?: Readonly<Record<string, (entry: UrlEntry) => unknown>>;
  now?: () => Date;
};

/** A page anywhere on the site, for the link picker and duplicate checks. */
export type PageLink = { collection: string; id: string; title: string; url: string };

/** One row of the studio's outline. */
export type PageTreeNode = {
  path: string;
  slug: string;
  title: string;
  id?: string;
  url: string | null;
  depth: number;
  /** The entry's file, site-relative. */
  file?: string;
  /** The entry's version, for a delete that must not race an edit. */
  version?: string;
  status?: EntryStatus;
  draft?: boolean;
  /** Whether the entry is its folder's section page (`folder/index.md`). */
  section?: boolean;
  children: PageTreeNode[];
};

export type PageTree = { collection: string; nodes: PageTreeNode[]; maxDepth?: number };

export type MoveRequest = {
  collection: string;
  /** The page's path in the tree (a folder with no section page can move too). */
  path: string;
  /** The new parent's path in the tree, '' for the top level. */
  parent: string;
  /** A new last segment for the address. Defaults to the current one. */
  slug?: string;
};

export type Position = { index: number; of: number };

export type MoveResult =
  | {
      ok: true;
      /** The page's new path in the tree. */
      path: string;
      /** The page's entry ID after the move, when it has an entry. */
      id?: string;
      title: string;
      /** Pages that move: the page and everything under it. */
      pages: number;
      /** Links on other pages that change. */
      links: number;
      redirects: number;
      from: string | null;
      to: string | null;
      /** The new parent's title, or null for the top level. */
      parent: string | null;
      position: Position;
    }
  | { ok: false; reason: 'invalid' | 'conflict' | 'error'; message: string };

export type ReorderRequest = {
  collection: string;
  path: string;
} & (
  | { direction: 'up' | 'down' }
  /** Where the page ends up among its siblings, from 0 (a drag and drop). */
  | { index: number }
);
export type ReorderResult =
  | { ok: true; position: Position }
  | { ok: false; reason: 'invalid' | 'conflict' | 'error'; message: string };

/** The redirects file for the Redirects screen: values encoded as in `EntryDocument.data`. */
export type RedirectsDocument = {
  /** The file's version, or null when it doesn't exist yet. */
  version: string | null;
  redirects: unknown[];
  warnings: RedirectWarning[];
};

export type SaveRedirectsRequest = { version: string | null; redirects: unknown[] };
export type SaveRedirectsResult =
  | ({ ok: true } & RedirectsDocument)
  | { ok: false; reason: 'invalid' | 'conflict' | 'error'; message: string };

type GlobSource = Extract<CollectionManifest['source'], { loader: 'glob' }>;
type Failure = { ok: false; reason: 'invalid' | 'conflict' | 'error'; message: string };

const refuse = (message: string): Failure => ({ ok: false, reason: 'invalid', message });
const conflict = (message: string): Failure => ({ ok: false, reason: 'conflict', message });

const STALE =
  'That page was moved, renamed or deleted since this list was loaded. Reload to see the pages as they are now.';
const BAD_SLUG =
  'Use lower-case letters, numbers and single dashes for the address, like “nursing-programs”.';

type OrderFile = { path: string; names: string[]; file: StoredFile | null; readable: boolean };

type TreeData = {
  collection: CollectionManifest;
  source: GlobSource;
  tree: PageNode<StoredEntry>[];
  entries: StoredEntry[];
  /** `_order.yaml` files by their folder's tree path. */
  orders: Map<string, OrderFile>;
  /** Each tree path's folder on disk, relative to the collection's base. */
  folders: Map<string, string>;
};

type Planned = {
  changes: FileChange[];
  summary: string;
  result: Extract<MoveResult, { ok: true }>;
};

export class PageService {
  private readonly storage: StorageAdapter;
  private readonly manifest: Manifest;
  private readonly content: ContentService;
  private readonly settings: UrlSettings;
  private readonly routes: () => StaticRoutes;
  private readonly urlFunctions: Readonly<Record<string, (entry: UrlEntry) => unknown>>;
  private readonly now: () => Date;

  constructor(
    storage: StorageAdapter,
    manifest: Manifest,
    content: ContentService,
    options: PageServiceOptions = {},
  ) {
    this.storage = storage;
    this.manifest = manifest;
    this.content = content;
    this.settings = {
      ...(manifest.site.urls ?? DEFAULT_URL_SETTINGS),
      ...(manifest.site.timeZone && !manifest.site.urls?.timeZone
        ? { timeZone: manifest.site.timeZone }
        : {}),
    };
    this.routes = options.routes ?? (() => new Map());
    this.urlFunctions = options.urlFunctions ?? {};
    this.now = options.now ?? (() => new Date());
  }

  /** Hooks for `ContentService`: where new tree pages go, and what a delete also changes. */
  hooks(): TreeHooks {
    return {
      placeNew: (collection, request) => this.placeNew(collection, request),
      deleteChanges: (collection, entry) => this.deleteChanges(collection, entry),
    };
  }

  // --- Reading --------------------------------------------------------------

  /** Every entry with a URL, in every collection, for the link picker. */
  async pages(): Promise<PageLink[]> {
    const found: PageLink[] = [];
    for (const collection of this.manifest.collections) {
      const pattern = this.patternOf(collection);
      if (pattern === undefined) continue;
      for (const entry of await this.content.entriesOf(collection.name)) {
        const key = this.keyOf(collection, entry.id, entry.data);
        if (key === null) continue;
        found.push({
          collection: collection.name,
          id: entry.id,
          title: titleOf(collection, entry.data, entry.id),
          url: formatUrl(key, this.settings),
        });
      }
    }
    return found;
  }

  /** A tree collection's outline. */
  async tree(name: string): Promise<PageTree> {
    const data = await this.treeData(name);
    const toNode = (node: PageNode<StoredEntry>): PageTreeNode => {
      const entry = node.entry;
      return {
        path: node.path,
        slug: node.slug,
        title: node.title,
        ...(node.id !== undefined ? { id: node.id } : {}),
        url: node.url,
        depth: node.depth,
        ...(entry
          ? {
              file: entry.path,
              version: entry.version,
              status: data.collection.editable ? entry.status : 'read-only',
              section: isSectionFile(entry.path),
              ...(isPlainObject(entry.data) && entry.data.draft === true ? { draft: true } : {}),
            }
          : {}),
        children: node.children.map(toNode),
      };
    };
    const { maxDepth } = data.collection.presentation;
    return {
      collection: name,
      nodes: data.tree.map(toNode),
      ...(maxDepth !== undefined ? { maxDepth } : {}),
    };
  }

  // --- Moving ----------------------------------------------------------------

  /** What a move would do, without doing it: for the confirmation dialog. */
  async planMove(request: MoveRequest): Promise<MoveResult> {
    const planned = await this.plan(request);
    return planned.ok ? planned.planned.result : planned;
  }

  /** Moves a page and everything under it, as one change set. */
  async move(request: MoveRequest): Promise<MoveResult> {
    const planned = await this.plan(request);
    if (!planned.ok) return planned;
    const result = await this.storage.commit({
      changes: planned.planned.changes,
      message: { summary: planned.planned.summary },
    });
    if (result.ok) return planned.planned.result;
    if (result.reason === 'conflict') return conflict(STALE);
    return { ok: false, reason: 'error', message: result.message };
  }

  private async plan(request: MoveRequest): Promise<{ ok: true; planned: Planned } | Failure> {
    let data: TreeData;
    try {
      data = await this.treeData(request.collection);
    } catch (error) {
      return refuse(error instanceof Error ? error.message : String(error));
    }
    const { collection, source, tree } = data;
    if (!collection.editable) return refuse(`${collection.label} can be read here but not edited.`);
    const node = findNode(tree, request.path);
    if (!node) return conflict(STALE);
    if (node.path === '') return refuse('The home page can’t be moved.');
    if (node.entry && hasOwnSlug(node.entry)) {
      return refuse(
        `“${node.title}” sets its own address in a slug field, so it can’t be moved here. A developer can move its file.`,
      );
    }
    const slug = request.slug ?? node.slug;
    if (!SLUG_PATTERN.test(slug)) return refuse(BAD_SLUG);
    const parent = request.parent;
    const parentNode = parent === '' ? null : findNode(tree, parent);
    if (parent !== '' && !parentNode) return conflict(STALE);
    if (parent === node.path || parent.startsWith(`${node.path}/`)) {
      return refuse(`“${node.title}” can’t be moved inside itself.`);
    }
    const newPath = parent === '' ? slug : `${parent}/${slug}`;
    if (newPath === node.path) return refuse(`“${node.title}” is already there.`);
    const taken = findNode(tree, newPath);
    if (taken) return refuse(this.takenMessage(taken.url, taken.title));

    // Where things are on disk, relative to the collection's base.
    const base = source.base === '.' ? '' : source.base;
    const at = (relative: string) => (base ? `${base}/${relative}` : relative);
    const relativeOf = (path: string) => (base ? path.slice(base.length + 1) : path);
    const files = new Map<string, string>();
    const changes = new Map<string, FileChange>();

    let parentFolder = parent === '' ? '' : (data.folders.get(parent) ?? parent);
    const parentEntry = parentNode?.entry;
    if (parentEntry && !isSectionFile(parentEntry.path)) {
      // A page with no folder becomes a section: page.md → page/index.md, same address.
      const relative = relativeOf(parentEntry.path);
      parentFolder = relative.slice(0, relative.lastIndexOf('.'));
      const to = at(`${parentFolder}/index${extensionOf(parentEntry.path)}`);
      files.set(parentEntry.path, to);
    }

    const movesFolder = !node.entry || isSectionFile(node.entry.path);
    const newFolder = parentFolder ? `${parentFolder}/${slug}` : slug;
    if (movesFolder) {
      const oldFolder = data.folders.get(node.path) ?? node.path;
      for (const file of await this.storage.list({ prefix: `${at(oldFolder)}/` })) {
        files.set(file.path, at(newFolder) + file.path.slice(at(oldFolder).length));
      }
    } else if (node.entry) {
      files.set(node.entry.path, at(`${newFolder}${extensionOf(node.entry.path)}`));
    }
    for (const to of files.values()) {
      if (!files.has(to) && (await this.storage.read(to))) {
        return refuse(this.takenMessage(this.urlOfPath(newPath, data), null));
      }
    }

    // Every page that moves, with its address before and after.
    const site = await this.pageKeys();
    // The pages that move: the page and everything under it, not a parent that only gains a folder.
    const moving = data.entries.filter((e) => files.has(e.path) && e !== parentEntry);
    const pages: { entry: StoredEntry; from: string | null; to: string | null; id: string }[] = [];
    for (const entry of moving) {
      const to = files.get(entry.path) ?? entry.path;
      const id = defaultEntryId(relativeOf(to), isPlainObject(entry.data) ? entry.data : null);
      pages.push({
        entry,
        id,
        from: this.keyOf(collection, entry.id, entry.data),
        to: this.keyOf(collection, id, entry.data),
      });
      const depth = pathDepth(entryPath(id));
      const { maxDepth } = collection.presentation;
      if (maxDepth !== undefined && depth > maxDepth) {
        return refuse(
          `Pages can be at most ${String(maxDepth)} levels deep here, and this move would put “${titleOf(collection, entry.data, entry.id)}” ${String(depth)} levels deep.`,
        );
      }
    }
    const leaving = new Set(pages.map((p) => p.from).filter((k): k is string => k !== null));
    for (const page of pages) {
      if (page.to === null) continue;
      const problem = this.checkAddress(page.to, site, leaving);
      if (problem) return refuse(problem);
    }

    // Order files: out of the old parent, into the new one.
    const oldParent = parentPathOf(node.path);
    const orderChanges: FileChange[] = [];
    if (oldParent === parent) {
      const order = data.orders.get(parent);
      if (order?.readable && order.file && order.names.includes(node.slug)) {
        orderChanges.push(
          orderPut(
            order,
            order.names.map((n) => (n === node.slug ? slug : n)),
          ),
        );
      }
    } else {
      const from = data.orders.get(oldParent);
      if (from?.readable && from.file && from.names.includes(node.slug)) {
        orderChanges.push(
          orderPut(
            from,
            from.names.filter((n) => n !== node.slug),
          ),
        );
      }
      const into = data.orders.get(parent);
      if (into?.readable && into.file && !into.names.includes(slug)) {
        orderChanges.push(orderPut(into, [...into.names, slug]));
      }
    }
    for (const change of orderChanges) {
      if (change.op === 'put' && files.has(change.path)) {
        // The order file sits in a folder that moves too (a leaf parent can't hold one, so this is rare).
        changes.set(change.path, {
          op: 'move',
          from: change.path,
          to: files.get(change.path) ?? change.path,
          bytes: change.bytes,
        });
      } else if (change.op === 'put') changes.set(change.path, change);
    }

    // Links on every page, and relative paths in files that move or point into the move.
    const pageMoves = new Map(
      pages
        .filter(
          (p): p is typeof p & { from: string; to: string } =>
            p.from !== null && p.to !== null && p.from !== p.to,
        )
        .map((p) => [p.from, p.to]),
    );
    const linkContext: LinkContext = { settings: this.settings, pages: pageMoves, files };
    const rewritten = await this.rewriteSite(linkContext, files);
    let links = 0;
    for (const [path, edit] of rewritten) {
      if (!files.has(path)) links += edit.links;
      changes.set(path, { op: 'put', path, bytes: edit.bytes, expectedVersion: edit.version });
    }
    for (const [from, to] of files) {
      const edited = changes.get(from);
      const version = (await this.storage.read(from))?.version;
      changes.set(from, {
        op: 'move',
        from,
        to,
        ...(edited?.op === 'put' ? { bytes: edited.bytes } : {}),
        ...(version !== undefined ? { expectedVersion: version } : {}),
      });
    }

    // Redirects for every page that moved, then cleanup against the site as it will be.
    const redirectPairs = [...pageMoves]
      .map(([from, to]) => ({ from, to }))
      .sort((a, b) => (a.from < b.from ? -1 : 1));
    let redirectCount = 0;
    if (redirectPairs.length > 0) {
      const written = await this.redirectChanges(
        (list) => withMoveRedirects(list, redirectPairs, this.today()),
        (key) => (site.has(key) && !leaving.has(key)) || [...pageMoves.values()].includes(key),
      );
      if (!written.ok) return written;
      for (const change of written.changes) changes.set(pathOf(change), change);
      redirectCount = redirectPairs.length;
    }

    const title = node.title;
    const newParentTitle = parentNode ? parentNode.title : null;
    const self = pages.find((p) => p.entry === node.entry);
    const siblings = (parentNode ? parentNode.children : tree).filter((n) => n.path !== node.path);
    const after = data.orders.get(parent)?.names ?? [];
    const position = positionAfterMove(
      siblings,
      slug,
      title,
      after,
      oldParent === parent ? node.slug : null,
    );
    const others = pages.length - (node.entry ? 1 : 0);
    const where = newParentTitle ? `under “${newParentTitle}”` : 'to the top level';
    return {
      ok: true,
      planned: {
        changes: [...changes.values()],
        summary:
          oldParent === parent
            ? `Rename “${title}” to ${slug}`
            : `Move “${title}”${others > 0 ? ` and ${String(others)} ${others === 1 ? 'page' : 'pages'} under it` : ''} ${where}`,
        result: {
          ok: true,
          path: newPath,
          ...(self ? { id: self.id } : {}),
          title,
          pages: pages.length,
          links,
          redirects: redirectCount,
          from: self?.from ? formatUrl(self.from, this.settings) : null,
          to: self?.to ? formatUrl(self.to, this.settings) : null,
          parent: newParentTitle,
          position,
        },
      },
    };
  }

  // --- Order -----------------------------------------------------------------

  /** Moves a page up or down among its siblings, by rewriting its folder's `_order.yaml`. */
  async reorder(request: ReorderRequest): Promise<ReorderResult> {
    const data = await this.treeData(request.collection);
    const node = findNode(data.tree, request.path);
    if (!node) return conflict(STALE);
    if (node.path === '') return refuse('The home page always comes first.');
    const parent = parentPathOf(node.path);
    const siblings = (
      parent === '' ? data.tree : (findNode(data.tree, parent)?.children ?? [])
    ).filter((n) => n.path !== '');
    const index = siblings.findIndex((n) => n.path === node.path);
    const target =
      'index' in request
        ? Math.max(0, Math.min(siblings.length - 1, request.index))
        : request.direction === 'up'
          ? index - 1
          : index + 1;
    if (target < 0) return refuse(`“${node.title}” is already first.`);
    if (target >= siblings.length) return refuse(`“${node.title}” is already last.`);
    if (target === index) return { ok: true, position: { index: index + 1, of: siblings.length } };
    const names = siblings.map((n) => n.slug).filter((n) => n !== node.slug);
    names.splice(target, 0, node.slug);

    const existing = data.orders.get(parent);
    if (existing && !existing.readable) {
      return refuse(
        `${existing.path} can’t be read, so the order wasn’t changed. A developer needs to fix it.`,
      );
    }
    const folder = parent === '' ? '' : (data.folders.get(parent) ?? parent);
    const base = data.source.base === '.' ? '' : data.source.base;
    const path = [base, folder, ORDER_FILE].filter(Boolean).join('/');
    const order: OrderFile = existing ?? { path, names: [], file: null, readable: true };
    const response = await this.content.commit(
      [orderPut(order, names)],
      `Move “${node.title}” ${'index' in request ? 'to a new place' : request.direction} in ${data.collection.label}`,
      { id: node.id ?? '', path: order.path, version: '', reformatted: false },
    );
    if (!response.ok)
      return response.reason === 'conflict'
        ? conflict(STALE)
        : refuse('message' in response ? response.message : STALE);
    return { ok: true, position: { index: target + 1, of: siblings.length } };
  }

  // --- New pages -------------------------------------------------------------

  /** Creates the missing section page of a folder: `folder/index.md`, titled after the folder. */
  async createSection(name: string, path: string): Promise<SaveResponse> {
    const data = await this.treeData(name);
    const node = findNode(data.tree, path);
    if (!node) return { ok: false, reason: 'conflict', message: STALE };
    if (node.entry)
      return { ok: false, reason: 'error', message: `“${node.title}” already has a section page.` };
    const folder = data.folders.get(path) ?? path;
    const extension = data.source.formats.find((f) => f !== 'toml') ?? 'md';
    const relative = `${folder}/index.${extension}`;
    if (!globMatcher(data.source.pattern)(relative)) {
      return {
        ok: false,
        reason: 'error',
        message: `A section page would be saved as ${relative}, which this collection's pattern doesn't include.`,
      };
    }
    const titleKey =
      data.collection.fields?.find(
        (f) =>
          f.path.length === 1 &&
          f.kind === 'string' &&
          ['title', 'name', 'label', 'heading'].includes(String(f.path[0])),
      )?.path[0] ?? 'title';
    const values: DataObject = { [titleKey]: folderTitle(node.slug) };
    const issues = await this.content.check(name, values);
    if (issues.length > 0) return { ok: false, reason: 'invalid', issues };
    const base = data.source.base === '.' ? '' : data.source.base;
    const file = base ? `${base}/${relative}` : relative;
    const bytes = newFileBytes(relative, values, undefined);
    return this.content.commit(
      [{ op: 'put', path: file, bytes, expectedVersion: null }],
      `Add a section page for “${node.title}” in ${data.collection.label}`,
      {
        id: defaultEntryId(relative, values),
        path: file,
        version: await gitBlobSha(bytes),
        reformatted: false,
      },
    );
  }

  private async placeNew(
    collection: CollectionManifest,
    request: { parent: string; slug: string; data: DataObject },
  ): Promise<
    { ok: true; relative: string; changes: FileChange[] } | { ok: false; response: SaveResponse }
  > {
    const fail = (message: string, reason: 'error' | 'conflict' = 'error') => ({
      ok: false as const,
      response: { ok: false as const, reason, message },
    });
    const data = await this.treeData(collection.name);
    const slug = request.slug.split('/').at(-1) ?? request.slug;
    if (!SLUG_PATTERN.test(slug)) return fail(BAD_SLUG);
    const parent = request.parent;
    const parentNode = parent === '' ? null : findNode(data.tree, parent);
    if (parent !== '' && !parentNode) return fail(STALE, 'conflict');
    const newPath = parent === '' ? slug : `${parent}/${slug}`;
    const taken = findNode(data.tree, newPath);
    if (taken) return fail(this.takenMessage(taken.url, taken.title), 'conflict');

    const base = data.source.base === '.' ? '' : data.source.base;
    const at = (relative: string) => (base ? `${base}/${relative}` : relative);
    const changes: FileChange[] = [];
    let folder = parent === '' ? '' : (data.folders.get(parent) ?? parent);
    const parentEntry = parentNode?.entry;
    if (parentEntry && !isSectionFile(parentEntry.path)) {
      const relative = base ? parentEntry.path.slice(base.length + 1) : parentEntry.path;
      folder = relative.slice(0, relative.lastIndexOf('.'));
      changes.push({
        op: 'move',
        from: parentEntry.path,
        to: at(`${folder}/index${extensionOf(parentEntry.path)}`),
        expectedVersion: parentEntry.file.version,
      });
    }
    const extension = data.source.formats.find((f) => f !== 'toml') ?? 'md';
    const relative = `${folder ? `${folder}/` : ''}${slug}.${extension}`;
    const id = defaultEntryId(relative, request.data);
    const depth = pathDepth(entryPath(id));
    const { maxDepth } = collection.presentation;
    if (maxDepth !== undefined && depth > maxDepth) {
      return fail(`Pages can be at most ${String(maxDepth)} levels deep here.`);
    }
    const key = this.keyOf(collection, id, request.data);
    if (key !== null) {
      const problem = this.checkAddress(key, await this.pageKeys(), new Set());
      if (problem) return fail(problem);
    }
    const order = data.orders.get(parent);
    if (order?.readable && order.file && !order.names.includes(slug)) {
      changes.push(orderPut(order, [...order.names, slug]));
    }
    return { ok: true, relative, changes };
  }

  private async deleteChanges(
    collection: CollectionManifest,
    entry: StoredEntry,
  ): Promise<FileChange[]> {
    const data = await this.treeData(collection.name);
    const path = entryPath(entry.id);
    const node = findNode(data.tree, path);
    // A section page with pages under it leaves its folder, and its place in the order.
    if (!node || node.children.length > 0) return [];
    const order = data.orders.get(parentPathOf(path));
    if (!order?.readable || !order.file || !order.names.includes(node.slug)) return [];
    return [
      orderPut(
        order,
        order.names.filter((n) => n !== node.slug),
      ),
    ];
  }

  // --- Redirects ---------------------------------------------------------------

  /** The redirects file, cleaned as the build will clean it, with what needs a look. */
  async redirects(): Promise<RedirectsDocument> {
    const file = await this.storage.read(REDIRECTS_FILE);
    const list = file ? readList(file) : [];
    const site = await this.pageKeys();
    const { warnings } = cleanRedirects(list ?? [], { isPage: (key) => site.has(key) });
    return {
      version: file?.version ?? null,
      redirects: (list ?? []).map((item) => encodeValue(item as DataValue)),
      warnings,
    };
  }

  /** Replaces the redirects with the Redirects screen's list, cleaned, as one change set. */
  async saveRedirects(request: SaveRedirectsRequest): Promise<SaveRedirectsResult> {
    const current = await this.storage.read(REDIRECTS_FILE);
    if ((current?.version ?? null) !== request.version) {
      return conflict(
        'The redirects changed since you opened them. Reload to see the current list.',
      );
    }
    const next = request.redirects.map((item) => decodeValue(item));
    for (const item of next) {
      if (!isRedirect(item)) {
        return refuse('Every redirect needs an old address starting with “/” and a new address.');
      }
      if (isReservedPath(redirectKey(item.from))) {
        return refuse(`${item.from} belongs to the studio, so it can’t be redirected.`);
      }
    }
    const site = await this.pageKeys();
    const written = await this.redirectChanges(
      () => next,
      (key) => site.has(key),
    );
    if (!written.ok) return written;
    if (written.changes.length === 0) {
      return { ok: true, ...(await this.redirects()) };
    }
    const result = await this.storage.commit({
      changes: written.changes,
      message: { summary: 'Update redirects' },
    });
    if (!result.ok) {
      return result.reason === 'conflict'
        ? conflict('The redirects changed since you opened them. Reload to see the current list.')
        : { ok: false, reason: 'error', message: result.message };
    }
    return { ok: true, ...(await this.redirects()) };
  }

  /**
   * The changes that write a new redirects list: the file itself, cleaned,
   * and `vercel.json` when the site keeps its redirects there too (Vercel
   * reads it before the build, so it can't be written at build time).
   */
  private async redirectChanges(
    update: (list: unknown[]) => unknown[],
    isPage: (key: string) => boolean,
  ): Promise<{ ok: true; changes: FileChange[] } | Failure> {
    const file = await this.storage.read(REDIRECTS_FILE);
    const before = file ? readList(file) : [];
    if (before === null) {
      return refuse(
        `${REDIRECTS_FILE} can’t be read, so nothing was changed. A developer needs to fix it.`,
      );
    }
    const { redirects } = cleanRedirects(update(before), { isPage });
    const changes: FileChange[] = [];
    let bytes: Uint8Array;
    try {
      bytes = file
        ? writeDataFile(file.bytes, 'yaml', redirects as DataValue).bytes
        : newRedirectsFile(redirects);
    } catch (error) {
      if (error instanceof SerializationError) return refuse(error.message);
      throw error;
    }
    if (!file || decodeUtf8(bytes) !== decodeUtf8(file.bytes)) {
      changes.push({
        op: 'put',
        path: REDIRECTS_FILE,
        bytes,
        expectedVersion: file?.version ?? null,
      });
    }
    const vercel = await this.vercelChange(before, redirects);
    if (vercel) changes.push(vercel);
    return { ok: true, changes };
  }

  private async vercelChange(before: unknown[], after: Redirect[]): Promise<FileChange | null> {
    const native: readonly NativeTarget[] = this.manifest.site.redirects?.native ?? [];
    const file = await this.storage.read(VERCEL_FILE);
    if (!file && !native.includes('vercel')) return null;
    const read = file
      ? readDataFile(file.bytes, 'json')
      : { status: 'editable' as const, value: {} };
    if (read.status !== 'editable' || !isPlainObject(read.value)) return null;
    const ours = new Set(
      [...activeRedirects(before), ...activeRedirects(after)].flatMap((r) => {
        const from = formatUrl(redirectKey(r.from), { ...this.settings, trailingSlash: 'never' });
        return [from, `${from}/`];
      }),
    );
    const existing = Array.isArray(read.value.redirects) ? read.value.redirects : [];
    const theirs = existing.filter(
      (r) => !(isPlainObject(r) && typeof r.source === 'string' && ours.has(r.source)),
    );
    const rules: VercelRedirect[] = vercelRules(
      hostRedirects(activeRedirects(after), this.settings),
    );
    const next = { ...read.value, redirects: [...theirs, ...(rules as unknown as DataValue[])] };
    if (deepEqual(next, read.value)) return null;
    const bytes = file
      ? writeDataFile(file.bytes, 'json', next).bytes
      : encodeUtf8(`${JSON.stringify(next, null, 2)}\n`);
    return { op: 'put', path: VERCEL_FILE, bytes, expectedVersion: file?.version ?? null };
  }

  // --- Shared ------------------------------------------------------------------

  private patternOf(collection: CollectionManifest): UrlPattern | undefined {
    const fn = this.urlFunctions[collection.name];
    if (fn) return fn;
    return typeof collection.presentation.url === 'string'
      ? collection.presentation.url
      : undefined;
  }

  private keyOf(collection: CollectionManifest, id: string, data: DataValue): string | null {
    return entryUrlKey(
      this.patternOf(collection),
      { id, collection: collection.name, data },
      this.settings,
    );
  }

  private urlOfPath(path: string, data: TreeData): string | null {
    const key = this.keyOf(data.collection, path === '' ? 'index' : path, {});
    return key === null ? null : formatUrl(key, this.settings);
  }

  /** Every page's key on the site (content and static routes), with its title. */
  async pageKeys(): Promise<Map<string, string>> {
    const keys = new Map<string, string>();
    for (const collection of this.manifest.collections) {
      if (this.patternOf(collection) === undefined) continue;
      for (const entry of await this.content.entriesOf(collection.name)) {
        const key = this.keyOf(collection, entry.id, entry.data);
        if (key !== null) keys.set(key, titleOf(collection, entry.data, entry.id));
      }
    }
    for (const key of this.routes().keys()) if (!keys.has(key)) keys.set(key, '');
    return keys;
  }

  /** Why a page can't take an address, or null when it can. */
  private checkAddress(
    key: string,
    site: Map<string, string>,
    leaving: Set<string>,
  ): string | null {
    const url = formatUrl(key, this.settings);
    if (isReservedPath(key))
      return `${url} belongs to the studio, so no page can use it. Choose a different address.`;
    const route = this.routes().get(key);
    if (route) {
      return `${url} is already a page on this site that isn’t edited here (${route}). Choose a different address.`;
    }
    if (site.has(key) && !leaving.has(key)) {
      const title = site.get(key);
      return `There’s already a page at ${url}${title ? ` (“${title}”)` : ''}. Choose a different address.`;
    }
    return null;
  }

  private takenMessage(url: string | null, title: string | null): string {
    return url
      ? `There’s already a page at ${url}${title ? ` (“${title}”)` : ''}. Choose a different address.`
      : `There’s already a page${title ? ` called “${title}”` : ''} there. Choose a different address.`;
  }

  private today(): Date {
    return calendarDate(this.now(), this.settings.timeZone);
  }

  private async treeData(name: string): Promise<TreeData> {
    const collection = this.manifest.collections.find((c) => c.name === name);
    if (!collection) throw new Error(`There's no collection called "${name}".`);
    const { source } = collection;
    if (source.loader !== 'glob')
      throw new Error(`${collection.label} isn't a collection of files in folders.`);
    const base = source.base === '.' ? '' : source.base;
    const relativeOf = (path: string) => (base ? path.slice(base.length + 1) : path);
    const entries = await this.content.entriesOf(name);

    const folders = new Map<string, string>();
    const remember = (relativeDir: string) => {
      if (relativeDir === '') return;
      const disk = relativeDir.split('/');
      for (let depth = 1; depth <= disk.length; depth++) {
        const key = folderKey(disk.slice(0, depth).join('/'));
        if (!folders.has(key)) folders.set(key, disk.slice(0, depth).join('/'));
      }
    };
    for (const entry of entries) {
      const relative = relativeOf(entry.path);
      remember(relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '');
    }

    const orders = new Map<string, OrderFile>();
    for (const listed of await this.storage.list(base ? { prefix: `${base}/` } : {})) {
      const relative = relativeOf(listed.path);
      if (relative !== ORDER_FILE && !relative.endsWith(`/${ORDER_FILE}`)) continue;
      const folder = relative === ORDER_FILE ? '' : relative.slice(0, -ORDER_FILE.length - 1);
      remember(folder);
      const file = await this.storage.read(listed.path);
      if (!file) continue;
      const names = readOrder(file);
      orders.set(folderKey(folder), {
        path: listed.path,
        names: names ?? [],
        file,
        readable: names !== null,
      });
    }

    const tree = buildTree(
      entries.map((entry) => {
        const key = this.keyOf(collection, entry.id, entry.data);
        return {
          id: entry.id,
          title: titleOf(collection, entry.data, entry.id),
          url: key === null ? null : formatUrl(key, this.settings),
          entry,
        };
      }),
      Object.fromEntries([...orders].map(([key, order]) => [key, order.names])),
    );
    return { collection, source, tree, entries, orders, folders };
  }

  /**
   * Rewrites links and relative paths in every content file on the site: each
   * collection's entries, plus Markdown, MDX and Markdoc files that aren't
   * entries (partials, drafts). Returns the files that change.
   */
  private async rewriteSite(
    context: LinkContext,
    files: ReadonlyMap<string, string>,
  ): Promise<Map<string, { bytes: Uint8Array; version: string; links: number }>> {
    const changed = new Map<string, { bytes: Uint8Array; version: string; links: number }>();
    const covered = new Set<string>();
    const placeOf = (path: string, url?: { from: string; to: string }): FilePlace => ({
      path: { from: path, to: files.get(path) ?? path },
      ...(url ? { url } : {}),
    });

    for (const collection of this.manifest.collections) {
      if (!collection.editable) continue;
      const { source } = collection;
      if (source.loader === 'file') {
        const stored = await this.storage.read(source.path);
        if (!stored || (source.format !== 'json' && source.format !== 'yaml')) continue;
        covered.add(source.path);
        const read = readCollectionFile(stored.bytes, source.format);
        if (read.status !== 'editable') continue;
        let bytes = stored.bytes;
        let links = 0;
        for (const item of read.entries) {
          const result = rewriteValues(item.data, collection.fields, context, placeOf(source.path));
          if (result.links + result.paths === 0) continue;
          bytes = writeCollectionEntry(bytes, source.format, item.id, result.data).bytes;
          links += result.links;
        }
        if (bytes !== stored.bytes)
          changed.set(source.path, { bytes, version: stored.version, links });
        continue;
      }
      if (source.loader !== 'glob') continue;
      for (const entry of await this.content.entriesOf(collection.name)) {
        covered.add(entry.path);
        const oldKey = this.keyOf(collection, entry.id, entry.data);
        const moved = files.get(entry.path);
        let url: { from: string; to: string } | undefined;
        if (oldKey !== null) {
          const base = source.base === '.' ? '' : source.base;
          const newId = moved
            ? defaultEntryId(
                base ? moved.slice(base.length + 1) : moved,
                isPlainObject(entry.data) ? entry.data : null,
              )
            : entry.id;
          const newKey = this.keyOf(collection, newId, entry.data) ?? oldKey;
          url = { from: formatUrl(oldKey, this.settings), to: formatUrl(newKey, this.settings) };
        }
        const edit = rewriteFile(
          entry.file,
          entry.format,
          collection,
          context,
          placeOf(entry.path, url),
        );
        if (edit) changed.set(entry.path, { ...edit, version: entry.file.version });
      }
    }

    const src = this.manifest.site.srcDir;
    const prefix = src === '.' || src === '' ? '' : `${src}/`;
    for (const listed of await this.storage.list(prefix ? { prefix } : {})) {
      if (covered.has(listed.path) || !/\.(md|markdown|mdx|mdoc)$/i.test(listed.path)) continue;
      const file = await this.storage.read(listed.path);
      if (!file) continue;
      const format = /\.mdx$/i.test(listed.path)
        ? 'mdx'
        : /\.mdoc$/i.test(listed.path)
          ? 'mdoc'
          : 'md';
      const edit = rewriteFile(file, format, null, context, placeOf(listed.path));
      if (edit) changed.set(listed.path, { ...edit, version: file.version });
    }
    return changed;
  }
}

/** One file's links and paths, rewritten. Null when nothing changes. */
function rewriteFile(
  file: StoredFile,
  format: string,
  collection: CollectionManifest | null,
  context: LinkContext,
  place: FilePlace,
): { bytes: Uint8Array; links: number } | null {
  try {
    if (format === 'json' || format === 'yaml') {
      const read = readDataFile(file.bytes, format);
      if (read.status !== 'editable') return null;
      const result = rewriteValues(read.value, collection?.fields ?? null, context, place);
      if (result.links + result.paths === 0) return null;
      return {
        bytes: writeDataFile(file.bytes, format, result.data).bytes,
        links: result.links,
      };
    }
    const read = readEntryFile(file.bytes);
    if (read.status === 'read-only') return null;
    const body = rewriteBody(read.body, format as BodyFormat, context, place);
    const values =
      read.status === 'editable' && read.split.format !== null
        ? rewriteValues(read.data, collection?.fields ?? null, context, place)
        : { data: read.data, links: 0, paths: 0 };
    const bodyChanged = body.links + body.paths > 0;
    const dataChanged = values.links + values.paths > 0;
    if (!bodyChanged && !dataChanged) return null;
    const result = writeEntryFile(file.bytes, {
      ...(bodyChanged ? { body: body.text } : {}),
      ...(dataChanged && isPlainObject(values.data) ? { data: values.data } : {}),
    });
    return result.changed ? { bytes: result.bytes, links: body.links + values.links } : null;
  } catch (error) {
    // A file that can't be rewritten safely keeps its links; its redirects still work.
    if (error instanceof SerializationError) return null;
    throw error;
  }
}

/** Where a page lands among its new siblings: listed order first, then by title. */
function positionAfterMove(
  siblings: readonly PageNode[],
  slug: string,
  title: string,
  order: readonly string[],
  renamedFrom: string | null,
): Position {
  const listed = order.map((n) => (n === renamedFrom ? slug : n));
  const names = listed.includes(slug) || order.length === 0 ? listed : [...listed, slug];
  const all = [...siblings.filter((n) => n.path !== ''), { slug, title }];
  const rank = (n: { slug: string }) => {
    const i = names.indexOf(n.slug);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const sorted = [...all].sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    if (x !== y) return x - y;
    return collator.compare(a.title, b.title) || collator.compare(a.slug, b.slug);
  });
  return { index: sorted.findIndex((n) => n.slug === slug) + 1, of: sorted.length };
}

/** A new `_order.yaml` (or a changed one), written through the YAML writer so comments stay. */
function orderPut(order: OrderFile, names: string[]): FileChange {
  const bytes = order.file
    ? writeDataFile(order.file.bytes, 'yaml', names).bytes
    : encodeUtf8(withFinalNewline(writeYaml('', names, { expect: 'any' }).text));
  return { op: 'put', path: order.path, bytes, expectedVersion: order.file?.version ?? null };
}

function withFinalNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** An `_order.yaml`'s names, or null when the file isn't a list of names. */
function readOrder(file: StoredFile): string[] | null {
  const read = readDataFile(file.bytes, 'yaml');
  if (read.status !== 'editable') return null;
  if (read.value === null) return [];
  if (!Array.isArray(read.value) || !read.value.every((v) => typeof v === 'string')) return null;
  return read.value;
}

/** The redirects file's list, or null when it isn't one. */
function readList(file: StoredFile): unknown[] | null {
  const read = readDataFile(file.bytes, 'yaml');
  if (read.status !== 'editable') return null;
  if (read.value === null) return [];
  return Array.isArray(read.value) ? read.value : null;
}

/** A new redirects file: a comment, then one flow map per line, as the spec's example. */
export function newRedirectsFile(redirects: readonly unknown[]): Uint8Array {
  const header =
    '# Redirects for this site (spec §6.15.5). Moves in the studio add to it; the Redirects screen edits it.\n';
  const lines = redirects.map(
    (item) => `- ${renderYaml(item as DataValue, DEFAULT_STYLE, true).trimEnd()}`,
  );
  const text = header + (lines.length > 0 ? `${lines.join('\n')}\n` : '[]\n');
  const read = readYaml(text, 'any');
  if (!read.editable || !deepEqual(read.value, redirects.length > 0 ? redirects : [])) {
    throw new SerializationError(
      'verification-failed',
      "The redirects couldn't be written without changing them, so nothing was saved.",
    );
  }
  return encodeUtf8(text);
}

function isSectionFile(path: string): boolean {
  return /(^|\/)index\.[^./]+$/.test(path);
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

function parentPathOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/** Whether an entry's ID comes from a `slug` in its frontmatter rather than its file. */
function hasOwnSlug(entry: StoredEntry): boolean {
  const data = entry.data;
  return isPlainObject(data) && data.slug !== undefined && data.slug !== '' && data.slug !== null;
}

function pathOf(change: FileChange): string {
  return change.op === 'move' ? change.from : change.path;
}
