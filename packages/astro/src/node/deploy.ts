/*
 * The workflows `vesper deploy init` writes (spec §6.16, §6.17). Each is
 * plain YAML the site owner keeps, reads and changes, run in their own
 * GitHub account with their own secrets: Vesper never deploys a site itself.
 * The text is built here, with no file system, so it's deterministic and
 * tested as it ships.
 */

export type DeployTarget = 'sftp' | 'ftp' | 'workers' | 'hook';

export const DEPLOY_TARGETS: readonly DeployTarget[] = ['sftp', 'ftp', 'workers', 'hook'];

/** `yarn` is Yarn 2 and later (a `.yarnrc.yml`), `yarn-classic` is Yarn 1. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'yarn-classic';

/** The workflow file, from the repository root. */
export const WORKFLOW_PATH = '.github/workflows/vesper-deploy.yml';

/** The `repository_dispatch` type the cloud sends at a scheduled time. */
export const DISPATCH_TYPE = 'vesper-rebuild';

/**
 * The intervals a schedule can keep exactly: cron's minute field divides an
 * hour, and its hour field a day. Five minutes is GitHub Actions' shortest.
 */
export const REBUILD_INTERVALS: readonly number[] = [
  5, 6, 10, 12, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720, 1440,
];

/** Where the generated workflows' actions come from, as this repository's CI pins them. */
const CHECKOUT = 'actions/checkout@v7';
const SETUP_NODE = 'actions/setup-node@v7';
const DEFAULT_NODE = '24';

export type WorkflowOptions = {
  target: DeployTarget;
  /** The command that wrote it, for the file's first line. */
  command: string;
  /** The default branch: pushes to it deploy, and scheduled runs read it. */
  branch: string;
  /** Minutes between scheduled checks, one of REBUILD_INTERVALS; absent for none. */
  rebuildEvery?: number;
  /** The live site's address, ending in `/`, where `_vesper/schedule.json` is read. */
  siteUrl?: string;
  /** The site's folder from the repository root; `.` at the root. */
  siteDir: string;
  /** The folder holding the lockfile, from the repository root. */
  installDir: string;
  /** The lockfile, from the repository root. */
  lockfile: string;
  packageManager: PackageManager;
  /** `.nvmrc` or `.node-version`, from the repository root. */
  nodeVersionFile?: string;
  /** Astro's `outDir` from the site's folder, ending in `/`. */
  outDir: string;
};

/**
 * The schedule for a check every `minutes`. Runs start a few minutes past
 * the hour: GitHub delays scheduled runs at the start of every hour, and
 * drops some under load.
 */
export function cronFor(minutes: number): string {
  if (!REBUILD_INTERVALS.includes(minutes)) {
    throw new Error(
      `A scheduled rebuild runs every ${REBUILD_INTERVALS.join(', ')} minutes, which a schedule can keep exactly, not every ${String(minutes)}.`,
    );
  }
  if (minutes < 60) return `${String(7 % minutes)}-59/${String(minutes)} * * * *`;
  const hours = minutes / 60;
  if (hours === 24) return '7 0 * * *';
  return hours === 1 ? '7 * * * *' : `7 */${String(hours)} * * *`;
}

/** "every hour", as the studio's Schedule dialog says it. */
export function everyText(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? 'every hour' : `every ${String(hours)} hours`;
  }
  return `every ${String(minutes)} minutes`;
}

/**
 * The scheduled run's first step, run by the runner's own Node with nothing
 * installed. It reads the live site's `_vesper/schedule.json` and rebuilds
 * only once the next change is due (DECISIONS.md, "A free site rebuilds on a
 * schedule only when something is due"). When the file can't be read, the run
 * fails without building, naming the address it tried: rebuilding instead
 * would spend a free plan's month of deploys on a wrong address in a day
 * (DECISIONS.md, "A scheduled run that can't read `schedule.json` fails").
 * The query defeats caches in front of the site. Plain JavaScript, and never
 * `${{`, which Actions would expand.
 */
