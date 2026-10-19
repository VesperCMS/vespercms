import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { humanize } from '@vesper/core';
import type { AstroIntegration } from 'astro';
import type { PluginOption } from 'vite';
import { withCropStep } from '../images/register.ts';
import { checkBuild, summaryLine, type A11yBuildOptions } from './a11y.ts';
import { siteConfigFiles } from '../node/load-site.ts';
import {
  buildSchemaBundle,
  githubSettings,
  type GitHubOptions,
  type GitHubSettings,
} from '../node/github.ts';
import { writeManifest } from '../node/manifest.ts';
import { reactProblem, reactVersionFrom } from './react-check.ts';
import { indexSearch, openSearchXml, type SearchOptions } from './search.ts';
import { searchPlugin } from './search-plugin.ts';
import { buildRedirects, urlSettings, writeHostRules, type BuildRedirects } from './redirects.ts';
import { staticRoutesFromFiles, staticRoutesOf, type ResolvedRoute } from './routes.ts';
import { checkSite, withRoutes } from './site-check.ts';
import { formatUrl } from '@vesper/core';
import { SiteModelCache } from './site-model.ts';
import { studioPlugin } from './vite-plugin.ts';
import { widgetJsxPlugin } from './widget-jsx.ts';

export type VesperOptions = {
  studio?: {
    /**
     * Include `/admin` in production builds (spec §6.16). It's a static shell
     * that shows nothing without signing in, so this is safe by default. Set
     * `false` for sites edited only locally: `/admin` then exists only in
     * `astro dev`.
     */
    deploy?: boolean;
  };
  /** The site's name in the studio. Defaults to the host of Astro's `site`, then the package name. */
  siteName?: string;
  /**
   * The crop step (spec §6.6.5). When the site uses Astro's own Sharp image
   * service, Vesper wraps it to cut each image's stored crop before Astro
   * resizes it. `false` leaves Astro's service alone: `<Img>` then uses
   * Astro's own server crop for each ratio, with the focal point as
   * `object-position`, and manual crops aren't applied.
   */
  imageService?: boolean;
  /**
   * Accessibility checks at build (spec §6.18, layer 2). After every build,
   * each page is checked with axe-core's structure rules (no colour or
   * layout) and the issues, traced to the entries that produced them, go to
   * `.vesper/a11y-report.json`, never into `dist/`. `failBuildOn: 'error'`
   * (or `'warning'`) fails the build when there's an issue at that level;
   * by default the build never fails. `false` turns the check off.
   */
  a11y?: false | A11yBuildOptions;
  /**
   * Site search (spec §6.19, D23). When a page uses `<Search>`, every build
   * indexes the site with Pagefind into `_vesper/search/`: plain files that
   * work on any host. `filters` and `sort` name each collection's fields
   * (`{ blog: ['tags'] }`), `exclude` leaves pages out by URL
   * (`['/tags/**']`). `false` turns search off.
   */
  search?: false | SearchOptions;
  /**
   * GitHub mode (spec §6.8): editors sign in with GitHub on the deployed
   * site, and each save is one commit to the repository's default branch.
   * `relay` is the address of the OAuth relay (templates/oauth-relay).
   * `repo`, `branch` and the site's folder in the repository are read from
   * git when absent. `astro dev` stays local mode.
   */
  github?: GitHubOptions;
};

/** A file in ../runtime: TypeScript in this workspace, JavaScript once built. */
function runtimeFile(name: string): URL {
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  return new URL(`../runtime/${name}${extension}`, import.meta.url);
}

/** A crescent, for the evening star. The toolbar names the app in text. */
const TOOLBAR_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M12.5 2.5a7.5 7.5 0 1 0 5 13.1A6 6 0 0 1 12.5 2.5Z"/></svg>';

/** The studio page, shipped beside src/ and dist/ so both resolve it the same way. */
const ADMIN_PAGE = new URL('../../pages/admin.astro', import.meta.url);
/** The /search page, injected unless the site has its own (spec §6.19). */
const SEARCH_PAGE = new URL('../../pages/search.astro', import.meta.url);

