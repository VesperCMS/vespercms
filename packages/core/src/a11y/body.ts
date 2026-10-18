import type { Nodes, Root } from 'mdast';
import { parseMarkdoc } from '../body/markdoc.ts';
import { parseMdast } from '../body/mdast.ts';
import type { BodyFormat, MarkdocParseOptions } from '../body/types.ts';
import { lineOf, lineStarts } from '../files/text.ts';
import type { MarkdocManifest, MdxManifest } from '../markdoc/types.ts';
import { htmlElements, plainText } from './html.ts';
import { A11Y_RULES, type A11yRuleId } from './rules.ts';
import {
  ALT_TEXT_LIMIT,
  fileNameOf,
  isFakeList,
  looksLikeFileName,
  quoted,
  redundantAltPrefix,
  saysNewWindow,
  vagueLinkText,
} from './text.ts';
import type { A11yNote, A11yTarget, PdfTarget } from './types.ts';

/*
 * Layer-1 checks over a body (spec §6.18). Each format is read with the
 * parser the site renders it with (micromark for Markdown and MDX, Markdoc
 * with Astro's tokenizer options), turned into a short list of facts
 * (images, links, headings, tables, paragraphs, tags) with their offsets,
 * and the rules run over the facts, so the three formats share every rule.
 */

type Span = { start: number; end: number };

export type BodyFact = Span &
  (
    | { kind: 'image'; alt: string | null; src: string }
    | {
        kind: 'link';
        text: string;
        href: string;
        target?: string;
        label?: string;
        title?: string;
      }
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'table'; header: boolean }
    | { kind: 'paragraph'; source: string }
    | {
        kind: 'tag';
        syntax: 'markdoc' | 'mdx';
        name: string;
        /** Literal values; anything computed (a variable, an expression) is `{ dynamic: true }`. */
        attributes: Record<string, unknown>;
      }
  );

/** What the tag rules need to know about one tag or component. */
export type TagDefinition = {
  label: string;
  /** Required attributes that are the embed's accessible name, with their labels. */
  names: { name: string; label: string }[];
  /** The attribute that says the video has captions, when the schema has one. */
  captions?: string;
};

export type TagDefinitions = {
  markdoc: ReadonlyMap<string, TagDefinition>;
  mdx: ReadonlyMap<string, TagDefinition>;
};

/** Attribute names that hold an embed's accessible name. */
const NAME_ATTRIBUTES = new Set(['title', 'alt', 'label', 'arialabel', 'aria-label']);

/** The tag rules' view of the manifest's Markdoc tags and declared MDX components. */
export function tagDefinitions(markdoc?: MarkdocManifest, mdx?: MdxManifest): TagDefinitions {
  const markdocTags = new Map<string, TagDefinition>();
  for (const tag of markdoc?.tags ?? []) {
    const labelOf = (name: string) =>
      tag.fields.find((field) => field.path[0] === name)?.label ?? name;
    markdocTags.set(tag.name, {
      label: tag.label,
      names: tag.attributes
        .filter((a) => a.required && NAME_ATTRIBUTES.has(a.name.toLowerCase()))
        .map((a) => ({ name: a.name, label: labelOf(a.name) })),
      ...(tag.attributes.some((a) => a.name === 'captions') ? { captions: 'captions' } : {}),
    });
  }
  const components = new Map<string, TagDefinition>();
  for (const component of mdx?.components ?? []) {
    const fields = component.fields ?? [];
    components.set(component.name, {
      label: component.label,
      names: fields
        .filter((f) => f.required && NAME_ATTRIBUTES.has(String(f.path[0]).toLowerCase()))
        .map((f) => ({ name: String(f.path[0]), label: f.label })),
      ...(fields.some((f) => f.path[0] === 'captions') ? { captions: 'captions' } : {}),
    });
  }
  return { markdoc: markdocTags, mdx: components };
}

export type BodyCheckOptions = {
  /** The level the body's top headings should have (spec §6.18): 2 when the title is the page's h1. */
  headingStart?: number;
  /** Check heading order and empty headings. Off for compact Markdown fields. */
  headings?: boolean;
  markdoc?: MarkdocParseOptions;
  tags?: TagDefinitions;
};

