import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  IMAGE_MARKER,
  VESPER_META_KEY,
  type CollectionInput,
  type Diagnostic,
  patternExtensions,
  type LoaderInfo,
  type ManifestInput,
  type MarkdocConfigLike,
} from '@vesper/core';
import type { Plugin, ViteDevServer } from 'vite';
import { checkConfig, type VesperConfig } from '../config/index.ts';

/*
 * Reads a site's own config files (content.config.ts, vesper.config.ts,
 * forms.config.ts) with the site's own Vite, in an isolated server, so it
 * can introspect them without running Astro.
 *
 * Two modules are shimmed, and both only add information:
 * - `astro:content` re-exports Astro's real defineCollection, reference()
 *   and z from astro/content/runtime and astro/zod. Runtime-only functions
 *   (getCollection, render…) throw if a config calls them.
 * - `astro/loaders` wraps the real glob() and file(), so Astro's own option
 *   checks still run, and records their options for the manifest.
 *
 * Schema functions are called with an image() that marks the field, because
 * Astro's own image() is an unmarked string transform. Any other astro:*
 * module makes the config fail to load, and every collection is then listed
 * read-only with that message. Nothing crashes.
 */

export const LOADER_MARK = Symbol.for('vesper.loader');

type MarkedLoader = {
  name?: string;
  [LOADER_MARK]?:
    | { kind: 'glob'; options: GlobOptions }
    | { kind: 'file'; fileName: string; options?: { parser?: unknown } };
};
type GlobOptions = { pattern: string | string[]; base?: string | URL; generateId?: unknown };
type CollectionConfigObject = { loader?: unknown; schema?: unknown; type?: string };

const CONTENT_CONFIG_NAMES = [
  'content.config.ts',
  'content.config.mts',
  'content.config.js',
  'content.config.mjs',
];
const FORMS_CONFIG_NAMES = [
  'forms.config.ts',
  'forms.config.mts',
  'forms.config.js',
  'forms.config.mjs',
];
const ROOT_CONFIG_EXTENSIONS = ['ts', 'mts', 'js', 'mjs'];
const MARKDOC_CONFIG_NAMES = [
  'markdoc.config.js',
  'markdoc.config.mjs',
  'markdoc.config.mts',
  'markdoc.config.ts',
];

export type LoadSiteOptions = {
  /** The site root (where astro.config lives). */
  root: string;
  /** Astro's srcDir, relative to root. Defaults to `src`. */
  srcDir?: string;
  /** Astro's URL settings (base, trailingSlash, build.format, site), when loaded inside Astro. */
  urls?: NonNullable<ManifestInput['site']['urls']>;
};

export type LoadedSite = Omit<ManifestInput, 'generator'> & { root: string };

/** The config files Vesper reads, as absolute paths. Missing files are left out. */
export function siteConfigFiles(
  root: string,
  srcDir = 'src',
): {
  contentConfig?: string;
  vesperConfig?: string;
  formsConfig?: string;
  markdocConfig?: string;
} {
  const contentConfig = CONTENT_CONFIG_NAMES.map((name) => join(root, srcDir, name)).find((path) =>
    existsSync(path),
  );
  const vesperConfig = findRootFile(root, 'vesper.config');
  const formsConfig = FORMS_CONFIG_NAMES.map((name) => join(root, srcDir, name)).find((path) =>
    existsSync(path),
  );
  // The same names, in the same order, as @astrojs/markdoc looks for.
  const markdocConfig = MARKDOC_CONFIG_NAMES.map((name) => join(root, name)).find((path) =>
    existsSync(path),
  );
  return {
    ...(contentConfig ? { contentConfig } : {}),
    ...(vesperConfig ? { vesperConfig } : {}),
    ...(formsConfig ? { formsConfig } : {}),
    ...(markdocConfig ? { markdocConfig } : {}),
  };
}

/** astro.config, which Vesper reads only to learn @astrojs/markdoc's options. */
function astroConfigFile(root: string): string | undefined {
  return ['mjs', 'js', 'ts', 'mts', 'cjs', 'cts']
    .map((ext) => join(root, `astro.config.${ext}`))
    .find((path) => existsSync(path));
}