export const DUE_SCRIPT = `import { appendFileSync } from 'node:fs';

const url = new URL('_vesper/schedule.json', process.env.VESPER_SITE_URL);
const address = url.href;
url.searchParams.set('at', String(Date.now()));
// Actions reads a workflow command's message with these three escaped.
const command = (text) => text.replace(/%/g, '%25').replace(/\\r/g, '%0D').replace(/\\n/g, '%0A');
let due;
let reason;
try {
  const response = await fetch(url, {
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(\`it answered \${response.status}\`);
  const schedule = await response.json().catch(() => null);
  const next = schedule && schedule.version === 1 ? schedule.next : undefined;
  if (next === null) {
    due = false;
    reason = 'Nothing is scheduled.';
  } else if (typeof next === 'string' && !Number.isNaN(Date.parse(next))) {
    due = Date.parse(next) <= Date.now();
    reason = due ? \`A change was due at \${next}.\` : \`Nothing is due until \${next}.\`;
  } else {
    throw new Error('it is not a schedule this workflow knows');
  }
} catch (error) {
  const why = error instanceof Error ? error.message : String(error);
  reason = \`::error::\${command(
    \`\${address} could not be read (\${why}), so nothing was built. Check VESPER_SITE_URL in this workflow, and that the live site was built with Vesper. The next scheduled run tries again.\`,
  )}\`;
  process.exitCode = 1;
}
console.log(reason);
// Without an output, the deploy skips a scheduled run.
if (due !== undefined) appendFileSync(process.env.GITHUB_OUTPUT, \`due=\${due}\\n\`);
`;

/** The repository secrets each target reads, with what goes in them, for `deploy init` to list. */
export function secretsFor(target: DeployTarget): { name: string; what: string }[] {
  if (target === 'hook') {
    return [
      {
        name: 'VESPER_BUILD_HOOK',
        what: 'the host’s build hook URL (Netlify: build hooks; Cloudflare Pages and Workers Builds: deploy hooks; Vercel: deploy hooks)',
      },
    ];
  }
  if (target === 'workers') {
    return [
      {
        name: 'CLOUDFLARE_API_TOKEN',
        what: 'a Cloudflare API token from the “Edit Cloudflare Workers” template',
      },
      {
        name: 'CLOUDFLARE_ACCOUNT_ID',
        what: 'optional; the account’s ID, needed when the Wrangler config has no account_id and the token reaches more than one account',
      },
    ];
  }
  const prefix = target === 'sftp' ? 'VESPER_SFTP' : 'VESPER_FTP';
  const port = target === 'sftp' ? '22' : '21';
  return [
    { name: `${prefix}_HOST`, what: 'the server, such as ftp.example.com' },
    { name: `${prefix}_PORT`, what: `optional; ${port} when it isn’t set` },
    { name: `${prefix}_USER`, what: 'the account’s user name' },
    target === 'sftp'
      ? { name: `${prefix}_PASSWORD`, what: 'its password, or instead VESPER_SFTP_KEY' }
      : { name: `${prefix}_PASSWORD`, what: 'its password' },
    ...(target === 'sftp'
      ? [
          {
            name: `${prefix}_KEY`,
            what: 'a private key the server accepts, instead of a password',
          },
          {
            name: `${prefix}_KNOWN_HOSTS`,
            what: 'the server’s host keys: the output of `ssh-keyscan -p 22 <server>`',
          },
        ]
      : []),
    { name: `${prefix}_PATH`, what: 'the site’s folder on the server, such as public_html' },
  ];
}

/** The workflow `vesper deploy init` writes, as text. */
export function deployWorkflow(options: WorkflowOptions): string {
  if (options.rebuildEvery !== undefined && !options.siteUrl) {
    throw new Error('A scheduled rebuild needs the live site’s address, to read its schedule.');
  }
  const scheduled = options.rebuildEvery !== undefined;
  const lines = [
    ...header(options),
    '',
    `name: ${options.target === 'hook' ? 'Vesper rebuild' : 'Vesper deploy'}`,
    '',
    'on:',
    ...(options.target === 'hook'
      ? []
      : ['  push:', `    branches: [${yamlString(options.branch)}]`]),
    ...(scheduled ? ['  schedule:', `    - cron: '${cronFor(options.rebuildEvery ?? 0)}'`] : []),
    '  repository_dispatch:',
    `    types: [${DISPATCH_TYPE}]`,
    '  workflow_dispatch:',
    '',
    ...(options.target === 'hook'
      ? []
      : [
          ...(options.target === 'workers'
            ? [
                '# One deploy at a time, so an older build never replaces a newer one.',
                '# A newer run waits for the one deploying; it never cancels it.',
              ]
            : [
                '# One deploy at a time, so two uploads never mix. A newer run waits for',
                '# the one copying files; it never cancels it.',
              ]),
          'concurrency:',
          '  group: vesper-deploy',
          '  cancel-in-progress: false',
          '',
        ]),
    'permissions:',
    '  contents: read',
    '',
    ...(scheduled ? ['env:', `  VESPER_SITE_URL: ${yamlString(options.siteUrl ?? '')}`, ''] : []),
    'jobs:',
    ...(scheduled ? [...dueJob(), ''] : []),
    ...(options.target === 'hook' ? hookJob(scheduled) : deployJob(options, scheduled)),
  ];
  return `${lines.join('\n')}\n`;
}

