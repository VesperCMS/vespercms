import type { Nodes, Root } from 'mdast';
import { parseMdast } from '../body/mdast.ts';
import { jsxAttribute, jsxTagLayout } from '../body/jsx-tag.ts';
import { markdocTagLayout, markdocTags, markdocValue } from '../body/markdoc-tag.ts';
import type { BodyFormat } from '../body/types.ts';
import { isPlainObject, type DataValue } from '../files/equal.ts';
import type { FieldModel } from '../field-model.ts';
import { childrenFor } from '../schema/variants.ts';
import { formatUrl, parseSiteUrl, reshapeUrl, urlKey, type UrlSettings } from '../urls/pattern.ts';
import { dirOf, relativePath } from './media.ts';

/*
 * Keeping links working when pages move (spec §6.15.6). A move updates, in
 * the same change set:
 * - links to the old URLs anywhere in the site's content: Markdown links
 *   and reference definitions, Markdoc and MDX attributes whose value is a
 *   page URL, and frontmatter fields shown with the URL widget;
 * - references that are relative to a file, in files that move and files
 *   that point into the moved folder: images, MDX imports, Markdoc
 *   partials, and frontmatter paths starting with `./` or `../`;
 * - links that are relative to the page's URL, when the page they're on
 *   moves or the page they point at does.
 *
 * Each change replaces only the bytes of that one address, written in the
 * same shape as before (with or without the base, a trailing slash, a
 * query or a hash). Redirects remain the safety net for links elsewhere.
 */

export type LinkContext = {
  settings: UrlSettings;
  /** Old page key → new page key, for every page that moves. */
  pages: ReadonlyMap<string, string>;
  /** Old site file path → new, for every file that moves. */
  files: ReadonlyMap<string, string>;
};

/** Where the file being rewritten is, before and after the change. */
export type FilePlace = {
  path: { from: string; to: string };
  /** The page's URL before and after (with base), when the file is a page. */
  url?: { from: string; to: string };
};

export type RewriteCount = {
  /** Links to pages that changed. */
  links: number;
  /** File-relative references that changed. */
  paths: number;
};

type Edit = { start: number; end: number; text: string; kind: keyof RewriteCount };

/** Rewrites one body. Returns the new text and what changed. */
export function rewriteBody(
  body: string,
  format: BodyFormat,
  context: LinkContext,
  place: FilePlace,
): { text: string } & RewriteCount {
  const edits: Edit[] = [];
  let tree: Root;
  try {
    tree = parseMdast(body, format === 'mdx');
  } catch {
    // A body Vesper can't parse is left as it is; the site can't build it either.
    return { text: body, links: 0, paths: 0 };
  }
  const code: [number, number][] = [];
  visit(tree, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === 'code' || node.type === 'inlineCode') {
      code.push([start, end]);
    } else if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
      const span = destinationSpan(body, node, start, end);
      if (!span) return;
      const raw = body.slice(span.start, span.end);
      const address = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
      const replaced =
        node.type === 'image'
          ? fileRelative(address, context, place, false)
          : (siteLink(address, context) ?? urlRelative(address, context, place));
      if (replaced) edits.push({ ...span, text: wrap(raw, replaced.value), kind: replaced.kind });
    } else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      edits.push(...jsxEdits(body.slice(start, end), start, context));
    } else if (node.type === 'mdxjsEsm') {
      edits.push(...importEdits(body.slice(start, end), start, context, place));
    } else if (node.type === 'html') {
      edits.push(...htmlEdits(body.slice(start, end), start, context));
    }
  });
  if (format === 'mdoc') {
    const inCode = (offset: number) => code.some(([s, e]) => offset >= s && offset < e);
    for (const tag of markdocTags(body)) {
      if (inCode(tag.start) || (tag.kind !== 'tag_open' && tag.kind !== 'tag')) continue;
      edits.push(...markdocEdits(body.slice(tag.start, tag.end), tag.start, context, place));
    }
  }
  return applyEdits(body, edits);
}

/**
 * Rewrites values: URL-widget fields that link to moved pages, and any
 * string that's a file-relative path (`./`, `../`). `fields` are the
 * collection's field models; without them only relative paths change.
 */
