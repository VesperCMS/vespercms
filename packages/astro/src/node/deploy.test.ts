import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  cronFor,
  DEPLOY_TARGETS,
  deployWorkflow,
  DUE_SCRIPT,
  REBUILD_INTERVALS,
  secretsFor,
  type WorkflowOptions,
} from './deploy.ts';

const base: WorkflowOptions = {
  target: 'sftp',
  command: 'vesper deploy init --target sftp --rebuild-every 60',
  branch: 'main',
  rebuildEvery: 60,
  siteUrl: 'https://example.com/',
  siteDir: 'apps/site',
  installDir: '.',
  lockfile: 'package-lock.json',
  packageManager: 'npm',
  nodeVersionFile: '.node-version',
  outDir: 'dist/',
};

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string> };
type Workflow = {
  on: Record<string, unknown>;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  env?: Record<string, string>;
  jobs: Record<string, { needs?: string; if?: string; steps: Step[] }>;
};
const read = (options: WorkflowOptions) => parse(deployWorkflow(options)) as Workflow;
const step = (workflow: Workflow, job: string, name: string) => {
  const found = workflow.jobs[job]?.steps.find((s) => s.name === name);
  if (!found) throw new Error(`No step "${name}" in ${job}`);
  return found;
};

describe('cronFor', () => {
  it('keeps every interval exactly, a few minutes past the hour', () => {
    expect(cronFor(5)).toBe('2-59/5 * * * *');
    expect(cronFor(15)).toBe('7-59/15 * * * *');
    expect(cronFor(30)).toBe('7-59/30 * * * *');
    expect(cronFor(60)).toBe('7 * * * *');
    expect(cronFor(120)).toBe('7 */2 * * *');
    expect(cronFor(1440)).toBe('7 0 * * *');
    for (const minutes of REBUILD_INTERVALS) expect(cronFor(minutes)).toMatch(/^\d/);
  });

  it('refuses an interval a schedule would keep unevenly', () => {
    for (const minutes of [4, 7, 45, 90, 2880]) {
      expect(() => cronFor(minutes)).toThrow(/can keep exactly/);
    }
  });
});