function header(options: WorkflowOptions): string[] {
  const how =
    options.target === 'hook'
      ? [
          'It asks the host to build the site, through its build hook. The host',
          'builds on every push already, so this runs only:',
        ]
      : [
          options.target === 'workers'
            ? 'It builds the site and deploys it to Cloudflare Workers with wrangler:'
            : `It builds the site and copies it to the server by ${options.target.toUpperCase()}:`,
          `- on every push to ${options.branch}, which includes each publish from the studio;`,
        ];
  return [
    `# Written by \`${options.command}\`.`,
    '# It’s yours to read and change: Vesper never deploys a site itself.',
    '#',
    ...how.map((line) => `# ${line}`),
    '# - when the Vesper cloud asks, at a scheduled change’s exact time;',
    '# - when someone runs it from the Actions tab;',
    ...(options.rebuildEvery !== undefined
      ? [
          `# - ${everyText(options.rebuildEvery)}, but only when a scheduled change is due. It reads`,
          `#   ${options.siteUrl ?? ''}_vesper/schedule.json first, and when it can't, that`,
          '#   run fails without building.',
        ]
      : []),
    '#',
    '# Its secrets are under Settings > Secrets and variables > Actions:',
    ...wrap(
      `${secretsFor(options.target)
        .map((secret) => secret.name)
        .join(', ')}.`,
    ).map((line) => `# ${line}`),
  ];
}

/** Words in lines of at most 76 characters, for comments. */
function wrap(text: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > 76) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return line ? [...lines, line] : lines;
}

function dueJob(): string[] {
  return [
    '  # Scheduled runs only: every other run builds.',
    '  due:',
    "    if: github.event_name == 'schedule'",
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 5',
    '    outputs:',
    '      due: ${{ steps.check.outputs.due }}',
    '    steps:',
    '      - name: Check whether a scheduled change is due',
    '        id: check',
    '        run: |',
    "          node --input-type=module <<'EOF'",
    ...indent(DUE_SCRIPT.trimEnd().split('\n'), 10),
    '          EOF',
  ];
}

/**
 * Every run builds but a scheduled one with nothing due, or whose `due` job
 * failed and so has no output; a skipped `due` job doesn't stop it.
 */
function needsDue(scheduled: boolean): string[] {
  return scheduled
    ? [
        '    needs: due',
        "    if: ${{ !cancelled() && (github.event_name != 'schedule' || needs.due.outputs.due == 'true') }}",
      ]
    : [];
}

function hookJob(scheduled: boolean): string[] {
  return [
    '  rebuild:',
    ...needsDue(scheduled),
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 5',
    '    steps:',
    '      - name: Call the build hook',
    '        env:',
    '          BUILD_HOOK: ${{ secrets.VESPER_BUILD_HOOK }}',
    '        run: |',
    '          if [ -z "$BUILD_HOOK" ]; then',
    `            echo "::error::Add the repository secret VESPER_BUILD_HOOK, the host's build hook URL."`,
    '            exit 1',
    '          fi',
    '          curl --fail-with-body --silent --show-error --retry 3 --max-time 30 \\',
    `            -X POST -H 'Content-Type: application/json' -d '{}' "$BUILD_HOOK"`,
  ];
}

