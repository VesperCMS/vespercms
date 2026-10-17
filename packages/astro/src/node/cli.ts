#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { generateManifest, writeManifest } from './manifest.ts';

const HELP = `Usage: vesper manifest [--root <site>] [--src-dir <dir>] [--out <file>]

Reads the site's content.config.ts, vesper.config.ts and forms.config.ts and
writes Vesper's manifest. It prints the manifest when --out is omitted.`;

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string', default: '.' },
      'src-dir': { type: 'string', default: 'src' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals[0] !== 'manifest') {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  const manifest = await generateManifest({ root: values.root, srcDir: values['src-dir'] });
  if (values.out) {
    writeManifest(manifest, resolve(values.out));
    console.log(
      `Wrote ${values.out}: ${String(manifest.collections.length)} collections, ${String(manifest.forms.length)} forms.`,
    );
  } else {
    console.log(JSON.stringify(manifest, null, 2));
  }
  for (const diagnostic of manifest.diagnostics) {
    const where = [diagnostic.collection, diagnostic.path?.join('.')].filter(Boolean).join(' › ');
    console.error(`${diagnostic.level}: ${where ? `${where}: ` : ''}${diagnostic.message}`);
  }
  return manifest.diagnostics.some((d) => d.level === 'error') ? 1 : 0;
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
