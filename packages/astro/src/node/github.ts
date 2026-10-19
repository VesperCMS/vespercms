import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parseRepo } from '@vesper/core';
import type { Plugin } from 'vite';
import { importSiteVite, processConditions } from './load-site.ts';

/*
 * GitHub mode at build (spec §6.8): which repository, branch and folder the
 * studio saves to, and the site's content schemas built for the browser, so
 * the studio validates with the real schemas there too (spec §6.3.1;
 * DECISIONS.md, "GitHub mode validates with the real schemas").
 */

/** The integration's `github` option. */
export type GitHubOptions = {
  /** The OAuth relay's address (templates/oauth-relay, or Vesper's free relay). */
  relay: string;
  /** `owner/name`. Read from git, or the host's environment, when absent. */
  repo?: string;
  /** The branch saves go to: the repository's default branch when absent. */
  branch?: string;
  /** The site's folder inside the repository, when it isn't at the root. Read from git when absent. */
  root?: string;
  /** GitHub Enterprise Server's API (`https://host/api/v3`), or a test double. Its sign-in pages are the relay's `GITHUB_URL`. */
  apiUrl?: string;
};

/** What the studio needs to save to GitHub. */
export type GitHubSettings = {
  owner: string;
  repo: string;
  branch: string;
  root: string;
  relay: string;
  apiUrl?: string;
};

/** The settings, or why GitHub mode can't be on, in a sentence for the build log. */
export function githubSettings(
  options: GitHubOptions,
  siteRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): { settings: GitHubSettings; notes: string[] } | { problem: string } {
  const notes: string[] = [];
  const git = (args: string[]): string | null => {
    try {
      return execFileSync('git', args, {
        cwd: siteRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim();
    } catch {
      return null;
    }
  };

  const slug =
    options.repo ??
    env.GITHUB_REPOSITORY ??
    (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
      ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`
      : undefined) ??
    env.REPOSITORY_URL ??
    git(['config', '--get', 'remote.origin.url']) ??
    '';
  const parsed = parseRepo(slug);
  if (!parsed) {
    return {
      problem:
        "GitHub mode: couldn't tell which repository this site is in. Set vesper({ github: { repo: 'owner/name' } }).",
    };
  }

  let branch = options.branch;
  if (!branch) {
    const remoteHead = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    branch = remoteHead?.replace(/^origin\//, '') || undefined;
  }
  if (!branch) {
    branch = 'main';
    notes.push(
      "GitHub mode: couldn't read the repository's default branch, so the studio publishes to main. Set vesper({ github: { branch } }) if that's wrong.",
    );
  }

  const prefix = options.root ?? git(['rev-parse', '--show-prefix']) ?? '';
  return {
    settings: {
      ...parsed,
      branch,
      root: prefix.replace(/^\/+|\/+$/g, ''),
      relay: options.relay.replace(/\/+$/, ''),
      ...(options.apiUrl ? { apiUrl: options.apiUrl.replace(/\/+$/, '') } : {}),
    },
    notes,
  };
}

const ENTRY = '\0vesper:schemas-entry';
const CONTENT = '\0vesper:browser-content';
const LOADERS = '\0vesper:browser-loaders';

/**
 * Builds `content.config.ts`'s schemas for the browser into `outFile`, with
 * shims for `astro:content` and `astro/loaders` that carry no Astro runtime.
 * A config that imports Node or another `astro:*` module can't run there;
 * the build then fails here, and only here: the site's own build is never
 * affected, and the studio falls back to the manifest's checks.
 */
export async function buildSchemaBundle(options: {
  root: string;
  contentConfig: string;
  outFile: string;
}): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> {
  try {
    const vite = await importSiteVite(options.root);
    await vite.build({
      root: options.root,
      configFile: false,
      envDir: false,
      logLevel: 'silent',
      publicDir: false,
      resolve: { tsconfigPaths: true },
      plugins: [browserShims(options.contentConfig), processConditions(vite)],
      build: {
        outDir: dirname(options.outFile),
        emptyOutDir: false,
        copyPublicDir: false,
        minify: true,
        target: 'es2022',
        reportCompressedSize: false,
        rollupOptions: {
          input: ENTRY,
          preserveEntrySignatures: 'strict',
          output: { format: 'es', entryFileNames: basename(options.outFile) },
        },
      },
    });
    return { ok: true, bytes: statSync(options.outFile).size };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
    };
  }
}

const NODE_BUILTINS = new Set(builtinModules);

function browserShims(contentConfig: string): Plugin {
  return {
    name: 'vesper:browser-schemas',
    enforce: 'pre',
    resolveId(source) {
      if (source === ENTRY || source === CONTENT || source === LOADERS) return source;
      if (source === 'astro:content') return CONTENT;
      if (source === 'astro/loaders') return LOADERS;
      if (source.startsWith('astro:')) {
        throw new Error(
          `content.config.ts imports ${source}, which the studio can't run in the browser.`,
        );
      }
      const bare = source.replace(/^node:/, '');
      if (source.startsWith('node:') || NODE_BUILTINS.has(bare)) {
        throw new Error(
          `content.config.ts imports ${source}, which the studio can't run in the browser.`,
        );
      }
      return null;
    },
    load(id) {
      if (id === ENTRY) {
        return [
          `import * as config from ${JSON.stringify(contentConfig)};`,
          "import { z } from 'astro/zod';",
          // Astro's image() resolves a file at build; in the studio a value is its path.
          'const image = () => z.string();',
          'export const schemas = {};',
          'for (const [name, collection] of Object.entries(config.collections ?? {})) {',
          "  const schema = typeof collection?.schema === 'function' ? collection.schema({ image }) : collection?.schema;",
          "  if (schema && typeof schema.safeParseAsync === 'function') schemas[name] = schema;",
          '}',
        ].join('\n');
      }
      if (id === CONTENT) {
        return [
          "import { z } from 'astro/zod';",
          'export { z };',
          'export const defineCollection = (config) => config;',
          'export const defineLiveCollection = (config) => config;',
          // Astro's own reference(), without the runtime lookup: what it accepts.
          'export function reference(collection) {',
          '  return z.union([',
          '    z.number().transform((n) => n.toString(10)),',
          '    z.string(),',
          '    z.object({ id: z.string(), collection: z.string() }),',
          '    z.object({ slug: z.string(), collection: z.string() }),',
          "  ]).refine((value) => typeof value !== 'object' || value.collection === collection, {",
          '    message: `Expected a reference to ${collection}.`,',
          '  });',
          '}',
          ...[
            'getCollection',
            'getEntry',
            'getEntries',
            'render',
            'getLiveCollection',
            'getLiveEntry',
          ].map(
            (name) =>
              `export const ${name} = () => { throw new Error("${name}() isn't available in the studio."); };`,
          ),
        ].join('\n');
      }
      if (id === LOADERS) {
        return [
          "export const glob = (options) => ({ name: 'glob', options });",
          "export const file = (fileName, options) => ({ name: 'file', fileName, options });",
        ].join('\n');
      }
      return null;
    },
  };
}
