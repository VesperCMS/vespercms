import Markdoc from '@markdoc/markdoc';
import { lineStarts } from '../files/text.ts';
import { contentIndent, escapeRegExp, wholeBody } from './util.ts';
import { markdocTags } from './markdoc-tag.ts';
import type { BodyBlock, InlineChip, MarkdocParseOptions } from './types.ts';

/*
 * Markdoc bodies as blocks. Parsed exactly as Astro's @astrojs/markdoc
 * parses them (its tokenizer options), so a tag inside an HTML comment is a
 * comment here too, and inline HTML is HTML when the site allows it.
 *
 * Markdoc's tree records line ranges only, so offsets come from the lines,
 * and every inline chip found in the text is checked against the tree: when
 * the two disagree, the block is kept as written.
 */

type MarkdocNode = {
  type: string;
  tag?: string;
  lines: number[];
  inline?: boolean;
  children: MarkdocNode[];
  attributes?: Record<string, unknown>;
  annotations?: unknown[];
};

/** The tokenizer options @astrojs/markdoc uses for these integration options. */
export function markdocTokenizerOptions(options: MarkdocParseOptions = {}): {
  allowComments: true;
  html?: true;
  allowIndentation?: true;
} {
  return {
    allowComments: true,
    ...(options.allowHTML ? { html: true } : {}),
    ...(options.allowHTML || options.ignoreIndentation ? { allowIndentation: true } : {}),
  };
}

/** Parses a Markdoc body the way Astro does. Throws if Markdoc can't. */
export function parseMarkdoc(body: string, options: MarkdocParseOptions = {}): MarkdocNode {
  const tokenizer = new Markdoc.Tokenizer(markdocTokenizerOptions(options));
  const ast: unknown = Markdoc.parse(tokenizer.tokenize(body));
  return ast as MarkdocNode;
}

/** Markdoc node types the writing view shows as Markdown. */
const WRITABLE_TYPES = new Set([
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

export function markdocBlocks(body: string, options: MarkdocParseOptions = {}): BodyBlock[] {
  let ast: MarkdocNode;
  try {
    ast = parseMarkdoc(body, options);
  } catch {
    return wholeBody(body);
  }
  return blocksOf(ast.children, new Lines(body));
}

/** Line-to-offset arithmetic over the body. */
class Lines {
  readonly text: string;
  private readonly starts: number[];
  constructor(text: string) {
    this.text = text;
    this.starts = lineStarts(text);
  }
  /** Where `line`'s content starts, after its indentation. */
  contentStart(line: number): number {
    let i = this.starts[line] ?? this.text.length;
    while (this.text[i] === ' ' || this.text[i] === '\t') i++;
    return i;
  }
  lineStart(line: number): number {
    return this.starts[line] ?? this.text.length;
  }
  /** End of `line`'s content: before its \n (and any \r before that). */
  lineEnd(line: number): number {
    const next = this.starts[line + 1];
    if (next === undefined) return this.text.length;
    return this.text[next - 2] === '\r' ? next - 2 : next - 1;
  }
}

function blocksOf(nodes: readonly MarkdocNode[], lines: Lines): BodyBlock[] {
  return nodes.flatMap((node): BodyBlock[] => {
    const first = node.lines[0];
    const last = node.lines.at(-1);
    if (first === undefined || last === undefined) return [];
    const start = lines.contentStart(first);
    // Trailing whitespace (spaces on the last line, or a blank line Markdoc
    // counts into a list) belongs to the gap after the block, so it survives
    // when the block is rewritten.
    let end = Math.max(start, lines.lineEnd(Math.max(first, last - 1)));
    while (end > start && /\s/.test(lines.text[end - 1] ?? '')) end--;
    if (node.type === 'tag') return [tagBlock(node, start, end, lines)];
    const block = { start, end, type: node.type };
    if (!markdownShape(node)) return [{ ...block, kind: 'source' }];
    const chips = inlineChips(node, lines.text.slice(start, end), start);
    if (chips === null) return [{ ...block, kind: 'source' }];
    return [{ ...block, kind: 'markdown', ...(chips.length > 0 ? { chips } : {}) }];
  });
}

/** Every node is one the writing view writes back faithfully, or an inline tag, variable or annotation. */
function markdownShape(node: MarkdocNode): boolean {
  if (!WRITABLE_TYPES.has(node.type) && !(node.type === 'tag' && node.inline)) return false;
  if (node.type === 'tag') return true;
  return node.children.every(markdownShape);
}

function hasFence(node: MarkdocNode): boolean {
  return node.type === 'fence' || node.children.some(hasFence);
}

/**
 * The block's chips, from Markdoc's own tag scanner over the text (with code
 * spans blanked out), or null when they don't match the tree: the same
 * number of inline tags, and of variables and functions.
 */
function inlineChips(node: MarkdocNode, text: string, offset: number): InlineChip[] | null {
  const expected = { tags: 0, variables: 0 };
  const count = (n: MarkdocNode) => {
    if (n.type === 'tag') {
      expected.tags++;
      return;
    }
    if (n.type === 'text' && typeof n.attributes?.content !== 'string') expected.variables++;
    n.children.forEach(count);
  };
  node.children.forEach(count);
  if (!text.includes('{%')) return expected.tags + expected.variables === 0 ? [] : null;
  // A tag in a fence's info string or content is Markdoc's, not text to retype.
  if (hasFence(node)) return null;

  const chips: InlineChip[] = [];
  const open: { name: string; start: number }[] = [];
  for (const token of markdocTags(blankCode(text))) {
    if (token.kind === 'tag_open' && token.name) {
      open.push({ name: token.name, start: token.start });
    } else if (token.kind === 'tag_close') {
      const opened = open.pop();
      if (!opened || opened.name !== token.name) return null;
      // Only the outermost tag is a chip: what's inside belongs to it.
      if (open.length === 0) {
        chips.push({
          start: offset + opened.start,
          end: offset + token.end,
          kind: 'tag',
          name: opened.name,
        });
      }
    } else if (open.length === 0) {
      chips.push({
        start: offset + token.start,
        end: offset + token.end,
        kind: token.kind === 'tag' ? 'tag' : token.kind === 'variable' ? 'variable' : 'annotation',
        ...(token.name ? { name: token.name } : {}),
      });
    }
  }
  if (open.length > 0) return null;
  const tags = chips.filter((c) => c.kind === 'tag').length;
  const variables = chips.filter((c) => c.kind === 'variable').length;
  return tags === expected.tags && variables === expected.variables ? chips : null;
}

/** Code spans replaced by spaces of the same length, so tags inside them aren't found. */
function blankCode(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      out += text.charAt(i);
      i++;
      continue;
    }
    let run = 0;
    while (text[i + run] === '`') run++;
    const fence = '`'.repeat(run);
    let close = text.indexOf(fence, i + run);
    // The closing run must be exactly as long as the opening one.
    while (close !== -1 && text[close + run] === '`') {
      let next = close;
      while (text[next] === '`') next++;
      close = text.indexOf(fence, next);
    }
    if (close === -1) {
      out += fence;
      i += run;
      continue;
    }
    out += ' '.repeat(close + run - i);
    i = close + run;
  }
  return out;
}

