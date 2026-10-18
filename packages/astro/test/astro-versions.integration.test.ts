import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import sharp, { type Region } from 'sharp';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { vesperShims } from '../src/node/load-site.ts';
import { generateManifest } from '../src/node/manifest.ts';

/*
 * Vesper supports Astro 6 and 7 (spec D1). Two checks per major:
 * - the `astro:content` shim offers every export Astro's own module does,
 *   so any content config that loads in Astro loads in Vesper;
 * - a real site on that major produces the expected manifest.
 * Astro 7 is the workspace's own. Astro 6 is fixtures/astro6-site, installed
 * on its own; CI's astro6 job sets VESPER_ASTRO6=1 so a missing install fails
 * instead of skipping.
 */

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const astro6Site = `${repo}fixtures/astro6-site`;
const astro6Installed = existsSync(`${astro6Site}/node_modules/astro/package.json`);
const requireAstro6 = process.env.VESPER_ASTRO6 === '1';

/** Names `templates/content/module.mjs` exports: Astro's own `astro:content`. */
function astroContentExports(astroDir: string): string[] {
  return exportedNames(readFileSync(`${astroDir}/templates/content/module.mjs`, 'utf8'));
}

/** Names the shim exports. */
function shimExports(): string[] {
  const load = vesperShims('/unused').load as (id: string) => string | null;
  return exportedNames(load.call({}, '\0vesper:astro-content') ?? '');
}

/** Export names in a module's source: `export const x`, `export function x`, `export { a, b as c }`. */
function exportedNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(
    /export\s+(?:const|let|var|async\s+function|function)\s+(\w+)/g,
  )) {
    if (match[1]) names.add(match[1]);
  }
  for (const match of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .at(-1)
        ?.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

describe('the astro:content shim', () => {
  it('offers everything Astro 7’s astro:content does', () => {
    const missing = astroContentExports(`${repo}node_modules/astro`).filter(
      (name) => !shimExports().includes(name),
    );
    expect(missing).toEqual([]);
  });

  it.runIf(astro6Installed || requireAstro6)(
    'offers everything Astro 6’s astro:content does',
    () => {
      const missing = astroContentExports(`${astro6Site}/node_modules/astro`).filter(
        (name) => !shimExports().includes(name),
      );
      expect(missing).toEqual([]);
    },
  );
});

describe.runIf(astro6Installed || requireAstro6)('an Astro 6 site', () => {
  it('produces a manifest with image(), reference() and .meta() hints detected', async () => {
    const manifest = await generateManifest({ root: astro6Site });
    expect(manifest.diagnostics).toEqual([]);
    const blog = manifest.collections.find((c) => c.name === 'blog');
    expect(
      blog?.fields?.map((f) => ({
        key: f.path[0],
        kind: f.kind,
        label: f.label,
        ...(f.reference ? { reference: f.reference.collection } : {}),
      })),
    ).toEqual([
      { key: 'title', kind: 'string', label: 'Headline' },
      { key: 'cover', kind: 'image', label: 'Cover' },
      { key: 'hero', kind: 'object', label: 'Hero' },
      { key: 'author', kind: 'reference', label: 'Author', reference: 'authors' },
      { key: 'category', kind: 'enum', label: 'Category' },
      { key: 'publishedAt', kind: 'date', label: 'Published at' },
      { key: 'draft', kind: 'boolean', label: 'Draft' },
    ]);
    expect(manifest.collections.find((c) => c.name === 'authors')?.source).toMatchObject({
      loader: 'file',
      path: 'src/data/authors.json',
    });
  });
});

/** The environment without what Vitest adds to it. */
function siteEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(VITEST.*|NODE_ENV|DEV|PROD|MODE|SSR|BASE_URL|TEST)$/.test(key),
    ),
  );
}

describe.runIf(astro6Installed || requireAstro6)('images on Astro 6 (spec §6.6.5)', () => {
  it(
    'registers the crop step, and <Img> cuts the manual og crop and the focal square',
    { timeout: 300_000 },
    async () => {
      const build = spawnSync(
        process.execPath,
        ['--conditions=@vesper/source', `${astro6Site}/node_modules/astro/bin/astro.mjs`, 'build'],
        // A build as a site runs it: without the variables Vitest sets (NODE_ENV, DEV, MODE…),
        // which Astro would read as a development build.
        { cwd: astro6Site, encoding: 'utf8', env: siteEnv() },
      );
      expect(build.status, build.stderr + build.stdout).toBe(0);
      expect(build.stdout).toContain('cut by Vesper’s step');
      expect(readFileSync(`${astro6Site}/dist/index.html`, 'utf8')).not.toContain(
        'data-image-component',
      );
      const html = readFileSync(`${astro6Site}/dist/index.html`, 'utf8');
      const srcOf = (test: string) =>
        /src="([^"]+)"/.exec(
          [...html.matchAll(/<img [^>]*>/g)]
            .map((m) => m[0])
            .find((tag) => tag.includes(`data-test="${test}"`)) ?? '',
        )?.[1] ?? '';
      const original = readFileSync(`${astro6Site}/src/content/blog/harbor.jpg`);
      const compare = async (test: string, region: Region, width: number, height: number) => {
        const file = readFileSync(`${astro6Site}/dist${srcOf(test)}`);
        const out = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        expect([out.info.width, out.info.height]).toEqual([width, height]);
        const reference = await sharp(original)
          .extract(region)
          .resize(width, height)
          .removeAlpha()
          .raw()
          .toBuffer();
        let sum = 0;
        for (let i = 0; i < reference.length; i++)
          sum += Math.abs((out.data[i] ?? 0) - (reference[i] ?? 0));
        return sum / reference.length;
      };
      // The stored og crop, { x: 0.1, y: 0.2, w: 0.6, h: 0.4712 } of 2400×1600.
      expect(
        await compare('og', { left: 240, top: 320, width: 1440, height: 754 }, 382, 200),
      ).toBeLessThan(2);
      // A square centred on the focal point (62%, 35%): from 62% − ⅓ = 28.67% across.
      expect(
        await compare('square', { left: 688, top: 0, width: 1600, height: 1600 }, 200, 200),
      ).toBeLessThan(2);
    },
  );
});
