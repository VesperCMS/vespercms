import { resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { createDevApi } from './dev-api.ts';
import type { SiteModelCache } from './site-model.ts';

/*
 * The studio's virtual modules and the local-mode dev API.
 *
 * - `virtual:vesper/studio` is the /admin page's script: it mounts the
 *   precompiled studio with the manifest, the back end and the widgets.
 * - `virtual:vesper/manifest` is the site's manifest (spec §6.2).
 * - `virtual:vesper/widgets` maps custom widget names to their lazy
 *   `component` imports from vesper.config.ts (spec §6.3.3). They're bundled
 *   by the site's own Vite, so they run on the site's origin (D14).
 * - `virtual:vesper/page` gives the page its title.
 */

export type StudioPluginOptions = {
  root: string;
  cache: SiteModelCache;
  /** Absolute paths of content.config, vesper.config and forms.config, where they exist. */
  configFiles: string[];
  vesperConfig: string | undefined;
  /** Mount point of the dev API, e.g. `/_vesper/api/`. */
  apiBase: string;
  siteName: string;
  siteUrl: string;
  /** Resolved `@vesper/admin` and its stylesheet: dist/ when installed, src/ in this workspace. */
  adminEntry: string;
  adminCss: string;
  /** True in this workspace, where @vesper/admin resolves to its TypeScript source. */
  studioFromSource: boolean;
};

/** @vesper/core's runtime packages, which the browser loads through the studio. */
const CORE_DEPENDENCIES = [
  '@markdoc/markdoc',
  'github-slugger',
  'js-yaml',
  'jsonc-parser',
  'mdast-util-from-markdown',
  'mdast-util-gfm',
  'mdast-util-mdx',
  'micromark-extension-gfm',
  'micromark-extension-mdxjs',
  'picomatch/posix.js',
  'yaml',
];

const STUDIO = 'virtual:vesper/studio';
const MANIFEST = 'virtual:vesper/manifest';
const WIDGETS = 'virtual:vesper/widgets';
const PAGE = 'virtual:vesper/page';
const IDS = new Set([STUDIO, MANIFEST, WIDGETS, PAGE]);

const toPosix = (path: string) => path.split('\\').join('/');

export function studioPlugin(options: StudioPluginOptions): Plugin {
  const watched = new Set(options.configFiles.map((file) => toPosix(resolve(file))));

  return {
    name: 'vesper:studio',
    config() {
      // The studio is imported from a virtual module, so Vite's dependency
      // scan can't see its packages and would re-optimize (and reload the
      // page) on the first visit to /admin. Name them up front. The `>`
      // form finds packages that are only installed under @vesper/admin.
      return {
        optimizeDeps: {
          include: [
            'react',
            'react/jsx-runtime',
            'react-dom/client',
            '@vesper/astro > @vesper/admin > react-aria-components',
            // The geo field's map, loaded on demand.
            '@vesper/astro > @vesper/admin > maplibre-gl',
            // The body editor, and SVG sanitizing for uploads.
            ...[
              '@tiptap/core',
              '@tiptap/react',
              '@tiptap/starter-kit',
              '@tiptap/markdown',
              '@tiptap/extension-image',
              'dompurify',
            ].map((dep) => `@vesper/astro > @vesper/admin > ${dep}`),
            ...(options.studioFromSource
              ? // This workspace: the studio is TSX compiled in dev mode, and
                // @vesper/core is linked source, so its own packages are named.
                [
                  'react/jsx-dev-runtime',
                  ...CORE_DEPENDENCIES.map((dep) => `@vesper/astro > @vesper/core > ${dep}`),
                ]
              : ['@vesper/astro > @vesper/admin > @vesper/core']),
          ],
        },
      };
    },
    resolveId(id) {
      return IDS.has(id) ? `\0${id}` : null;
    },
    async load(id) {
      if (!id.startsWith('\0virtual:vesper/')) return null;
      const name = id.slice(1);
      if (name === MANIFEST) {
        const { manifest } = await options.cache.get();
        return `export default ${JSON.stringify(manifest)};`;
      }
      if (name === WIDGETS) {
        if (!options.vesperConfig) return 'export const widgets = {};';
        return [
          `import config from ${JSON.stringify(toPosix(options.vesperConfig))};`,
          'export const widgets = Object.fromEntries(',
          '  Object.entries(config?.widgets ?? {}).map(([name, widget]) => [name, widget.component]),',
          ');',
        ].join('\n');
      }
      if (name === PAGE) {
        return `export const siteName = ${JSON.stringify(options.siteName)};`;
      }
      if (name === STUDIO) {
        return [
          `import { createLocalApi, mountStudio } from ${JSON.stringify(toPosix(options.adminEntry))};`,
          `import ${JSON.stringify(toPosix(options.adminCss))};`,
          `import manifest from '${MANIFEST}';`,
          `import { widgets } from '${WIDGETS}';`,
          "const element = document.getElementById('vesper-studio');",
          'if (element) {',
          '  mountStudio(element, {',
          '    manifest,',
          '    widgets,',
          // Local mode only while astro dev runs; GitHub and cloud modes arrive in Phases 3 and 4.
          `    api: import.meta.env.DEV ? createLocalApi(${JSON.stringify(options.apiBase)}) : null,`,
          `    siteName: ${JSON.stringify(options.siteName)},`,
          `    siteUrl: ${JSON.stringify(options.siteUrl)},`,
          '  });',
          '}',
          // Astro reloads every open page when a content file changes (a
          // full-reload with path '*' and no triggeredBy). The studio made
          // that change itself, and a reload would throw away its state, so
          // it steps out of the way: Vite's client reads the payload after
          // this listener and only reloads for a .html path matching the
          // page. Code changes carry triggeredBy and still reload.
          'if (import.meta.hot) {',
          "  import.meta.hot.on('vite:beforeFullReload', (payload) => {",
          "    if (payload.path === '*' && !payload.triggeredBy) payload.path = '/__vesper_studio_stays__.html';",
          '  });',
          '}',
        ].join('\n');
      }
      return null;
    },
    configureServer(server) {
      server.middlewares.use(
        createDevApi({
          root: options.root,
          base: options.apiBase,
          model: () => options.cache.get(),
        }),
      );
      const onChange = (file: string) => {
        if (!watched.has(toPosix(resolve(file)))) return;
        options.cache.reset();
        reloadStudio(server);
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}

/** A schema changed: the studio's manifest is stale, so reload any open /admin. */
function reloadStudio(server: ViteDevServer): void {
  const client = server.environments.client;
  const module = client.moduleGraph.getModuleById(`\0${MANIFEST}`);
  if (module) client.moduleGraph.invalidateModule(module);
  // triggeredBy marks a real reload, which the studio page doesn't skip.
  client.hot.send({ type: 'full-reload', path: '*', triggeredBy: 'vesper:manifest' });
}
