import { jsxTagLayout, markdocTags, type InlineChip } from '@vesper/core';

/*
 * Inline chips (an inline tag, a variable, an annotation, inline JSX) inside
 * Markdown blocks. The Markdown parser and serializer see each chip as one
 * private-use placeholder holding the chip's source as hex, so marks can
 * span chips and nothing ever escapes or rewraps them. After serializing,
 * placeholders turn back into each chip's current source.
 */

const OPEN = '';
const CLOSE = '';
const PLACEHOLDER = /([0-9a-f]*)/g;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function chipPlaceholder(source: string): string {
  let hex = '';
  for (const byte of encoder.encode(source)) hex += byte.toString(16).padStart(2, '0');
  return `${OPEN}${hex}${CLOSE}`;
}

export function decodeHex(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return decoder.decode(bytes);
}

/** Text with every placeholder replaced by the chip source it holds. */
export function restoreChips(text: string): string {
  return text.replace(PLACEHOLDER, (_, hex: string) => decodeHex(hex));
}

/** A block's text with its chips (offsets relative to the text) replaced by placeholders. */
export function withPlaceholders(
  text: string,
  chips: readonly { start: number; end: number }[],
): string {
  let out = '';
  let cursor = 0;
  for (const chip of chips) {
    out += text.slice(cursor, chip.start) + chipPlaceholder(text.slice(chip.start, chip.end));
    cursor = chip.end;
  }
  return out + text.slice(cursor);
}

/** True when the text holds a private-use character the placeholders rely on. */
export function hasPlaceholderCharacters(text: string): boolean {
  return text.includes(OPEN) || text.includes(CLOSE);
}

export type TagValues = {
  /** Attribute values the settings form can edit. */
  values: Record<string, unknown>;
  /** Attributes set by code (variables, functions, JSX expressions): shown, never edited. */
  code: Record<string, string>;
};

/** A tag's attributes, read from its opening (Markdoc) or its opening or whole element (MDX). */
export function tagValues(syntax: 'markdoc' | 'mdx', text: string): TagValues {
  const values: Record<string, unknown> = {};
  const code: Record<string, string> = {};
  if (syntax === 'markdoc') {
    const [token] = markdocTags(text);
    for (const attribute of token?.attributes ?? []) {
      if (attribute.type !== 'attribute' || attribute.name === 'primary') continue;
      if (isMarkdocCode(attribute.value)) code[attribute.name] = describeCode(attribute.value);
      else values[attribute.name] = attribute.value;
    }
    return { values, code };
  }
  const layout = jsxTagLayout(text);
  for (const attribute of layout?.attributes ?? []) {
    if (!attribute.name) continue;
    if (attribute.readable) values[attribute.name] = attribute.value;
    else code[attribute.name] = text.slice(attribute.start, attribute.end);
  }
  return { values, code };
}

function isMarkdocCode(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if ('$$mdtype' in value) return true;
  return Object.values(value).some(isMarkdocCode);
}

function describeCode(value: unknown): string {
  const node = value as { $$mdtype?: string; path?: unknown[]; name?: string };
  if (node.$$mdtype === 'Variable' && Array.isArray(node.path)) return `$${node.path.join('.')}`;
  if (node.$$mdtype === 'Function' && node.name) return `${node.name}(…)`;
  return 'a value set by code';
}

export type ChipInfo = {
  syntax: 'markdoc' | 'mdx';
  kind: InlineChip['kind'];
  name?: string;
  /** For tags and components: the opening, the content between, and the closing. */
  open?: string;
  inner?: string;
  close?: string;
};

/** What a chip's source is: its kind, name and parts. */
export function chipInfo(source: string): ChipInfo {
  if (source.startsWith('{%')) {
    const tokens = markdocTags(source);
    const first = tokens[0];
    const last = tokens.at(-1);
    if (!first) return { syntax: 'markdoc', kind: 'variable' };
    if (first.kind === 'variable') return { syntax: 'markdoc', kind: 'variable' };
    if (first.kind === 'annotation') return { syntax: 'markdoc', kind: 'annotation' };
    const name = first.name;
    if (first.kind === 'tag') {
      return {
        syntax: 'markdoc',
        kind: 'tag',
        ...(name ? { name } : {}),
        open: source,
        inner: '',
        close: '',
      };
    }
    const closeStart =
      last && last.kind === 'tag_close' && last.end === source.length ? last.start : source.length;
    return {
      syntax: 'markdoc',
      kind: 'tag',
      ...(name ? { name } : {}),
      open: source.slice(0, first.end),
      inner: source.slice(first.end, closeStart),
      close: source.slice(closeStart),
    };
  }
  if (source.startsWith('<')) {
    const layout = jsxTagLayout(source);
    if (!layout) return { syntax: 'mdx', kind: 'component' };
    const close = layout.selfClosing ? '' : (/<\/[^>]*>$/.exec(source)?.[0] ?? '');
    return {
      syntax: 'mdx',
      kind: 'component',
      name: layout.name,
      open: source.slice(0, layout.openEnd),
      inner: source.slice(layout.openEnd, source.length - close.length),
      close,
    };
  }
  return { syntax: 'mdx', kind: 'expression' };
}