/** Loads a site's configs and returns what `buildManifest` needs. Never throws for config problems; it reports them. */
export async function loadSite(options: LoadSiteOptions): Promise<LoadedSite> {
  const root = resolve(options.root);
  const srcDir = options.srcDir ?? 'src';
  const diagnostics: Diagnostic[] = [];
  const {
    contentConfig: contentConfigPath,
    vesperConfig: vesperConfigPath,
    formsConfig: formsConfigPath,
    markdocConfig: markdocConfigPath,
  } = siteConfigFiles(root, srcDir);

  const server = await createIsolatedServer(root);
  try {
    const astroZod = (await server.ssrLoadModule('astro/zod')) as {
      z: { string: () => { meta: (m: object) => unknown } };
    };
    const markedImage = () => astroZod.z.string().meta({ [VESPER_META_KEY]: IMAGE_MARKER });

    let collections: CollectionInput[] = [];
    if (!contentConfigPath) {
      diagnostics.push({
        level: 'warning',
        code: 'no-content-config',
        message: `No content config found in ${srcDir}/.`,
      });
    } else {
      collections = await loadCollections(
        server,
        root,
        contentConfigPath,
        markedImage,
        diagnostics,
      );
    }

    let config: VesperConfig | undefined;
    if (vesperConfigPath) {
      try {
        const module = (await server.ssrLoadModule(vesperConfigPath)) as { default?: unknown };
        for (const problem of checkConfig(module.default)) {
          diagnostics.push({
            level: problem.level,
            code: 'vesper-config',
            message: problem.message,
          });
        }
        if (typeof module.default === 'object' && module.default !== null) config = module.default;
      } catch (error) {
        diagnostics.push({
          level: 'error',
          code: 'vesper-config',
          message: `vesper.config could not be loaded: ${messageOf(error)}`,
        });
      }
    }

    let forms: ManifestInput['forms'] = [];
    if (formsConfigPath) {
      try {
        const module = (await server.ssrLoadModule(formsConfigPath)) as {
          forms?: Record<string, unknown>;
        };
        forms = Object.entries(module.forms ?? {}).map(([name, definition]) => {
          const { schema, ...rest } = (definition ?? {}) as { schema?: unknown };
          return { name, schema, options: rest };
        });
      } catch (error) {
        diagnostics.push({
          level: 'error',
          code: 'forms-config',
          message: `forms.config could not be loaded: ${messageOf(error)}`,
        });
      }
    }

    const usesMarkdoc = collections.some(
      (c) => c.loader.kind === 'glob' && patternExtensions(c.loader.pattern).includes('mdoc'),
    );
    const markdoc =
      markdocConfigPath || usesMarkdoc
        ? await loadMarkdoc(server, root, markdocConfigPath, diagnostics)
        : undefined;

    return {
      root,
      site: {
        srcDir,
        ...(contentConfigPath ? { contentConfig: toPosix(relative(root, contentConfigPath)) } : {}),
        ...(options.urls ? { urls: options.urls } : {}),
      },
      collections,
      ...(config
        ? {
            config: {
              ...(config.collections ? { collections: config.collections } : {}),
              ...(config.widgets ? { widgets: config.widgets } : {}),
              ...(config.timeZone ? { timeZone: config.timeZone } : {}),
              ...(config.markdoc ? { markdoc: config.markdoc } : {}),
              ...(config.mdx ? { mdx: config.mdx } : {}),
              ...(config.redirects ? { redirects: config.redirects } : {}),
            },
          }
        : {}),
      ...(markdoc ? { markdoc } : {}),
      forms,
      diagnostics,
    };
  } finally {
    await server.close();
  }
}

type MarkdocOptions = { allowHTML?: boolean; ignoreIndentation?: boolean };

/**
 * The site's Markdoc config, merged exactly as @astrojs/markdoc merges it
 * (its own `setupConfig`: heading ids, `extends`, the HTML tag), and the
 * integration's options, read from astro.config. Undefined when the site
 * doesn't use @astrojs/markdoc at all.
 */
