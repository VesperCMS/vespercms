import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/*
 * The studio is React 19 (a peer dependency), bundled by the site's own Vite
 * together with the site's custom widgets, so it runs on whichever React the
 * site resolves. A site still on React 18 (through @astrojs/react) would get
 * a studio that breaks in the browser, so the integration stops first and
 * says why (DECISIONS.md, "The studio needs React 19").
 */

/** The version of `react` that `from` (a file path) resolves, or null when there is none. */
export function reactVersionFrom(from: string): string | null {
  try {
    const require = createRequire(from);
    const pkg = JSON.parse(readFileSync(require.resolve('react/package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/** What's wrong with the React the studio would run on, in plain words, or null when it's fine. */
export function reactProblem(version: string | null): string | null {
  const fix = 'Install React 19 with `npm install react@19 react-dom@19`, then restart.';
  if (version === null) return `Vesper's studio needs React 19, and this site has no React. ${fix}`;
  const major = Number.parseInt(version, 10);
  if (Number.isFinite(major) && major >= 19) return null;
  return `Vesper's studio needs React 19, and this site has React ${version}. ${fix}`;
}
