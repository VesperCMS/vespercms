import Markdoc from '@markdoc/markdoc';
import type { Nodes, Root, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { gfm } from 'micromark-extension-gfm';
import { mdxjs } from 'micromark-extension-mdxjs';
import { lineEndings, lineStarts, withLineEnding } from './text.ts';

/*
 * Bodies as top-level blocks with exact source ranges (DECISIONS.md, "The
 * body editor splices changed blocks into the original text").
 *
 * Bodies are parsed with the parser the site renders with: micromark with
 * GFM for Markdown (Astro's default), plus the MDX extensions for .mdx, and
 * Markdoc's own parser for .mdoc. On save, unchanged blocks are copied
 * byte for byte, and so is the whitespace between two untouched
 * neighbours. Only changed or new blocks are new text.
 */

export type BodyFormat = 'md' | 'mdx' | 'mdoc';

export type BodyBlock = {
  /** Offsets of the block's own text in the body, without surrounding blank lines. */
  start: number;
  end: number;
  /**
   * `markdown`: plain Markdown the writing view can show faithfully.
   * `source`: anything it can't (JSX, expressions, imports, raw HTML,
   * Markdoc tags, link definitions). Edited as raw text, never reformatted.
   */
  kind: 'markdown' | 'source';
  /** The parser's node type, such as `paragraph`, `heading`, `mdxJsxFlowElement` or `tag`. */
  type: string;
};

export type ParsedBody = { blocks: BodyBlock[]; text: string };

export function parseBody(body: string, format: BodyFormat): ParsedBody {
  return {
    text: body,
    blocks: format === 'mdoc' ? markdocBlocks(body) : mdastBlocks(body, format === 'mdx'),
  };
}

/**
 * Node types the writing view can show and write back faithfully. Anything
 * else makes the whole block a protected source block: JSX, expressions,
 * imports, raw HTML, tables, footnotes, reference-style links and images,
 * task list items, and links or images with a title.
 */
const WRITABLE_TYPES = new Set([
  'paragraph',
  'heading',
  'list',
  'listItem',
  'blockquote',
  'code',
  'thematicBreak',
  'text',
  'emphasis',
  'strong',
  'inlineCode',
  'link',
  'image',
  'break',
  'delete',
]);

function writable(node: Nodes): boolean {
  if (!WRITABLE_TYPES.has(node.type)) return false;
  if (node.type === 'listItem' && node.checked !== null && node.checked !== undefined) return false;
  if ((node.type === 'link' || node.type === 'image') && node.title) return false;
  return !('children' in node) || (node.children as Nodes[]).every(writable);
}

function mdastBlocks(body: string, mdx: boolean): BodyBlock[] {
  let tree: Root;
  try {
    tree = fromMarkdown(body, {
      extensions: mdx ? [gfm(), mdxjs()] : [gfm()],
      mdastExtensions: mdx ? [gfmFromMarkdown(), mdxFromMarkdown()] : [gfmFromMarkdown()],
    });
  } catch {
    // MDX that doesn't parse: the whole body is one protected source block.
    return wholeBody(body);
  }
  return tree.children.flatMap((node: RootContent): BodyBlock[] => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return [];
    return [{ start, end, kind: writable(node) ? 'markdown' : 'source', type: node.type }];
  });
}

type MarkdocNode = {
  type: string;
  lines: number[];
  children: MarkdocNode[];
  attributes?: Record<string, unknown>;
  annotations?: unknown[];
};

/** Markdoc node types the writing view can show (Phase 2.5 adds tag blocks and chips). */
const MARKDOC_WRITABLE_TYPES = new Set([
  'paragraph',
  'heading',
  'list',
  'item',
  'blockquote',
  'fence',
  'hr',
  'inline',
  'text',
  'strong',
  'em',
  's',
  'link',
  'code',
  'image',
  'hardbreak',
  'softbreak',
]);

