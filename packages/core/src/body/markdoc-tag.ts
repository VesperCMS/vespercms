import Markdoc from '@markdoc/markdoc';

/*
 * One Markdoc tag's text: where it is, what Markdoc reads in it, and where
 * each attribute sits, so an edit can change one attribute's bytes and
 * nothing else (spec §6.5.1, "Round-trip fidelity for Markdoc").
 *
 * Markdoc's own `parseTags` finds tags and parses them (it skips strings
 * that contain `%}`); Markdoc records no column offsets for attributes, so
 * a small scanner finds their spans, and its keys are checked against
 * Markdoc's before anything is edited.
 */

export type MarkdocTagKind = 'tag_open' | 'tag_close' | 'tag' | 'variable' | 'annotation';

export type MarkdocTagToken = {
  /** Offsets of `{%` and just after `%}`. */
  start: number;
  end: number;
  /**
   * `tag_open` and `tag_close` pair up around content, `tag` is self-closing
   * (`/%}`), `variable` is `{% $x %}` or a function call, and `annotation`
   * is attributes with no tag name (`{% .lead %}`).
   */
  kind: MarkdocTagKind;
  /** The tag's name, for tags and closings. */
  name?: string;
  /** Attributes as Markdoc parsed them. Shorthand classes come as `class`. */
  attributes: { type: string; name: string; value: unknown }[];
};

type ParsedTagToken = {
  type: string;
  start?: number;
  end?: number;
  meta?: { tag?: string; attributes?: { type: string; name: string; value: unknown }[] | null };
};

const KINDS = new Set<string>(['tag_open', 'tag_close', 'tag', 'variable', 'annotation']);

/** Every `{% … %}` in `text`, in order, as Markdoc reads it. Text that fails to parse as a tag is left out. */
export function markdocTags(text: string): MarkdocTagToken[] {
  const tokens = Markdoc.parseTags(text) as ParsedTagToken[];
  const out: MarkdocTagToken[] = [];
  for (const token of tokens) {
    if (!KINDS.has(token.type) || token.start === undefined || token.end === undefined) continue;
    out.push({
      start: token.start,
      end: token.end + 1,
      kind: token.type as MarkdocTagKind,
      ...(token.meta?.tag ? { name: token.meta.tag } : {}),
      attributes: token.meta?.attributes ?? [],
    });
  }
  return out;
}

/** One attribute's place in a tag's text. Offsets are relative to the tag's `{%`. */
export type MarkdocAttributeSpan = {
  /** `primary` for a value right after the name (`{% if $x %}`), `class`/`id` for shorthand. */
  key: string;
  kind: 'attribute' | 'primary' | 'class' | 'id';
  /** The attribute's text, without the whitespace before it. */
  start: number;
  end: number;
  /** The value's text (for `key=value` and primary values). */
  valueStart: number;
  valueEnd: number;
};

export type MarkdocTagLayout = {
  name: string;
  selfClosing: boolean;
  /** Just after the name. */
  nameEnd: number;
  attributes: MarkdocAttributeSpan[];
  /** Where the closing `/%}` or `%}` starts, after any whitespace. */
  closeStart: number;
};

const IDENT = /[a-zA-Z0-9_-]/;
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * The layout of an opening or self-closing tag's text (from `{%` to `%}`),
 * or null when the scanner can't account for every character, or when its
 * reading disagrees with Markdoc's. Callers then keep the tag as written.
 */
