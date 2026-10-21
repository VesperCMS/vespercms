#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Manifest } from '@vesper/core';
import { agentGuide, withAgentGuide } from './agents.ts';
import { generateManifest, writeManifest } from './manifest.ts';

const HELP = `Usage: vesper manifest [--root <site>] [--src-dir <dir>] [--out <file>]
       vesper agents [--root <site>] [--src-dir <dir>] [--file <file>] [--check]

manifest  Reads the site's content.config.ts, vesper.config.ts and forms.config.ts
          and writes Vesper's manifest. It prints the manifest when --out is omitted.

agents    Writes instructions for coding agents, generated from the same configs,
          between Vesper's markers in the site's AGENTS.md (or --file, relative to
          the site), and leaves the rest of the file alone. --check writes nothing
          and fails when the file is out of date.`;

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
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
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
