import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CorpusFile = {
  /** Path relative to its root, with forward slashes. */
  name: string;
  /** `corpus`, `fixtures` or `private`. */
  source: 'corpus' | 'fixtures' | 'private';
  bytes: Uint8Array;
};

const testDir = fileURLToPath(new URL('..', import.meta.url));
const CONTENT = /\.(md|mdx|mdoc|json|ya?ml|toml)$/;

function walk(root: string, source: CorpusFile['source']): CorpusFile[] {
  if (!existsSync(root)) return [];
  const out: CorpusFile[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) visit(path);
      else if (CONTENT.test(entry) && entry !== 'sources.json') {
        out.push({
          name: relative(root, path).replaceAll('\\', '/'),
          source,
          bytes: new Uint8Array(readFileSync(path)),
        });
      }
    }
  };
  visit(root);
  return out;
}

/** Real-world files, plus the private corpus when VESPER_PRIVATE_CORPUS is set (local only). */
export function corpusFiles(): CorpusFile[] {
  const privateRoot = process.env.VESPER_PRIVATE_CORPUS;
  return [
    ...walk(join(testDir, 'corpus'), 'corpus'),
    ...(privateRoot ? walk(privateRoot, 'private') : []),
  ];
}

export function fixtureFiles(): CorpusFile[] {
  return walk(join(testDir, 'fixtures'), 'fixtures');
}

export function allFiles(): CorpusFile[] {
  return [...corpusFiles(), ...fixtureFiles()];
}

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(testDir, 'fixtures', name)));
}