/**
 * The Vesper integration (spec §6.1). Zero config:
 *
 * ```js
 * import vesper from '@vesper/astro';
 * export default defineConfig({ integrations: [vesper()] });
 * ```
 */
export default function vesper(options: VesperOptions = {}): AstroIntegration {
  let cache: SiteModelCache | undefined;
  let root = '';
  let srcDir = 'src';
  let command: 'dev' | 'build' | 'preview' | 'sync' = 'dev';
  /** Astro's resolved routes, once known (spec §6.15.1). */
  let resolved: ResolvedRoute[] | null = null;
  /** The build's cleaned redirects, written as host rules when the build is done. */
  let redirects: BuildRedirects | null = null;
  const logged = new Set<string>();
  let siteName = 'Your site';
  /** GitHub mode's settings for built sites, or null. */
  let github: GitHubSettings | null = null;
  let contentConfig: string | undefined;
  const staticRoutes = () =>
    resolved ? staticRoutesOf(resolved, root) : staticRoutesFromFiles(root, srcDir);

  return {
    name: '@vesper/astro',
    hooks: {
      'astro:config:setup': async ({
        config,
        command: astroCommand,
        injectRoute,
        updateConfig,
        addWatchFile,
        addMiddleware,
        addDevToolbarApp,
        logger,
      }) => {
        root = fileURLToPath(config.root);
        srcDir = relative(root, fileURLToPath(config.srcDir)).split(sep).join('/') || 'src';
        command = astroCommand;
        const files = siteConfigFiles(root, srcDir);
        contentConfig = files.contentConfig;
        if (options.github && command === 'build') {
          const found = githubSettings(options.github, root);
          if ('problem' in found) logger.warn(found.problem);
          else {
            github = found.settings;
            for (const note of found.notes) logger.warn(note);
          }
        }
        cache = new SiteModelCache(
          {
            root,
            srcDir,
            urls: {
              base: config.base,
              trailingSlash: config.trailingSlash,
              buildFormat: config.build.format,
              ...(config.site ? { site: config.site } : {}),
            },
          },
          logger,
        );

        const base = config.base.endsWith('/') ? config.base : `${config.base}/`;
        siteName = options.siteName ?? siteNameOf(config.site, root);
        if (command === 'dev' || options.studio?.deploy !== false) {
          injectRoute({ pattern: '/admin', entrypoint: ADMIN_PAGE, prerender: true });
        }
        if (options.search !== false && !staticRoutesFromFiles(root, srcDir).has('/search')) {
          injectRoute({ pattern: '/search', entrypoint: SEARCH_PAGE, prerender: true });
        }
        if (command === 'dev') {
          // "Edit this page": which entries each page reads (spec §6.10). Dev only.
          addMiddleware({ order: 'pre', entrypoint: runtimeFile('page-entries') });
          addDevToolbarApp({
            id: 'vesper',
            name: 'Vesper',
            icon: TOOLBAR_ICON,
            entrypoint: runtimeFile('toolbar-app'),
          });
        }
        // Widgets come from vesper.config.ts, so a change to it restarts the dev server.
        if (files.vesperConfig) addWatchFile(files.vesperConfig);

        const adminEntry = fileURLToPath(import.meta.resolve('@vesper/admin'));
        // The studio runs on the React its own package resolves, which is the site's.
        if (command === 'dev' || options.studio?.deploy !== false) {
          const problem = reactProblem(reactVersionFrom(adminEntry));
          if (problem) throw new Error(problem);
        }
        const adminCss = fileURLToPath(import.meta.resolve('@vesper/admin/studio.css'));
        const studioFromSource = adminCss.endsWith(`${sep}src${sep}studio.css`);
        const plugins: PluginOption[] = [
          widgetJsxPlugin(files.vesperConfig),
          searchPlugin({
            cache,
            search: options.search || {},
            settings: {
              base: config.base,
              trailingSlash: config.trailingSlash,
              buildFormat: config.build.format,
              ...(config.site ? { site: config.site } : {}),
            },
            siteName,
            dist: fileURLToPath(config.outDir),
            sitemap: config.integrations.some((i) => i.name === '@astrojs/sitemap'),
            dev: command === 'dev' && options.search !== false,
          }),
          studioPlugin({
            root,
            cache,
            configFiles: Object.values(files),
            vesperConfig: files.vesperConfig,
            apiBase: `${base}_vesper/api/`,
            routes: staticRoutes,
            helpersEntry: fileURLToPath(runtimeFile('helpers')),
            siteName,
            siteUrl: base,
            command,
            adminEntry,
            adminCss,
            studioFromSource,
            github: () => github,
          }),
        ];
        // In this workspace the studio's stylesheet is its Tailwind source,
        // compiled on the fly. Installed from npm it's precompiled CSS
        // (dist/studio.css) and this never runs.
        if (studioFromSource) {
          const { default: tailwindcss } = await import('@tailwindcss/vite');
          plugins.push(tailwindcss());
        }
        updateConfig({ vite: { plugins } });

        const images = options.imageService === false ? null : withCropStep(config.image.service);
        if (images) {
          updateConfig({ image: { service: images } });
          // A visible config change (spec §6.6.5): say so where builds are read.
          if (command === 'build') {
            logger.info(
              'Crops from fields.image() are cut by Vesper’s step inside Astro’s Sharp image service. vesper({ imageService: false }) turns it off.',
            );
          }
        }

        if (command === 'build') {
          // Redirects reach the built site through Astro (spec §6.15.5), cleaned
          // against every page the build will have. Routes aren't resolved yet,
          // so the static ones come from src/pages directly.
          redirects = await buildRedirects({
            root,
            model: await cache.get(),
            routes: staticRoutesFromFiles(root, srcDir),
            env: process.env,
            existing: config.redirects,
          });
          for (const warning of redirects.warnings) logger.warn(warning.message);
          if (Object.keys(redirects.astro).length > 0) updateConfig({ redirects: redirects.astro });
        }
      },

      'astro:routes:resolved': async ({ routes, logger }) => {
        resolved = routes;
        if (!cache || (command !== 'build' && command !== 'dev')) return;
        const run = async () => {
          if (!cache) return;
          const check = await checkSite(await cache.get(), root, routes);
          for (const diagnostic of check.diagnostics) {
            // Hints (tree: true) are for the developer at work, not every build log.
            if (
              logged.has(diagnostic.message) ||
              (diagnostic.level === 'info' && command === 'build')
            )
              continue;
            logged.add(diagnostic.message);
            if (diagnostic.level === 'warning') logger.warn(diagnostic.message);
            else logger.info(diagnostic.message);
          }
          if (command === 'build') {
            await cache.update(async (model) => ({
              ...model,
              manifest: await withRoutes(model.manifest, check.routes),
            }));
          }
        };
        // In dev the check runs alongside startup rather than holding it up.
        if (command === 'build') await run();
        else
          run().catch((error: unknown) => {
            logger.debug(
              `Route check skipped: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
      },

      'astro:config:done': ({ injectTypes }) => {
        injectTypes({
          filename: 'vesper.d.ts',
          content: VESPER_CONTENT_TYPES,
        });
      },

      'astro:build:done': async ({ dir, logger }) => {
        if (!cache) return;
        // How the cloud learns the schema without any secrets in the build (spec §6.2).
        const model = await cache.get();
        writeManifest(model.manifest, fileURLToPath(new URL('_vesper/manifest.json', dir)));
        logger.info('Wrote _vesper/manifest.json');
        if (redirects && redirects.redirects.length > 0) {
          const written = writeHostRules(fileURLToPath(dir), redirects, urlSettings(model));
          logger.info(`Wrote ${written.join(', ')}`);
        }
        if (options.a11y !== false) {
          const result = await checkBuild({
            root,
            dist: fileURLToPath(dir),
            model,
            settings: urlSettings(model),
            routes: staticRoutes,
            a11y: options.a11y ?? {},
          });
          if (result.written) logger.info(summaryLine(result));
          else logger.warn(summaryLine(result));
          // Thrown after the report is written, so the reasons are there to read.
          if (result.failed) throw new Error(result.failed);
        }
        if (github && contentConfig) {
          // The real schemas for the studio in the browser (spec §6.3.1), or why not.
          const built = await buildSchemaBundle({
            root,
            contentConfig,
            outFile: fileURLToPath(new URL('_vesper/schemas.js', dir)),
          });
          if (built.ok) {
            logger.info(
              `GitHub mode: publishing to ${github.owner}/${github.repo} (${github.branch}). The studio checks entries with your content schemas (_vesper/schemas.js, ${String(Math.round(built.bytes / 1024))} KB).`,
            );
          } else {
            logger.warn(
              `GitHub mode: your content schemas couldn't be built for the browser (${built.reason}). The studio checks entries from the manifest instead, and the site's build is the last check.`,
            );
          }
        }
        if (options.search !== false) {
          const settings = urlSettings(model);
          const dist = fileURLToPath(dir);
          const result = await indexSearch({
            root,
            dist,
            model,
            settings,
            routes: staticRoutes,
            search: options.search ?? {},
          });
          for (const line of result.info) logger.info(line);
          for (const line of result.warnings) logger.warn(line);
          if (result.built && settings.site) {
            writeFileSync(
              join(dist, 'opensearch.xml'),
              openSearchXml({
                siteName,
                site: settings.site,
                searchPage: formatUrl('/search', settings),
              }),
            );
            logger.info('Wrote opensearch.xml');
          }
        }
      },
    },
  };
}

/** Types for `vesper:content`: astro:content, plus the site helpers (spec §6.15.7). */
const VESPER_CONTENT_TYPES = `declare module 'vesper:content' {
  export * from 'astro:content';
  import type { CollectionEntry, CollectionKey } from 'astro:content';
  /** A page in a collection's tree. Folders with no section page have no entry and no URL. */
  export type PageNode<C extends CollectionKey = CollectionKey> = {
    path: string;
    slug: string;
    title: string;
    id?: string;
    entry?: CollectionEntry<C>;
    url: string | null;
    depth: number;
    children: PageNode<C>[];
  };
  export type Crumb = { title: string; url: string | null; id?: string };
  /** A collection's pages, nested by folder and ordered by _order.yaml, the root page first. */
  export function getTree<C extends CollectionKey>(collection: C): Promise<PageNode<C>[]>;
  /** A page's children, in order. */
  export function getChildren<C extends CollectionKey>(
    collection: C,
    entry: CollectionEntry<C> | string,
  ): Promise<PageNode<C>[]>;
  /** The trail from the home page to the entry, both included. */
  export function getBreadcrumbs<C extends CollectionKey>(
    collection: C,
    entry: CollectionEntry<C> | string,
  ): Promise<Crumb[]>;
  /** The entry's URL from its collection's url pattern, or undefined for a collection without one. */
  export function getUrl(entry: { collection: string; id: string; data?: unknown }): string | undefined;
}
/** Internal: the site's aspect ratios, for <Img> in @vesper/astro/components. */
declare module 'virtual:vesper/images' {
  export const ratios: Record<string, number>;
}
`;

function siteNameOf(site: string | undefined, root: string): string {
  if (site) {
    try {
      return new URL(site).hostname;
    } catch {
      // Not a URL; fall through.
    }
  }
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown };
    if (typeof pkg.name === 'string' && pkg.name)
      return humanize(pkg.name.replace(/^@[^/]+\//, ''));
  } catch {
    // No package.json: use the default.
  }
  return 'Your site';
}
