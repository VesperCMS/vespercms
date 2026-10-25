import type { Nodes, Root } from 'mdast';
import { parseMdast } from './mdast.ts';
import { sameValue, spliceList } from './list-value.ts';

/*
 * One MDX element's opening tag: its attributes as micromark's MDX parser
 * reads them, with their spans, so an edit can change one attribute's bytes
 * and nothing else (spec §6.5.2: "only changed JSX elements are
 * re-serialized", and within one, only what changed).
 *
 * Attribute values in braces are read as plain JavaScript literals (strings,
 * numbers, booleans, null, arrays and objects of those). Anything else, and
 * spreads, is code: shown, kept byte for byte, never edited.
 */

export type JsxAttribute = {
  /** Empty for a spread (`{...props}`). */
  name: string;
  kind: 'string' | 'shorthand' | 'expression' | 'spread';
  /** The value: a string, `true` for shorthand, or a literal read from braces. */
  value?: unknown;
  /** False for spreads and for braces that hold code rather than a literal. */
  readable: boolean;
  /** Offsets relative to the tag's `<`. */
  start: number;
  end: number;
};

export type JsxTagLayout = {
  name: string;
  selfClosing: boolean;
  nameEnd: number;
  attributes: JsxAttribute[];
  /** Just after the opening's `>` or `/>`. */
  openEnd: number;
};

const NAME = /^<\s*([A-Za-z_$][\w$.:-]*)/;

type ElementNode = Extract<Nodes, { type: 'mdxJsxFlowElement' | 'mdxJsxTextElement' }>;

/**
 * The layout of a JSX element's opening, given the opening alone, or a whole
 * element. Null when micromark can't read it or the spans don't add up.
 */
export function jsxTagLayout(text: string): JsxTagLayout | null {
  const name = NAME.exec(text)?.[1];
  if (!name) return null;
  for (const candidate of [text, `${text}</${name}>`]) {
    let tree: Root;
    try {
      tree = parseMdast(candidate, true);
    } catch {
      continue;
    }
    const element = firstElement(tree);
    if (element?.name !== name || element.position?.start.offset !== 0) continue;
    return layoutOf(text, name, element);
  }
  return null;
}

function firstElement(node: Nodes): ElementNode | undefined {
  if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') return node;
  if (!('children' in node)) return undefined;
  for (const child of node.children as Nodes[]) {
    const found = firstElement(child);
    if (found) return found;
  }
  return undefined;
}

function layoutOf(text: string, name: string, element: ElementNode): JsxTagLayout | null {
  const nameEnd = text.indexOf(name) + name.length;
  let cursor = nameEnd;
  const attributes: JsxAttribute[] = [];
  for (const attribute of element.attributes) {
    const start = attribute.position?.start.offset;
    const end = attribute.position?.end.offset;
    if (start === undefined || end === undefined || end > text.length) return null;
    cursor = Math.max(cursor, end);
    if (attribute.type === 'mdxJsxExpressionAttribute') {
      attributes.push({ name: '', kind: 'spread', readable: false, start, end });
      continue;
    }
    const { value } = attribute;
    if (value === null || value === undefined) {
      attributes.push({
        name: attribute.name,
        kind: 'shorthand',
        value: true,
        readable: true,
        start,
        end,
      });
    } else if (typeof value === 'string') {
      attributes.push({ name: attribute.name, kind: 'string', value, readable: true, start, end });
    } else {
      const literal = readJsLiteral(value.value);
      attributes.push({
        name: attribute.name,
        kind: 'expression',
        ...(literal.ok ? { value: literal.value } : {}),
        readable: literal.ok,
        start,
        end,
      });
    }
  }
  while (/\s/.test(text[cursor] ?? '')) cursor++;
  if (text.startsWith('/>', cursor)) {
    return { name, selfClosing: true, nameEnd, attributes, openEnd: cursor + 2 };
  }
  if (text[cursor] !== '>') return null;
  return { name, selfClosing: false, nameEnd, attributes, openEnd: cursor + 1 };
}

/**
 * A prop value as JSX: a quoted string when that reads back exactly
 * (`"…"`, else `'…'`), and braces otherwise. Strings with `&` go in braces,
 * because JSX decodes character references in quoted attributes.
 */
export function jsxAttribute(name: string, value: unknown): string {
  if (typeof value === 'string' && !value.includes('&')) {
    if (!value.includes('"')) return `${name}="${value}"`;
    if (!value.includes("'")) return `${name}='${value}'`;
  }
  return `${name}={${JSON.stringify(value)}}`;
}

/**
 * A changed prop's text. An array prop written one item per line changes
 * item by item, as `editMarkdocTag`'s lists do, when it reads back as meant;
 * anything else is written whole.
 */
function writeAttribute(text: string, existing: JsxAttribute, value: unknown): string {
  const whole = jsxAttribute(existing.name, value);
  if (!Array.isArray(value) || !Array.isArray(existing.value)) return whole;
  const written = /^([^=]+=\{)(\s*)(\[[\s\S]*\])(\s*)\}$/.exec(
    text.slice(existing.start, existing.end),
  );
  if (!written) return whole;
  const [, opening = '', lead = '', list = '', trail = ''] = written;
  const spliced = spliceList(list, existing.value, value, (item) => JSON.stringify(item));
  if (spliced === null) return whole;
  const read = readJsLiteral(`${lead}${spliced}${trail}`);
  return read.ok && sameValue(read.value, value) ? `${opening}${lead}${spliced}${trail}}` : whole;
}