export function rewriteValues(
  data: DataValue,
  fields: readonly FieldModel[] | null,
  context: LinkContext,
  place: FilePlace,
): { data: DataValue } & RewriteCount {
  const count: RewriteCount = { links: 0, paths: 0 };
  const walk = (value: DataValue, model: FieldModel | undefined): DataValue => {
    if (typeof value === 'string') {
      if (model?.widget === 'url') {
        const link = siteLink(value, context);
        if (link) {
          count.links++;
          return link.value;
        }
      }
      if (value.startsWith('./') || value.startsWith('../')) {
        const path = fileRelative(value, context, place, true);
        if (path) {
          count.paths++;
          return path.value;
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      const item = model?.kind === 'array' ? model.children?.[0] : undefined;
      return value.map((v) => walk(v, item));
    }
    if (isPlainObject(value)) {
      const children = model ? childrenFor(model, value) : fields;
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [
          key,
          walk(
            v,
            children?.find((c) => c.path.at(-1) === key),
          ),
        ]),
      );
    }
    return value;
  };
  const next = walk(data, undefined);
  return { data: next, ...count };
}

// --- Single addresses ------------------------------------------------------

type Replacement = { value: string; kind: keyof RewriteCount };

/** A root-relative or own-origin link to a moved page, rewritten. */
function siteLink(raw: string, context: LinkContext): Replacement | null {
  const parsed = parseSiteUrl(raw, context.settings);
  if (!parsed) return null;
  const next = context.pages.get(parsed.key);
  if (next === undefined) return null;
  return { value: reshapeUrl(parsed, next, context.settings), kind: 'links' };
}

/**
 * A link relative to the page's own URL (`nursing/`, `../apply/`). When the
 * page or its target moves, it becomes root-relative: the one form that
 * can't be misread from the new place.
 */
