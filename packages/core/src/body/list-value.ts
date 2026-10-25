/*
 * A list value in a tag's attribute (Markdoc `items=[…]`, MDX `items={[…]}`)
 * written one item per line, or one key per line, changes item by item: a
 * changed item rewrites only its own lines, a new one is written in the same
 * layout after the last, a removed one goes with its lines, and a moved one
 * moves its lines as they are (DECISIONS.md, "A list attribute written one
 * item per line changes item by item"). Any other layout is left to the
 * caller, which writes the whole value, as before.
 */

/** Two plain values are the same, whatever order an object's keys are in. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = new Map(Object.entries(b).filter(([, value]) => value !== undefined));
  return (
    left.length === right.size &&
    left.every(([key, value]) => right.has(key) && sameValue(value, right.get(key)))
  );
}

export type ListLayout = {
  /** Each item's text, which may span lines. */
  items: string[];
  /** Before each item, on its own line. */
  indent: string;
  /** Before the closing `]`, on its own line. */
  closingIndent: string;
  newline: '\n' | '\r\n';
  trailingComma: boolean;
};

const QUOTES = new Set(['"', "'", '`']);

/** Just after the string starting at `i`, or -1. */
function stringEnd(text: string, i: number): number {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === quote) return j + 1;
  }
  return -1;
}

/** The items' spans inside `[ … ]`: from each one's first character to just after its last. */
function itemSpans(text: string): { start: number; end: number }[] | null {
  const spans: { start: number; end: number }[] = [];
  let depth = 0;
  let start = -1;
  let last = -1;
  for (let j = 1; j < text.length - 1; j++) {
    const c = text[j] ?? '';
    if (/\s/.test(c)) continue;
    if (start === -1 && c !== ',') start = j;
    if (QUOTES.has(c)) {
      j = stringEnd(text, j) - 1;
      if (j < 0) return null;
    } else if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') {
      depth--;
      if (depth < 0) return null;
    } else if (c === ',' && depth === 0) {
      if (start === -1) return null;
      spans.push({ start, end: last + 1 });
      start = -1;
      continue;
    }
    last = j;
  }
  if (depth !== 0) return null;
  if (start !== -1) spans.push({ start, end: last + 1 });
  return spans;
}

/**
 * The layout of `[ … ]` when each item starts on its own line, one level in,
 * and the `]` has a line of its own; or null.
 */
export function listLayout(text: string): ListLayout | null {
  if (!text.startsWith('[') || !text.endsWith(']')) return null;
  const spans = itemSpans(text);
  const first = spans?.[0];
  if (!spans || !first) return null;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lead = text.slice(1, first.start);
  if (!lead.startsWith(newline)) return null;
  const indent = lead.slice(newline.length);
  if (indent === '' || !/^[ \t]+$/.test(indent)) return null;
  for (let i = 1; i < spans.length; i++) {
    const between = text.slice(spans[i - 1]?.end, spans[i]?.start);
    if (between !== `,${newline}${indent}`) return null;
  }
  let tail = text.slice(spans.at(-1)?.end, -1);
  const trailingComma = tail.startsWith(',');
  if (trailingComma) tail = tail.slice(1);
  if (!tail.startsWith(newline)) return null;
  const closingIndent = tail.slice(newline.length);
  if (!/^[ \t]*$/.test(closingIndent)) return null;
  return {
    items: spans.map(({ start, end }) => text.slice(start, end)),
    indent,
    closingIndent,
    newline,
    trailingComma,
  };
}

/** How a list writes an object over several lines: one key per line, as its first such item does. */
type ObjectStyle = { keyIndent: string; quotedKeys: boolean; trailingComma: boolean };

function objectStyle(item: string | undefined, newline: string): ObjectStyle | null {
  if (!item?.startsWith('{') || !item.includes(newline)) return null;
  const lines = item.split(newline);
  const second = lines[1] ?? '';
  const keyIndent = /^[ \t]*/.exec(second)?.[0] ?? '';
  if (keyIndent === '') return null;
  return {
    keyIndent,
    quotedKeys: second.trimStart().startsWith('"'),
    trailingComma: (lines.at(-2) ?? '').trimEnd().endsWith(','),
  };
}