export type BodyCheck = { notes: A11yNote[]; pdfs: PdfTarget[] };

/** Accessibility notes for a body, in document order, and the PDFs it links to. */
export function checkBody(
  body: string,
  format: BodyFormat,
  options: BodyCheckOptions = {},
): BodyCheck {
  const facts = bodyFacts(body, format, options.markdoc);
  const starts = lineStarts(body);
  const at = (span: Span): A11yTarget => ({
    kind: 'body',
    start: span.start,
    end: span.end,
    line: lineOf(starts, span.start) + 1,
  });
  const notes: A11yNote[] = [];
  const pdfs: PdfTarget[] = [];
  const headingStart = options.headingStart ?? 2;
  let previous = headingStart - 1;
  let topSeen = false;

  for (const fact of facts) {
    const note = (rule: A11yRuleId, message: string, subject?: string) => {
      notes.push({
        rule,
        message,
        why: A11Y_RULES[rule].why,
        target: at(fact),
        ...(subject ? { subject } : {}),
      });
    };
    switch (fact.kind) {
      case 'image': {
        const subject =
          fact.alt !== null && fact.alt.trim() !== ''
            ? `Image ${quoted(fact.alt)}`
            : `Image ${quoted(fileNameOf(fact.src))}`;
        for (const [rule, message] of altProblems(fact.alt)) note(rule, message, subject);
        break;
      }
      case 'link': {
        const subject = fact.text.trim() ? `Link ${quoted(fact.text)}` : `Link to ${fact.href}`;
        const vague = vagueLinkText(fact.text, fact.href);
        if (vague) note('link-vague', VAGUE_MESSAGE[vague], subject);
        if (
          fact.target?.toLowerCase() === '_blank' &&
          !saysNewWindow(fact.text, fact.label, fact.title)
        )
          note('link-new-window', 'Tell readers this opens in a new tab.', subject);
        if (isSitePdf(fact.href))
          pdfs.push({
            href: fact.href,
            target: at(fact),
            subject: fact.text.trim()
              ? `PDF ${quoted(fact.text)}`
              : `PDF ${quoted(fileNameOf(fact.href))}`,
          });
        break;
      }
      case 'heading': {
        if (options.headings === false) break;
        const subject = fact.text
          ? `Heading ${quoted(fact.text)}`
          : `Level ${String(fact.level)} heading`;
        if (!fact.text) note('heading-empty', 'This heading is empty.', subject);
        if (fact.level < headingStart) {
          note(
            'heading-extra-top',
            headingStart === 2
              ? 'The title is already the page’s main heading. Use level 2 here.'
              : `Headings here start at level ${String(headingStart)}. Use level ${String(headingStart)} here.`,
            subject,
          );
        } else if (headingStart === 1 && fact.level === 1 && topSeen) {
          note(
            'heading-extra-top',
            'This page already has a main heading. Use level 2 here.',
            subject,
          );
        } else if (fact.level > previous + 1) {
          note('heading-skip', skipMessage(previous, fact.level, headingStart), subject);
        }
        if (fact.level === 1) topSeen = true;
        previous = fact.level;
        break;
      }
      case 'table':
        if (!fact.header)
          note('table-header', 'Add a header row so screen readers can announce columns.', 'Table');
        break;
      case 'paragraph':
        if (isFakeList(fact.source)) {
          const first = fact.source.split(/\r?\n/)[0] ?? '';
          note(
            'fake-list',
            'This looks like a list. Format it as one.',
            `Paragraph ${quoted(first)}`,
          );
        }
        break;
      case 'tag': {
        const definition = (
          fact.syntax === 'markdoc' ? options.tags?.markdoc : options.tags?.mdx
        )?.get(fact.name);
        if (!definition) break;
        for (const { name, label } of definition.names) {
          const value = fact.attributes[name];
          if (typeof value === 'string' && value.trim() === '') {
            const noun = label.toLowerCase();
            note(
              'tag-name-empty',
              `${definition.label} needs ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}.`,
              definition.label,
            );
          }
        }
        if (definition.captions !== undefined) {
          const value = fact.attributes[definition.captions];
          if (value === undefined || value === false || value === 'false')
            note('video-captions', 'Confirm this video has captions.', definition.label);
        }
        break;
      }
    }
  }
  return { notes, pdfs };
}

