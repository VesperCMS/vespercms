// Proves every published entry point works from dist/ alone, the way a site
// that installs Vesper from npm will load it. The dev loop never reads
// dist/ (see .npmrc and DECISIONS.md), so without this check a broken build
// could ship unnoticed.
//
// Run after `tsc -b`. Each export is imported in a fresh Node process with
// NODE_OPTIONS cleared, so the @vesper/source condition is off.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootPath = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
let checked = 0;

for (const dir of readdirSync(join(rootPath, 'packages'))) {
  const manifestPath = join(rootPath, 'packages', dir, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (pkg.private || !pkg.exports) continue;

  for (const [subpath, target] of Object.entries(pkg.exports)) {
    // Wildcards and non-JS exports (stylesheets) can't be imported by Node.
    if (subpath.includes('*')) continue;
    const entry = typeof target === 'string' ? target : target.default;
    if (typeof entry !== 'string' || !/\.(m?js)$/.test(entry)) continue;

    const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)});`],
      { cwd: rootPath, env, encoding: 'utf8' },
    );
    checked++;
    if (result.status !== 0) failures.push(`${specifier}\n${result.stderr.trim()}`);
  }

  // Each command a package installs must start from dist/ too.
  for (const [name, target] of Object.entries(pkg.bin ?? {})) {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const result = spawnSync(
      process.execPath,
      [join(rootPath, 'packages', dir, target), '--help'],
      {
        cwd: rootPath,
        env,
        encoding: 'utf8',
      },
    );
    checked++;
    if (result.status !== 0) failures.push(`${name} (bin of ${pkg.name})\n${result.stderr.trim()}`);
  }
}

if (failures.length > 0) {
  console.error(`check-dist: ${failures.length} of ${checked} entry points failed:\n`);
  for (const failure of failures) console.error(`${failure}\n`);
  process.exit(1);
}
console.log(`check-dist: ${checked} entry point(s) load from dist/.`);