async function loadMarkdoc(
  server: ViteDevServer,
  root: string,
  configPath: string | undefined,
  diagnostics: Diagnostic[],
): Promise<{ config: MarkdocConfigLike; options: MarkdocOptions } | undefined> {
  const options = await markdocOptions(server, root, diagnostics);
  if (options === null && !configPath) return undefined;

  let user: object = {};
  if (configPath) {
    try {
      const module = (await server.ssrLoadModule(configPath)) as { default?: unknown };
      if (typeof module.default === 'object' && module.default !== null) user = module.default;
    } catch (error) {
      diagnostics.push({
        level: 'error',
        code: 'markdoc-config',
        message: `${toPosix(relative(root, configPath))} could not be loaded: ${messageOf(error)}`,
      });
      return undefined;
    }
  }
  let config = user as MarkdocConfigLike;
  try {
    const runtimePath = createRequire(join(root, 'package.json')).resolve(
      '@astrojs/markdoc/runtime',
    );
    const runtime = (await import(pathToFileURL(runtimePath).href)) as {
      setupConfig: (config: object, options: MarkdocOptions) => Promise<MarkdocConfigLike>;
    };
    config = await runtime.setupConfig(user, options ?? {});
  } catch (error) {
    diagnostics.push({
      level: 'warning',
      code: 'markdoc-config',
      message: `Vesper couldn't merge the Markdoc config the way Astro does (${messageOf(error)}), so the studio's checks may differ from the build's.`,
    });
  }
  return { config, options: options ?? {} };
}

/**
 * @astrojs/markdoc's options, recorded by the wrapper when astro.config is
 * loaded; null when astro.config has no Markdoc integration. When
 * astro.config can't be read in isolation, Astro's defaults are assumed.
 */
async function markdocOptions(
  server: ViteDevServer,
  root: string,
  diagnostics: Diagnostic[],
): Promise<MarkdocOptions | null> {
  const path = astroConfigFile(root);
  if (!path) return null;
  let integrations: unknown;
  try {
    const module = (await server.ssrLoadModule(path)) as {
      default?: { integrations?: unknown };
    };
    integrations = module.default?.integrations;
  } catch (error) {
    diagnostics.push({
      level: 'info',
      code: 'markdoc-options',
      message: `Vesper couldn't read astro.config on its own (${messageOf(error)}), so it parses Markdoc with @astrojs/markdoc's default options.`,
    });
    return {};
  }
  const flat = Array.isArray(integrations) ? (integrations.flat(Infinity) as unknown[]) : [];
  for (const integration of flat) {
    if (typeof integration !== 'object' || integration === null) continue;
    const recorded = (integration as { [MARKDOC_OPTIONS]?: unknown })[MARKDOC_OPTIONS];
    if (typeof recorded === 'object' && recorded !== null) {
      const { allowHTML, ignoreIndentation } = recorded as MarkdocOptions;
      return {
        ...(allowHTML === true ? { allowHTML } : {}),
        ...(ignoreIndentation === true ? { ignoreIndentation } : {}),
      };
    }
  }
  return null;
}

async function loadCollections(
  server: ViteDevServer,
  root: string,
  configPath: string,
  markedImage: () => unknown,
  diagnostics: Diagnostic[],
): Promise<CollectionInput[]> {
  let module: { collections?: Record<string, CollectionConfigObject> };
  try {
    module = (await server.ssrLoadModule(configPath)) as typeof module;
  } catch (error) {
    diagnostics.push({
      level: 'error',
      code: 'content-config',
      message: `${toPosix(relative(root, configPath))} could not be loaded: ${messageOf(error)}`,
    });
    return [];
  }

  return Object.entries(module.collections ?? {}).map(([name, collection]): CollectionInput => {
    const loader = loaderInfo(collection.loader, root);
    let schema: unknown = collection.schema;
    if (typeof schema === 'function') {
      try {
        schema = (schema as (context: { image: () => unknown }) => unknown)({ image: markedImage });
      } catch (error) {
        return {
          name,
          loader,
          schema: null,
          error: `The schema function for "${name}" threw: ${messageOf(error)}`,
        };
      }
    }
    return { name, loader, schema: schema ?? null };
  });
}

