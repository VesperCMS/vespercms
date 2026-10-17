/**
 * Splits a content file into frontmatter and body exactly the way Astro does,
 * so the editor and the site always agree on where the frontmatter is.
 *
 * The regular expression is copied from `@astrojs/internal-helpers/frontmatter`
 * (used by Markdown, MDX and Markdoc alike). A parity test runs it against
 * Astro's own `extractFrontmatter` over the whole corpus.
 *
 * `joinFrontmatter(splitFrontmatter(text)) === text` for every input. Nothing
 * here normalizes: the BOM, blank lines before the fence, the fence lines and
 * every line ending survive as they are.
 */

// Either at the very start (allowing a BOM) or after whitespace-only lines.
// Group 1 is Astro's `rawFrontmatter`: everything after the opening fence up to
// and including the line break before the closing fence.
const FRONTMATTER_RE = /(?:^\uFEFF?|^\s*\n)(?:---|\+\+\+)([\s\S]*?\n)(?:---|\+\+\+)/;

export type FrontmatterFormat = 'yaml' | 'toml';

export type SplitFile = {
  /** BOM and/or whitespace-only lines before the opening fence. */
  prefix: string;
  /** `---`, `+++`, or `''` when the file has no frontmatter. */
  open: string;
  /** The text between the fences: starts right after the opening fence, ends with a line break. */
  raw: string;
  /** The closing fence, or `''`. */
  close: string;
  /** Everything after the closing fence, starting with its line break. */
  body: string;
  /** Decided by the opening fence, as Astro does. `null` when there is no frontmatter. */
  format: FrontmatterFormat | null;
  /** Offset of `raw` in the file. */
  rawOffset: number;
  /** Offset of `body` in the file. */
  bodyOffset: number;
};

export function splitFrontmatter(text: string): SplitFile {
  const match = FRONTMATTER_RE.exec(text);
  const raw = match?.[1];
  if (!match || raw === undefined) {
    return {
      prefix: '',
      open: '',
      raw: '',
      close: '',
      body: text,
      format: null,
      rawOffset: 0,
      bodyOffset: 0,
    };
  }
  const end = match[0].length;
  const openOffset = end - 3 - raw.length - 3;
  const open = text.slice(openOffset, openOffset + 3);
  return {
    prefix: text.slice(0, openOffset),
    open,
    raw,
    close: text.slice(end - 3, end),
    body: text.slice(end),
    format: open === '+++' ? 'toml' : 'yaml',
    rawOffset: openOffset + 3,
    bodyOffset: end,
  };
}

export function joinFrontmatter(
  file: Pick<SplitFile, 'prefix' | 'open' | 'raw' | 'close' | 'body'>,
): string {
  return file.prefix + file.open + file.raw + file.close + file.body;
}

/** Replaces the frontmatter text, keeping prefix, fences and body exactly. */
export function withRaw(file: SplitFile, raw: string): string {
  return joinFrontmatter({ ...file, raw });
}

/** Replaces the body, keeping everything before it exactly. */
export function withBody(file: SplitFile, body: string): string {
  return joinFrontmatter({ ...file, body });
}