/** A new opening tag in house style, attributes in the order given. */
export function jsxOpening(
  name: string,
  attributes: readonly (readonly [string, unknown])[],
  selfClosing: boolean,
): string {
  const parts = attributes
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => jsxAttribute(key, value));
  return `<${[name, ...parts].join(' ')}${selfClosing ? ' />' : '>'}`;
}

export function jsxClosing(name: string): string {
  return `</${name}>`;
}

/**
 * Changes props in an opening tag (or a whole element) and nothing else,
 * by the same rules as `editMarkdocTag`. Props that hold code are never
 * changed. Returns null when the tag can't be edited in place.
 */
export function editJsxTag(
  text: string,
  changes: readonly (readonly [string, unknown])[],
  order: readonly string[] = [],
): string | null {
  let out = text;
  for (const [key, value] of changes) {
    const layout = jsxTagLayout(out);
    if (!layout) return null;
    const existing = layout.attributes.find((a) => a.name === key);
    if (existing && !existing.readable) return null;
    if (existing) {
      if (value === undefined) {
        let from = existing.start;
        while (from > 0 && /\s/.test(out[from - 1] ?? '')) from--;
        out = out.slice(0, from) + out.slice(existing.end);
      } else {
        out =
          out.slice(0, existing.start) +
          writeAttribute(out, existing, value) +
          out.slice(existing.end);
      }
      continue;
    }
    if (value === undefined) continue;
    const written = jsxAttribute(key, value);
    const named = layout.attributes.filter((a) => a.name !== '');
    const rank = (k: string) => {
      const index = order.indexOf(k);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    };
    const earlier = named.filter((a) => rank(a.name) < rank(key)).at(-1);
    const later = named.find((a) => rank(a.name) > rank(key));
    if (earlier) out = `${out.slice(0, earlier.end)} ${written}${out.slice(earlier.end)}`;
    else if (later) out = `${out.slice(0, later.start)}${written} ${out.slice(later.start)}`;
    else {
      const after = layout.attributes.at(-1)?.end ?? layout.nameEnd;
      out = `${out.slice(0, after)} ${written}${out.slice(after)}`;
    }
  }
  return jsxTagLayout(out) ? out : null;
}

/** Reads a JavaScript literal: strings, numbers, booleans, null, and arrays and objects of those. */
export function readJsLiteral(source: string): { ok: true; value: unknown } | { ok: false } {
  const reader = new LiteralReader(source);
  try {
    const value = reader.value();
    reader.space();
    return reader.done() ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

class LiteralReader {
  private i = 0;
  private readonly text: string;
  constructor(text: string) {
    this.text = text;
  }

  done(): boolean {
    return this.i === this.text.length;
  }

  space(): void {
    while (/\s/.test(this.text[this.i] ?? '')) this.i++;
  }

  value(): unknown {
    this.space();
    const c = this.text[this.i];
    if (c === '"' || c === "'") return this.string(c);
    if (c === '`') return this.template();
    if (c === '[') return this.array();
    if (c === '{') return this.object();
    const number = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.i));
    if (number) {
      this.i += number[0].length;
      return Number(number[0]);
    }
    for (const [word, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (
        this.text.startsWith(word, this.i) &&
        !/[\w$]/.test(this.text[this.i + word.length] ?? '')
      ) {
        this.i += word.length;
        return value;
      }
    }
    throw new SyntaxError('Not a literal');
  }

  private string(quote: string): string {
    let out = '';
    this.i++;
    for (;;) {
      const c = this.text[this.i];
      if (c === undefined || c === '\n') throw new SyntaxError('Unterminated string');
      this.i++;
      if (c === quote) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.text[this.i];
      this.i++;
      const simple: Record<string, string> = {
        n: '\n',
        t: '\t',
        r: '\r',
        b: '\b',
        f: '\f',
        v: '\v',
        '0': '\0',
      };
      if (e === 'u') {
        const hex = /^[0-9a-fA-F]{4}/.exec(this.text.slice(this.i))?.[0];
        if (!hex) throw new SyntaxError('Bad escape');
        out += String.fromCharCode(parseInt(hex, 16));
        this.i += 4;
      } else if (e !== undefined) out += simple[e] ?? e;
    }
  }

  /** A template literal with no `${…}`: plain text. */
  private template(): string {
    const end = this.text.indexOf('`', this.i + 1);
    const body = end === -1 ? null : this.text.slice(this.i + 1, end);
    if (body === null || body.includes('${') || body.includes('\\'))
      throw new SyntaxError('Template');
    this.i = end + 1;
    return body;
  }

  private array(): unknown[] {
    const out: unknown[] = [];
    this.i++;
    for (;;) {
      this.space();
      if (this.text[this.i] === ']') {
        this.i++;
        return out;
      }
      out.push(this.value());
      this.space();
      if (this.text[this.i] === ',') this.i++;
      else if (this.text[this.i] !== ']') throw new SyntaxError('Array');
    }
  }

  private object(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.i++;
    for (;;) {
      this.space();
      const c = this.text[this.i];
      if (c === '}') {
        this.i++;
        return out;
      }
      let key: string;
      if (c === '"' || c === "'") key = this.string(c);
      else {
        const ident = /^[A-Za-z_$][\w$]*|^\d+/.exec(this.text.slice(this.i))?.[0];
        if (!ident) throw new SyntaxError('Key');
        key = ident;
        this.i += ident.length;
      }
      this.space();
      if (this.text[this.i] !== ':' || key === '__proto__') throw new SyntaxError('Key');
      this.i++;
      out[key] = this.value();
      this.space();
      if (this.text[this.i] === ',') this.i++;
      else if (this.text[this.i] !== '}') throw new SyntaxError('Object');
    }
  }
}