describe('deployWorkflow', () => {
  it('writes each target as it ships', () => {
    expect(deployWorkflow(base)).toMatchSnapshot('sftp, scheduled, in a monorepo');
    expect(
      deployWorkflow({
        ...base,
        target: 'ftp',
        command: 'vesper deploy init --target ftp',
        rebuildEvery: undefined,
        siteDir: '.',
        lockfile: 'pnpm-lock.yaml',
        packageManager: 'pnpm',
        nodeVersionFile: undefined,
      }),
    ).toMatchSnapshot('ftp, unscheduled, pnpm at the root');
    expect(
      deployWorkflow({ ...base, target: 'hook', command: 'vesper deploy init --target hook' }),
    ).toMatchSnapshot('hook, every hour');
    expect(
      deployWorkflow({
        ...base,
        target: 'workers',
        command: 'vesper deploy init --target workers --rebuild-every 30',
        rebuildEvery: 30,
      }),
    ).toMatchSnapshot('workers, every 30 minutes, in a monorepo');
  });

  it('builds on push, on the cloud’s dispatch, by hand and on the schedule', () => {
    const sftp = read(base);
    expect(Object.keys(sftp.on)).toEqual([
      'push',
      'schedule',
      'repository_dispatch',
      'workflow_dispatch',
    ]);
    expect(sftp.on.push).toEqual({ branches: ['main'] });
    expect(sftp.on.schedule).toEqual([{ cron: '7 * * * *' }]);
    expect(sftp.on.repository_dispatch).toEqual({ types: ['vesper-rebuild'] });
    expect(sftp.env).toEqual({ VESPER_SITE_URL: 'https://example.com/' });
    expect(sftp.jobs.due?.if).toBe("github.event_name == 'schedule'");
    expect(sftp.jobs.deploy?.needs).toBe('due');
    expect(sftp.jobs.deploy?.if).toContain('!cancelled()');

    const hook = read({ ...base, target: 'hook' });
    expect(Object.keys(hook.on)).toEqual(['schedule', 'repository_dispatch', 'workflow_dispatch']);
    expect(Object.keys(hook.jobs)).toEqual(['due', 'rebuild']);
    expect(hook.concurrency).toBeUndefined();

    // Workers deploys as the uploads do: on push, one run at a time.
    const workers = read({ ...base, target: 'workers' });
    expect(workers.on).toEqual(sftp.on);
    expect(workers.env).toEqual(sftp.env);
    expect(workers.concurrency).toEqual({ group: 'vesper-deploy', 'cancel-in-progress': false });
    expect(Object.keys(workers.jobs)).toEqual(['due', 'deploy']);
    expect(workers.jobs.deploy?.needs).toBe('due');
    expect(workers.jobs.deploy?.if).toBe(sftp.jobs.deploy?.if);

    const unscheduled = read({ ...base, rebuildEvery: undefined });
    expect(Object.keys(unscheduled.on)).toEqual([
      'push',
      'repository_dispatch',
      'workflow_dispatch',
    ]);
    expect(unscheduled.env).toBeUndefined();
    expect(Object.keys(unscheduled.jobs)).toEqual(['deploy']);
    expect(unscheduled.jobs.deploy?.needs).toBeUndefined();
  });

  it('installs where the lockfile is and builds in the site’s folder', () => {
    const monorepo = read({
      ...base,
      installDir: 'site',
      lockfile: 'site/package-lock.json',
      siteDir: 'site',
    });
    const steps = monorepo.jobs.deploy?.steps ?? [];
    expect(steps[1]).toEqual({
      uses: 'actions/setup-node@v7',
      with: {
        'node-version-file': '.node-version',
        cache: 'npm',
        'cache-dependency-path': 'site/package-lock.json',
      },
    });
    expect(step(monorepo, 'deploy', 'Install')).toEqual({
      name: 'Install',
      'working-directory': 'site',
      run: 'npm ci',
    });
    expect(step(monorepo, 'deploy', 'Build')).toMatchObject({ 'working-directory': 'site' });

    const yarn = read({ ...base, packageManager: 'yarn', nodeVersionFile: undefined });
    expect(yarn.jobs.deploy?.steps[1]).toEqual({
      uses: 'actions/setup-node@v7',
      with: { 'node-version': '24' },
    });
    expect(step(yarn, 'deploy', 'Turn on Corepack').run).toBe('corepack enable');
    expect(step(yarn, 'deploy', 'Install').run).toBe('yarn install --immutable');
    expect(step(read({ ...base, packageManager: 'yarn-classic' }), 'deploy', 'Install').run).toBe(
      'yarn install --frozen-lockfile',
    );
  });

  it('deploys with the site’s own wrangler, from the site’s folder', () => {
    const wrangler = (packageManager: WorkflowOptions['packageManager']) => {
      const workers = read({ ...base, target: 'workers', packageManager });
      const steps = workers.jobs.deploy?.steps ?? [];
      expect(steps.map((s) => s.name ?? s.uses)).toEqual([
        'actions/checkout@v7',
        'actions/setup-node@v7',
        ...(packageManager === 'npm' ? [] : ['Turn on Corepack']),
        'Install',
        'Build',
        'Deploy with Wrangler',
      ]);
      const deploy = step(workers, 'deploy', 'Deploy with Wrangler');
      expect(deploy).toMatchObject({ 'working-directory': 'apps/site' });
      expect(deploy.env).toEqual({
        CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
        CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
      });
      return (deploy.run ?? '').trimEnd().split('\n').at(-1);
    };
    expect(wrangler('npm')).toBe('npx wrangler deploy');
    expect(wrangler('pnpm')).toBe('pnpm exec wrangler deploy');
    expect(wrangler('yarn')).toBe('yarn wrangler deploy');
    expect(wrangler('yarn-classic')).toBe('yarn wrangler deploy');
    expect(deployWorkflow({ ...base, target: 'workers' })).not.toContain('lftp');
  });

  it('reads only the secrets it lists', () => {
    for (const target of DEPLOY_TARGETS) {
      const text = deployWorkflow({ ...base, target });
      const used = [...text.matchAll(/\$\{\{ secrets\.(\w+) \}\}/g)].map((m) => m[1]);
      expect(new Set(used)).toEqual(new Set(secretsFor(target).map((s) => s.name)));
    }
  });

  it('quotes what YAML would read as something else', () => {
    expect(read({ ...base, branch: 'on' }).on.push).toEqual({ branches: ['on'] });
    expect(read({ ...base, branch: '2026' }).on.push).toEqual({ branches: ['2026'] });
    expect(read({ ...base, branch: "it's" }).on.push).toEqual({ branches: ["it's"] });
  });

  it('needs the live site’s address for a schedule', () => {
    expect(() => deployWorkflow({ ...base, siteUrl: undefined })).toThrow(/address/);
  });
});

