import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * Phase 2.7's last "Done when" (spec §11): with the crop step turned off,
 * the site still builds, and crops fall back to Astro's own server crop plus
 * the focal point as object-position. Also: building never touches an
 * original image.
 *
 * A copy of the playground (at the playground's depth, so its relative
 * imports resolve) gets `vesper({ imageService: false })` and is built with
 * Astro's own Sharp service. Each ratio's file must be exactly what Sharp
 * makes for that size and anchor on its own.
 */

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const playground = join(repo, 'apps', 'playground');
const site = join(repo, 'e2e', '.images-site');
const SKIP = new Set(['node_modules', 'dist', '.astro', '.vesper']);

/** SHA-256 of every file under a folder, by path. */
function hashes(dir: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    found[relative(dir, path).split('\\').join('/')] = createHash('sha256')
      .update(readFileSync(path))
      .digest('hex');
  }
  return found;
}

/**
 * The environment a site builds in: without the variables Vitest sets
 * (NODE_ENV, DEV, MODE…), which Astro would read as a development build.
 */
function siteEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(VITEST.*|NODE_ENV|DEV|PROD|MODE|SSR|BASE_URL|TEST)$/.test(key),
    ),
  );
}

let before: Record<string, string> = {};
let build: SpawnSyncReturns<string>;

beforeAll(() => {
  rmSync(site, { recursive: true, force: true });
  cpSync(playground, site, {
    recursive: true,
    filter: (path) => !path.split(/[\\/]/).some((part) => SKIP.has(part)),
  });
  const config = join(site, 'astro.config.mjs');
  const text = readFileSync(config, 'utf8');
  if (!text.includes('vesper({ search })'))
    throw new Error('astro.config.mjs no longer calls vesper({ search })');
  writeFileSync(
    config,
    text.replace('vesper({ search })', 'vesper({ search, imageService: false })'),
  );
  before = hashes(join(site, 'src'));
  build = spawnSync(
    process.execPath,
    [
      '--conditions=@vesper/source',
      join(repo, 'node_modules/astro/bin/astro.mjs'),
      'build',
      '--root',
      site,
    ],
    { cwd: repo, encoding: 'utf8', env: siteEnv() },
  );
}, 300_000);

afterAll(() => {
  rmSync(site, { recursive: true, force: true });
});

const harbor = join(site, 'src/assets/blog/harbor-at-dawn.jpg');

/** The attributes of the /images/ page's <img> for one post and ratio. */
function imageAttributes(html: string, post: string, ratio: string): Record<string, string> {
  const tag = [...html.matchAll(/<img [^>]*>/g)]
    .map((match) => match[0])
    .find((text) => text.includes(`data-post="${post}"`) && text.includes(`data-ratio="${ratio}"`));
  if (!tag) throw new Error(`no ${ratio} image for ${post}`);
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1] ?? '', match[2] ?? '']),
  );
}

async function difference(a: Buffer, b: Buffer): Promise<number> {
  const left = await sharp(a).removeAlpha().raw().toBuffer();
  const right = await sharp(b).removeAlpha().raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < left.length; i++) sum += Math.abs((left[i] ?? 0) - (right[i] ?? 0));
  return sum / left.length;
}

describe('the crop step turned off', () => {
  it('still builds, with Astro’s own Sharp service', () => {
    expect(build.status, build.stderr + build.stdout).toBe(0);
    expect(build.stdout).not.toContain('cut by Vesper’s step');
  });

  it.each([
    // Sharp's own anchors for each crop: the nearest edge to the focal point,
    // or to the manual square crop's centre.
    ['wide', 16 / 9, 'top'],
    ['square', 1, 'right'],
    ['portrait', 4 / 5, 'right'],
    ['og', 1.91, 'top'],
  ] as const)(
    'crops %s with Astro’s server crop, keeping the focal point as object-position',
    async (name, ratio, anchor) => {
      const html = readFileSync(join(site, 'dist/images/index.html'), 'utf8');
      const attributes = imageAttributes(html, 'harbor-at-dawn', name);
      const height = Math.round(320 / ratio);
      expect(attributes).toMatchObject({ width: '320', height: String(height) });
      expect(attributes.style).toMatch(/^object-position: [\d.]+% [\d.]+%$/);
      expect(attributes).not.toHaveProperty('crop');
      const file = readFileSync(join(site, 'dist', attributes.src ?? ''));
      expect(await sharp(file).metadata()).toMatchObject({ width: 320, height });
      // Exactly what Sharp makes on its own for that size and anchor.
      const reference = await sharp(readFileSync(harbor))
        .resize(320, height, { fit: 'cover', position: anchor })
        .png()
        .toBuffer();
      expect(await difference(file, reference)).toBeLessThan(2);
    },
  );

  it('ignores the manual crop, which only the crop step can cut', async () => {
    const html = readFileSync(join(site, 'dist/images/index.html'), 'utf8');
    const file = readFileSync(
      join(site, 'dist', imageAttributes(html, 'harbor-at-dawn', 'square').src ?? ''),
    );
    const manual = await sharp(readFileSync(harbor))
      .extract({ left: 960, top: 160, width: 1080, height: 1080 })
      .resize(320, 320)
      .png()
      .toBuffer();
    expect(await difference(file, manual)).toBeGreaterThan(5);
  });

  it('never changes an original file', () => {
    expect(hashes(join(site, 'src'))).toEqual(before);
  });
});

describe('the crop step on', () => {
  let on: SpawnSyncReturns<string>;

  beforeAll(() => {
    const config = join(site, 'astro.config.mjs');
    writeFileSync(
      config,
      readFileSync(config, 'utf8').replace(
        'vesper({ search, imageService: false })',
        'vesper({ search })',
      ),
    );
    rmSync(join(site, 'dist'), { recursive: true, force: true });
    on = spawnSync(
      process.execPath,
      [
        '--conditions=@vesper/source',
        join(repo, 'node_modules/astro/bin/astro.mjs'),
        'build',
        '--root',
        site,
      ],
      { cwd: repo, encoding: 'utf8', env: siteEnv() },
    );
  }, 300_000);

  it('says so in the build log, cuts the manual crop, and still never changes an original', async () => {
    expect(on.status, on.stderr + on.stdout).toBe(0);
    expect(on.stdout).toContain('cut by Vesper’s step inside Astro’s Sharp image service');
    const html = readFileSync(join(site, 'dist/images/index.html'), 'utf8');
    const file = readFileSync(
      join(site, 'dist', imageAttributes(html, 'harbor-at-dawn', 'square').src ?? ''),
    );
    const manual = await sharp(readFileSync(harbor))
      .extract({ left: 960, top: 160, width: 1080, height: 1080 })
      .resize(320, 320)
      .png()
      .toBuffer();
    expect(await difference(file, manual)).toBeLessThan(2);
    expect(hashes(join(site, 'src'))).toEqual(before);
  });
});
