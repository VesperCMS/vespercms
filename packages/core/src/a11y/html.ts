/*
 * A small reader for the HTML inside Markdown and Markdoc bodies: just
 * enough to find links, images, headings and tables and their attributes.
 * It never builds a document and never runs anything. Core can't use a DOM
 * (it runs in Workers too), and these rules only need tags and their text.
 */

export type HtmlTag = {
  /** Lower case. */
  name: string;
  /** Lower-case names; values with the common entities decoded. */
  attributes: Record<string, string>;
  start: number;
  end: number;
  closing: boolean;
  selfClosing: boolean;
};

const TAG =
  /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X'))
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Every tag in the text, in order. Comments are skipped. */
export function htmlTags(text: string): HtmlTag[] {
  const tags: HtmlTag[] = [];
  for (const match of text.matchAll(TAG)) {
    const [whole, slash, name, attributeText, selfClose] = match;
    if (name === undefined) continue;
    const attributes: Record<string, string> = {};
    for (const attribute of (attributeText ?? '').matchAll(ATTRIBUTE)) {
      const [, key, double, single, bare] = attribute;
      if (key === undefined) continue;
      attributes[key.toLowerCase()] = decodeEntities(double ?? single ?? bare ?? '');
    }
    tags.push({
      name: name.toLowerCase(),
      attributes,
      start: match.index,
      end: match.index + whole.length,
      closing: slash === '/',
      selfClosing: selfClose === '/',
    });
  }
  return tags;
}

/** Text as a reader hears it: tags and Markdown emphasis removed, entities decoded, spaces collapsed. */
export function plainText(source: string): string {
  return decodeEntities(source.replace(TAG, ' '))
    .replace(/(\*\*|__|[*_`])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type HtmlElement = {
  name: string;
  attributes: Record<string, string>;
  /** From the opening tag to the end of the closing tag (or the opening, for a void element). */
  start: number;
  end: number;
  /** The source between the opening and closing tags. */
  inner: string;
  /** Lower-case names of every element inside. */
  contains: Set<string>;
};

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'track', 'wbr']);

/**
 * The elements with the given names, with what's inside each. An element
 * with no closing tag ends where the text ends.
 */
export function htmlElements(text: string, names: ReadonlySet<string>): HtmlElement[] {
  const tags = htmlTags(text);
  const found: HtmlElement[] = [];
  tags.forEach((tag, index) => {
    if (tag.closing || !names.has(tag.name)) return;
    if (tag.selfClosing || VOID.has(tag.name)) {
      found.push({ ...tag, inner: '', contains: new Set() });
      return;
    }
    let depth = 0;
    let close: HtmlTag | undefined;
    const contains = new Set<string>();
    for (const next of tags.slice(index + 1)) {
      if (next.name === tag.name) {
        if (!next.closing && !next.selfClosing) depth++;
        else if (next.closing) {
          if (depth === 0) {
            close = next;
            break;
          }
          depth--;
        }
      }
      if (!next.closing) contains.add(next.name);
    }
    found.push({
      name: tag.name,
      attributes: tag.attributes,
      start: tag.start,
      end: close?.end ?? text.length,
      inner: text.slice(tag.end, close?.start ?? text.length),
      contains,
    });
  });
  return found;
}
