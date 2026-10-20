import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_URL_SETTINGS, folderKey, readDataFile, siteRatios } from '@vesper/core';
import type { Plugin, ViteDevServer } from 'vite';
import { createDevApi } from './dev-api.ts';
import type { CloudStudioSettings, StaticRoutes } from '@vesper/core';
import type { SiteModel } from '../node/manifest.ts';
import type { HelperData } from '../runtime/helpers.ts';
import type { GitHubSettings } from '../node/github.ts';
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
 * - `virtual:vesper/images` gives `<Img>` the site's aspect ratios (spec §6.6.3).
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
  /** GitHub mode's settings in a built site, or null (spec §6.8). */
  github?: () => GitHubSettings | null;
  /** The cloud's settings in a built site, or null (spec §6.9). */
  cloud?: () => CloudStudioSettings | null;
  /** The site's static routes, for the dev API's collision checks. */
  routes?: () => StaticRoutes;
  /** The `vesper:content` helpers' runtime (runtime/helpers): TypeScript here, JavaScript once built. */
  helpersEntry: string;
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
const IMAGES = 'virtual:vesper/images';
const CONTENT = 'vesper:content';
const IDS = new Set([STUDIO, MANIFEST, WIDGETS, PAGE, IMAGES, CONTENT]);

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
              '@tiptap/pm/model',
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
      if (id === `\0${CONTENT}`) {
        const model = await options.cache.get();
        return contentModule({
          dev: options.command === 'dev',
          helpers: toPosix(options.helpersEntry),
          data: helperData(model, options.root),
          vesperConfig:
            options.vesperConfig && Object.keys(model.urlFunctions ?? {}).length > 0
              ? toPosix(options.vesperConfig)
              : undefined,
        });
      }
      if (!id.startsWith('\0virtual:vesper/')) return null;
      const name = id.slice(1);
      if (name === MANIFEST) {
        const { manifest } = await options.cache.get();
        return `export default ${JSON.stringify(manifest)};`;
      }
      if (name === WIDGETS) {
        if (!options.vesperConfig) {
          return [
            'export const widgets = {};',
            'export const loadMdxProps = () => Promise.resolve({});',
            'export const loadUrlFunctions = () => Promise.resolve({});',
          ].join('\n');
        }
        const { widgetNames } = await options.cache.get();
        return [
          // vesper.config.ts loads on first use: when a field's custom widget
          // renders, or when an MDX body needs its components' props schemas
          // (spec §6.5.2), so it and Zod stay out of /admin's first load.
          `const load = () => import(${JSON.stringify(toPosix(options.vesperConfig))}).then((module) => module.default ?? {});`,
          'export const widgets = {',
          ...widgetNames.map(
            (widget) =>
              `  ${JSON.stringify(widget)}: () => load().then((config) => config.widgets[${JSON.stringify(widget)}].component()),`,
          ),
          '};',
          'export const loadMdxProps = () => load().then((config) => Object.fromEntries(',
          '  Object.entries(config.mdx?.components ?? {}).flatMap(([name, component]) =>',
          '    component?.props ? [[name, component.props]] : []),',
          '));',
          // Function-form URL patterns, for moves and links in GitHub mode (spec §6.15.1).
          'export const loadUrlFunctions = () => load().then((config) => Object.fromEntries(',
          '  Object.entries(config.collections ?? {}).flatMap(([name, collection]) =>',
          "    typeof collection?.url === 'function' ? [[name, collection.url]] : []),",
          '));',
        ].join('\n');
      }
      if (name === IMAGES) {
        const { manifest } = await options.cache.get();
        return `export const ratios = ${JSON.stringify(manifest.site.images?.ratios ?? siteRatios())};`;
      }
      if (name === PAGE) {
        return [
          `export const siteName = ${JSON.stringify(options.siteName)};`,
          `export const adminUrl = ${JSON.stringify(`${options.siteUrl}admin/`)};`,
        ].join('\n');
      }
      if (name === STUDIO) {
        const github = options.command === 'build' ? (options.github?.() ?? null) : null;
        const cloud = options.command === 'build' ? (options.cloud?.() ?? null) : null;
        const { manifest } = await options.cache.get();
        const routes =
          github || cloud ? [...(options.routes?.() ?? new Map<string, string>())] : [];
        // Built for the browser with the manifest's hash, so a new build is fetched anew.
        const schemas = `${options.siteUrl}_vesper/schemas.js?v=${manifest.hash.slice(0, 12)}`;
        return [
          `import { createLocalApi, mountStudio } from ${JSON.stringify(toPosix(options.adminEntry))};`,
          `import ${JSON.stringify(toPosix(options.adminCss))};`,
          `import manifest from '${MANIFEST}';`,
          `import { widgets, loadMdxProps, loadUrlFunctions } from '${WIDGETS}';`,
          "const element = document.getElementById('vesper-studio');",
          'if (element) {',
          '  mountStudio(element, {',
          '    manifest,',
          '    widgets,',
          '    loadMdxProps,',
          // Local mode while astro dev runs; GitHub and cloud modes in built sites.
          `    api: import.meta.env.DEV ? createLocalApi(${JSON.stringify(options.apiBase)}) : null,`,
          `    siteName: ${JSON.stringify(options.siteName)},`,
          `    siteUrl: ${JSON.stringify(options.siteUrl)},`,
          // GitHub mode (spec §6.8) and the cloud (spec §6.9) in a built site.
          `    github: import.meta.env.DEV ? null : ${JSON.stringify(github ? { ...github, schemas } : null)},`,
          `    cloud: import.meta.env.DEV ? null : ${JSON.stringify(cloud ? { ...cloud, schemas } : null)},`,
          `    routes: ${JSON.stringify(routes)},`,
          '    loadUrlFunctions,',
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
          ...(options.routes ? { routes: options.routes } : {}),
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
      // Page order lives in _order.yaml files, which aren't entries: the helpers
      // embed them, so a change reloads the site's pages (not the studio).
      const onOrder = (file: string) => {
        if (!toPosix(file).endsWith('/_order.yaml')) return;
        for (const environment of Object.values(server.environments)) {
          const module = environment.moduleGraph.getModuleById(`\0${CONTENT}`);
          if (module) environment.moduleGraph.invalidateModule(module);
        }
        server.environments.client.hot.send({ type: 'full-reload', path: '*' });
      };
      server.watcher.on('change', onOrder);
      server.watcher.on('add', onOrder);
      server.watcher.on('unlink', onOrder);
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
function contentModule(options: {
  dev: boolean;
  helpers: string;
  data: HelperData;
  vesperConfig: string | undefined;
}): string {
  const helpers = [
    `import { createHelpers } from ${JSON.stringify(options.helpers)};`,
    ...(options.vesperConfig
      ? [
          `import vesperConfig from ${JSON.stringify(options.vesperConfig)};`,
          "const urlFunctions = Object.fromEntries(Object.entries(vesperConfig?.collections ?? {}).flatMap(([name, c]) => typeof c?.url === 'function' ? [[name, c.url]] : []));",
        ]
      : ['const urlFunctions = {};']),
    `const helpers = createHelpers(${JSON.stringify(options.data)}, (name) => getCollection(name), urlFunctions);`,
    'export const getTree = helpers.getTree;',
    'export const getChildren = helpers.getChildren;',
    'export const getBreadcrumbs = helpers.getBreadcrumbs;',
    'export const getUrl = helpers.getUrl;',
  ];
  if (!options.dev) {
    return [
      "import { getCollection } from 'astro:content';",
      "export * from 'astro:content';",
      ...helpers,
    ].join('\n');
  }
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
    ...helpers,
  ].join('\n');
}

const TITLE_KEYS = ['title', 'name', 'label', 'heading'];

/**
 * What the helpers need, as JSON: the URL settings, and for each collection
 * its pattern, where to read a title, and its parsed `_order.yaml` files.
 */
export function helperData(model: SiteModel, root: string): HelperData {
  const { manifest } = model;
  const settings = manifest.site.urls ?? {
    ...DEFAULT_URL_SETTINGS,
    ...(manifest.site.timeZone ? { timeZone: manifest.site.timeZone } : {}),
  };
  const collections: HelperData['collections'] = {};
  for (const collection of manifest.collections) {
    const fieldKeys = (collection.fields ?? [])
      .filter((f) => f.path.length === 1 && f.kind === 'string')
      .map((f) => String(f.path[0]))
      .filter((key) => TITLE_KEYS.includes(key));
    const titleKeys = [
      ...new Set([
        ...fieldKeys,
        'title',
        'name',
        ...(collection.presentation.listFields ?? []).slice(0, 1),
      ]),
    ];
    collections[collection.name] = {
      ...(typeof collection.presentation.url === 'string'
        ? { url: collection.presentation.url }
        : {}),
      titleKeys,
      orders:
        collection.source.loader === 'glob' ? orderFiles(join(root, collection.source.base)) : {},
    };
  }
  return { settings, collections };
}

/** Every `_order.yaml` under a folder, parsed, keyed by its folder's path in the tree. */
function orderFiles(base: string): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  if (!existsSync(base)) return found;
  const visit = (dir: string, relative: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name))
          visit(join(dir, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
      } else if (entry.name === '_order.yaml') {
        const read = readDataFile(new Uint8Array(readFileSync(join(dir, entry.name))), 'yaml');
        if (read.status === 'editable' && Array.isArray(read.value)) {
          found[folderKey(relative)] = read.value.filter((v): v is string => typeof v === 'string');
        }
      }
    }
  };
  visit(base, '');
  return found;
}

const SKIPPED = new Set(['node_modules', '.git', 'dist', '.astro', '.vesper']);