function urlRelative(raw: string, context: LinkContext, place: FilePlace): Replacement | null {
  if (!place.url || raw === '' || /^[a-z][a-z\d+.-]*:|^\/|^#|^\?/i.test(raw)) return null;
  const origin = 'http://vesper.invalid';
  let before: URL;
  let after: URL;
  try {
    before = new URL(raw, origin + place.url.from);
    after = new URL(raw, origin + place.url.to);
  } catch {
    return null;
  }
  const key = urlKey(before.pathname, context.settings);
  if (key === null) return null;
  const target = context.pages.get(key) ?? key;
  if (urlKey(after.pathname, context.settings) === target) return null;
  return {
    value: formatUrl(target, context.settings) + before.search + before.hash,
    kind: 'links',
  };
}

/**
 * A path relative to the file (`./market.jpg`, `../../components/x.astro`),
 * recomputed when the file or its target moves. `dotted` keeps a leading
 * `./` for paths that need one (frontmatter and imports).
 */
function fileRelative(
  raw: string,
  context: LinkContext,
  place: FilePlace,
  dotted: boolean,
): Replacement | null {
  if (raw === '' || /^[a-z][a-z\d+.-]*:|^\/|^#|^\?|^~|^@/i.test(raw)) return null;
  const cut = raw.search(/[?#]/);
  const path = cut === -1 ? raw : raw.slice(0, cut);
  const suffix = cut === -1 ? '' : raw.slice(cut);
  const target = resolveFrom(dirOf(place.path.from), path);
  if (target === null) return null;
  const moved = context.files.get(target) ?? target;
  if (moved === target && place.path.from === place.path.to) return null;
  let next = relativePath(dirOf(place.path.to), moved);
  if (!dotted && !path.startsWith('./') && next.startsWith('./')) next = next.slice(2);
  if (next === path) return null;
  return { value: next + suffix, kind: 'paths' };
}

function resolveFrom(dir: string, path: string): string | null {
  const parts = dir.split('/').filter(Boolean);
  for (const segment of path.split('/')) {
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return parts.join('/');
}

/** Keeps `<…>` around a destination written that way. */
function wrap(raw: string, value: string): string {
  return raw.startsWith('<') && raw.endsWith('>') ? `<${value}>` : value;
}

// --- Finding addresses in a body -------------------------------------------

/**
 * Where a link's destination sits in the source: after `](` for inline
 * links and images, after `]:` for definitions. Reference-style links and
 * autolinks return null (their address is elsewhere, or is the text).
 */
function destinationSpan(
  body: string,
  node: Extract<Nodes, { type: 'link' | 'image' | 'definition' }>,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let i: number;
  if (node.type === 'definition') {
    const colon = body.indexOf(']:', start);
    if (colon === -1 || colon >= end) return null;
    i = colon + 2;
  } else {
    if (body[end - 1] !== ')') return null;
    let close: number;
    if (node.type === 'link') {
      const last = node.children.at(-1)?.position?.end.offset;
      close = last ?? start + 1;
    } else {
      close = body.indexOf('](', start + 2);
    }
    if (body.slice(close, close + 2) !== '](') return null;
    i = close + 2;
  }
  while (i < end && /[ \t\r\n]/.test(body[i] ?? '')) i++;
  if (body[i] === '<') {
    const closeAngle = body.indexOf('>', i);
    if (closeAngle === -1 || closeAngle >= end) return null;
    return { start: i, end: closeAngle + 1 };
  }
  let depth = 0;
  let j = i;
  for (; j < end; j++) {
    const c = body[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === undefined || /\s/.test(c)) break;
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0) break;
      depth--;
    }
  }
  if (j === i) return null;
  const raw = body.slice(i, j);
  // Escapes and entities would need decoding to compare; such links are left alone.
  if (/[\\&]/.test(raw)) return null;
  return { start: i, end: j };
}

function jsxEdits(text: string, offset: number, context: LinkContext): Edit[] {
  const layout = jsxTagLayout(text);
  if (!layout) return [];
  const edits: Edit[] = [];
  for (const attribute of layout.attributes) {
    if (attribute.kind !== 'string' || typeof attribute.value !== 'string') continue;
    const link = siteLink(attribute.value, context);
    if (!link) continue;
    edits.push({
      start: offset + attribute.start,
      end: offset + attribute.end,
      text: jsxAttribute(attribute.name, link.value),
      kind: 'links',
    });
  }
  return edits;
}

function markdocEdits(
  text: string,
  offset: number,
  context: LinkContext,
  place: FilePlace,
): Edit[] {
  const layout = markdocTagLayout(text);
  if (!layout) return [];
  const edits: Edit[] = [];
  for (const span of layout.attributes) {
    if (span.kind !== 'attribute') continue;
    const valueText = text.slice(span.valueStart, span.valueEnd);
    if (!valueText.startsWith('"')) continue;
    let value: unknown;
    try {
      value = JSON.parse(valueText.replace(/\\([^"\\nrt])/g, '$1'));
    } catch {
      continue;
    }
    if (typeof value !== 'string') continue;
    // A partial's file is relative to the entry (spec §6.5.1); other attributes may hold page URLs.
    const replaced =
      layout.name === 'partial' && span.key === 'file'
        ? fileRelative(value, context, place, false)
        : siteLink(value, context);
    if (!replaced) continue;
    edits.push({
      start: offset + span.valueStart,
      end: offset + span.valueEnd,
      text: markdocValue(replaced.value),
      kind: replaced.kind,
    });
  }
  return edits;
}

/** Relative module paths in MDX `import … from '…'` and `export … from '…'` lines. */
function importEdits(text: string, offset: number, context: LinkContext, place: FilePlace): Edit[] {
  const edits: Edit[] = [];
  const pattern = /(\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"\n]*)\2/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const [, lead = '', quote = '', path = ''] = match;
    const replaced = fileRelative(path, context, place, true);
    if (!replaced) continue;
    const start = offset + match.index + lead.length + quote.length;
    edits.push({ start, end: start + path.length, text: replaced.value, kind: 'paths' });
  }
  return edits;
}

/** `href` and `src` attributes in raw HTML that link to moved pages. */
function htmlEdits(text: string, offset: number, context: LinkContext): Edit[] {
  const edits: Edit[] = [];
  const pattern = /\s(?:href|src)\s*=\s*(["'])([^"'<>]*)\1/gi;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const [whole, quote = '', value = ''] = match;
    const link = siteLink(value, context);
    if (!link) continue;
    const start = offset + match.index + whole.length - quote.length - value.length;
    edits.push({ start, end: start + value.length, text: link.value, kind: 'links' });
  }
  return edits;
}

function applyEdits(text: string, edits: Edit[]): { text: string } & RewriteCount {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  const count: RewriteCount = { links: 0, paths: 0 };
  for (const edit of sorted) {
    if (edit.start < at) continue; // Overlapping spans: the first one wins.
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
    count[edit.kind]++;
  }
  return { text: out + text.slice(at), ...count };
}

function visit(node: Nodes, fn: (node: Nodes) => void): void {
  fn(node);
  if ('children' in node) for (const child of node.children as Nodes[]) visit(child, fn);
}
