import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DeployInitError, type DeployInitOptions, planDeploy } from './deploy-init.ts';
import type { AstroSettings } from './load-site.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository with the given files ('' makes an empty file; a trailing / a folder). */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-deploy-'));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    if (path.endsWith('/')) mkdirSync(join(dir, path), { recursive: true });
    else {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
  }
  return dir;
}

const settings = (value: AstroSettings) => (): Promise<AstroSettings> => Promise.resolve(value);

const plan = (root: string, options: Partial<DeployInitOptions>, astro: AstroSettings = {}) =>
  planDeploy(
    { root, target: 'sftp', command: 'vesper deploy init', branch: 'main', ...options },
    settings(astro),
  );

type Workflow = {
  on: { push?: { branches: string[] } };
  env?: { VESPER_SITE_URL: string };
  jobs: Record<
    string,
    {
      steps: {
        name?: string;
        run?: string;
        with?: object;
        env?: Record<string, string>;
        'working-directory'?: string;
      }[];
    }
  >;
};
const steps = (contents: string) => (parse(contents) as Workflow).jobs.deploy?.steps ?? [];
const named = (contents: string, name: string) => steps(contents).find((s) => s.name === name);

describe('planDeploy', () => {
  it('writes into the repository’s own workflows from a site in a subfolder', async () => {
    const root = repo({
      '.git/': '',
      'package-lock.json': '{}',
      '.nvmrc': '24\n',
      'apps/web/astro.config.mjs': '',
    });
    const result = await plan(
      join(root, 'apps', 'web'),
      { rebuildEvery: 15 },
      { site: 'https://example.com', base: '/blog' },
    );
    expect(result.file).toBe(join(root, '.github', 'workflows', 'vesper-deploy.yml'));
    const workflow = parse(result.contents) as Workflow;
    expect(workflow.env?.VESPER_SITE_URL).toBe('https://example.com/blog/');
    expect(steps(result.contents)[1]?.with).toEqual({
      'node-version-file': '.nvmrc',
      cache: 'npm',
    });
    expect(named(result.contents, 'Install')).toEqual({ name: 'Install', run: 'npm ci' });
    expect(named(result.contents, 'Build')?.['working-directory']).toBe('apps/web');
    expect(named(result.contents, 'Upload by SFTP')?.env?.OUT_DIR).toBe('dist/');
    expect(result.next).toContain(
      'It builds the site on every push to main and uploads apps/web/dist/ by SFTP. Every 15 minutes it reads https://example.com/blog/_vesper/schedule.json and rebuilds when a scheduled change is due.',
    );
    expect(result.next).toContain('  VESPER_SFTP_KNOWN_HOSTS  the server’s host keys');
    expect(result.next).toContain('Files in that folder that the build doesn’t have are deleted');
    expect(result.next).toMatch(/\n {2}rebuildEvery: 15,$/);
  });

  it('follows the package manager whose lockfile is nearest the site', async () => {
    const pnpm = repo({ '.git/': '', 'site/pnpm-lock.yaml': '', 'package-lock.json': '{}' });
    const pnpmPlan = await plan(join(pnpm, 'site'), {});
    expect(named(pnpmPlan.contents, 'Install')).toEqual({
      name: 'Install',
      'working-directory': 'site',
      run: 'pnpm install --frozen-lockfile',
    });
    expect(steps(pnpmPlan.contents)[1]?.with).toEqual({ 'node-version': '24' });

    const berry = repo({ '.git/': '', 'yarn.lock': '', '.yarnrc.yml': '' });
    expect(named((await plan(berry, {})).contents, 'Install')?.run).toBe(
      'yarn install --immutable',
    );
    const classic = repo({ '.git/': '', 'yarn.lock': '' });
    expect(named((await plan(classic, {})).contents, 'Install')?.run).toBe(
      'yarn install --frozen-lockfile',
    );
  });

  it('uploads Astro’s own output folder', async () => {
    const root = repo({ '.git/': '', 'package-lock.json': '{}' });
    const built = await plan(root, {}, { outDir: './build' });
    expect(named(built.contents, 'Upload by SFTP')?.env?.OUT_DIR).toBe('build/');
    await expect(plan(root, {}, { outDir: '../elsewhere' })).rejects.toThrow(
      /outside the site’s folder/,
    );
  });

  it('checks every hour for a build hook, unless told otherwise', async () => {
    const root = repo({ '.git/': '', 'package-lock.json': '{}' });
    const hook = await plan(root, { target: 'hook', url: 'https://example.com' });
    expect(hook.contents).toContain("- cron: '7 * * * *'");
    expect(hook.next).toContain(
      'Every hour it reads https://example.com/_vesper/schedule.json and, when a scheduled change is due, asks the host to build the site through its build hook.',
    );
    expect(hook.next).not.toContain('deleted');
    const daily = await plan(root, {
      target: 'hook',
      url: 'https://example.com/',
      rebuildEvery: 1440,
    });
    expect(daily.contents).toContain("- cron: '7 0 * * *'");
  });

  it('deploys to Cloudflare Workers, saying what the site still needs', async () => {
    const ready = repo({
      '.git/': '',
      'package-lock.json': '{}',
      'package.json': JSON.stringify({ devDependencies: { wrangler: '^4.0.0' } }),
      'wrangler.jsonc': '{}',
    });
    const workers = await plan(ready, { target: 'workers' });
    expect(named(workers.contents, 'Deploy with Wrangler')?.run).toContain('npx wrangler deploy');
    expect(workers.contents).not.toContain('schedule:');
    expect(workers.next).toContain(
      'It builds the site on every push to main and deploys it to Cloudflare Workers with wrangler. It also runs',
    );
    expect(workers.next).toContain('  CLOUDFLARE_API_TOKEN   a Cloudflare API token');
    expect(workers.next).toContain(
      'wrangler deploy reads wrangler.jsonc, whose assets.directory should be ./dist, where Astro builds.',
    );
    expect(workers.next).toContain(
      "add `redirects: { native: ['cloudflare'] }` to vesper.config.ts",
    );
    expect(workers.next).toContain('use --target hook instead');
    expect(workers.next).not.toContain('dependencies');
    expect(workers.next).not.toContain('deleted');

    // A site in a subfolder, with neither a Wrangler config nor wrangler yet.
    const bare = repo({ '.git/': '', 'pnpm-lock.yaml': '', 'apps/web/package.json': '{}' });
    const fresh = await plan(
      join(bare, 'apps', 'web'),
      { target: 'workers' },
      { outDir: './build' },
    );
    expect(named(fresh.contents, 'Deploy with Wrangler')).toMatchObject({
      'working-directory': 'apps/web',
    });
    expect(fresh.next).toContain(
      'There’s no Wrangler config yet. Add a wrangler.jsonc beside astro.config, with assets.directory set to ./build, where Astro builds.',
    );
    expect(fresh.next).toContain(
      'wrangler isn’t among the site’s dependencies. Add it in the site’s folder, so each deploy runs the version in the lockfile: pnpm add --save-dev wrangler',
    );

    // Found as wrangler finds them: a config and a dependency further up count.
    const monorepo = repo({
      '.git/': '',
      'package-lock.json': '{}',
      'package.json': JSON.stringify({ dependencies: { wrangler: '4.154.0' } }),
      'wrangler.toml': '',
      'apps/web/package.json': '{}',
    });
    const above = await plan(join(monorepo, 'apps', 'web'), { target: 'workers' });
    expect(above.next).toContain(
      'wrangler deploy reads wrangler.toml, whose assets.directory should be ./apps/web/dist,',
    );
    expect(above.next).not.toContain('dependencies');
  });

  it('says what it needs, in words', async () => {
    const root = repo({ '.git/': '', 'package-lock.json': '{}' });
    const cases: [Partial<DeployInitOptions>, AstroSettings, RegExp][] = [
      [{ rebuildEvery: 45 }, {}, /--rebuild-every takes 5, 6, 10/],
      [{ rebuildEvery: 60 }, {}, /Set `site` in astro.config, or pass --url/],
      [{ rebuildEvery: 60, url: 'example.com' }, {}, /example.com isn’t a web address/],
      [{ rebuildEvery: 60, url: 'ftp://example.com' }, {}, /isn’t a web address/],
    ];
    for (const [options, astro, message] of cases) {
      const attempt = plan(root, options, astro);
      await expect(attempt).rejects.toThrow(DeployInitError);
      await expect(attempt).rejects.toThrow(message);
    }

    const loose = repo({ 'package-lock.json': '{}' });
    await expect(plan(loose, {})).rejects.toThrow(/must be in a git repository/);
    const unlocked = repo({ '.git/': '' });
    await expect(plan(unlocked, {})).rejects.toThrow(/commit the lockfile/);
    const bun = repo({ '.git/': '', 'bun.lock': '' });
    await expect(plan(bun, {})).rejects.toThrow(/uses Bun/);
  });

  it('notes an astro.config it couldn’t read', async () => {
    const root = repo({ '.git/': '', 'package-lock.json': '{}' });
    const result = await plan(root, {}, { problem: 'astro:env isn’t available' });
    expect(result.next).toContain(
      'astro.config couldn’t be read on its own (astro:env isn’t available), so the workflow assumes Astro’s defaults',
    );
  });

  it('takes the default branch from git', async () => {
    const root = repo({ 'package-lock.json': '{}' });
    const init = spawnSync('git', ['init', '--quiet', '--initial-branch', 'trunk', root]);
    if (init.status !== 0) return; // git older than 2.28 can't name the first branch
    const result = await planDeploy(
      { root, target: 'ftp', command: 'vesper deploy init' },
      settings({}),
    );
    expect((parse(result.contents) as Workflow).on.push).toEqual({ branches: ['trunk'] });
  });
});

