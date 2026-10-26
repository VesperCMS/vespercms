import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  type DeployTarget,
  deployWorkflow,
  everyText,
  type PackageManager,
  REBUILD_INTERVALS,
  secretsFor,
  WORKFLOW_PATH,
} from './deploy.ts';
import { type AstroSettings, loadAstroSettings } from './load-site.ts';

/*
 * What `vesper deploy init` learns from the site's repository before it
 * writes a workflow: where the repository's root is, which branch is its
 * default, which package manager and Node it uses, and where the live site
 * and its build are. Anything it can't learn, it asks for in words.
 */

export type DeployInitOptions = {
  /** The site's folder, where astro.config is. */
  root: string;
  target: DeployTarget;
  /** Minutes between scheduled checks. The `hook` target defaults to an hour. */
  rebuildEvery?: number;
  /** The live site's address, when astro.config's `site` isn't it. */
  url?: string;
  /** The default branch, when git can't say. */
  branch?: string;
  /** The command line, for the workflow's first line. */
  command: string;
};

export type DeployPlan = {
  /** The workflow's absolute path. */
  file: string;
  contents: string;
  /** What to tell the developer once it's written: what it does, the secrets, the config line. */
  next: string;
};

/** A problem the developer can fix, said in words; the CLI prints only the message. */
export class DeployInitError extends Error {}