function deployJob(options: WorkflowOptions, scheduled: boolean): string[] {
  const at = (dir: string) =>
    dir === '.' ? [] : [`        working-directory: ${yamlString(dir)}`];
  const cache =
    options.packageManager === 'npm'
      ? [
          '          cache: npm',
          ...(options.installDir === '.'
            ? []
            : [`          cache-dependency-path: ${yamlString(options.lockfile)}`]),
        ]
      : [];
  const node = options.nodeVersionFile
    ? `          node-version-file: ${yamlString(options.nodeVersionFile)}`
    : `          node-version: '${DEFAULT_NODE}'`;
  const run = RUN[options.packageManager];
  return [
    '  deploy:',
    ...needsDue(scheduled),
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 30',
    '    steps:',
    `      - uses: ${CHECKOUT}`,
    `      - uses: ${SETUP_NODE}`,
    '        with:',
    node,
    ...cache,
    ...(options.packageManager === 'npm'
      ? []
      : ['      - name: Turn on Corepack', '        run: corepack enable']),
    '      - name: Install',
    ...at(options.installDir),
    `        run: ${run.install}`,
    '      - name: Build',
    ...at(options.siteDir),
    `        run: ${run.build}`,
    ...(options.target === 'workers'
      ? [
          '      - name: Deploy with Wrangler',
          // From the site's folder, where wrangler looks for its config first.
          ...at(options.siteDir),
          ...wranglerDeploy(run.wrangler),
        ]
      : [
          '      - name: Install lftp',
          '        run: sudo apt-get update -qq && sudo apt-get install -y -qq lftp',
          `      - name: Upload by ${options.target.toUpperCase()}`,
          ...at(options.siteDir),
          ...(options.target === 'sftp' ? sftpUpload(options.outDir) : ftpUpload(options.outDir)),
        ]),
  ];
}

/**
 * Wrangler runs from the site's own dependencies, at the version its
 * lockfile holds, not through cloudflare/wrangler-action, which installs one
 * of its own choosing: the uploads keep third-party Actions away from a
 * host's secrets too (DECISIONS.md, "`vesper deploy init` writes SFTP, FTP
 * and build-hook workflows").
 */
const RUN: Record<PackageManager, { install: string; build: string; wrangler: string }> = {
  npm: { install: 'npm ci', build: 'npm run build', wrangler: 'npx wrangler deploy' },
  pnpm: {
    install: 'pnpm install --frozen-lockfile',
    build: 'pnpm run build',
    wrangler: 'pnpm exec wrangler deploy',
  },
  yarn: {
    install: 'yarn install --immutable',
    build: 'yarn run build',
    wrangler: 'yarn wrangler deploy',
  },
  'yarn-classic': {
    install: 'yarn install --frozen-lockfile',
    build: 'yarn run build',
    wrangler: 'yarn wrangler deploy',
  },
};

/**
 * `wrangler deploy` uploads the folder the Wrangler config's
 * `assets.directory` names. Wrangler 4 takes the account from the config's
 * `account_id`, then a non-empty CLOUDFLARE_ACCOUNT_ID, then the one account
 * the token reaches, so the secret can be left unset.
 */
function wranglerDeploy(command: string): string[] {
  return [
    '        env:',
    '          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
    '          # Optional when the Wrangler config has account_id, or the token',
    '          # reaches only one account.',
    '          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
    '        run: |',
    '          if [ -z "$CLOUDFLARE_API_TOKEN" ]; then',
    '            echo "::error::Add the repository secret CLOUDFLARE_API_TOKEN (Settings > Secrets and variables > Actions)."',
    '            exit 1',
    '          fi',
    `          ${command}`,
  ];
}

/** The shell that checks a secret is set, naming it when it isn't. */
const NEED = [
  'need() {',
  '  if [ -z "$1" ]; then',
  '    echo "::error::Add the repository secret $2 (Settings > Secrets and variables > Actions)."',
  '    exit 1',
  '  fi',
  '}',
];

/**
 * lftp's mirror: the whole build each time, deleting what the build no
 * longer has, which is what makes an expired page 404 (call 4). The
 * server's own .well-known and cgi-bin folders are left alone unless the
 * build has its own.
 */
const MIRROR = [
  'keep=""',
  'for folder in .well-known cgi-bin; do',
  '  [ -e "$OUT_DIR$folder" ] || keep="$keep --exclude-glob $folder/"',
  'done',
  "mirror=\"mirror --reverse --delete --parallel=4$keep '$OUT_DIR' '$REMOTE_PATH'\"",
];

