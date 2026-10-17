import { Extension, Node, type AnyExtension } from '@tiptap/core';
import type { BlockKind, Catalog } from './catalog.ts';
import { chipPlaceholder, decodeHex } from './chips.ts';

/*
 * The editor's node types for bodies (DECISIONS.md, "The writing view owns
 * only blocks it can round-trip"). Every block-level node carries the path
 * of the original block it was loaded from (`vesperBlock`: "3", or "3.1" for
 * a container's second child), so a save can keep its bytes when it's
 * unchanged. Paths are never copied when a block is split or pasted.
 */

/** Editor node types a Markdown block may become. Anything else stays source. */
export const WRITABLE_NODES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
]);

const blockPath = { default: null, keepOnSplit: false, rendered: false } as const;

/** Remembers which original block a Markdown node came from. */
export const BlockIndex = Extension.create({
  name: 'vesperBlockIndex',
  addGlobalAttributes() {
    return [{ types: [...WRITABLE_NODES], attributes: { vesperBlock: blockPath } }];
  },
});

/** A block the writing view can't show: kept exactly, editable as raw text. */
export const SourceBlock = Node.create({
  name: 'sourceBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      vesperBlock: blockPath,
      text: { default: '', rendered: false },
      blockType: { default: '', rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-vesper-source]',
        getAttrs: (element) => ({
          text: element.getAttribute('data-text') ?? '',
          blockType: element.getAttribute('data-block-type') ?? '',
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      'div',
      {
        'data-vesper-source': '',
        'data-text': String(node.attrs.text ?? ''),
        'data-block-type': String(node.attrs.blockType ?? ''),
      },
    ];
  },
});

/** A tag or component without editable content (spec §6.5.1: "a compact card"). Its whole text is `source`. */
export const VesperCard = Node.create({
  name: 'vesperCard',
  group: 'block vesperTag',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      vesperBlock: blockPath,
      syntax: { default: 'markdoc', rendered: false },
      name: { default: '', rendered: false },
      source: { default: '', rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-vesper-card]',
        getAttrs: (element) => ({
          syntax: element.getAttribute('data-syntax') ?? 'markdoc',
          name: element.getAttribute('data-name') ?? '',
          source: element.getAttribute('data-source') ?? '',
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      'div',
      {
        'data-vesper-card': '',
        'data-syntax': String(node.attrs.syntax),
        'data-name': String(node.attrs.name),
        'data-source': String(node.attrs.source),
      },
    ];
  },
});

/**
 * An inline chip: an inline tag, a variable, an annotation, inline JSX or an
 * expression. Its text is `source`. To the Markdown parser and serializer it
 * is one placeholder (see chips.ts).
 */
export const VesperInline = Node.create({
  name: 'vesperInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { source: { default: '', rendered: false } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-vesper-chip]',
        getAttrs: (element) => ({ source: element.getAttribute('data-source') ?? '' }),
      },
    ];
  },
  renderHTML({ node }) {
    return ['span', { 'data-vesper-chip': '', 'data-source': String(node.attrs.source) }];
  },
  markdownTokenizer: {
    name: 'vesperInline',
    level: 'inline',
    start: (src) => src.indexOf(''),
    tokenize: (src) => {
      const match = /^([0-9a-f]*)/.exec(src);
      return match ? { type: 'vesperInline', raw: match[0], hex: match[1] } : undefined;
    },
  },
  parseMarkdown: (token, helpers) =>
    helpers.createNode('vesperInline', { source: decodeHex(String(token.hex ?? '')) }),
  renderMarkdown: (node) => chipPlaceholder(String(node.attrs?.source ?? '')),
});

/** Markdoc child node types, as editor node types. */
const CHILD_TYPES: Record<string, string[]> = {
  paragraph: ['paragraph'],
  list: ['bulletList', 'orderedList'],
  heading: ['heading'],
  blockquote: ['blockquote'],
  fence: ['codeBlock'],
  hr: ['horizontalRule'],
  image: ['paragraph'],
  tag: ['vesperTag'],
};

export type ContainerTypes = {
  /** Editor node types for containers, one per kind that has content. */
  extensions: AnyExtension[];
  /** The editor node type for a kind's container. */
  typeOf: (kind: BlockKind) => string | undefined;
  /** The kind behind a container node type. */
  kindOf: (type: string) => BlockKind | undefined;
  /** Whether a node of `type` may sit directly inside a container of `kind`. */
  allows: (kind: BlockKind, type: string) => boolean;
};

/**
 * One container node type per tag or component with content. Its content
 * expression comes from Markdoc's `children`, so only allowed node types
 * fit inside (spec §6.5.1), and protected blocks always do.
 */
export function containerTypes(catalog: Catalog): ContainerTypes {
  const byType = new Map<string, BlockKind>();
  const typeByKey = new Map<string, string>();
  const allowed = new Map<string, Set<string> | null>();
  const extensions: AnyExtension[] = [];
  let n = 0;
  for (const kind of catalog.kinds.values()) {
    if (kind.block !== 'container') continue;
    const type = `vesperTag${String(n++)}_${kind.name.replace(/[^A-Za-z0-9]/g, '')}`;
    byType.set(type, kind);
    typeByKey.set(kind.key, type);
    const children = kind.children?.flatMap((child) => CHILD_TYPES[child] ?? []);
    const set = children ? new Set([...children, 'sourceBlock']) : null;
    allowed.set(kind.key, set);
    const content = set ? `(${[...set].join(' | ')})+` : 'block+';
    extensions.push(containerNode(type, content, kind));
  }
  return {
    extensions,
    typeOf: (kind) => typeByKey.get(kind.key),
    kindOf: (type) => byType.get(type),
    allows: (kind, type) => {
      const set = allowed.get(kind.key);
      if (set === undefined || set === null) return true;
      if (set.has(type)) return true;
      return set.has('vesperTag') && (type === 'vesperCard' || byType.has(type));
    },
  };
}

function containerNode(type: string, content: string, kind: BlockKind): AnyExtension {
  return Node.create({
    name: type,
    group: 'block vesperTag',
    content,
    defining: true,
    isolating: true,
    draggable: false,
    selectable: true,
    addAttributes() {
      return {
        vesperBlock: blockPath,
        syntax: { default: kind.syntax, rendered: false },
        name: { default: kind.name, rendered: false },
        open: { default: '', rendered: false },
        close: { default: '', rendered: false },
      };
    },
    parseHTML() {
      return [
        {
          tag: `div[data-vesper-container="${type}"]`,
          getAttrs: (element) => ({
            open: element.getAttribute('data-open') ?? '',
            close: element.getAttribute('data-close') ?? '',
          }),
        },
      ];
    },
    renderHTML({ node }) {
      return [
        'div',
        {
          'data-vesper-container': type,
          'data-open': String(node.attrs.open),
          'data-close': String(node.attrs.close),
        },
        0,
      ];
    },
  });
}
