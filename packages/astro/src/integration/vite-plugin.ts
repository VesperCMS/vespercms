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
  /** `dev` records which entries each page reads (spec §6.10); builds re-export astro:content as is. */
  command: 'dev' | 'build' | 'preview' | 'sync';
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
const CONTENT = 'vesper:content';
const IDS = new Set([STUDIO, MANIFEST, WIDGETS, PAGE, CONTENT]);

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
            // Declared MDX components' props schemas reach the studio through vesper.config.ts.
            'astro/zod',
            '@vesper/astro > @vesper/admin > react-aria-components',
            // The geo field's map, loaded on demand.
            '@vesper/astro > @vesper/admin > maplibre-gl',
            // The body editor, and SVG sanitizing for uploads.
            ...[
              '@tiptap/core',
              '@tiptap/pm/state',
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
      if (id === `\0${CONTENT}`) return contentModule(options.command === 'dev');
      if (!id.startsWith('\0virtual:vesper/')) return null;
      const name = id.slice(1);
      if (name === MANIFEST) {
        const { manifest } = await options.cache.get();
        return `export default ${JSON.stringify(manifest)};`;
      }
      if (name === WIDGETS) {
        if (!options.vesperConfig) return 'export const widgets = {};\nexport const mdxProps = {};';
        return [
          `import config from ${JSON.stringify(toPosix(options.vesperConfig))};`,
          'export const widgets = Object.fromEntries(',
          '  Object.entries(config?.widgets ?? {}).map(([name, widget]) => [name, widget.component]),',
          ');',
          // Declared MDX components' real Zod props schemas, so the studio
          // checks props exactly as the site does, in every mode (spec §6.5.2).
          'export const mdxProps = Object.fromEntries(',
          '  Object.entries(config?.mdx?.components ?? {}).flatMap(([name, component]) =>',
          '    component?.props ? [[name, component.props]] : []),',
          ');',
        ].join('\n');
      }
      if (name === PAGE) {
        return [
          `export const siteName = ${JSON.stringify(options.siteName)};`,
          `export const adminUrl = ${JSON.stringify(`${options.siteUrl}admin/`)};`,
        ].join('\n');
      }
      if (name === STUDIO) {
        return [
          `import { createLocalApi, mountStudio } from ${JSON.stringify(toPosix(options.adminEntry))};`,
          `import ${JSON.stringify(toPosix(options.adminCss))};`,
          `import manifest from '${MANIFEST}';`,
          `import { widgets, mdxProps } from '${WIDGETS}';`,
          "const element = document.getElementById('vesper-studio');",
          'if (element) {',
          '  mountStudio(element, {',
          '    manifest,',
          '    widgets,',
          '    mdxProps,',
          // Local mode only while astro dev runs; GitHub and cloud modes arrive in Phases 3 and 4.
          `    api: import.meta.env.DEV ? createLocalApi(${JSON.stringify(options.apiBase)}) : null,`,
          `    siteName: ${JSON.stringify(options.siteName)},`,
          `    siteUrl: ${JSON.stringify(options.siteUrl)},`,
          '  });',
          '}',
          // Astro reloads every open page when a content file changes (a
          // full-reload with path '*', or with no path at all for Markdoc
          // entries, and no triggeredBy). The studio made that change
          // itself, and a reload would throw away its state, so it steps
          // out of the way: Vite's client reads the payload after this
          // listener and only reloads for a .html path matching the page.
          // Code changes carry triggeredBy and still reload.
          'if (import.meta.hot) {',
          "  import.meta.hot.on('vite:beforeFullReload', (payload) => {",
          "    if ((payload.path === '*' || payload.path === undefined) && !payload.triggeredBy) payload.path = '/__vesper_studio_stays__.html';",
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

/**
 * `vesper:content` (spec §6.11): Astro's own `astro:content`, re-exported.
 * In dev, the loaders also note each entry a page reads, for the toolbar's
 * "Edit this page": `shown` for `render()` and `getEntry()`, `listed` for
 * `getCollection()` and `getEntries()` (which `getStaticPaths` calls for
 * every page of a route). In builds it's a plain re-export: zero cost.
 */
function contentModule(dev: boolean): string {
  if (!dev) return "export * from 'astro:content';";
  return [
    "import * as content from 'astro:content';",
    "export * from 'astro:content';",
    "const store = () => globalThis[Symbol.for('vesper.pageEntries')]?.getStore();",
    'function note(entry, kind) {',
    '  const entries = store();',
    "  if (!entries || !entry || typeof entry.collection !== 'string' || typeof entry.id !== 'string') return entry;",
    '  const data = entry.data ?? {};',
    "  const title = [data.title, data.name, data.label].find((t) => typeof t === 'string' && t.trim() !== '');",
    "  const key = entry.collection + '/' + entry.id;",
    "  const shown = kind === 'shown' || entries.get(key)?.kind === 'shown';",
    "  entries.set(key, { collection: entry.collection, id: entry.id, kind: shown ? 'shown' : 'listed', ...(title ? { title } : {}) });",
    '  return entry;',
    '}',
    "export async function getEntry(...args) { return note(await content.getEntry(...args), 'shown'); }",
    "export async function getEntries(...args) { const list = await content.getEntries(...args); list.forEach((e) => note(e, 'listed')); return list; }",
    "export async function getCollection(...args) { const list = await content.getCollection(...args); list.forEach((e) => note(e, 'listed')); return list; }",
    "export async function render(entry, ...rest) { note(entry, 'shown'); return content.render(entry, ...rest); }",
  ].join('\n');
}
