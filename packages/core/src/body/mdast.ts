import type { Nodes, Root, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { gfm } from 'micromark-extension-gfm';
import { mdxjs } from 'micromark-extension-mdxjs';
import { contentIndent, escapeRegExp, wholeBody } from './util.ts';
import type { BodyBlock, InlineChip } from './types.ts';

/*
 * Markdown and MDX bodies as blocks, parsed with micromark as Astro does
 * (GFM, plus the MDX extensions for .mdx). In MDX, JSX elements become tag
 * blocks (containers when laid out on their own lines), and inline JSX and
 * expressions inside a paragraph become chips.
 */

/**
 * Node types the writing view can show and write back faithfully. Anything
 * else makes the whole block a protected source block: flow expressions,
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

/** Inline MDX the writing view keeps as one chip each. */
const CHIP_TYPES = new Set(['mdxJsxTextElement', 'mdxTextExpression']);

function writable(node: Nodes): boolean {
  if (CHIP_TYPES.has(node.type)) return true;
  if (!WRITABLE_TYPES.has(node.type)) return false;
  if (node.type === 'listItem' && node.checked !== null && node.checked !== undefined) return false;
  if ((node.type === 'link' || node.type === 'image') && node.title) return false;
  return !('children' in node) || (node.children as Nodes[]).every(writable);
}

export function parseMdast(body: string, mdx: boolean): Root {
  return fromMarkdown(body, {
    extensions: mdx ? [gfm(), mdxjs()] : [gfm()],
    mdastExtensions: mdx ? [gfmFromMarkdown(), mdxFromMarkdown()] : [gfmFromMarkdown()],
  });
}

export function mdastBlocks(body: string, mdx: boolean): BodyBlock[] {
  let tree: Root;
  try {
    tree = parseMdast(body, mdx);
  } catch {
    // MDX that doesn't parse: the whole body is one protected source block.
    return wholeBody(body);
  }
  return blocksOf(tree.children, body);
}

function blocksOf(nodes: readonly RootContent[], body: string): BodyBlock[] {
  return nodes.flatMap((node): BodyBlock[] => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return [];
    if (node.type === 'mdxJsxFlowElement') return [elementBlock(node, start, end, body)];
    if (!writable(node)) return [{ start, end, kind: 'source', type: node.type }];
    const chips = chipsOf(node);
    return [
      { start, end, kind: 'markdown', type: node.type, ...(chips.length > 0 ? { chips } : {}) },
    ];
  });
}

function chipsOf(node: Nodes): InlineChip[] {
  if (CHIP_TYPES.has(node.type)) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return [];
    const name = node.type === 'mdxJsxTextElement' ? node.name : null;
    return [
      {
        start,
        end,
        kind: node.type === 'mdxJsxTextElement' ? 'component' : 'expression',
        ...(name ? { name } : {}),
      },
    ];
  }
  return 'children' in node ? (node.children as Nodes[]).flatMap(chipsOf) : [];
}

type FlowElement = Extract<RootContent, { type: 'mdxJsxFlowElement' }>;

/**
 * A JSX element as a block. Fragments and elements whose opening can't be
 * located exactly are kept as written. An element with children gets them as
 * blocks when its opening ends its line and its closing starts its own.
 */
function elementBlock(node: FlowElement, start: number, end: number, body: string): BodyBlock {
  const fallback: BodyBlock = { start, end, kind: 'source', type: node.type };
  const { name } = node;
  if (!name) return fallback;
  const nameAt = body.indexOf(name, start);
  if (nameAt === -1 || body.slice(start + 1, nameAt).trim() !== '') return fallback;
  let cursor = nameAt + name.length;
  for (const attribute of node.attributes) {
    const attributeEnd = attribute.position?.end.offset;
    if (attributeEnd === undefined) return fallback;
    cursor = Math.max(cursor, attributeEnd);
  }
  while (/\s/.test(body[cursor] ?? '')) cursor++;
  if (body.startsWith('/>', cursor)) {
    const openEnd = cursor + 2;
    if (openEnd !== end) return fallback;
    return {
      start,
      end,
      kind: 'tag',
      type: node.type,
      tag: { syntax: 'mdx', name, openEnd, selfClosing: true },
    };
  }
  if (body[cursor] !== '>') return fallback;
  const openEnd = cursor + 1;
  const whole: BodyBlock = {
    start,
    end,
    kind: 'tag',
    type: node.type,
    tag: { syntax: 'mdx', name, openEnd, selfClosing: false },
  };

  const closeStart = body.lastIndexOf('</', end - 1);
  if (closeStart < openEnd) return whole;
  if (!new RegExp(`^</\\s*${escapeRegExp(name)}\\s*>$`).test(body.slice(closeStart, end))) {
    return whole;
  }
  // The opening ends its line, and the closing starts its own.
  const afterOpen = body.slice(
    openEnd,
    body.indexOf('\n', openEnd) === -1 ? end : body.indexOf('\n', openEnd),
  );
  const beforeClose = body.slice(body.lastIndexOf('\n', closeStart - 1) + 1, closeStart);
  if (
    afterOpen.trim() !== '' ||
    beforeClose.trim() !== '' ||
    !body.slice(openEnd, closeStart).includes('\n')
  ) {
    return whole;
  }
  const children = blocksOf(node.children, body);
  let at = openEnd;
  for (const child of children) {
    if (child.start < at || body.slice(at, child.start).trim() !== '') return whole;
    at = child.end;
  }
  if (body.slice(at, closeStart).trim() !== '') return whole;
  return {
    ...whole,
    tag: {
      syntax: 'mdx',
      name,
      openEnd,
      selfClosing: false,
      closeStart,
      children,
      indent: contentIndent(body, openEnd, closeStart, children),
    },
  };
}
