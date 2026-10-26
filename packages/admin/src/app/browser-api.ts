import {
  ContentService,
  MEDIA_TYPES,
  MediaService,
  PageService,
  extensionOf,
  fieldModelIssues,
  issuesFromZod,
  type FieldIssue,
  type Manifest,
  type StorageAdapter,
  type UrlEntry,
} from '@vesper/core';
import { ApiError, type StudioApi } from './api.ts';

/*
 * The studio's back end in the browser (DECISIONS.md, "GitHub mode runs
 * core's services in the browser"): the same core services local mode's dev
 * API runs, over a storage adapter. GitHub mode passes its repository, the
 * cloud its drafts; every screen, check and splice stays the same code.
 *
 * Saves are validated with the site's own Zod schemas, built for the
 * browser at `astro build`. If that file can't load, the field model's
 * checks stand in, and the site's build is the last check.
 */

type SafeParse = (
  value: unknown,
  params?: object,
) => Promise<{ success: boolean; error?: { issues: unknown[] } }>;

export type BrowserApiOptions = {
  storage: StorageAdapter;
  manifest: Manifest;
  /** The site's schemas built for the browser. */
  schemas: string;
  loadMdxProps: () => Promise<Readonly<Record<string, unknown>>>;
  loadUrlFunctions?: () => Promise<Readonly<Record<string, (entry: UrlEntry) => unknown>>>;
  /** The site's static routes at build, for collision checks. */
  routes?: readonly (readonly [string, string])[];
  /** Whether a save publishes (GitHub mode) or keeps a draft (the cloud). */
  publishesOnSave: boolean;
  /** The storage's own errors in the studio's terms. */
  mapError: (error: unknown) => unknown;
};

export function createBrowserApi(options: BrowserApiOptions): StudioApi {
  const { storage, manifest } = options;

  let schemas: Promise<Readonly<Record<string, unknown>> | null> | null = null;
  const loadSchemas = () => {
    schemas ??= (import(/* @vite-ignore */ options.schemas) as Promise<{ schemas?: unknown }>).then(
      (module) =>
        typeof module.schemas === 'object' && module.schemas !== null
          ? (module.schemas as Record<string, unknown>)
          : null,
      () => null,
    );
    return schemas;
  };
  const validate = async (name: string, data: Record<string, unknown>): Promise<FieldIssue[]> => {
    const all = await loadSchemas();
    const schema = all?.[name] as { safeParseAsync?: SafeParse } | undefined;
    if (typeof schema?.safeParseAsync === 'function') {
      const result = await schema.safeParseAsync(data, { reportInput: true });
      return result.success ? [] : issuesFromZod(result.error?.issues ?? []);
    }
    if (all !== null) return [];
    const collection = manifest.collections.find((c) => c.name === name);
    return fieldModelIssues(collection?.fields ?? null, data as never);
  };

  let ready: Promise<{ content: ContentService; pages: PageService; media: MediaService }> | null =
    null;
  const services = () => {
    ready ??= (async () => {
      const urlFunctions = (await options.loadUrlFunctions?.().catch(() => ({}))) ?? {};
      const routes = new Map(options.routes ?? []);
      const content: ContentService = new ContentService(storage, manifest, {
        validate: (name, data) => validate(name, data),
        validateBody: async ({ format, body, path }) => {
          const { bodyChecks } = await import('../body/checks.ts');
          const partials = format === 'mdoc' ? await content.listPartials() : [];
          return bodyChecks({
            manifest,
            format,
            loadMdxProps: options.loadMdxProps,
            partials,
            entryPath: path,
          }).validate(body);
        },
        tree: () => pages.hooks(),
      });
      const pages: PageService = new PageService(storage, manifest, content, {
        routes: () => routes,
        urlFunctions,
      });
      const media = new MediaService(storage, content, {
        roots: [`${manifest.site.srcDir}/assets`, 'public'],
      });
      return { content, pages, media };
    })();
    return ready;
  };

  /** Runs a request, with the storage's errors in the studio's terms. */
  const call = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw options.mapError(error);
    }
  };
  const known = (name: string) => manifest.collections.some((c) => c.name === name);
  const objectUrls = new Map<string, string>();

  return {
    publishesOnSave: () => options.publishesOnSave,
    summary: () => call(async () => (await services()).content.summary()),
    listEntries: (collection) =>
      call(async () => {
        if (!known(collection))
          throw new ApiError(404, `There's no collection called "${collection}".`);
        return (await services()).content.listEntries(collection);
      }),
    readEntry: (collection, id) =>
      call(async () => {
        const doc = known(collection)
          ? await (await services()).content.readEntry(collection, id)
          : null;
        if (!doc) throw new ApiError(404, `"${id}" wasn't found in ${collection || 'this site'}.`);
        return doc;
      }),
    saveEntry: (request) => call(async () => (await services()).content.saveEntry(request)),
    deleteEntry: (collection, id, version) =>
      call(async () => (await services()).content.deleteEntry(collection, id, version)),
    listMedia: () => call(async () => (await services()).media.list()),
    upload: (file, name, folder, uploadOptions) =>
      call(async () =>
        (await services()).media.upload(new Uint8Array(await file.arrayBuffer()), name, folder, {
          defer: uploadOptions?.withNextSave === true,
        }),
      ),
    deleteMedia: (path) => call(async () => (await services()).media.remove(path)),
    listPartials: () => call(async () => (await services()).content.listPartials()),
    fileUrl: (path) =>
      call(async () => {
        const file = await storage.read(path);
        if (!file) throw new ApiError(404, `${path} wasn't found.`);
        let url = objectUrls.get(file.version);
        if (!url) {
          const type = MEDIA_TYPES[extensionOf(path)] ?? 'application/octet-stream';
          url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type }));
          objectUrls.set(file.version, url);
        }
        return url;
      }),
    listPages: () => call(async () => (await services()).pages.pages()),
    listScheduled: () => call(async () => (await services()).content.scheduledChanges(new Date())),
    pageTree: (collection) => call(async () => (await services()).pages.tree(collection)),
    movePage: (request, moveOptions) =>
      call(async () => {
        const { pages } = await services();
        return moveOptions?.dryRun ? pages.planMove(request) : pages.move(request);
      }),
    reorderPage: (request) => call(async () => (await services()).pages.reorder(request)),
    createSection: (collection, path) =>
      call(async () => (await services()).pages.createSection(collection, path)),
    readRedirects: () => call(async () => (await services()).pages.redirects()),
    saveRedirects: (request) => call(async () => (await services()).pages.saveRedirects(request)),
  };
}
