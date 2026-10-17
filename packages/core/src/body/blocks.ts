import { lineEndings, withLineEnding, type LineEnding } from '../files/text.ts';
import { markdocBlocks } from './markdoc.ts';
import { mdastBlocks } from './mdast.ts';
import type {
  BodyBlock,
  BodyFormat,
  BodyItem,
  BodyTag,
  ParseBodyOptions,
  ParsedBody,
} from './types.ts';

/*
 * Bodies are parsed with the parser the site renders with: micromark with
 * GFM for Markdown (Astro's default), plus the MDX extensions for .mdx, and
 * Markdoc with Astro's tokenizer options for .mdoc. On save, unchanged
 * blocks are copied byte for byte, and so is the whitespace between two
 * untouched neighbours. Only changed or new blocks are new text, and a
 * container (a tag with content) re-writes only the parts that changed: its
 * opening, or the children that changed, never its closing.
 */

export function parseBody(
  body: string,
  format: BodyFormat,
  options: ParseBodyOptions = {},
): ParsedBody {
  return {
    text: body,
    blocks:
      format === 'mdoc'
        ? markdocBlocks(body, options.markdoc)
        : mdastBlocks(body, format === 'mdx'),
  };
}

const anchorOf = (item: BodyItem): number | null =>
  'keep' in item ? item.keep : (item.replaces ?? null);

type Sequence = {
  text: string;
  blocks: readonly BodyBlock[];
  eol: LineEnding;
  /** Text before the first block, after the last, and what an empty sequence becomes. */
  leading: string;
  trailing: string;
  empty: string;
  /** Prefix for every line after a sequence item's first (content inside an indented container). */
  indent: string;
};

/**
 * Builds the new body from the original plus an ordered list of items.
 * - The text before the first block and after the last is always kept.
 * - Kept blocks copy their exact bytes.
 * - Two kept blocks that were neighbours keep the exact whitespace between them.
 * - Everywhere else, blocks are separated by one blank line in the body's
 *   own line ending.
 *
 * So keeping every block in order reproduces the input exactly, and the
 * same holds inside every container.
 */
export function assembleBody(parsed: ParsedBody, items: readonly BodyItem[]): string {
  const { text, blocks } = parsed;
  const eol = lineEndings(text).dominant;
  const first = blocks[0];
  const last = blocks.at(-1);
  const leading = first ? text.slice(0, first.start) : text;
  const trailing = last ? text.slice(last.end) : '';
  return assemble(
    {
      text,
      blocks,
      eol,
      // A body with no blocks at all ends with a line break before new text.
      leading: !first && leading !== '' && !leading.endsWith('\n') ? leading + eol : leading,
      trailing: last ? trailing : eol,
      empty: first ? leading.replace(/\s+$/, '') + trailing : text,
      indent: '',
    },
    items,
  );
}

function assemble(sequence: Sequence, items: readonly BodyItem[]): string {
  const { text, blocks, eol, indent } = sequence;
  if (items.length === 0) return sequence.empty;
  let out = sequence.leading;
  let previous: number | null = null;
  items.forEach((item, i) => {
    const anchor = anchorOf(item);
    if (i > 0) {
      // Going forward through the original (neighbours, or blocks removed in
      // between), keep the exact whitespace that preceded this block.
      const before = anchor === null ? undefined : blocks[anchor - 1];
      const current = anchor === null ? undefined : blocks[anchor];
      out +=
        anchor !== null && previous !== null && anchor > previous && before && current
          ? text.slice(before.end, current.start)
          : eol + eol + indent;
    }
    out += itemText(sequence, item);
    previous = anchor;
  });
  return out + sequence.trailing;
}

function itemText(sequence: Sequence, item: BodyItem): string {
  const { text, blocks, eol, indent } = sequence;
  if ('keep' in item) {
    const block = blocks[item.keep];
    if (!block) throw new RangeError(`No block ${String(item.keep)} here.`);
    return text.slice(block.start, block.end);
  }
  if ('text' in item) return indented(item.text.replace(/\s+$/, ''), eol, indent);

  if (item.replaces === undefined) {
    if (item.open === undefined || item.close === undefined) {
      throw new TypeError('A new container needs its opening and closing text.');
    }
    const inner = assemble(
      {
        text: '',
        blocks: [],
        eol,
        leading: eol + indent,
        trailing: eol + indent,
        empty: eol + indent,
        indent,
      },
      item.children,
    );
    return indented(item.open, eol, indent) + inner + item.close;
  }

  const block = blocks[item.replaces];
  const tag = block?.tag;
  if (!block || tag?.closeStart === undefined || !tag.children) {
    throw new RangeError(`Block ${String(item.replaces)} has no content to edit.`);
  }
  const open = item.open ?? text.slice(block.start, tag.openEnd);
  const close = item.close ?? text.slice(tag.closeStart, block.end);
  return (
    indented(open, eol, indent) +
    assemble(innerOf(text, tag, tag.closeStart, eol), item.children) +
    close
  );
}

/** The sequence between a container's opening and closing. */
function innerOf(text: string, tag: BodyTag, closeStart: number, eol: LineEnding): Sequence {
  const children = tag.children ?? [];
  const first = children[0];
  const last = children.at(-1);
  const inner = text.slice(tag.openEnd, closeStart);
  // Content lines are indented like the original's; the closing like its own line.
  const closeIndent = /[ \t]*$/.exec(inner)?.[0] ?? '';
  const indent = tag.indent ?? '';
  return {
    text,
    blocks: children,
    eol,
    leading: first ? text.slice(tag.openEnd, first.start) : eol + indent,
    trailing: last ? text.slice(last.end, closeStart) : eol + closeIndent,
    empty: first ? eol + closeIndent : inner,
    indent,
  };
}

/** Text in the body's line ending, with every line after the first indented. */
function indented(value: string, eol: LineEnding, indent: string): string {
  const text = withLineEnding(value, eol);
  if (indent === '') return text;
  return text
    .split(eol)
    .map((line, i) => (i === 0 || line === '' ? line : indent + line))
    .join(eol);
}

/** Every block kept in order: the identity edit. */
export function keepAll(parsed: ParsedBody): BodyItem[] {
  return parsed.blocks.map((_, keep) => ({ keep }));
}

/**
 * A block's text with its container's indentation taken off every line
 * after the first, so it can be parsed on its own. Returns null when a line
 * isn't indented like the rest (the block is then kept as written).
 */
export function dedentedText(text: string, block: BodyBlock, indent: string): string | null {
  const raw = text.slice(block.start, block.end);
  if (indent === '') return raw;
  const lines = raw.split('\n');
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (i === 0 || line.trim() === '') out.push(i === 0 ? line : line.replace(/^[ \t]*/, ''));
    else if (line.startsWith(indent)) out.push(line.slice(indent.length));
    else return null;
  }
  return out.join('\n');
}
