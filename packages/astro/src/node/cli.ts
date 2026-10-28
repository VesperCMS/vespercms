#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Manifest } from '@vespercms/core';
import { agentGuide, withAgentGuide } from './agents.ts';
import { DEPLOY_TARGETS, type DeployTarget } from './deploy.ts';
import { DeployInitError, planDeploy } from './deploy-init.ts';
import { generateManifest, writeManifest } from './manifest.ts';

const HELP = `Usage: vesper manifest [--root <site>] [--src-dir <dir>] [--out <file>]
       vesper agents [--root <site>] [--src-dir <dir>] [--file <file>] [--check]
       vesper deploy init --target sftp|ftp|workers|hook [--rebuild-every <minutes>]
                          [--url <live site>] [--branch <name>] [--root <site>] [--force]

manifest     Reads the site's content.config.ts, vesper.config.ts and forms.config.ts
             and writes Vesper's manifest. It prints the manifest when --out is omitted.

agents       Writes instructions for coding agents, generated from the same configs,
             between Vesper's markers in the site's AGENTS.md (or --file, relative to
             the site), and leaves the rest of the file alone. --check writes nothing
             and fails when the file is out of date.

deploy init  Writes a GitHub Actions workflow, .github/workflows/vesper-deploy.yml,
             that builds the site on every push and uploads it by SFTP or FTP or
             deploys it to Cloudflare Workers with wrangler, or, for a host that
             builds from git, calls its build hook. With --rebuild-every (minutes;
             an hour for hook) it also rebuilds on a schedule, whenever a scheduled
             change is due. It lists the secrets to add, and never replaces a
             workflow without --force.`;

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string', default: '.' },
      'src-dir': { type: 'string', default: 'src' },
      out: { type: 'string' },
      file: { type: 'string', default: 'AGENTS.md' },
      check: { type: 'boolean', default: false },
      target: { type: 'string' },
      'rebuild-every': { type: 'string' },
      url: { type: 'string' },
      branch: { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (command === 'deploy' && positionals[1] === 'init' && !values.help) {
    return deployInit(values);
  }
  if (values.help || (command !== 'manifest' && command !== 'agents')) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  const manifest = await generateManifest({ root: values.root, srcDir: values['src-dir'] });
  if (command === 'agents') {
    report(manifest);
    return agents(manifest, resolve(values.root, values.file), values.check);
  }

  if (values.out) {
    writeManifest(manifest, resolve(values.out));
    console.log(
      `Wrote ${values.out}: ${String(manifest.collections.length)} collections, ${String(manifest.forms.length)} forms.`,
    );
  } else {
    console.log(JSON.stringify(manifest, null, 2));
  }
  report(manifest);
  return manifest.diagnostics.some((d) => d.level === 'error') ? 1 : 0;
}

function agents(manifest: Manifest, file: string, check: boolean): number {
  const name = relative(process.cwd(), file) || file;
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const next = withAgentGuide(existing, agentGuide(manifest));
  if (next === existing) {
    console.log(`${name} is up to date.`);
    return 0;
  }
  if (check) {
    console.error(`${name} is out of date. Run \`vesper agents\` to update it.`);
    return 1;
  }
  writeFileSync(file, next);
  console.log(
    `${existing === null ? 'Wrote' : 'Updated'} ${name}: ${String(manifest.collections.length)} collections.`,
  );
  return 0;
}

async function deployInit(values: {
  root: string;
  target?: string | undefined;
  'rebuild-every'?: string | undefined;
  url?: string | undefined;
  branch?: string | undefined;
  force: boolean;
}): Promise<number> {
  const target = values.target as DeployTarget | undefined;
  if (!target || !DEPLOY_TARGETS.includes(target)) {
    console.error(
      'Choose where the site goes with --target: sftp or ftp for a server the workflow uploads to; workers for Cloudflare Workers, deployed with wrangler; hook for a host that builds from git (Netlify, Cloudflare Pages or Workers Builds, Vercel).',
    );
    return 1;
  }
  const every = values['rebuild-every'];
  const rebuildEvery = every === undefined ? undefined : Number(every);
  if (rebuildEvery !== undefined && !Number.isInteger(rebuildEvery)) {
    console.error(`--rebuild-every takes whole minutes, not ${String(every)}.`);
    return 1;
  }
  const command = [
    'vesper deploy init',
    `--target ${target}`,
    ...(every !== undefined ? [`--rebuild-every ${every}`] : []),
    ...(values.url ? [`--url ${values.url}`] : []),
    ...(values.branch ? [`--branch ${values.branch}`] : []),
  ].join(' ');

  let plan;
  try {
    plan = await planDeploy({
      root: values.root,
      target,
      command,
      ...(rebuildEvery !== undefined ? { rebuildEvery } : {}),
      ...(values.url ? { url: values.url } : {}),
      ...(values.branch ? { branch: values.branch } : {}),
    });
  } catch (error) {
    if (error instanceof DeployInitError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  const name = relative(process.cwd(), plan.file) || plan.file;
  if (existsSync(plan.file) && !values.force) {
    console.error(`${name} is already there. Pass --force to replace it.`);
    return 1;
  }
  mkdirSync(dirname(plan.file), { recursive: true });
  writeFileSync(plan.file, plan.contents);
  console.log(`Wrote ${name}.\n\n${plan.next}`);
  return 0;
}

function report(manifest: Manifest): void {
  for (const diagnostic of manifest.diagnostics) {
    const where = [diagnostic.collection, diagnostic.path?.join('.')].filter(Boolean).join(' › ');
    console.error(`${diagnostic.level}: ${where ? `${where}: ` : ''}${diagnostic.message}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
