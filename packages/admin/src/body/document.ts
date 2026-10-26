import type { JSONContent } from '@tiptap/core';
import type { MarkdownManager } from '@tiptap/markdown';
import {
  editTable,
  parseBody,
  type BodyBlock,
  type BodyFormat,
  type BodyItem,
  type MarkdocParseOptions,
  type ParsedBody,
  type TableEdit,
  type TableValue,
} from '@vesper/core';
import type { Catalog } from './catalog.ts';
import { hasPlaceholderCharacters, restoreChips, withPlaceholders } from './chips.ts';
import { WRITABLE_NODES, type ContainerTypes } from './nodes.ts';
import { cellFits, editorValue, savedValue } from './table.ts';

/*
 * The body as editor nodes, and back (DECISIONS.md: "The body editor splices
 * changed blocks into the original text"). Each block becomes one node
 * tagged with its path: Markdown the writing view can show faithfully, a
 * tag or component the site declares (a container with editable children,
 * or a card), or a protected source block. On save, a node whose content
 * didn't change copies its original bytes, a container re-writes its
 * opening only if its attributes changed, and only changed or new blocks
 * are written by the Markdown serializer.
 */

export type BodyContext = {
  format: BodyFormat;
  markdown: MarkdownManager;
  catalog: Catalog;
  containers: ContainerTypes;
  markdoc?: MarkdocParseOptions;
};

export type BodyDocument = {
  /** The text the document was built from, and its blocks. */
  parsed: ParsedBody;
  doc: JSONContent;
};

/** Builds the editor document for a body. */
export function buildDocument(body: string, context: BodyContext): BodyDocument {
  const parsed = parseBody(
    body,
    context.format,
    context.markdoc ? { markdoc: context.markdoc } : {},
  );
  const content = nodesOf(parsed.text, parsed.blocks, null, '', context, null);
  return {
    parsed,
    doc: { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] },
  };
}

const pathOf = (parent: string | null, index: number) =>
  parent === null ? String(index) : `${parent}.${String(index)}`;

function nodesOf(
  text: string,
  blocks: readonly BodyBlock[],
  parent: string | null,
  indent: string,
  context: BodyContext,
  allows: ((type: string) => boolean) | null,
): JSONContent[] {
  return blocks.map((block, index) => {
    const path = pathOf(parent, index);
    const node = nodeOf(text, block, path, indent, context);
    return allows && !allows(node.type ?? '') ? sourceNode(text, block, path) : node;
  });
}

function sourceNode(text: string, block: BodyBlock, path: string): JSONContent {
  return {
    type: 'sourceBlock',
    attrs: { vesperBlock: path, text: text.slice(block.start, block.end), blockType: block.type },
  };
}

function nodeOf(
  text: string,
  block: BodyBlock,
  path: string,
  indent: string,
  context: BodyContext,
): JSONContent {
  const raw = text.slice(block.start, block.end);
  if (block.kind === 'markdown' && !hasPlaceholderCharacters(raw)) {
    const chips = (block.chips ?? []).map((c) => ({
      start: c.start - block.start,
      end: c.end - block.start,
    }));
    const source = dedent(withPlaceholders(raw, chips), indent);
    const node = source === null ? null : writableNode(context.markdown, source);
    if (node) return { ...node, attrs: { ...node.attrs, vesperBlock: path } };
    return sourceNode(text, block, path);
  }
  if (block.kind === 'table' && block.table) {
    const value = editorValue(text, block.table);
    // Every cell must be one the writing view writes back, or the whole table is kept as written.
    const fits = value.rows.every((row) =>
      row.cells.every(
        (cell) => !hasPlaceholderCharacters(restoreChips(cell)) && cellFits(context.markdown, cell),
      ),
    );
    if (fits) return { type: 'vesperTable', attrs: { vesperBlock: path, value } };
    return sourceNode(text, block, path);
  }
  const tag = block.tag;
  const kind = block.kind === 'tag' && tag ? context.catalog.find(tag.syntax, tag.name) : undefined;
  if (!tag || !kind) return sourceNode(text, block, path);

  const containerType = context.containers.typeOf(kind);
  if (containerType && tag.children && tag.closeStart !== undefined) {
    const children = nodesOf(text, tag.children, path, tag.indent ?? '', context, (type) =>
      context.containers.allows(kind, type),
    );
    return {
      type: containerType,
      attrs: {
        vesperBlock: path,
        syntax: tag.syntax,
        name: tag.name,
        open: text.slice(block.start, tag.openEnd),
        close: text.slice(tag.closeStart, block.end),
      },
      content: children.length > 0 ? children : [{ type: 'paragraph' }],
    };
  }
  return {
    type: 'vesperCard',
    attrs: { vesperBlock: path, syntax: tag.syntax, name: tag.name, source: raw },
  };
}

