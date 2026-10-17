import { slug as githubSlug } from 'github-slugger';
import picomatch from 'picomatch/posix.js';

/*
 * Which files belong to a glob() collection, and what each entry's ID is,
 * computed exactly as Astro's glob loader does (astro/dist/content/loaders/
 * glob.js and content/utils.js). Paths here are POSIX and relative to the
 * loader's `base`.
 */

/**
 * A matcher for a glob loader's `pattern`. Negated patterns (`!**\/draft-*`)
 * subtract from the positive ones, as tinyglobby (Astro's lister) treats them.
 */
export function globMatcher(pattern: string | readonly string[]): (path: string) => boolean {
  const patterns = typeof pattern === 'string' ? [pattern] : [...pattern];
  const positive = patterns.filter((p) => !p.startsWith('!'));
  const negative = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
  const isMatch = picomatch(positive, negative.length > 0 ? { ignore: negative } : {});
  return (path) => !path.startsWith('../') && isMatch(path);
}

/**
 * Astro's default glob entry ID:
 * - a `slug` in the entry's data wins;
 * - otherwise the path without its extension, with each segment slugged
 *   (lower case, spaces to dashes, punctuation dropped) and a trailing
 *   `/index` removed.
 *
 * So `academics/nursing/index.md` is `academics/nursing`, but a top-level
 * `index.md` stays `index`.
 */
export function defaultEntryId(relativePath: string, data?: { slug?: unknown } | null): string {
  // Astro: `if (data.slug) return String(data.slug)`.
  const slug = data?.slug;
  if (typeof slug === 'string' && slug !== '') return slug;
  if ((typeof slug === 'number' && slug !== 0) || slug === true) return String(slug);
  // path.extname semantics: the last `.suffix` of the file name, unless the name starts with the dot.
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  const withoutExt = relativePath.slice(0, relativePath.length - extension.length);
  return withoutExt
    .split('/')
    .map((segment) => githubSlug(segment))
    .join('/')
    .replace(/\/index$/, '');
}

const CONTENT_EXTENSIONS = new Set(['md', 'mdx', 'mdoc', 'markdown']);
const DATA_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml']);

/** File extensions a glob pattern can match, as far as the pattern spells them out. */
export function patternExtensions(pattern: string | readonly string[]): string[] {
  const patterns = typeof pattern === 'string' ? [pattern] : [...pattern];
  const found = new Set<string>();
  for (const p of patterns.filter((x) => !x.startsWith('!'))) {
    const braces = /\.\{([^}]+)\}$/.exec(p);
    if (braces?.[1]) for (const ext of braces[1].split(',')) found.add(ext.trim().toLowerCase());
    const single = /\.([A-Za-z0-9]+)$/.exec(p);
    if (single?.[1]) found.add(single[1].toLowerCase());
  }
  return [...found].sort();
}

/** `content` for Markdown-family entries (with a body), `data` for JSON/YAML/TOML. */
export function entryKindOf(extensions: readonly string[]): 'content' | 'data' {
  if (extensions.some((ext) => CONTENT_EXTENSIONS.has(ext))) return 'content';
  if (extensions.length > 0 && extensions.every((ext) => DATA_EXTENSIONS.has(ext))) return 'data';
  return 'content';
}