describe('vesper deploy init', () => {
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const cli = join(repoRoot, 'packages', 'astro', 'src', 'node', 'cli.ts');
  const vesper = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, ['--conditions=@vesper/source', cli, 'deploy', 'init', ...args], {
      cwd,
      encoding: 'utf8',
    });

  it('writes the workflow once, and replaces it only when asked', () => {
    const root = repo({ '.git/': '', 'package-lock.json': '{}' });
    const file = join(root, '.github', 'workflows', 'vesper-deploy.yml');

    const first = vesper(
      root,
      '--target',
      'hook',
      '--url',
      'https://example.com',
      '--branch',
      'main',
    );
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain(`Wrote ${join('.github', 'workflows', 'vesper-deploy.yml')}.`);
    expect(first.stdout).toContain('VESPER_BUILD_HOOK');
    expect(first.stdout).toContain('rebuildEvery: 60,');
    const written = readFileSync(file, 'utf8');
    expect(written.split('\n')[0]).toBe(
      '# Written by `vesper deploy init --target hook --url https://example.com --branch main`.',
    );

    const again = vesper(root, '--target', 'sftp', '--branch', 'main');
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('is already there. Pass --force to replace it.');
    expect(readFileSync(file, 'utf8')).toBe(written);

    const forced = vesper(root, '--target', 'sftp', '--branch', 'main', '--force');
    expect(forced.status, forced.stderr).toBe(0);
    expect(readFileSync(file, 'utf8')).toContain('name: Vesper deploy');
  }, 30_000);

  it('asks for a target, and whole minutes', () => {
    const root = repo({ '.git/': '', 'package-lock.json': '{}' });
    const none = vesper(root);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('Choose where the site goes with --target');
    const unknown = vesper(root, '--target', 'pages');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('workers for Cloudflare Workers, deployed with wrangler');
    const odd = vesper(root, '--target', 'hook', '--rebuild-every', 'hourly');
    expect(odd.status).toBe(1);
    expect(odd.stderr).toContain('--rebuild-every takes whole minutes, not hourly.');
    expect(existsSync(join(root, '.github'))).toBe(false);
  }, 30_000);
});
