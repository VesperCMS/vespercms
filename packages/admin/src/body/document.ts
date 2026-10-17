import { Extension, Node, type JSONContent } from '@tiptap/core';
import type { MarkdownManager } from '@tiptap/markdown';
import { parseBody, type BodyFormat, type BodyItem, type ParsedBody } from '@vesper/core';

/*
 * The body as blocks (DECISIONS.md: "The body editor splices changed blocks
 * into the original text"). Each Markdown block becomes one editor node
 * tagged with its index; anything the writing view can't show faithfully
 * becomes a protected source block. On save, a node whose content didn't
 * change copies its original bytes, and only changed or new blocks are
 * written by the Markdown serializer.
 */

/** Editor node types a Markdown block may become. Anything else stays source. */
const WRITABLE_NODES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
]);

/** Remembers which original block a node came from. Not copied when a block is split. */
export const BlockIndex = Extension.create({
  name: 'vesperBlockIndex',
  addGlobalAttributes() {
    return [
      {
        types: [...WRITABLE_NODES],
        attributes: {
          vesperBlock: { default: null, keepOnSplit: false, rendered: false },
        },
      },
    ];
  },
});

/** A block the writing view can't show: kept exactly, edited in the source view. */
export const SourceBlock = Node.create({
  name: 'sourceBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      index: { default: null, rendered: false },
      text: { default: '', rendered: false },
      blockType: { default: '', rendered: false },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ['div', { 'data-vesper-source': '' }];
  },
});

export type BodyDocument = {
  /** The text the document was built from, and its blocks. */
  parsed: ParsedBody;
  doc: JSONContent;
};

/** Builds the editor document for a body. */
export function buildDocument(
  body: string,
  format: BodyFormat,
  markdown: MarkdownManager,
): BodyDocument {
  const parsed = parseBody(body, format);
  const content = parsed.blocks.map((block, index): JSONContent => {
    const text = body.slice(block.start, block.end);
    const node = block.kind === 'markdown' ? writableNode(markdown, text) : null;
    if (node) return { ...node, attrs: { ...node.attrs, vesperBlock: index } };
    return { type: 'sourceBlock', attrs: { index, text, blockType: block.type } };
  });
  return {
    parsed,
    doc: { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] },
  };
}

/**
 * The one editor node a Markdown block becomes, or null when the writing
 * view can't own it: it isn't exactly one supported node, or saving it would
 * read back differently (a lossy parse would show the editor something
 * other than what the site renders).
 */
function writableNode(markdown: MarkdownManager, text: string): JSONContent | null {
  try {
    const nodes = markdown.parse(text).content ?? [];
    const [node] = nodes;
    if (nodes.length !== 1 || !node?.type || !WRITABLE_NODES.has(node.type)) return null;
    const again =
      markdown.parse(markdown.serialize({ type: 'doc', content: [node] })).content ?? [];
    return again.length === 1 && JSON.stringify(again[0]) === JSON.stringify(node) ? node : null;
  } catch {
    return null;
  }
}

/** The JSON of each block-tagged node as the editor first holds it, by block index. */
export function snapshot(doc: JSONContent): Map<number, string> {
  const initial = new Map<number, string>();
  for (const node of doc.content ?? []) {
    const index = node.attrs?.vesperBlock as unknown;
    if (typeof index === 'number' && !initial.has(index)) initial.set(index, JSON.stringify(node));
  }
  return initial;
}

/** The edited body: unchanged blocks keep their bytes, changed ones are serialized. */
export function bodyItems(
  doc: JSONContent,
  initial: ReadonlyMap<number, string>,
  markdown: MarkdownManager,
): BodyItem[] {
  const items: BodyItem[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === 'sourceBlock') {
      const index = node.attrs?.index as unknown;
      if (typeof index === 'number') items.push({ keep: index });
      continue;
    }
    const index = node.attrs?.vesperBlock as unknown;
    const block = typeof index === 'number' ? index : undefined;
    if (block !== undefined && initial.get(block) === JSON.stringify(node)) {
      items.push({ keep: block });
      continue;
    }
    const { vesperBlock: _vesperBlock, ...attrs } = node.attrs ?? {};
    const text = markdown
      .serialize({ type: 'doc', content: [{ ...node, attrs }] })
      .replace(/\s+$/, '');
    // An empty paragraph (the line the cursor sits on) writes nothing.
    if (text === '' && block === undefined) continue;
    items.push(block === undefined ? { text } : { text, replaces: block });
  }
  return items;
}

/** A plain-language name for a protected block, from its parser type. */
export function sourceLabel(blockType: string): string {
  const labels: Record<string, string> = {
    mdxjsEsm: 'Import',
    mdxJsxFlowElement: 'Component',
    mdxFlowExpression: 'Expression',
    html: 'HTML',
    definition: 'Link reference',
    footnoteDefinition: 'Footnote',
    table: 'Table',
    tag: 'Markdoc tag',
    unparsed: 'Body that couldn’t be read',
  };
  return labels[blockType] ?? 'Formatted text';
}