describe('the due step', () => {
  const script = (() => {
    const run = step(read(base), 'due', 'Check whether a scheduled change is due').run ?? '';
    const match = /^node --input-type=module <<'EOF'\n([\s\S]*)\nEOF\n?$/.exec(run);
    if (!match?.[1]) throw new Error('The due step is no longer a heredoc');
    return match[1];
  })();

  let server: Server;
  let origin = '';
  const seen: string[] = [];
  const hour = 3_600_000;
  const pages: Record<string, () => [number, string]> = {
    '/passed/_vesper/schedule.json': () => [
      200,
      JSON.stringify({
        version: 1,
        builtAt: new Date(Date.now() - hour).toISOString(),
        next: new Date(Date.now() - 60_000).toISOString(),
      }),
    ],
    '/later/_vesper/schedule.json': () => [
      200,
      JSON.stringify({
        version: 1,
        builtAt: new Date().toISOString(),
        next: new Date(Date.now() + hour).toISOString(),
      }),
    ],
    '/none/_vesper/schedule.json': () => [
      200,
      JSON.stringify({ version: 1, builtAt: new Date().toISOString(), next: null }),
    ],
    '/newer/_vesper/schedule.json': () => [200, JSON.stringify({ version: 2, next: null })],
    '/garbled/_vesper/schedule.json': () => [200, '<!doctype html><p>Not here'],
    '/no-time/_vesper/schedule.json': () => [200, JSON.stringify({ version: 1, next: 'soon' })],
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      seen.push(request.url ?? '');
      const page = pages[url.pathname];
      const [status, body] = page ? page() : [404, 'Not found'];
      response.writeHead(status, { 'content-type': 'application/json' }).end(body);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
  });

  // Asynchronous, so the test's own server can answer while it runs.
  async function due(siteUrl: string): Promise<{ due: string; log: string; code: number | null }> {
    const dir = mkdtempSync(join(tmpdir(), 'vesper-due-'));
    const output = join(dir, 'output');
    writeFileSync(output, '');
    try {
      const { log, code } = await new Promise<{ log: string; code: number | null }>(
        (done, fail) => {
          const child = spawn(process.execPath, ['--input-type=module'], {
            env: { ...process.env, VESPER_SITE_URL: siteUrl, GITHUB_OUTPUT: output },
          });
          let text = '';
          child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString()));
          child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString()));
          child.on('error', fail);
          child.on('close', (code) => {
            done({ log: text, code });
          });
          child.stdin.end(script);
        },
      );
      return { due: readFileSync(output, 'utf8'), log, code };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('rebuilds once the next change has passed', async () => {
    const result = await due(`${origin}/passed/`);
    expect(result.due).toBe('due=true\n');
    expect(result.log).toMatch(/^A change was due at /);
    expect(result.code).toBe(0);
  });

  it('waits when the next change is still to come, or nothing is scheduled', async () => {
    const later = await due(`${origin}/later/`);
    expect(later.due).toBe('due=false\n');
    expect(later.log).toMatch(/^Nothing is due until /);
    const none = await due(`${origin}/none/`);
    expect(none).toEqual({ due: 'due=false\n', log: 'Nothing is scheduled.\n', code: 0 });
  });

  it('fails without building when the schedule can’t be read, naming the address', async () => {
    for (const [path, why] of [
      ['missing', 'it answered 404'],
      ['garbled', 'it is not a schedule this workflow knows'],
      ['newer', 'it is not a schedule this workflow knows'],
      ['no-time', 'it is not a schedule this workflow knows'],
    ] as const) {
      const result = await due(`${origin}/${path}/`);
      // No output, so the deploy's `needs.due.outputs.due == 'true'` is false.
      expect(result).toEqual({
        due: '',
        log: `::error::${origin}/${path}/_vesper/schedule.json could not be read (${why}), so nothing was built. Check VESPER_SITE_URL in this workflow, and that the live site was built with Vesper. The next scheduled run tries again.\n`,
        code: 1,
      });
    }
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((done) => closed.close(done));
    const unreachable = await due(`http://127.0.0.1:${String(port)}/`);
    expect(unreachable.due).toBe('');
    expect(unreachable.code).toBe(1);
    expect(unreachable.log).toMatch(
      new RegExp(
        `^::error::http://127\\.0\\.0\\.1:${String(port)}/_vesper/schedule\\.json could not be read`,
      ),
    );
  });

  it('escapes the address for the error annotation', async () => {
    const result = await due(`${origin}/100%25/`);
    expect(result.log).toMatch(
      /^::error::\S+\/100%2525\/_vesper\/schedule\.json could not be read/,
    );
  });

  it('reads the schedule under the site’s base, past any cache', async () => {
    seen.length = 0;
    await due(`${origin}/none/`);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^\/none\/_vesper\/schedule\.json\?at=\d+$/);
  });

  it('holds nothing Actions would expand', () => {
    expect(DUE_SCRIPT).not.toContain('${{');
  });
});