/** Text with `indent` taken off every line after the first; null when a line isn't indented so. */
export function dedent(text: string, indent: string): string | null {
  if (indent === '') return text;
  const lines = text.split('\n');
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (i === 0) out.push(line);
    else if (line.trim() === '') out.push(line.trim());
    else if (line.startsWith(indent)) out.push(line.slice(indent.length));
    else return null;
  }
  return out.join('\n');
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

const isContainer = (node: JSONContent, containers: ContainerTypes) =>
  node.type !== undefined && containers.kindOf(node.type) !== undefined;

/** How every node with a path first looked: its JSON, or for a container its opening. */
export function snapshot(doc: JSONContent, containers: ContainerTypes): Map<string, string> {
  const initial = new Map<string, string>();
  const visit = (nodes: readonly JSONContent[] | undefined) => {
    for (const node of nodes ?? []) {
      const path = node.attrs?.vesperBlock as unknown;
      if (typeof path === 'string' && !initial.has(path)) {
        initial.set(
          path,
          isContainer(node, containers)
            ? JSON.stringify({ open: node.attrs?.open as unknown })
            : JSON.stringify(node),
        );
      }
      if (isContainer(node, containers)) visit(node.content);
    }
  };
  visit(doc.content);
  return initial;
}

/** The index of `path` within `parent`, when it's a direct child of it there. */
function childIndex(path: unknown, parent: string | null): number | null {
  if (typeof path !== 'string') return null;
  const dot = path.lastIndexOf('.');
  const parentPart = dot === -1 ? null : path.slice(0, dot);
  if (parentPart !== parent) return null;
  return Number(path.slice(dot + 1));
}

type ItemsContext = Pick<BodyContext, 'markdown' | 'containers'> & {
  parsed?: ParsedBody;
  /** How the body parses, for checking a changed table reads back. */
  format?: BodyFormat;
  markdoc?: MarkdocParseOptions;
};

/** The edited body as items: unchanged blocks keep their bytes, changed ones are written. */
export function bodyItems(
  doc: JSONContent,
  initial: ReadonlyMap<string, string>,
  context: ItemsContext,
): BodyItem[] {
  return itemsOf(doc.content, null, initial, context);
}

/** The original block at a path ("3", "3.1"), and the indentation of the container holding it. */
function blockAt(parsed: ParsedBody, path: string): { block: BodyBlock; indent: string } | null {
  let blocks: readonly BodyBlock[] = parsed.blocks;
  let indent = '';
  const parts = path.split('.');
  for (const [i, part] of parts.entries()) {
    const block = blocks[Number(part)];
    if (!block) return null;
    if (i === parts.length - 1) return { block, indent };
    if (!block.tag?.children) return null;
    blocks = block.tag.children;
    indent = block.tag.indent ?? '';
  }
  return null;
}

/** Each chip's source, in order, and the node with every chip's source blanked. */
function chipShape(node: JSONContent): { sources: string[]; shape: string } {
  const sources: string[] = [];
  const blank = (n: JSONContent): JSONContent => {
    if (n.type === 'vesperInline') {
      sources.push(String(n.attrs?.source ?? ''));
      return { ...n, attrs: { ...n.attrs, source: '' } };
    }
    return n.content ? { ...n, content: n.content.map(blank) } : n;
  };
  return { sources, shape: JSON.stringify(blank(node)) };
}

/**
 * When a Markdown block's only change is inside its chips (an inline tag's
 * settings, a variable edited as text), the chips' new text is spliced into
 * the block's original text, so nothing else in it is re-serialized: editing
 * one tag changes only that tag's text. Null when anything else changed.
 */