function markdocContainsSource(node: MarkdocNode, isRoot: boolean): boolean {
  if (!isRoot && !MARKDOC_WRITABLE_TYPES.has(node.type)) return true;
  if (node.annotations?.length) return true;
  // `{% $variable %}` and functions parse as text whose content isn't a string.
  if (node.type === 'text' && typeof node.attributes?.content !== 'string') return true;
  return node.children.some((child) => markdocContainsSource(child, false));
}

function markdocBlocks(body: string): BodyBlock[] {
  let ast: MarkdocNode;
  try {
    ast = Markdoc.parse(body);
  } catch {
    return wholeBody(body);
  }
  const starts = lineStarts(body);
  const lineEnd = (line: number) => {
    // End of `line`'s content: before its \n (and any \r before that).
    const next = starts[line + 1];
    if (next === undefined) return body.length;
    return body[next - 2] === '\r' ? next - 2 : next - 1;
  };
  return ast.children.flatMap((node): BodyBlock[] => {
    const first = node.lines[0];
    const last = node.lines.at(-1);
    if (first === undefined || last === undefined) return [];
    const start = starts[first] ?? body.length;
    const end = lineEnd(Math.max(first, last - 1));
    const kind = node.type === 'tag' || markdocContainsSource(node, true) ? 'source' : 'markdown';
    return [{ start, end, kind, type: node.type === 'tag' ? `tag` : node.type }];
  });
}

function wholeBody(body: string): BodyBlock[] {
  const start = body.search(/\S/);
  if (start === -1) return [];
  return [{ start, end: body.trimEnd().length, kind: 'source', type: 'unparsed' }];
}

/**
 * One block of the edited body: an original block kept as-is, or new text.
 * New text that `replaces` an original block takes that block's place, so the
 * whitespace around it is kept too.
 */
export type BodyItem = { keep: number } | { text: string; replaces?: number };

const anchorOf = (item: BodyItem): number | null =>
  'keep' in item ? item.keep : (item.replaces ?? null);

/**
 * Builds the new body from the original plus an ordered list of items.
 * - The text before the first block and after the last is always kept.
 * - Kept blocks copy their exact bytes.
 * - Two kept blocks that were neighbours keep the exact whitespace between them.
 * - Everywhere else, blocks are separated by one blank line in the body's
 *   own line ending.
 *
 * So keeping every block in order reproduces the input exactly.
 */
export function assembleBody(parsed: ParsedBody, items: readonly BodyItem[]): string {
  const { text, blocks } = parsed;
  const eol = lineEndings(text).dominant;
  const first = blocks[0];
  const last = blocks.at(-1);
  const leading = first ? text.slice(0, first.start) : text;
  const trailing = last ? text.slice(last.end) : '';

  let out = leading;
  let previous: number | null = null;
  items.forEach((item, i) => {
    const anchor = anchorOf(item);
    if (i > 0) {
      // Going forward through the original (neighbours, or blocks removed in
      // between), keep the exact whitespace that preceded this block.
      const before = anchor === null ? undefined : blocks[anchor - 1];
      const current = anchor === null ? undefined : blocks[anchor];
      out +=
        anchor !== null && previous !== null && anchor > previous && before && current
          ? text.slice(before.end, current.start)
          : eol + eol;
    } else if (!first && out !== '' && !out.endsWith('\n')) {
      out += eol;
    }
    if ('keep' in item) {
      const block = blocks[item.keep];
      if (!block) throw new RangeError(`No block ${String(item.keep)} in this body.`);
      out += text.slice(block.start, block.end);
    } else {
      out += withLineEnding(item.text.replace(/\s+$/, ''), eol);
    }
    previous = anchor;
  });

  if (items.length === 0) return first ? leading.replace(/\s+$/, '') + trailing : text;
  return out + (last ? trailing : eol);
}

/** Every block kept in order: the identity edit. */
export function keepAll(parsed: ParsedBody): BodyItem[] {
  return parsed.blocks.map((_, keep) => ({ keep }));
}
