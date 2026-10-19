import {
  ContentService,
  GitHubError,
  GitHubStorage,
  MEDIA_TYPES,
  MediaService,
  PageService,
  extensionOf,
  fieldModelIssues,
  issuesFromZod,
  type BlobCache,
  type FieldIssue,
  type Manifest,
  type UrlEntry,
} from '@vesper/core';
import { ApiError, type StudioApi } from '../app/api.ts';
import type { GitHubStudioSettings } from './session.ts';

/*
 * GitHub mode's back end (spec §6.8): the same core services local mode's
 * dev API runs, here in the browser over the repository's branch. Every
 * screen, check and splice is the same code; only storage differs.
 *
 * Saves are validated with the site's own Zod schemas, built for the
 * browser at `astro build` (DECISIONS.md, "GitHub mode validates with the
 * real schemas"). If that file can't load, the field model's checks stand
 * in, and the site's build is the last check.
 */

type SafeParse = (
  value: unknown,
  params?: object,
) => Promise<{ success: boolean; error?: { issues: unknown[] } }>;

export type GitHubApiOptions = {
  settings: GitHubStudioSettings;
  /** The current token. */
  token: () => string;
  manifest: Manifest;
  loadMdxProps: () => Promise<Readonly<Record<string, unknown>>>;
  loadUrlFunctions?: () => Promise<Readonly<Record<string, (entry: UrlEntry) => unknown>>>;
  /** The site's static routes at build, for collision checks. */
  routes?: readonly (readonly [string, string])[];
  cache?: BlobCache;
  /** Called when GitHub says the sign-in has expired. */
  onExpired?: () => void;
  fetch?: typeof fetch;
};

export function createGitHubApi(options: GitHubApiOptions): StudioApi {
  const { settings, manifest } = options;
  const storage = new GitHubStorage({
    owner: settings.owner,
    repo: settings.repo,
    branch: settings.branch,
    root: settings.root,
    token: options.token,
    ...(settings.apiUrl ? { apiUrl: settings.apiUrl } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  let schemas: Promise<Readonly<Record<string, unknown>> | null> | null = null;
  const loadSchemas = () => {
    schemas ??= (
      import(/* @vite-ignore */ settings.schemas) as Promise<{ schemas?: unknown }>
    ).then(
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

  /** Runs a request, with GitHub's errors in the studio's terms. */
  const call = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw apiError(error, options.onExpired);
    }
  };
  const known = (name: string) => manifest.collections.some((c) => c.name === name);
  const objectUrls = new Map<string, string>();

  return {
    publishesOnSave: () => true,
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

/** GitHub's errors as the studio shows them: plain words, and a status the screens understand. */
export function apiError(error: unknown, onExpired?: () => void): unknown {
  if (!(error instanceof GitHubError)) return error;
  switch (error.kind) {
    case 'auth':
      onExpired?.();
      return new ApiError(401, 'Your GitHub sign-in has expired. Sign in again to publish.');
    case 'rate-limit':
      return new ApiError(
        429,
        error.retryAt
          ? `GitHub asked the studio to slow down. Try again after ${error.retryAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
          : 'GitHub asked the studio to slow down. Try again in a few minutes.',
      );
    case 'network':
      return new ApiError(0, error.message);
    case 'forbidden':
    case 'not-found':
      return new ApiError(
        error.status,
        'Your GitHub account can’t reach this site’s repository. Ask its owner to add you.',
      );
    default:
      return new ApiError(502, 'GitHub had a problem. Try again in a moment.');
  }
}