/** The alt-text problems of one image: missing (`null`: no alt at all), a file name, redundant, too long. */
export function altProblems(alt: string | null): [A11yRuleId, string][] {
  // An empty alt is HTML's mark for a decorative image, and what the studio
  // writes for one (DECISIONS.md, "An empty alt in the body is decorative").
  if (alt === null) return [['missing-alt', 'Describe this image, or mark it decorative.']];
  const text = alt.trim();
  if (text === '') return [];
  const found: [A11yRuleId, string][] = [];
  if (looksLikeFileName(text)) found.push(['alt-file-name', 'Alt text looks like a file name.']);
  const prefix = redundantAltPrefix(text);
  if (prefix) {
    const shown = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    found.push(['alt-redundant', `Alt text doesn’t need to start with “${shown}”.`]);
  }
  if (text.length > ALT_TEXT_LIMIT)
    found.push([
      'alt-too-long',
      `This alt text is ${String(text.length)} characters long. Keep it under ${String(ALT_TEXT_LIMIT)} and put the rest in the text.`,
    ]);
  return found;
}

const VAGUE_MESSAGE = {
  vague: 'Link text should say where it goes.',
  address: 'Link text should say where it goes, not repeat its address.',
  empty: 'This link has no text, so it can’t say where it goes.',
} as const;

function skipMessage(previous: number, level: number, start: number): string {
  if (previous === 0) return `The first heading should be level 1, not ${String(level)}.`;
  const from = previous === start - 1 && start === 2 ? '1 (the title)' : String(previous);
  return `Heading jumps from level ${from} to level ${String(level)}.`;
}