// The upload and hook steps are bash on GitHub's Ubuntu runners. They run here
// with stand-ins for lftp and curl that record how they were called.
describe.skipIf(process.platform === 'win32')('the upload and hook steps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-steps-'));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  const site = join(dir, 'site');
  const calls = join(dir, 'calls');
  mkdirSync(bin);
  mkdirSync(home);
  mkdirSync(join(site, 'dist'), { recursive: true });
  for (const tool of ['lftp', 'curl', 'npx']) {
    writeFileSync(join(bin, tool), `#!/bin/sh\nprintf '%s\\n' "${tool} $*" >> "${calls}"\n`);
    chmodSync(join(bin, tool), 0o755);
  }

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(script: string, env: Record<string, string>) {
    rmSync(calls, { force: true });
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: site,
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: home, ...env },
    });
    const called = (() => {
      try {
        return readFileSync(calls, 'utf8');
      } catch {
        return '';
      }
    })();
    return { status: result.status, stdout: result.stdout, called };
  }

  const upload = (target: 'sftp' | 'ftp') =>
    step(read({ ...base, target }), 'deploy', `Upload by ${target.toUpperCase()}`);

  it('mirrors the build by SFTP, checking the server’s plain key', () => {
    const sftp = upload('sftp');
    expect(spawnSync('bash', ['-n', '-c', sftp.run ?? '']).status).toBe(0);
    const env = {
      OUT_DIR: 'dist/',
      HOST: 'ssh.example.com',
      PORT: '2222',
      LOGIN: 'deployer',
      LFTP_PASSWORD: 'secret',
      KEY: '',
      KNOWN_HOSTS: '[ssh.example.com]:2222 ssh-ed25519 AAAA',
      REMOTE_PATH: 'public_html',
    };
    const result = run(sftp.run ?? '', env);
    expect(result.status).toBe(0);
    expect(readFileSync(join(home, '.ssh', 'known_hosts'), 'utf8')).toBe(`${env.KNOWN_HOSTS}\n`);
    // Certificates are refused: Hostinger offers one first, and nothing names
    // an authority for it, so ssh reported the key ssh-keyscan listed as changed.
    expect(result.called).toBe(
      "lftp -c set sftp:connect-program 'ssh -a -x -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=-*-cert-v01@openssh.com'; set net:max-retries 2; set net:timeout 30; open --env-password -u 'deployer' 'sftp://ssh.example.com:2222'; mirror --reverse --delete --parallel=4 --exclude-glob .well-known/ --exclude-glob cgi-bin/ 'dist/' 'public_html'\n",
    );

    // A key instead of a password; a build with its own .well-known uploads it.
    // Both secrets as Windows writes them, CR LF, are written with LF alone.
    mkdirSync(join(site, 'dist', '.well-known'));
    const keyed = run(sftp.run ?? '', {
      ...env,
      PORT: '',
      LFTP_PASSWORD: '',
      KEY: 'PRIVATE\r\nKEY\r\n',
      KNOWN_HOSTS: '[ssh.example.com]:2222 ssh-rsa BBBB\r\n[ssh.example.com]:2222 ssh-ed25519 AAAA',
    });
    rmSync(join(site, 'dist', '.well-known'), { recursive: true });
    expect(keyed.status).toBe(0);
    expect(readFileSync(join(home, '.ssh', 'known_hosts'), 'utf8')).toBe(
      '[ssh.example.com]:2222 ssh-rsa BBBB\n[ssh.example.com]:2222 ssh-ed25519 AAAA\n',
    );
    expect(readFileSync(join(home, '.ssh', 'vesper_deploy'), 'utf8')).toBe('PRIVATE\nKEY\n\n');
    expect(keyed.called).toContain(`-i ${home}/.ssh/vesper_deploy'`);
    expect(keyed.called).toContain("'sftp://ssh.example.com:22'");
    expect(keyed.called).toContain('--parallel=4 --exclude-glob cgi-bin/ ');
  });

  it('names the secret that’s missing, and uploads nothing', () => {
    const sftp = upload('sftp');
    const env = {
      OUT_DIR: 'dist/',
      HOST: 'h',
      LOGIN: 'u',
      REMOTE_PATH: 'p',
      KNOWN_HOSTS: 'k',
      LFTP_PASSWORD: '',
      KEY: '',
      PORT: '',
    };
    const noHostKeys = run(sftp.run ?? '', { ...env, KNOWN_HOSTS: '' });
    expect(noHostKeys.status).toBe(1);
    expect(noHostKeys.stdout).toContain(
      '::error::Add the repository secret VESPER_SFTP_KNOWN_HOSTS',
    );
    expect(noHostKeys.called).toBe('');
    const noLogin = run(sftp.run ?? '', env);
    expect(noLogin.status).toBe(1);
    expect(noLogin.stdout).toContain('VESPER_SFTP_PASSWORD, or VESPER_SFTP_KEY');
  });

  it('insists on TLS for FTP', () => {
    const ftp = upload('ftp');
    expect(spawnSync('bash', ['-n', '-c', ftp.run ?? '']).status).toBe(0);
    const result = run(ftp.run ?? '', {
      OUT_DIR: 'dist/',
      HOST: 'ftp.example.com',
      PORT: '',
      LOGIN: 'deployer',
      LFTP_PASSWORD: 'secret',
      REMOTE_PATH: '/www',
    });
    expect(result.status).toBe(0);
    expect(result.called).toBe(
      "lftp -c set ftp:ssl-force true; set ftp:ssl-protect-data true; set net:max-retries 2; set net:timeout 30; open --env-password -u 'deployer' 'ftp://ftp.example.com:21'; mirror --reverse --delete --parallel=4 --exclude-glob .well-known/ --exclude-glob cgi-bin/ 'dist/' '/www'\n",
    );
  });

  it('posts to the build hook', () => {
    const hook = step(read({ ...base, target: 'hook' }), 'rebuild', 'Call the build hook');
    const result = run(hook.run ?? '', { BUILD_HOOK: 'https://api.netlify.com/build_hooks/abc' });
    expect(result.status).toBe(0);
    expect(result.called).toBe(
      'curl --fail-with-body --silent --show-error --retry 3 --max-time 30 -X POST -H Content-Type: application/json -d {} https://api.netlify.com/build_hooks/abc\n',
    );
    const missing = run(hook.run ?? '', { BUILD_HOOK: '' });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain('::error::Add the repository secret VESPER_BUILD_HOOK');
  });

  it('deploys with wrangler once the token is set', () => {
    const deploy = step(read({ ...base, target: 'workers' }), 'deploy', 'Deploy with Wrangler');
    expect(spawnSync('bash', ['-n', '-c', deploy.run ?? '']).status).toBe(0);
    const result = run(deploy.run ?? '', {
      CLOUDFLARE_API_TOKEN: 'token',
      CLOUDFLARE_ACCOUNT_ID: '',
    });
    expect(result.status).toBe(0);
    expect(result.called).toBe('npx wrangler deploy\n');
    const missing = run(deploy.run ?? '', { CLOUDFLARE_API_TOKEN: '' });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain('::error::Add the repository secret CLOUDFLARE_API_TOKEN');
    expect(missing.called).toBe('');
  });
});