function sftpUpload(outDir: string): string[] {
  return [
    '        env:',
    `          OUT_DIR: ${yamlString(outDir)}`,
    '          HOST: ${{ secrets.VESPER_SFTP_HOST }}',
    '          PORT: ${{ secrets.VESPER_SFTP_PORT }}',
    '          LOGIN: ${{ secrets.VESPER_SFTP_USER }}',
    '          LFTP_PASSWORD: ${{ secrets.VESPER_SFTP_PASSWORD }}',
    '          KEY: ${{ secrets.VESPER_SFTP_KEY }}',
    '          KNOWN_HOSTS: ${{ secrets.VESPER_SFTP_KNOWN_HOSTS }}',
    '          REMOTE_PATH: ${{ secrets.VESPER_SFTP_PATH }}',
    '        run: |',
    ...indent(
      [
        'set -euo pipefail',
        ...NEED,
        'need "$HOST" VESPER_SFTP_HOST',
        'need "$LOGIN" VESPER_SFTP_USER',
        'need "$REMOTE_PATH" VESPER_SFTP_PATH',
        '# The server must be the one whose keys are in VESPER_SFTP_KNOWN_HOSTS.',
        'need "$KNOWN_HOSTS" VESPER_SFTP_KNOWN_HOSTS',
        'if [ -z "$LFTP_PASSWORD$KEY" ]; then',
        '  echo "::error::Add the repository secret VESPER_SFTP_PASSWORD, or VESPER_SFTP_KEY for a private key."',
        '  exit 1',
        'fi',
        'mkdir -p ~/.ssh',
        '# A secret made on Windows can end its lines with CR LF; ssh reads LF.',
        "printf '%s\\n' \"$KNOWN_HOSTS\" | tr -d '\\r' > ~/.ssh/known_hosts",
        '# Only plain host keys, which ssh-keyscan lists: a host certificate',
        '# (Hostinger offers one first) needs an authority this file never names.',
        'ssh="ssh -a -x -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=-*-cert-v01@openssh.com"',
        'if [ -n "$KEY" ]; then',
        "  printf '%s\\n' \"$KEY\" | tr -d '\\r' > ~/.ssh/vesper_deploy",
        '  chmod 600 ~/.ssh/vesper_deploy',
        '  ssh="$ssh -i $HOME/.ssh/vesper_deploy"',
        'fi',
        ...MIRROR,
        'settings="set sftp:connect-program \'$ssh\'; set net:max-retries 2; set net:timeout 30"',
        "lftp -c \"$settings; open --env-password -u '$LOGIN' 'sftp://$HOST:${PORT:-22}'; $mirror\"",
      ],
      10,
    ),
  ];
}

function ftpUpload(outDir: string): string[] {
  return [
    '        env:',
    `          OUT_DIR: ${yamlString(outDir)}`,
    '          HOST: ${{ secrets.VESPER_FTP_HOST }}',
    '          PORT: ${{ secrets.VESPER_FTP_PORT }}',
    '          LOGIN: ${{ secrets.VESPER_FTP_USER }}',
    '          LFTP_PASSWORD: ${{ secrets.VESPER_FTP_PASSWORD }}',
    '          REMOTE_PATH: ${{ secrets.VESPER_FTP_PATH }}',
    '        run: |',
    ...indent(
      [
        'set -euo pipefail',
        ...NEED,
        'need "$HOST" VESPER_FTP_HOST',
        'need "$LOGIN" VESPER_FTP_USER',
        'need "$LFTP_PASSWORD" VESPER_FTP_PASSWORD',
        'need "$REMOTE_PATH" VESPER_FTP_PATH',
        ...MIRROR,
        '# Without TLS, FTP sends the password as plain text, so this insists on',
        '# it (FTPS). For a host with no TLS at all, set ftp:ssl-force false; for',
        '# a certificate made out to another name, set ssl:verify-certificate false.',
        'settings="set ftp:ssl-force true; set ftp:ssl-protect-data true; set net:max-retries 2; set net:timeout 30"',
        "lftp -c \"$settings; open --env-password -u '$LOGIN' 'ftp://$HOST:${PORT:-21}'; $mirror\"",
      ],
      10,
    ),
  ];
}

function indent(lines: string[], spaces: number): string[] {
  const pad = ' '.repeat(spaces);
  return lines.map((line) => (line === '' ? '' : `${pad}${line}`));
}

/** A YAML scalar, single-quoted when plain would be read as something else (`on`, `1.0`, `.x`). */
function yamlString(value: string): string {
  const plain =
    /^[A-Za-z_][\w./-]*$/.test(value) && !/^(?:y|n|yes|no|on|off|true|false|null)$/i.test(value);
  return plain ? value : `'${value.replaceAll("'", "''")}'`;
}