/**
 * A tag as a block. Its opening must be the tag Markdoc saw, starting the
 * block. A tag with content gets its children only when the opening and the
 * closing each end and start their own lines and the children cover every
 * character between them. Otherwise it's kept whole (and its attributes can
 * still be edited), or, when even the opening can't be read, kept as written.
 */
function tagBlock(node: MarkdocNode, start: number, end: number, lines: Lines): BodyBlock {
  const text = lines.text;
  const fallback: BodyBlock = { start, end, kind: 'source', type: 'tag' };
  const [opening] = markdocTags(text.slice(start, end));
  if (opening?.start !== 0 || opening.name !== node.tag || !node.tag) return fallback;
  const openEnd = start + opening.end;
  const name = node.tag;
  if (opening.kind === 'tag') {
    if (text.slice(openEnd, end).trim() !== '') return fallback;
    return {
      start,
      end: openEnd,
      kind: 'tag',
      type: 'tag',
      tag: { syntax: 'markdoc', name, openEnd, selfClosing: true },
    };
  }
  if (opening.kind !== 'tag_open') return fallback;
  const whole: BodyBlock = {
    start,
    end,
    kind: 'tag',
    type: 'tag',
    tag: { syntax: 'markdoc', name, openEnd, selfClosing: false },
  };

  const [openFirst, openNext, closeFirst, closeNext] = node.lines;
  if (
    node.lines.length !== 4 ||
    openNext === undefined ||
    closeFirst === undefined ||
    closeNext === undefined ||
    openFirst === undefined
  ) {
    return whole;
  }
  const closeStart = lines.contentStart(closeFirst);
  const closing = text.slice(closeStart, lines.lineEnd(closeNext - 1)).replace(/[ \t]+$/, '');
  if (!new RegExp(`^\\{%\\s*/${escapeRegExp(name)}\\s*%\\}$`).test(closing)) return whole;
  if (closeFirst < openNext || text.slice(openEnd, lines.lineEnd(openNext - 1)).trim() !== '') {
    return whole;
  }

  const children = blocksOf(node.children, lines);
  let cursor = openEnd;
  for (const child of children) {
    if (child.start < cursor || text.slice(cursor, child.start).trim() !== '') return whole;
    cursor = child.end;
  }
  if (text.slice(cursor, closeStart).trim() !== '') return whole;

  return {
    ...whole,
    end: closeStart + closing.length,
    tag: {
      syntax: 'markdoc',
      name,
      openEnd,
      selfClosing: false,
      closeStart,
      children,
      indent: contentIndent(text, openEnd, closeStart, children),
    },
  };
}