export function markdocTagLayout(tagText: string): MarkdocTagLayout | null {
  const [token] = markdocTags(tagText);
  if (!token || token.start !== 0 || token.end !== tagText.length) return null;
  if ((token.kind !== 'tag_open' && token.kind !== 'tag') || !token.name) return null;

  let i = skipSpace(tagText, 2);
  const nameStart = i;
  while (i < tagText.length && IDENT.test(tagText[i] ?? '')) i++;
  if (tagText.slice(nameStart, i) !== token.name) return null;
  const nameEnd = i;
  const attributes: MarkdocAttributeSpan[] = [];

  for (let first = true; ; first = false) {
    const before = i;
    i = skipSpace(tagText, i);
    if (tagText.startsWith('/%}', i) || tagText.startsWith('%}', i)) {
      if (i + (tagText[i] === '/' ? 3 : 2) !== tagText.length) return null;
      const selfClosing = tagText[i] === '/';
      if (selfClosing !== (token.kind === 'tag')) return null;
      const layout = { name: token.name, selfClosing, nameEnd, attributes, closeStart: i };
      return agrees(layout, token) ? layout : null;
    }
    // Attributes are separated by whitespace. Markdoc is laxer, but a tag
    // written without it is rare enough to keep as written.
    if (i === before) return null;
    const c = tagText[i];
    if (c === '.' || c === '#') {
      const start = i;
      i++;
      const identStart = i;
      while (i < tagText.length && IDENT.test(tagText[i] ?? '')) i++;
      if (i === identStart) return null;
      const kind = c === '.' ? 'class' : 'id';
      attributes.push({ key: kind, kind, start, end: i, valueStart: identStart, valueEnd: i });
      continue;
    }
    const keyMatch = /^[a-zA-Z0-9_-]+=/.exec(tagText.slice(i));
    if (keyMatch) {
      const start = i;
      const key = keyMatch[0].slice(0, -1);
      const valueStart = i + keyMatch[0].length;
      const valueEnd = scanValue(tagText, valueStart);
      if (valueEnd === -1) return null;
      attributes.push({ key, kind: 'attribute', start, end: valueEnd, valueStart, valueEnd });
      i = valueEnd;
      continue;
    }
    if (first) {
      const valueEnd = scanValue(tagText, i);
      if (valueEnd === -1) return null;
      attributes.push({
        key: 'primary',
        kind: 'primary',
        start: i,
        end: valueEnd,
        valueStart: i,
        valueEnd,
      });
      i = valueEnd;
      continue;
    }
    return null;
  }
}

/** The scanner and Markdoc must see the same attributes, or nothing is edited. */
function agrees(layout: MarkdocTagLayout, token: MarkdocTagToken): boolean {
  const ours = layout.attributes.map((a) => (a.kind === 'class' ? 'class' : a.key));
  // Markdoc names a shorthand class attribute after the class itself.
  const theirs = token.attributes.map((a) => (a.type === 'class' ? 'class' : a.name));
  // Markdoc folds every `.x` shorthand into one `class` attribute.
  const collapse = (keys: string[]) =>
    keys.filter((key, index) => key !== 'class' || keys.indexOf('class') === index);
  return JSON.stringify(collapse(ours)) === JSON.stringify(collapse(theirs));
}

function skipSpace(text: string, i: number): number {
  while (i < text.length && isSpace(text[i])) i++;
  return i;
}

/** End of the value starting at `i`, or -1. Brackets are matched, strings skipped. */
function scanValue(text: string, i: number): number {
  const c = text[i];
  if (c === undefined) return -1;
  if (c === '"') return scanString(text, i);
  if (c === '[' || c === '{') return scanBalanced(text, i);
  if (c === '$' || c === '@') {
    let j = i + 1;
    while (j < text.length) {
      const d = text[j] ?? '';
      if (IDENT.test(d) || d === '.') j++;
      else if (d === '[') {
        j = scanBalanced(text, j);
        if (j === -1) return -1;
      } else break;
    }
    return j > i + 1 ? j : -1;
  }
  let j = i;
  while (j < text.length && /[a-zA-Z0-9_.-]/.test(text[j] ?? '')) j++;
  if (j === i) return -1;
  // A function call: name(…).
  if (text[j] === '(') return scanBalanced(text, j);
  return j;
}

function scanString(text: string, i: number): number {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '"') return j + 1;
  }
  return -1;
}