/** A link to a PDF on this site (an address with no scheme or host). */
export function isSitePdf(href: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return false;
  return /\.pdf$/i.test(href.split(/[?#]/)[0] ?? '');
}

// Facts

/** The facts the rules read from a body, in document order. */
export function bodyFacts(
  body: string,
  format: BodyFormat,
  markdoc?: MarkdocParseOptions,
): BodyFact[] {
  try {
    return format === 'mdoc'
      ? markdocFacts(body, markdoc)
      : mdastFacts(parseMdast(body, format === 'mdx'), body);
  } catch {
    // A body that doesn't parse has bigger problems, reported by validation.
    return [];
  }
}

const HTML_NAMES = new Set(['a', 'img', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Facts from raw HTML: links, images, tables and headings. Offsets are shifted by `offset`. */
function htmlFacts(source: string, offset: number): BodyFact[] {
  return htmlElements(source, HTML_NAMES).flatMap((element): BodyFact[] => {
    const span = { start: offset + element.start, end: offset + element.end };
    const { attributes: a } = element;
    if (element.name === 'img') {
      const hidden = a.role === 'presentation' || a.role === 'none' || a['aria-hidden'] === 'true';
      return [
        {
          ...span,
          kind: 'image',
          alt: 'alt' in a ? a.alt : hidden ? '' : null,
          src: a.src ?? '',
        },
      ];
    }
    if (element.name === 'a') {
      // An image inside a link names it with its alt text.
      const text = plainText(
        element.inner.replace(/<img\b[^>]*?\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi, ' $1$2 '),
      );
      return [
        {
          ...span,
          kind: 'link',
          text,
          href: a.href ?? '',
          ...(a.target !== undefined ? { target: a.target } : {}),
          ...(a['aria-label'] !== undefined ? { label: a['aria-label'] } : {}),
          ...(a.title !== undefined ? { title: a.title } : {}),
        },
      ];
    }
    if (element.name === 'table') {
      const header =
        element.contains.has('th') || /role\s*=\s*["']?columnheader/i.test(element.inner);
      return [{ ...span, kind: 'table', header }];
    }
    return [
      {
        ...span,
        kind: 'heading',
        level: Number(element.name.slice(1)),
        text: plainText(element.inner),
      },
    ];
  });
}

type JsxAttribute = {
  type: string;
  name?: string;
  value?: string | { type: string; value: string } | null;
};
type JsxElement = {
  type: string;
  name: string | null;
  attributes: JsxAttribute[];
  children: Nodes[];
};

/** A JSX attribute's value: a string, a literal from `{…}`, or `{ dynamic: true }`. */
function jsxValue(value: JsxAttribute['value']): unknown {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value;
  const code = value.value.trim();
  if (code === 'true') return true;
  if (code === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(code)) return Number(code);
  const quoted = /^(["'`])([^"'`\\]*)\1$/.exec(code);
  if (quoted) return quoted[2];
  return { dynamic: true };
}

function mdastText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
  if ('children' in node) return (node.children as Nodes[]).map(mdastText).join('');
  return '';
}

function jsxDescendants(node: Nodes, names: ReadonlySet<string>): boolean {
  if (!('children' in node)) return false;
  return (node.children as Nodes[]).some((child) => {
    const element = child as unknown as JsxElement;
    if (
      (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') &&
      element.name !== null &&
      names.has(element.name)
    )
      return true;
    return jsxDescendants(child, names);
  });
}

function mdastFacts(tree: Root, body: string): BodyFact[] {
  const facts: BodyFact[] = [];
  const visit = (node: Nodes, inParagraph: boolean): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const span = start !== undefined && end !== undefined ? { start, end } : null;
    const children = 'children' in node ? (node.children as Nodes[]) : [];
    const visitChildren = (paragraph = inParagraph) => {
      for (const child of children) visit(child, paragraph);
    };
    if (!span) {
      visitChildren();
      return;
    }
    switch (node.type) {
      case 'heading':
        facts.push({ ...span, kind: 'heading', level: node.depth, text: mdastText(node).trim() });
        visitChildren();
        return;
      case 'image':
        facts.push({ ...span, kind: 'image', alt: node.alt ?? '', src: node.url });
        return;
      case 'imageReference':
        facts.push({ ...span, kind: 'image', alt: node.alt ?? '', src: '' });
        return;
      case 'link':
        facts.push({ ...span, kind: 'link', text: mdastText(node), href: node.url });
        visitChildren();
        return;
      case 'linkReference':
        facts.push({ ...span, kind: 'link', text: mdastText(node), href: '' });
        visitChildren();
        return;
      case 'paragraph': {
        const source = body.slice(span.start, span.end);
        facts.push({ ...span, kind: 'paragraph', source });
        // Inline HTML comes in pieces (`<a …>`, text, `</a>`): read the paragraph's own text.
        if (children.some((child) => child.type === 'html'))
          facts.push(...htmlFacts(source, span.start));
        visitChildren(true);
        return;
      }
      case 'html':
        if (!inParagraph) facts.push(...htmlFacts(body.slice(span.start, span.end), span.start));
        return;
      default:
        break;
    }
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      facts.push(...jsxFacts(node, node, span));
    }
    visitChildren();
  };
  for (const child of tree.children) visit(child, false);
  return facts;
}

function jsxFacts(element: JsxElement, node: Nodes, span: Span): BodyFact[] {
  const { name } = element;
  if (!name) return [];
  const attributes: Record<string, unknown> = {};
  for (const attribute of element.attributes) {
    if (attribute.type === 'mdxJsxAttribute' && attribute.name)
      attributes[attribute.name] = jsxValue(attribute.value);
  }
  const text = (key: string) => {
    const value = attributes[key];
    return typeof value === 'string' ? value : undefined;
  };
  if (/^[A-Z]/.test(name) || name.includes('.'))
    return [{ ...span, kind: 'tag', syntax: 'mdx', name, attributes }];
  if (name === 'img') {
    // Alt text computed by an expression can't be judged here.
    if ('alt' in attributes && text('alt') === undefined) return [];
    const hidden = text('role') === 'presentation' || attributes['aria-hidden'] === true;
    const alt = text('alt') ?? (hidden ? '' : null);
    return [{ ...span, kind: 'image', alt, src: text('src') ?? '' }];
  }
  if (name === 'a') {
    const target = text('target');
    const label = text('aria-label');
    const title = text('title');
    return [
      {
        ...span,
        kind: 'link',
        text: mdastText(node),
        href: text('href') ?? '',
        ...(target !== undefined ? { target } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(title !== undefined ? { title } : {}),
      },
    ];
  }
  if (name === 'table')
    return [{ ...span, kind: 'table', header: jsxDescendants(node, new Set(['th'])) }];
  if (/^h[1-6]$/.test(name))
    return [
      { ...span, kind: 'heading', level: Number(name.slice(1)), text: mdastText(node).trim() },
    ];
  return [];
}

type MarkdocNode = {
  type: string;
  tag?: string;
  lines: number[];
  attributes?: Record<string, unknown>;
  children: MarkdocNode[];
};

function markdocText(node: MarkdocNode): string {
  if (node.type === 'text' || node.type === 'code') {
    const content = node.attributes?.content;
    return typeof content === 'string' ? content : '';
  }
  if (node.type === 'image') {
    const alt = node.attributes?.alt;
    return typeof alt === 'string' ? alt : '';
  }
  if (node.type === 'softbreak' || node.type === 'hardbreak') return ' ';
  return node.children.map(markdocText).join('');
}

function markdocFacts(body: string, options?: MarkdocParseOptions): BodyFact[] {
  const ast = parseMarkdoc(body, options) as unknown as MarkdocNode;
  const starts = lineStarts(body);
  // Markdoc records line ranges only: a node spans from its first line's
  // content to the end of its last line.
  const spanOf = (node: MarkdocNode): Span | null => {
    const first = node.lines[0];
    const last = node.lines.at(-1);
    if (first === undefined || last === undefined) return null;
    let start = starts[first] ?? body.length;
    while (body[start] === ' ' || body[start] === '\t') start++;
    const endLine = Math.max(first, last - 1);
    const next = starts[endLine + 1];
    let end = next === undefined ? body.length : next - 1;
    while (end > start && /\s/.test(body[end - 1] ?? '')) end--;
    return { start, end };
  };
  const facts: BodyFact[] = [];
  const visit = (node: MarkdocNode, inParagraph: boolean): void => {
    const span = spanOf(node);
    const a = node.attributes ?? {};
    const visitChildren = (paragraph = inParagraph) => {
      for (const child of node.children) visit(child, paragraph);
    };
    if (!span) {
      visitChildren();
      return;
    }
    switch (node.type) {
      case 'heading':
        facts.push({
          ...span,
          kind: 'heading',
          level: typeof a.level === 'number' ? a.level : 1,
          text: markdocText(node).trim(),
        });
        break;
      case 'image':
        facts.push({
          ...span,
          kind: 'image',
          alt: typeof a.alt === 'string' ? a.alt : '',
          src: typeof a.src === 'string' ? a.src : '',
        });
        return;
      case 'link':
        facts.push({
          ...span,
          kind: 'link',
          text: markdocText(node),
          href: typeof a.href === 'string' ? a.href : '',
        });
        break;
      case 'paragraph': {
        const source = body.slice(span.start, span.end);
        facts.push({ ...span, kind: 'paragraph', source });
        if (hasType(node, 'html_inline')) facts.push(...htmlFacts(source, span.start));
        visitChildren(true);
        return;
      }
      case 'html_block':
        if (!inParagraph) facts.push(...htmlFacts(body.slice(span.start, span.end), span.start));
        return;
      case 'tag':
        if (node.tag) {
          const attributes: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(a)) {
            attributes[key] =
              value === null || ['string', 'number', 'boolean'].includes(typeof value)
                ? value
                : { dynamic: true };
          }
          facts.push({ ...span, kind: 'tag', syntax: 'markdoc', name: node.tag, attributes });
        }
        break;
      default:
        break;
    }
    visitChildren();
  };
  for (const child of ast.children) visit(child, false);
  return facts;
}

function hasType(node: MarkdocNode, type: string): boolean {
  return node.children.some((child) => child.type === type || hasType(child, type));
}
