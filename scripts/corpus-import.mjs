// Builds the serializer round-trip corpus (packages/core/test/corpus/) from
// local checkouts of real Astro sites, recording where every file came from
// in sources.json. CI never runs this: the corpus is committed, and the
// script exists so it can be rebuilt or extended reproducibly.
//
// Only Jeremy's own sites are committed (DECISIONS.md, "Only Jeremy's own
// sites go into the committed test corpus"). Client sites are written only
// to a private directory outside the repo, which the tests read when
// VESPER_PRIVATE_CORPUS points at it.
//
// Usage:
//   node scripts/corpus-import.mjs                     # rebuild the committed corpus
//   node scripts/corpus-import.mjs --private <dir>     # also build the private corpus into <dir>
//   VESPER_CORPUS_SOURCES=/path/to/checkouts node scripts/corpus-import.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sourcesRoot = process.env.VESPER_CORPUS_SOURCES ?? resolve(repoRoot, '..');
const corpusDir = join(repoRoot, 'packages', 'core', 'test', 'corpus');
const CONTENT_EXTENSIONS = /\.(md|mdx|mdoc|json|ya?ml|toml)$/;

/**
 * `worktree`: how many working-tree copies to take per line-ending kind.
 * Git for Windows checks these sites out with autocrlf=true, so their
 * working trees hold CRLF and mixed-EOL files that never reach git; real
 * editors will save exactly those bytes.
 */
const SITES = [
  { name: 'jazzy-astro5', worktree: { crlf: 4, mixed: 6 } },
  // The same site's Hugo predecessor: the corpus's plain .md files, with YAML
  // frontmatter, page bundles (index.md) and full ISO datetimes.
  { name: 'jazzycabbages', contentDir: 'content', worktree: { crlf: 2, mixed: 1 } },
  { name: 'thosegeeks-astro', worktree: { crlf: 3 } },
  { name: 'cookingnerdy-astro', worktree: { crlf: 2 } },
];
const PRIVATE_SITES = [
  { name: 'domsys-astro', worktree: { crlf: 2 } },
  { name: 'washcofair-keystatic-astro', worktree: {} },
  { name: 'vhcc-catalog', worktree: {} },
  { name: 'vhcc-catalog3', worktree: {}, limit: 150 },
];

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { maxBuffer: 1 << 28 });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function importSite(site, outDir) {
  const repo = join(sourcesRoot, site.name);
  const commit = git(repo, ['rev-parse', 'HEAD']).toString().trim();
  const contentDir = site.contentDir ?? 'src/content';
  const eolLines = git(repo, ['ls-files', '--eol', '--', contentDir])
    .toString()
    .split('\n')
    .filter(Boolean);
  const entries = [];
  const takenWorktree = { crlf: 0, mixed: 0 };

  let files = eolLines
    .map((line) => {
      const [index, worktree] = line.split(/\s+/);
      return { path: line.slice(line.indexOf('\t') + 1), index, worktree };
    })
    .filter((f) => CONTENT_EXTENSIONS.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (site.limit) files = files.slice(0, site.limit);

  for (const file of files) {
    const relative = file.path.replace(/^src\/content\//, '');
    // The committed bytes: what git stores and CI checks out.
    const committed = git(repo, ['show', `${commit}:${file.path}`]);
    const target = join(outDir, site.name, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, committed);
    entries.push({
      file: `${site.name}/${relative}`,
      site: site.name,
      commit,
      source: file.path,
      variant: 'committed',
      sha256: sha256(committed),
    });

    // A few working-tree copies, byte for byte, for line-ending coverage.
    const kind = file.worktree === 'w/crlf' ? 'crlf' : file.worktree === 'w/mixed' ? 'mixed' : null;
    if (kind && takenWorktree[kind] < (site.worktree[kind] ?? 0)) {
      takenWorktree[kind]++;
      const bytes = readFileSync(join(repo, file.path));
      const variantTarget = join(outDir, '_worktree', kind, site.name, relative);
      mkdirSync(dirname(variantTarget), { recursive: true });
      writeFileSync(variantTarget, bytes);
      entries.push({
        file: `_worktree/${kind}/${site.name}/${relative}`,
        site: site.name,
        commit,
        source: file.path,
        variant: `worktree-${kind}`,
        sha256: sha256(bytes),
      });
    }
  }
  return entries;
}

function build(sites, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const entries = sites.flatMap((site) => importSite(site, outDir));
  writeFileSync(join(outDir, 'sources.json'), `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`${outDir}: ${entries.length} files from ${sites.length} sites`);
}

build(SITES, corpusDir);

const privateIndex = process.argv.indexOf('--private');
if (privateIndex !== -1) {
  const privateDir = process.argv[privateIndex + 1];
  if (!privateDir) throw new Error('--private needs a directory outside the repository');
  const resolved = resolve(privateDir);
  if (resolved.startsWith(resolve(repoRoot))) {
    throw new Error(
      'The private corpus must live outside the repository; client content is never committed.',
    );
  }
  build(PRIVATE_SITES, resolved);
}