/**
 * The list's text with `next` in it, item by item, or null when the old text
 * isn't laid out one item per line or doesn't hold `before`'s items.
 */
export function spliceList(
  text: string,
  before: readonly unknown[],
  next: readonly unknown[],
  write: (value: unknown) => string,
): string | null {
  const layout = listLayout(text);
  if (!layout || layout.items.length !== before.length) return null;
  const { indent, newline, closingIndent, trailingComma } = layout;
  const style = objectStyle(
    layout.items.find((item) => item.startsWith('{')),
    newline,
  );
  const writeItem = (value: unknown): string => {
    if (!style || typeof value !== 'object' || value === null || Array.isArray(value)) {
      return write(value);
    }
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    const key = (k: string) =>
      style.quotedKeys || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? JSON.stringify(k) : k;
    const lines = entries.map(
      ([k, v], index) =>
        `${style.keyIndent}${key(k)}: ${write(v)}${index < entries.length - 1 || style.trailingComma ? ',' : ''}`,
    );
    return `{${newline}${lines.join(newline)}${newline}${indent}}`;
  };

  const used = new Set<number>();
  const kept = next.map((value, index) =>
    index < before.length && sameValue(before[index], value) ? index : -1,
  );
  for (const index of kept) if (index !== -1) used.add(index);
  const items = next.map((value, index) => {
    let from = kept[index] ?? -1;
    if (from === -1) {
      // Moved: the same item elsewhere in the old list keeps its own text.
      from = before.findIndex((old, at) => !used.has(at) && sameValue(old, value));
      if (from !== -1) used.add(from);
      else {
        // Changed in place: an object rewrites only the keys that changed.
        const old = before[index];
        const oldText = layout.items[index];
        if (
          oldText !== undefined &&
          !used.has(index) &&
          style &&
          isObject(old) &&
          isObject(value)
        ) {
          const spliced = spliceObject(oldText, old, value, style, newline, write);
          if (spliced !== null) {
            used.add(index);
            return spliced;
          }
        }
      }
    }
    return from === -1 ? writeItem(value) : (layout.items[from] ?? writeItem(value));
  });
  if (items.length === 0) return '[]';
  return `[${newline}${indent}${items.join(`,${newline}${indent}`)}${trailingComma ? ',' : ''}${newline}${closingIndent}]`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An object written one key per line, with only the changed keys' lines
 * rewritten; null when a key was added or removed, or a line holds more
 * than one key.
 */
function spliceObject(
  text: string,
  before: Record<string, unknown>,
  next: Record<string, unknown>,
  style: ObjectStyle,
  newline: string,
  write: (value: unknown) => string,
): string | null {
  const keys = Object.keys(before);
  if (
    !sameValue(
      keys.slice().sort(),
      Object.keys(next)
        .filter((k) => next[k] !== undefined)
        .sort(),
    )
  ) {
    return null;
  }
  const lines = text.split(newline);
  if (lines.length !== keys.length + 2) return null;
  // Each line between the braces must be its own key's, in order.
  for (const [index, key] of keys.entries()) {
    const line = lines[index + 1] ?? '';
    if (!line.startsWith(style.keyIndent)) return null;
    const name = line.slice(style.keyIndent.length, line.indexOf(':')).trim();
    if (name !== key && name !== JSON.stringify(key)) return null;
  }
  const out = lines.map((line, index) => {
    const key = keys[index - 1];
    if (index === 0 || index === lines.length - 1 || key === undefined) return line;
    if (sameValue(before[key], next[key])) return line;
    const comma = line.trimEnd().endsWith(',') ? ',' : '';
    const name = line.slice(style.keyIndent.length, line.indexOf(':'));
    return `${style.keyIndent}${name}: ${write(next[key])}${comma}`;
  });
  return out.join(newline);
}
