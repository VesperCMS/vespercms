import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

/*
 * Compiles the site's custom widgets (spec §6.3.3) as React. Astro sites
 * default to `"jsx": "preserve"` (Astro's own JSX), and a site needn't have
 * @astrojs/react, so widget files and the JSX files they import are
 * compiled here with React's automatic runtime. Nothing else in the site is
 * touched: the widget modules are the ones vesper.config.ts imports lazily,
 * plus whatever JSX they import in turn.
 */

const toPosix = (path: string) => path.split('\\').join('/');
const JSX = /\.[jt]sx$/;

/** The files `vesper.config.ts` imports lazily (`component: () => import('./x.tsx')`). */
export function widgetEntries(configPath: string | undefined): string[] {
  if (!configPath) return [];
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const match of text.matchAll(/import\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g)) {
    const specifier = match[2];
    if (specifier) found.push(toPosix(resolve(dirname(configPath), specifier)));
  }
  return found;
}

export function widgetJsxPlugin(configPath: string | undefined): Plugin {
  const widgetFiles = new Set<string>();
  const clean = (id: string) => toPosix(id.split('?')[0] ?? id);

  return {
    name: 'vesper:widget-jsx',
    // Before Vite's own TypeScript step, which would keep the JSX as written.
    enforce: 'pre',
    buildStart() {
      widgetFiles.clear();
      for (const file of widgetEntries(configPath)) widgetFiles.add(file);
    },
    async resolveId(source, importer, options) {
      if (!importer || !widgetFiles.has(clean(importer)) || !source.startsWith('.')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && JSX.test(clean(resolved.id))) widgetFiles.add(clean(resolved.id));
      return resolved;
    },
    async transform(code, id) {
      const file = clean(id);
      if (!JSX.test(file) || !widgetFiles.has(file)) return null;
      // The site's own Vite: 8 transforms with Oxc, 7 (Astro 6) with esbuild.
      type Transform = (
        code: string,
        file: string,
        options: object,
      ) => Promise<{ code: string; map?: unknown }>;
      const vite = (await import('vite')) as unknown as {
        transformWithOxc?: Transform;
        transformWithEsbuild?: Transform;
      };
      const development = this.environment.config.mode !== 'production';
      const tsx = file.endsWith('.tsx');
      const result = vite.transformWithOxc
        ? await vite.transformWithOxc(code, file, {
            lang: tsx ? 'tsx' : 'jsx',
            jsx: { runtime: 'automatic', importSource: 'react', development },
          })
        : vite.transformWithEsbuild
          ? await vite.transformWithEsbuild(code, file, {
              loader: tsx ? 'tsx' : 'jsx',
              jsx: 'automatic',
              jsxImportSource: 'react',
              jsxDev: development,
            })
          : null;
      return result ? { code: result.code, map: result.map as never } : null;
    },
  };
}