function loaderInfo(loader: unknown, root: string): LoaderInfo {
  if (typeof loader !== 'object' || loader === null) return { kind: 'other' };
  const marked = loader as MarkedLoader;
  const mark = marked[LOADER_MARK];
  if (mark?.kind === 'glob') {
    const base = mark.options.base ?? '.';
    const basePath =
      base instanceof URL ? fileURLToPath(base) : isAbsolute(base) ? base : resolve(root, base);
    return {
      kind: 'glob',
      base: toPosix(relative(root, basePath)) || '.',
      pattern: mark.options.pattern,
      customId: typeof mark.options.generateId === 'function',
    };
  }
  if (mark?.kind === 'file') {
    return {
      kind: 'file',
      path: toPosix(mark.fileName).replace(/^\.\//, ''),
      customParser: typeof mark.options?.parser === 'function',
    };
  }
  return typeof marked.name === 'string' ? { kind: 'other', name: marked.name } : { kind: 'other' };
}

/** The site's own Vite, so Vesper never brings a second one (Vite 8 on Astro 7, Vite 7 on Astro 6). */
async function importSiteVite(root: string): Promise<typeof import('vite')> {
  const fromSite = createRequire(join(root, 'package.json'));
  let vitePath: string;
  try {
    vitePath = fromSite.resolve('vite');
  } catch {
    const astroPackage = fromSite.resolve('astro/package.json');
    vitePath = createRequire(astroPackage).resolve('vite');
  }
  // createRequire resolves the CommonJS entry; the ESM build sits beside it.
  const esm = join(dirname(vitePath), 'index.js');
  return (await import(
    pathToFileURL(existsSync(esm) ? esm : vitePath).href
  )) as typeof import('vite');
}

async function createIsolatedServer(root: string): Promise<ViteDevServer> {
  const vite = await importSiteVite(root);
  // Astro's real loaders, from the site's own Astro. Vite externalizes bare
  // `astro/*` imports in SSR before any plugin sees them, so the shim is
  // wired in with an alias rather than resolveId.
  const fromSite = createRequire(join(root, 'package.json'));
  const realLoaders = fromSite.resolve('astro/loaders');
  // @astrojs/markdoc keeps its options in a closure; a wrapper records them
  // when astro.config calls it, so Vesper parses Markdoc as Astro does.
  const realMarkdoc = resolveFrom(fromSite, '@astrojs/markdoc');
  return vite.createServer({
    root,
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: {
      tsconfigPaths: true,
      alias: [
        { find: /^astro\/loaders$/, replacement: LOADERS_SPECIFIER },
        ...(realMarkdoc ? [{ find: /^@astrojs\/markdoc$/, replacement: MARKDOC_SPECIFIER }] : []),
      ],
    },
    plugins: [vesperShims(realLoaders, realMarkdoc), processConditions(vite)],
  });
}

function resolveFrom(require: NodeJS.Require, specifier: string): string | undefined {
  try {
    return require.resolve(specifier);
  } catch {
    return undefined;
  }
}

/**
 * Custom export conditions the Node process runs with (`--conditions=x`, on
 * the command line or in NODE_OPTIONS), such as a monorepo that resolves
 * workspace packages to source. Astro's own Vite sees whatever the site's
 * config sets; this throwaway server has no config, so it follows the
 * process instead. With no custom conditions, it changes nothing.
 */
export function customConditions(
  execArgv: readonly string[],
  nodeOptions: string | undefined,
): string[] {
  const args = [...execArgv, ...(nodeOptions ?? '').split(/\s+/)].filter(Boolean);
  const found: string[] = [];
  args.forEach((arg, i) => {
    const inline = /^(?:--conditions|-C)=(.+)$/.exec(arg);
    if (inline?.[1]) found.push(inline[1]);
    else if ((arg === '--conditions' || arg === '-C') && args[i + 1])
      found.push(args[i + 1] as string);
  });
  return [...new Set(found)];
}

function processConditions(vite: typeof import('vite')): Plugin {
  const extra = customConditions(process.execArgv, process.env.NODE_OPTIONS);
  return {
    name: 'vesper:process-conditions',
    configEnvironment(name, config) {
      if (extra.length === 0) return;
      const consumer = config.consumer ?? (name === 'client' ? 'client' : 'server');
      const base =
        config.resolve?.conditions ??
        (consumer === 'client' ? vite.defaultClientConditions : vite.defaultServerConditions);
      config.resolve = {
        ...config.resolve,
        conditions: [...extra, ...base.filter((c) => !extra.includes(c))],
        ...(consumer === 'server'
          ? {
              externalConditions: [
                ...extra,
                ...(config.resolve?.externalConditions ?? []).filter((c) => !extra.includes(c)),
              ],
            }
          : {}),
      };
    },
  };
}

const CONTENT_ID = '\0vesper:astro-content';
const LOADERS_SPECIFIER = 'virtual:vesper/astro-loaders';
const LOADERS_ID = '\0vesper:astro-loaders';
const MARKDOC_SPECIFIER = 'virtual:vesper/astro-markdoc';
const MARKDOC_ID = '\0vesper:astro-markdoc';
const UNAVAILABLE_PREFIX = '\0vesper:unavailable:';
/** Where the wrapped @astrojs/markdoc integration keeps the options it was called with. */
export const MARKDOC_OPTIONS = Symbol.for('vesper.markdocOptions');

/**
 * The `astro:content`, `astro/loaders` and `@astrojs/markdoc` shims described
 * at the top of this file. `realLoaders` and `realMarkdoc` are the absolute
 * paths of the site's own modules.
 */
export function vesperShims(realLoaders: string, realMarkdoc?: string): Plugin {
  return {
    name: 'vesper:shims',
    enforce: 'pre',
    resolveId(source) {
      if (source === 'astro:content') return CONTENT_ID;
      if (source === LOADERS_SPECIFIER) return LOADERS_ID;
      if (source === MARKDOC_SPECIFIER && realMarkdoc) return MARKDOC_ID;
      if (source.startsWith('astro:')) return `${UNAVAILABLE_PREFIX}${source}`;
      return null;
    },
    load(id) {
      if (id === CONTENT_ID) {
        return [
          "import { createReference } from 'astro/content/runtime';",
          "export { defineCollection, defineLiveCollection } from 'astro/content/runtime';",
          "export { z } from 'astro/zod';",
          'export const reference = createReference();',
          'const unavailable = (name) => () => {',
          "  throw new Error(`${name}() isn't available while Vesper reads your content config.`);",
          '};',
          ...[
            'getCollection',
            'getEntry',
            'getEntries',
            'render',
            'getLiveCollection',
            'getLiveEntry',
            'getEntryBySlug',
            'getDataEntryById',
          ].map((name) => `export const ${name} = unavailable('${name}');`),
        ].join('\n');
      }
      if (id === LOADERS_ID) {
        const real = JSON.stringify(toPosix(realLoaders));
        return [
          `import * as real from ${real};`,
          `export * from ${real};`,
          "const MARK = Symbol.for('vesper.loader');",
          "export function glob(options) { const loader = real.glob(options); loader[MARK] = { kind: 'glob', options }; return loader; }",
          "export function file(fileName, options) { const loader = real.file(fileName, options); loader[MARK] = { kind: 'file', fileName, options }; return loader; }",
        ].join('\n');
      }
      if (id === MARKDOC_ID && realMarkdoc) {
        const real = JSON.stringify(toPosix(realMarkdoc));
        return [
          `import real from ${real};`,
          "const MARK = Symbol.for('vesper.markdocOptions');",
          'export default function markdoc(options) { const integration = real(options); integration[MARK] = options ?? {}; return integration; }',
        ].join('\n');
      }
      if (id.startsWith(UNAVAILABLE_PREFIX)) {
        const name = id.slice(UNAVAILABLE_PREFIX.length);
        return `throw new Error(${JSON.stringify(`${name} isn't available while Vesper reads your config. Move code that needs it out of content.config.ts.`)});`;
      }
      return null;
    },
  };
}

function findRootFile(root: string, base: string): string | undefined {
  return ROOT_CONFIG_EXTENSIONS.map((ext) => join(root, `${base}.${ext}`)).find((path) =>
    existsSync(path),
  );
}

const toPosix = (path: string) => path.split('\\').join('/');

function messageOf(error: unknown): string {
  return error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
}

/** This package's version, for the manifest's `generator`. */
export function packageVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}
