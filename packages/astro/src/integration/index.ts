import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { humanize } from '@vesper/core';
import type { AstroIntegration } from 'astro';
import type { PluginOption } from 'vite';
import { siteConfigFiles } from '../node/load-site.ts';
import { writeManifest } from '../node/manifest.ts';
import { buildRedirects, urlSettings, writeHostRules, type BuildRedirects } from './redirects.ts';
import { staticRoutesFromFiles, staticRoutesOf, type ResolvedRoute } from './routes.ts';
import { checkSite, withRoutes } from './site-check.ts';
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
        if (command === 'dev' || options.studio?.deploy !== false) {
          injectRoute({ pattern: '/admin', entrypoint: ADMIN_PAGE, prerender: true });
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
        const adminCss = fileURLToPath(import.meta.resolve('@vesper/admin/studio.css'));
        const studioFromSource = adminCss.endsWith(`${sep}src${sep}studio.css`);
        const plugins: PluginOption[] = [
          widgetJsxPlugin(files.vesperConfig),
          studioPlugin({
            root,
            cache,
            configFiles: Object.values(files),
            vesperConfig: files.vesperConfig,
            apiBase: `${base}_vesper/api/`,
            routes: staticRoutes,
            helpersEntry: fileURLToPath(runtimeFile('helpers')),
            siteName: options.siteName ?? siteNameOf(config.site, root),
            siteUrl: base,
            command,
            adminEntry,
            adminCss,
            studioFromSource,
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