const LOCKFILES: [string, PackageManager | 'bun'][] = [
  ['package-lock.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

export async function planDeploy(
  options: DeployInitOptions,
  load: (root: string) => Promise<AstroSettings> = loadAstroSettings,
): Promise<DeployPlan> {
  const siteRoot = resolve(options.root);
  const repoRoot = findUp(siteRoot, (dir) => existsSync(join(dir, '.git')));
  if (!repoRoot) {
    throw new DeployInitError(
      'vesper deploy init writes a GitHub Actions workflow, so the site must be in a git repository. Run `git init` first.',
    );
  }
  const fromRepo = (path: string) => toPosix(relative(repoRoot, path)) || '.';

  const rebuildEvery = options.rebuildEvery ?? (options.target === 'hook' ? 60 : undefined);
  if (rebuildEvery !== undefined && !REBUILD_INTERVALS.includes(rebuildEvery)) {
    throw new DeployInitError(
      `--rebuild-every takes ${REBUILD_INTERVALS.join(', ')} (minutes), which a schedule can keep exactly, not ${String(rebuildEvery)}.`,
    );
  }

  const settings = await load(siteRoot);
  const siteUrl = rebuildEvery === undefined ? undefined : liveAddress(options.url, settings);

  const lock = findLockfile(siteRoot, repoRoot);
  const nodeVersionFile = findUp(
    siteRoot,
    (dir) => existsSync(join(dir, '.nvmrc')) || existsSync(join(dir, '.node-version')),
    repoRoot,
  );
  const outDir = outFolder(siteRoot, settings.outDir);
  const branch = options.branch ?? defaultBranch(repoRoot);

  const contents = deployWorkflow({
    target: options.target,
    command: options.command,
    branch,
    ...(rebuildEvery !== undefined ? { rebuildEvery } : {}),
    ...(siteUrl ? { siteUrl } : {}),
    siteDir: fromRepo(siteRoot),
    installDir: fromRepo(dirname(lock.path)),
    lockfile: fromRepo(lock.path),
    packageManager: lock.manager,
    ...(nodeVersionFile
      ? {
          nodeVersionFile: fromRepo(
            join(
              nodeVersionFile,
              existsSync(join(nodeVersionFile, '.nvmrc')) ? '.nvmrc' : '.node-version',
            ),
          ),
        }
      : {}),
    outDir,
  });

  const every = rebuildEvery === undefined ? '' : capitalize(everyText(rebuildEvery));
  const what =
    options.target === 'hook'
      ? [
          every
            ? `${every} it reads ${siteUrl ?? ''}_vesper/schedule.json and, when a scheduled change is due, asks the host to build the site through its build hook.`
            : 'It asks the host to build the site through its build hook.',
        ]
      : [
          `It builds the site on every push to ${branch} and uploads ${fromRepo(join(siteRoot, outDir))}/ by ${options.target.toUpperCase()}.`,
          ...(every
            ? [
                `${every} it reads ${siteUrl ?? ''}_vesper/schedule.json and rebuilds when a scheduled change is due.`,
              ]
            : []),
        ];
  const secrets = secretsFor(options.target);
  const width = Math.max(...secrets.map((secret) => secret.name.length));
  const next = [
    [...what, 'It also runs when the Vesper cloud asks, and from the Actions tab.'].join(' '),
    '',
    'Add these repository secrets (Settings > Secrets and variables > Actions):',
    ...secrets.map((secret) => `  ${secret.name.padEnd(width)}  ${secret.what}`),
    ...(options.target === 'hook'
      ? []
      : [
          '',
          'Files in that folder that the build doesn’t have are deleted, so it should hold only this site.',
        ]),
    ...(rebuildEvery === undefined
      ? []
      : [
          '',
          'Then add this to vesper.config.ts, so the studio can say how soon a scheduled change goes live:',
          `  rebuildEvery: ${String(rebuildEvery)},`,
        ]),
    ...(settings.problem
      ? [
          '',
          `astro.config couldn’t be read on its own (${settings.problem}), so the workflow assumes Astro’s defaults: check its output folder.`,
        ]
      : []),
  ].join('\n');

  return { file: join(repoRoot, ...WORKFLOW_PATH.split('/')), contents, next };
}

/** The live site's address, ending in `/`: `--url`, or astro.config's `site` and `base`. */
function liveAddress(url: string | undefined, settings: AstroSettings): string {
  const given = url ?? (settings.site ? withBase(settings.site, settings.base) : undefined);
  if (!given) {
    throw new DeployInitError(
      'A scheduled rebuild reads the live site’s _vesper/schedule.json, so it needs the site’s address. Set `site` in astro.config, or pass --url.',
    );
  }
  let address: URL;
  try {
    address = new URL(given);
  } catch {
    throw new DeployInitError(
      `${given} isn’t a web address. Pass the live site’s, such as https://example.com/.`,
    );
  }
  if (address.protocol !== 'https:' && address.protocol !== 'http:') {
    throw new DeployInitError(
      `${given} isn’t a web address. Pass the live site’s, such as https://example.com/.`,
    );
  }
  address.search = '';
  address.hash = '';
  return address.href.endsWith('/') ? address.href : `${address.href}/`;
}

function withBase(site: string, base: string | undefined): string {
  if (!base || base === '/') return site;
  return new URL(
    base.replace(/^\/*/, '').replace(/\/*$/, '/'),
    site.endsWith('/') ? site : `${site}/`,
  ).href;
}

/** The build's folder from the site's, ending in `/`. Astro's default is `./dist/`. */
function outFolder(siteRoot: string, outDir: string | undefined): string {
  const absolute = outDir
    ? isAbsolute(outDir)
      ? outDir
      : resolve(siteRoot, outDir)
    : join(siteRoot, 'dist');
  const path = toPosix(relative(siteRoot, absolute));
  if (!path || path.startsWith('..')) {
    throw new DeployInitError(
      `Astro’s outDir (${outDir ?? ''}) is outside the site’s folder, so the workflow can’t upload it. Edit the workflow’s OUT_DIR by hand.`,
    );
  }
  return `${path}/`;
}

function findLockfile(
  siteRoot: string,
  repoRoot: string,
): { path: string; manager: PackageManager } {
  let found: { path: string; manager: PackageManager | 'bun' } | undefined;
  findUp(
    siteRoot,
    (dir) => {
      const hit = LOCKFILES.find(([name]) => existsSync(join(dir, name)));
      if (hit) found = { path: join(dir, hit[0]), manager: hit[1] };
      return hit !== undefined;
    },
    repoRoot,
  );
  if (!found) {
    throw new DeployInitError(
      'The workflow installs exactly what the lockfile lists, and there’s none between the site and the repository’s root. Run `npm install` (or your package manager’s) and commit the lockfile.',
    );
  }
  if (found.manager === 'bun') {
    throw new DeployInitError(
      'vesper deploy init writes workflows for npm, pnpm and Yarn, and this site uses Bun, which it doesn’t know yet.',
    );
  }
  if (found.manager === 'yarn' && !existsSync(join(dirname(found.path), '.yarnrc.yml'))) {
    return { path: found.path, manager: 'yarn-classic' };
  }
  return { path: found.path, manager: found.manager };
}

/** The repository's default branch: origin's, then the one checked out, then `main`. */
function defaultBranch(repoRoot: string): string {
  const git = (...args: string[]) => {
    try {
      return execFileSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  const origin = git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
  if (origin.startsWith('origin/')) return origin.slice('origin/'.length);
  return git('branch', '--show-current') || 'main';
}

/** The first folder from `start` up to `stop` (or the file system's root) where `test` holds. */
function findUp(start: string, test: (dir: string) => boolean, stop?: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    if (test(dir)) return dir;
    if (dir === stop || dirname(dir) === dir) return undefined;
  }
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