function scanBalanced(text: string, i: number): number {
  const closers: string[] = [];
  const pairs: Record<string, string> = { '[': ']', '{': '}', '(': ')' };
  for (let j = i; j < text.length; j++) {
    const c = text[j] ?? '';
    if (c === '"') {
      j = scanString(text, j) - 1;
      if (j < 0) return -1;
    } else if (pairs[c]) closers.push(pairs[c]);
    else if (c === ']' || c === '}' || c === ')') {
      if (closers.pop() !== c) return -1;
      if (closers.length === 0) return j + 1;
    }
  }
  return -1;
}

/** A value as Markdoc source: strings double-quoted with Markdoc's five escapes. */
export function markdocValue(value: unknown): string {
  if (typeof value === 'string') {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      // Markdoc strings can't hold other control characters at all.
      // eslint-disable-next-line no-control-regex
      .replace(/[\0-\x08\x0b\x0c\x0e-\x1f]/g, '');
    return `"${escaped}"`;
  }
  if (typeof value === 'number') {
    const text = String(value);
    if (!/^-?\d+(\.\d+)?$/.test(text))
      throw new RangeError(`Markdoc can't write the number ${text}.`);
    return text;
  }
  if (typeof value === 'boolean' || value === null) return String(value);
  if (Array.isArray(value)) return `[${value.map(markdocValue).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    const key = (k: string) => (/^[a-zA-Z0-9_-]+$/.test(k) ? k : markdocValue(k));
    return `{${entries.map(([k, v]) => `${key(k)}: ${markdocValue(v)}`).join(', ')}}`;
  }
  throw new TypeError(`Markdoc can't write a value of type ${typeof value}.`);
}

/** A new opening (or self-closing) tag in house style: attributes in the order given. */
export function markdocOpening(
  name: string,
  attributes: readonly (readonly [string, unknown])[],
  selfClosing: boolean,
): string {
  const parts = attributes
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${markdocValue(value)}`);
  return `{% ${[name, ...parts].join(' ')} ${selfClosing ? '/%}' : '%}'}`;
}

export function markdocClosing(name: string): string {
  return `{% /${name} %}`;
}

/**
 * Changes attributes in an opening tag's text and nothing else:
 * - a changed value replaces that value's bytes;
 * - `undefined` removes the attribute and the whitespace before it;
 * - a new attribute goes after the nearest earlier one in `order` that the
 *   tag has (else before the nearest later one, else after the last).
 * Returns null when the tag can't be edited in place (the caller keeps it).
 */
export function editMarkdocTag(
  tagText: string,
  changes: readonly (readonly [string, unknown])[],
  order: readonly string[] = [],
): string | null {
  let text = tagText;
  for (const [key, value] of changes) {
    const layout = markdocTagLayout(text);
    if (!layout) return null;
    const existing = layout.attributes.find((a) => a.kind === 'attribute' && a.key === key);
    if (existing) {
      if (value === undefined) {
        let from = existing.start;
        while (from > 0 && isSpace(text[from - 1])) from--;
        text = text.slice(0, from) + text.slice(existing.end);
      } else {
        text =
          text.slice(0, existing.valueStart) + markdocValue(value) + text.slice(existing.valueEnd);
      }
      continue;
    }
    if (value === undefined) continue;
    const written = `${key}=${markdocValue(value)}`;
    const named = layout.attributes.filter((a) => a.kind === 'attribute');
    const rank = (k: string) => {
      const index = order.indexOf(k);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    };
    const earlier = named.filter((a) => rank(a.key) < rank(key)).at(-1);
    const later = named.find((a) => rank(a.key) > rank(key));
    if (earlier) {
      text = `${text.slice(0, earlier.end)} ${written}${text.slice(earlier.end)}`;
    } else if (later) {
      text = `${text.slice(0, later.start)}${written} ${text.slice(later.start)}`;
    } else {
      const after = layout.attributes.at(-1)?.end ?? layout.nameEnd;
      text = `${text.slice(0, after)} ${written}${text.slice(after)}`;
    }
  }
  return markdocTagLayout(text) ? text : null;
}
