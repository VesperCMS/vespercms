import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { A11yReport } from '../src/integration/a11y.ts';

/*
 * Phase 2.8's build criteria (spec §11): the layer-2 report maps issues to
 * entries, and no report file appears in dist/.
 *
 * A copy of the playground gains one page that no entry produces, with an
 * image that has no alt text. It's built as is, then again with
 * `failBuildOn: 'error'`, which must fail the build after writing the report.
 */

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const playground = join(repo, 'apps', 'playground');
const site = join(repo, 'e2e', '.a11y-site');
const SKIP = new Set(['node_modules', 'dist', '.astro', '.vesper']);

/** The environment a site builds in, without Vitest's variables (DECISIONS.md). */
function siteEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(VITEST.*|NODE_ENV|DEV|PROD|MODE|SSR|BASE_URL|TEST)$/.test(key),
    ),
  );
}

function astroBuild(): SpawnSyncReturns<string> {
  return spawnSync(
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
}

const readReport = () =>
  JSON.parse(readFileSync(join(site, '.vesper/a11y-report.json'), 'utf8')) as A11yReport;

let build: SpawnSyncReturns<string>;
let report: A11yReport;
let distFiles: string[];
let failing: SpawnSyncReturns<string>;
let failingReport: A11yReport;

beforeAll(() => {
  rmSync(site, { recursive: true, force: true });
  cpSync(playground, site, {
    recursive: true,
    filter: (path) => !path.split(/[\\/]/).some((part) => SKIP.has(part)),
  });
  writeFileSync(
    join(site, 'src/pages/flawed.astro'),
    '---\n---\n<html lang="en"><head><title>Flawed</title></head><body><main><h1>Flawed</h1><img src="/favicon.svg"></main></body></html>\n',
  );
  build = astroBuild();
  report = readReport();
  distFiles = readdirSync(join(site, 'dist'), { recursive: true, encoding: 'utf8' }).map((f) =>
    f.split('\\').join('/'),
  );

  const config = join(site, 'astro.config.mjs');
  const text = readFileSync(config, 'utf8');
  if (!text.includes('vesper({ search })'))
    throw new Error('astro.config.mjs no longer calls vesper({ search })');
  writeFileSync(
    config,
    text.replace('vesper({ search })', "vesper({ search, a11y: { failBuildOn: 'error' } })"),
  );
  rmSync(join(site, '.vesper'), { recursive: true, force: true });
  failing = astroBuild();
  failingReport = readReport();
}, 400_000);

afterAll(() => {
  rmSync(site, { recursive: true, force: true });
});

describe('accessibility checks at build', () => {
  it('builds, and says what it checked', () => {
    expect(build.status, build.stderr).toBe(0);
    expect(build.stdout).toMatch(
      /Accessibility: checked \d+ pages, 4 issues on 2 pages \(2 errors\)\. Report: \.vesper\/a11y-report\.json/,
    );
    expect(report.checked.engine).toMatch(/^axe-core 4\.\d+\.\d+ in jsdom \d+/);
    // Astro's redirect pages (the playground has three) and the studio's shell.
    expect(report.checked.skipped).toEqual({ redirects: 3, studio: 1 });
    expect(report.checked.rules).not.toContain('color-contrast');
  });

  it('maps each page’s issues to the entry that produced it', () => {
    expect(report.pages.map((p) => [p.url, p.entry])).toEqual([
      [
        '/fixtures/accessibility-mistakes/',
        {
          collection: 'fixtures',
          id: 'accessibility-mistakes',
          file: 'src/content/fixtures/accessibility-mistakes.mdoc',
          studio: '/admin/#/c/fixtures/e/accessibility-mistakes',
        },
      ],
      // A page in src/pages that no entry produces.
      ['/flawed/', null],
    ]);
    const [fixture, flawed] = report.pages;
    expect(fixture?.issues.map((i) => [i.rule, i.level, i.message])).toEqual([
      ['empty-heading', 'warning', 'A heading is empty.'],
      ['heading-order', 'warning', 'A heading skips a level.'],
      ['image-alt', 'error', 'Describe this image, or mark it decorative.'],
    ]);
    expect(fixture?.issues.find((i) => i.rule === 'image-alt')).toMatchObject({
      html: '<img src="/favicon.svg">',
      help: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
    });
    expect(flawed?.issues.map((i) => i.rule)).toEqual(['image-alt']);
    expect(report.summary).toEqual({ errors: 2, warnings: 2, pages: 2 });
  });

  it('never puts a report into dist/', () => {
    expect(distFiles.filter((f) => /a11y|\.vesper/i.test(f))).toEqual([]);
    expect(existsSync(join(site, 'dist', '.vesper'))).toBe(false);
    expect(readFileSync(join(site, '.vesper/.gitignore'), 'utf8')).toMatch(/^\*$/m);
  });

  it('fails the build with failBuildOn, after writing the report', () => {
    expect(failing.status).not.toBe(0);
    expect(`${failing.stdout}${failing.stderr}`).toContain(
      "Accessibility: 2 errors at build, and vesper({ a11y: { failBuildOn: 'error' } }) fails the build on them. See .vesper/a11y-report.json.",
    );
    expect(failingReport.summary.errors).toBe(2);
  });
});