function chipSplice(
  node: JSONContent,
  path: string,
  initial: ReadonlyMap<string, string>,
  parsed: ParsedBody | undefined,
): string | null {
  const before = initial.get(path);
  const found = parsed ? blockAt(parsed, path) : null;
  if (!before || !parsed || !found?.block.chips) return null;
  const was = chipShape(JSON.parse(before) as JSONContent);
  const now = chipShape(node);
  const chips = found.block.chips;
  if (was.shape !== now.shape || now.sources.length !== chips.length) return null;
  let text = parsed.text.slice(found.block.start, found.block.end);
  // Right to left, so earlier offsets stay valid.
  for (let i = chips.length - 1; i >= 0; i--) {
    const chip = chips[i];
    if (!chip) return null;
    const from = chip.start - found.block.start;
    const to = chip.end - found.block.start;
    text = text.slice(0, from) + (now.sources[i] ?? '') + text.slice(to);
  }
  // The assembler indents lines after the first like their container's content.
  return dedent(text, found.indent);
}

function itemsOf(
  nodes: readonly JSONContent[] | undefined,
  parent: string | null,
  initial: ReadonlyMap<string, string>,
  context: ItemsContext,
): BodyItem[] {
  const items: BodyItem[] = [];
  for (const node of nodes ?? []) {
    const path = node.attrs?.vesperBlock as unknown;
    const index = childIndex(path, parent);
    if (isContainer(node, context.containers)) {
      const open = String(node.attrs?.open ?? '');
      if (index !== null && typeof path === 'string') {
        const before = initial.get(path);
        const children = itemsOf(node.content, path, initial, context);
        items.push({
          replaces: index,
          ...(before !== JSON.stringify({ open }) ? { open } : {}),
          children,
        });
      } else {
        items.push({
          open,
          close: String(node.attrs?.close ?? ''),
          children: itemsOf(node.content, null, initial, context),
        });
      }
      continue;
    }
    if (index !== null && typeof path === 'string' && initial.get(path) === JSON.stringify(node)) {
      items.push({ keep: index });
      continue;
    }
    if (node.type === 'vesperTable') {
      // The table view checked this change when it was made, so it can't be refused here.
      const edit = tableEdit(
        typeof path === 'string' ? path : null,
        node.attrs?.value as TableValue,
        context,
      );
      if (!edit.ok) throw new Error(edit.reason);
      items.push(index === null ? { text: edit.text } : { text: edit.text, replaces: index });
      continue;
    }
    const spliced =
      index !== null && typeof path === 'string'
        ? chipSplice(node, path, initial, context.parsed)
        : null;
    const text = spliced ?? nodeText(node, context.markdown);
    // An empty paragraph (the line the cursor sits on) writes nothing.
    if (text === '' && index === null) continue;
    items.push(index === null ? { text } : { text, replaces: index });
  }
  return items;
}

/**
 * A table's text as it will be saved: spliced into the table it was loaded
 * from (`path`), or written new. Refused when it wouldn't read back as this
 * table.
 */
export function tableEdit(
  path: string | null,
  value: TableValue,
  context: ItemsContext,
): TableEdit {
  if (!context.format) throw new Error('Saving a table needs the body’s format.');
  const options = {
    format: context.format,
    ...(context.markdoc ? { markdoc: context.markdoc } : {}),
  };
  const found = path !== null && context.parsed ? blockAt(context.parsed, path) : null;
  const table = found?.block.table;
  const source =
    found && table && context.parsed
      ? { text: context.parsed.text, table, indent: found.indent }
      : null;
  return editTable(source, savedValue(value), options);
}

/** A node's text as it will be saved. */
export function nodeText(node: JSONContent, markdown: MarkdownManager): string {
  if (node.type === 'sourceBlock') return String(node.attrs?.text ?? '');
  if (node.type === 'vesperCard') return String(node.attrs?.source ?? '');
  const { vesperBlock: _vesperBlock, ...attrs } = node.attrs ?? {};
  return restoreChips(
    markdown.serialize({ type: 'doc', content: [{ ...node, attrs }] }).replace(/\s+$/, ''),
  );
}

/** A plain-language name for a protected block, from its parser type. */
export function sourceLabel(blockType: string): string {
  const labels: Record<string, string> = {
    mdxjsEsm: 'Import',
    mdxJsxFlowElement: 'Component',
    mdxFlowExpression: 'Expression',
    html: 'HTML',
    html_block: 'HTML',
    comment: 'Comment',
    definition: 'Link reference',
    footnoteDefinition: 'Footnote',
    table: 'Table',
    tag: 'Markdoc tag',
    unparsed: 'Body that couldn’t be read',
  };
  return labels[blockType] ?? 'Formatted text';
}
