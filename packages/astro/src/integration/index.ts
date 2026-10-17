import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { humanize } from '@vesper/core';
import type { AstroIntegration } from 'astro';
import type { PluginOption } from 'vite';
import { siteConfigFiles } from '../node/load-site.ts';
import { writeManifest } from '../node/manifest.ts';
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

  return {
    name: '@vesper/astro',
    hooks: {
      'astro:config:setup': async ({
        config,
        command,
        injectRoute,
        updateConfig,
        addWatchFile,
        addMiddleware,
        addDevToolbarApp,
        logger,
      }) => {
        const root = fileURLToPath(config.root);
        const srcDir = relative(root, fileURLToPath(config.srcDir)).split(sep).join('/') || 'src';
        const files = siteConfigFiles(root, srcDir);
        cache = new SiteModelCache({ root, srcDir }, logger);

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
      },

      'astro:config:done': ({ injectTypes }) => {
        injectTypes({
          filename: 'vesper.d.ts',
          content: "declare module 'vesper:content' {\n  export * from 'astro:content';\n}\n",
        });
      },

      'astro:build:done': async ({ dir, logger }) => {
        if (!cache) return;
        // How the cloud learns the schema without any secrets in the build (spec §6.2).
        const { manifest } = await cache.get();
        writeManifest(manifest, fileURLToPath(new URL('_vesper/manifest.json', dir)));
        logger.info('Wrote _vesper/manifest.json');
      },
    },
  };
}

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
