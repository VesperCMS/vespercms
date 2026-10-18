import {
  CST,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  type Document,
  type Node,
  type Pair,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';
import { deepEqual, isPlainObject, type DataValue } from '../equal.ts';
import { SerializationError } from '../errors.ts';
import { diffValues, getAt, type Patch, type Path } from '../patch.ts';
import {
  lineEndingAt,
  lineEndings,
  lineOf,
  lineStarts,
  withLineEnding,
  type LineEnding,
} from '../text.ts';
import { ASTRO_YAML_OPTIONS, readYaml } from './read.ts';
import { isPlainSafe, renderScalar, renderYaml } from './scalar.ts';
import { detectStyle, type YamlStyle } from './style.ts';

export type YamlWriteResult = {
  text: string;
  /** False when `next` equals what the text already holds; `text` is then the input, unchanged. */
  changed: boolean;
  /**
   * True when the change couldn't be spliced into the original text (anchors,
   * aliases, merge keys, explicit tags) and the YAML was re-rendered instead.
   * The value is still exact, but formatting and comments elsewhere in the
   * block may have moved. The studio says so in plain words before saving.
   */
  reformatted: boolean;
};

/**
 * Writes `next` into a YAML block, changing only the bytes of values that
 * differ from what the block holds now.
 *
 * Every result is re-read and compared with `next` before it is returned. A
 * result that doesn't read back exactly is never returned:
 * - if splicing fails, the Document API fallback is tried;
 * - if that fails too, a `SerializationError` is thrown and nothing is written.
 *
 * @param next The full new value, as raw input (Dates as Date objects), never Zod output.
 * @param options.expect `map` for frontmatter; `any` for data files whose root may be a sequence.
 */
export function writeYaml(
  raw: string,
  next: DataValue,
  options: { expect?: 'map' | 'any' } = {},
): YamlWriteResult {
  const expect = options.expect ?? 'map';
  const read = readYaml(raw, expect);
  if (!read.editable) throw new SerializationError('source-only', read.message);

  const patches = consolidate(diffValues(read.value, next), read.value, next);
  if (patches.length === 0) return { text: raw, changed: false, reformatted: false };

  const style = detectStyle(read.doc, raw);
  const spliced = spliceYaml(raw, read.doc, patches, style);
  if (spliced !== null && readsBackAs(spliced, next, expect)) {
    return { text: spliced, changed: true, reformatted: false };
  }

  const rerendered = documentFallback(raw, patches, style);
  if (readsBackAs(rerendered, next, expect))
    return { text: rerendered, changed: true, reformatted: true };
  throw new SerializationError(
    'verification-failed',
    "This change couldn't be saved without altering other content, so nothing was saved.",
  );
}

function readsBackAs(text: string, expected: DataValue, expect: 'map' | 'any'): boolean {
  const read = readYaml(text, expect);
  const normalized =
    expect === 'map' && (expected === null || expected === undefined) ? {} : expected;
  return read.editable && deepEqual(read.value, normalized);
}

/**
 * Removing every key of a nested map (or every item of a nested sequence)
 * can't be spliced line by line: the empty collection must become `{}` or
 * `[]`. Such groups of patches become a single `set` of the new collection.
 */
function consolidate(patches: Patch[], before: DataValue, after: DataValue): Patch[] {
  const emptied = new Set<string>();
  for (const patch of patches) {
    if (patch.op !== 'delete' || patch.path.length < 2) continue;
    const parentPath = patch.path.slice(0, -1);
    const parentBefore = getAt(before, parentPath);
    const deletes = patches.filter(
      (p) =>
        p.op === 'delete' &&
        p.path.length === patch.path.length &&
        samePath(p.path.slice(0, -1), parentPath),
    ).length;
    const size = Array.isArray(parentBefore)
      ? parentBefore.length
      : isPlainObject(parentBefore)
        ? Object.values(parentBefore).filter((v) => v !== undefined).length
        : -1;
    if (deletes === size) emptied.add(JSON.stringify(parentPath));
  }
  if (emptied.size === 0) return patches;

  const replaced: Patch[] = [];
  const done = new Set<string>();
  for (const patch of patches) {
    const owner = [...emptied].find((key) => isWithin(patch.path, JSON.parse(key) as Path));
    if (!owner) {
      replaced.push(patch);
    } else if (!done.has(owner)) {
      done.add(owner);
      const path = JSON.parse(owner) as Path;
      replaced.push({ op: 'set', path, value: getAt(after, path) });
    }
  }
  return replaced;
}

const samePath = (a: Path, b: Path) => a.length === b.length && a.every((s, i) => s === b[i]);
const isWithin = (path: Path, prefix: Path) =>
  path.length > prefix.length && prefix.every((s, i) => s === path[i]);

/**
 * Applies patches by splicing new text into `raw`. Returns `null` when a patch
 * touches YAML that splicing can't handle safely (the caller then re-renders).
 * The result is not verified here.
 */
export function spliceYaml(
  raw: string,
  doc: Document.Parsed,
  patches: readonly Patch[],
  style: YamlStyle = detectStyle(doc, raw),
): string | null {
  try {
    return new Splicer(raw, doc, style).apply(patches);
  } catch (error) {
    if (error instanceof NeedsFallback) return null;
    throw error;
  }
}

/** Thrown when a patch touches YAML that splicing can't handle safely. */
class NeedsFallback extends Error {}

type Splice = { start: number; end: number; text: string; order: number };

type Location =
  | { kind: 'pair'; map: YAMLMap; index: number; pair: Pair }
  | { kind: 'missing-key'; map: YAMLMap | null; key: string }
  | { kind: 'item'; seq: YAMLSeq; index: number; node: Node };

class Splicer {
  private readonly splices: Splice[] = [];
  private readonly raw: string;
  private readonly doc: Document.Parsed;
  private readonly style: YamlStyle;
  private readonly starts: number[];
  private readonly eol: LineEnding;

  constructor(raw: string, doc: Document.Parsed, style: YamlStyle) {
    this.raw = raw;
    this.doc = doc;
    this.style = style;
    this.starts = lineStarts(raw);
    this.eol = lineEndings(raw).dominant;
  }

  apply(patches: readonly Patch[]): string {
    for (const patch of patches) this.applyPatch(patch);
    return this.build();
  }

  // ------------------------------------------------------------------ patches

  private applyPatch(patch: Patch): void {
    if (patch.op === 'push') {
      const seq = this.nodeAt(patch.path);
      if (!isSeq(seq)) throw new NeedsFallback();
      this.pushItem(seq, patch.value);
      return;
    }
    if (patch.path.length === 0) throw new NeedsFallback();
    const location = this.locate(patch.path);

    if (patch.op === 'delete') {
      if (location.kind === 'pair') this.deletePair(location.map, location.index);
      else if (location.kind === 'item') this.deleteItem(location.seq, location.index);
      else
        throw new SerializationError('unsupported', `Nothing to delete at ${patch.path.join('.')}`);
      return;
    }

    if (location.kind === 'missing-key') {
      this.addKey(location.map, location.key, patch.value);
      return;
    }
    const current = location.kind === 'pair' ? location.pair.value : location.node;
    const inFlow =
      location.kind === 'pair' ? location.map.flow === true : location.seq.flow === true;
    if (isScalar(current) && isScalarValue(patch.value) && current.srcToken) {
      this.guard(current);
      this.setScalar(current, patch.value, inFlow, location.kind === 'pair');
    } else {
      this.replaceValue(location, patch.value);
    }
  }

  // ----------------------------------------------------------------- locating

  private guard(node: unknown): void {
    if (isAlias(node)) throw new NeedsFallback();
    if (isScalar(node) || isMap(node) || isSeq(node)) {
      if (node.anchor !== undefined || node.tag !== undefined) throw new NeedsFallback();
    }
    if (isMap(node) && node.items.some((pair) => !isScalar(pair.key) || pair.key.value === '<<')) {
      throw new NeedsFallback();
    }
  }

  private child(node: unknown, segment: string | number): unknown {
    this.guard(node);
    if (isMap(node) && typeof segment === 'string') {
      return node.items.find((pair) => keyOf(pair) === segment)?.value ?? undefined;
    }
    if (isSeq(node) && typeof segment === 'number') return node.items[segment];
    return undefined;
  }

  private nodeAt(path: Path): unknown {
    let node: unknown = this.doc.contents;
    for (const segment of path) node = this.child(node, segment);
    this.guard(node);
    return node;
  }

  private locate(path: Path): Location {
    const parent = path.length === 1 ? this.doc.contents : this.nodeAt(path.slice(0, -1));
    this.guard(parent);
    const last = path.at(-1);
    if (parent === null && typeof last === 'string')
      return { kind: 'missing-key', map: null, key: last };
    if (isMap(parent) && typeof last === 'string') {
      const index = parent.items.findIndex((pair) => keyOf(pair) === last);
      const pair = parent.items[index];
      return pair
        ? { kind: 'pair', map: parent, index, pair }
        : { kind: 'missing-key', map: parent, key: last };
    }
    if (isSeq(parent) && typeof last === 'number') {
      const node = parent.items[last];
      if (!node || isPair(node)) throw new NeedsFallback();
      return { kind: 'item', seq: parent, index: last, node: node as Node };
    }
    throw new NeedsFallback();
  }

  // -------------------------------------------------------------- operations

  private setScalar(node: Scalar, value: DataValue, inFlow: boolean, afterKey: boolean): void {
    const token = node.srcToken;
    if (!token || !('offset' in token)) throw new NeedsFallback();
    const original = CST.stringify(token);
    const clone = structuredClone(token);
    const rendered = renderScalar(
      value,
      { type: node.type, source: 'source' in token ? token.source : undefined, value: node.value },
      { inFlow, style: this.style },
    );
    CST.setScalarValue(clone, rendered.text, { type: rendered.type, inFlow, afterKey });
    this.splice(token.offset, token.offset + original.length, CST.stringify(clone));
  }

  private replaceValue(
    location: Exclude<Location, { kind: 'missing-key' }>,
    value: DataValue,
  ): void {
    if (location.kind === 'pair') {
      const { map, pair } = location;
      const key = pair.key as Scalar;
      const node = pair.value as Node | null;
      if (node) this.guard(node);
      if (map.flow) {
        if (!node?.range) throw new NeedsFallback();
        this.splice(node.range[0], node.range[1], this.flowText(value));
        return;
      }
      const keyEnd = rangeOf(key)[1];
      const end = this.valueEnd(node, keyEnd);
      const indent = this.column(rangeOf(key)[0]);
      this.splice(keyEnd, end, this.trailingNewline(`:${this.valueSuffix(value, indent)}`, end));
      return;
    }
    const { seq, node } = location;
    this.guard(node);
    const range = rangeOf(node);
    if (seq.flow) {
      this.splice(range[0], range[1], this.flowText(value));
      return;
    }
    const end = this.valueEnd(node, range[0]);
    this.splice(
      range[0],
      end,
      this.trailingNewline(this.itemText(value, this.column(range[0])), end),
    );
  }

  private addKey(map: YAMLMap | null, key: string, value: DataValue): void {
    if (map?.flow) {
      const last = map.items.at(-1);
      if (last) {
        const end = rangeOf((last.value ?? last.key) as Node)[1];
        this.splice(end, end, `, ${this.keyText(key, true)}: ${this.flowText(value)}`);
      } else {
        const open = rangeOf(map)[0] + 1;
        const pad = this.style.flowPadding ? ' ' : '';
        this.splice(open, open, `${pad}${this.keyText(key, true)}: ${this.flowText(value)}${pad}`);
      }
      return;
    }
    const first = map?.items[0];
    const indent = first ? this.column(rangeOf(first.key as Node)[0]) : 0;
    const position = map ? rangeOf(map)[2] : this.raw.length;
    const atLineStart = position === 0 || this.raw[position - 1] === '\n';
    if (!atLineStart && position !== this.raw.length) throw new NeedsFallback();
    const line = `${' '.repeat(indent)}${this.keyText(key, false)}:${this.valueSuffix(value, indent)}`;
    this.splice(position, position, atLineStart ? line : `\n${line.replace(/\n$/, '')}`);
  }

  private deletePair(map: YAMLMap, index: number): void {
    const pair = map.items[index];
    if (!pair) throw new NeedsFallback();
    const key = pair.key as Node;
    const value = pair.value as Node | null;
    if (map.flow) {
      this.deleteFlowItem(
        map.items.map((p) => ({
          start: rangeOf(p.key as Node)[0],
          end: rangeOf((p.value ?? p.key) as Node)[1],
        })),
        index,
      );
      return;
    }
    const keyStart = rangeOf(key)[0];
    const lineStart = this.lineStart(keyStart);
    const end = this.valueEnd(value, rangeOf(key)[1]);
    if (/^[ \t]*$/.test(this.raw.slice(lineStart, keyStart))) {
      this.splice(lineStart, end, '');
      return;
    }
    // The first key of a map that starts on a `- ` line: keep the dash and pull the next key up.
    const nextPair = map.items[index + 1];
    if (index !== 0 || !nextPair) throw new NeedsFallback();
    this.splice(keyStart, rangeOf(nextPair.key as Node)[0], '');
  }

  private deleteItem(seq: YAMLSeq, index: number): void {
    const items = seq.items as Node[];
    const node = items[index];
    if (!node) throw new NeedsFallback();
    if (seq.flow) {
      this.deleteFlowItem(
        items.map((item) => ({ start: rangeOf(item)[0], end: rangeOf(item)[1] })),
        index,
      );
      return;
    }
    const start = rangeOf(node)[0];
    const lineStart = this.lineStart(start);
    if (!/^[ \t]*-[ \t]*$/.test(this.raw.slice(lineStart, start))) throw new NeedsFallback();
    this.splice(lineStart, this.valueEnd(node, start), '');
  }

  private deleteFlowItem(items: { start: number; end: number }[], index: number): void {
    const item = items[index];
    if (!item) throw new NeedsFallback();
    const next = items[index + 1];
    const previous = items[index - 1];
    if (next) this.splice(item.start, next.start, '');
    else if (previous) this.splice(previous.end, item.end, '');
    else this.splice(item.start, item.end, '');
  }

  private pushItem(seq: YAMLSeq, value: DataValue): void {
    const items = seq.items as Node[];
    if (seq.flow) {
      const last = items.at(-1);
      if (last) {
        const end = rangeOf(last)[1];
        this.splice(end, end, `, ${this.flowText(value)}`);
      } else {
        const open = rangeOf(seq)[0] + 1;
        const pad = this.style.flowPadding ? ' ' : '';
        this.splice(open, open, `${pad}${this.flowText(value)}${pad}`);
      }
      return;
    }
    const first = items[0];
    if (!first) throw new NeedsFallback();
    const firstStart = rangeOf(first)[0];
    const dashColumn = this.raw.slice(this.lineStart(firstStart), firstStart).indexOf('-');
    if (dashColumn < 0) throw new NeedsFallback();
    const position = rangeOf(seq)[2];
    const atLineStart = position === 0 || this.raw[position - 1] === '\n';
    if (!atLineStart && position !== this.raw.length) throw new NeedsFallback();
    // Items written as one-line flow maps (`- { from: /a, to: /b }`) get a new one in kind.
    const last = items.at(-1);
    const oneLineFlow =
      (isMap(last) || isSeq(last)) &&
      last.flow === true &&
      !this.raw.slice(rangeOf(last)[0], rangeOf(last)[1]).includes('\n') &&
      (isMap(last) ? isPlainObject(value) : Array.isArray(value));
    const text = oneLineFlow ? `${this.flowText(value)}\n` : this.itemText(value, dashColumn + 2);
    const line = `${' '.repeat(dashColumn)}- ${text}`;
    this.splice(position, position, atLineStart ? line : `\n${line.replace(/\n$/, '')}`);
  }

  // --------------------------------------------------------------- rendering

  /** Text after `key:` for a block map value: ` scalar\n`, ` []\n`, or `\n` plus an indented block. */
  private valueSuffix(value: DataValue, keyIndent: number): string {
    if (isScalarValue(value)) return ` ${this.scalarText(value, false)}\n`;
    if (Array.isArray(value) && value.length === 0) return ' []\n';
    if (isPlainObject(value) && Object.keys(value).length === 0) return ' {}\n';
    const childIndent =
      keyIndent + (Array.isArray(value) && !this.style.indentSeq ? 0 : this.style.indent);
    return `\n${indentLines(renderYaml(value, this.style, false), childIndent, true)}`;
  }

  /** Text after `- ` for a block sequence item: the first line inline, the rest indented. */
  private itemText(value: DataValue, contentColumn: number): string {
    if (isScalarValue(value)) return `${this.scalarText(value, false)}\n`;
    if (Array.isArray(value) && value.length === 0) return '[]\n';
    if (isPlainObject(value) && Object.keys(value).length === 0) return '{}\n';
    return indentLines(renderYaml(value, this.style, false), contentColumn, false);
  }

  private flowText(value: DataValue): string {
    if (isScalarValue(value)) return this.scalarText(value, true);
    return renderYaml(value, this.style, true).trimEnd();
  }

  private scalarText(value: DataValue, inFlow: boolean): string {
    const rendered = renderScalar(value, null, { inFlow, style: this.style });
    return CST.stringify(
      CST.createScalarToken(rendered.text, { indent: 0, inFlow, type: rendered.type, end: [] }),
    );
  }

  private keyText(key: string, inFlow: boolean): string {
    const probe = readYaml(inFlow ? `\nx: {${key}: 1}\n` : `\n${key}: 1\n`);
    const keys = probe.editable
      ? Object.keys((inFlow ? (probe.value as { x?: object }).x : probe.value) ?? {})
      : [];
    const plain = keys.length === 1 && keys[0] === key && isPlainSafe(key, inFlow);
    return plain ? key : JSON.stringify(key);
  }

  // -------------------------------------------------------------- positions

  private lineStart(offset: number): number {
    return this.starts[lineOf(this.starts, offset)] ?? 0;
  }

  private column(offset: number): number {
    return offset - this.lineStart(offset);
  }

  /** End of a value, including its trailing comment and line break. */
  private valueEnd(node: Node | null, fallbackOffset: number): number {
    if ((isMap(node) || isSeq(node)) && !node.flow) return rangeOf(node)[2];
    const contentEnd = node?.range ? Math.max(node.range[1], fallbackOffset) : fallbackOffset;
    const newline = this.raw.indexOf('\n', Math.max(contentEnd - 1, 0));
    if (node && isScalar(node) && (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED')) {
      return rangeOf(node)[2];
    }
    return newline === -1 ? this.raw.length : newline + 1;
  }

  /** Drops the generated final newline when the replaced text didn't end with one (end of file). */
  private trailingNewline(text: string, end: number): string {
    return this.raw[end - 1] === '\n' ? text : text.replace(/\n$/, '');
  }

  private splice(start: number, end: number, text: string): void {
    const eol = lineEndingAt(this.raw, start, this.eol);
    this.splices.push({ start, end, text: withLineEnding(text, eol), order: this.splices.length });
  }

  private build(): string {
    const ordered = [...this.splices].sort(
      (a, b) => a.start - b.start || a.end - b.end || a.order - b.order,
    );
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      if (previous && current && current.start < previous.end) throw new NeedsFallback();
    }
    let out = '';
    let cursor = 0;
    for (const splice of ordered) {
      out += this.raw.slice(cursor, splice.start) + splice.text;
      cursor = Math.max(cursor, splice.end);
    }
    return out + this.raw.slice(cursor);
  }
}

function keyOf(pair: Pair): string | undefined {
  return isScalar(pair.key) ? String(pair.key.value) : undefined;
}

function rangeOf(node: Node | YAMLMap | YAMLSeq): [number, number, number] {
  if (!node.range) throw new NeedsFallback();
  return node.range;
}

function isScalarValue(value: DataValue): boolean {
  return value === null || value instanceof Date || typeof value !== 'object';
}

/** Indents every line after the first (or every line) by `width`, leaving blank lines blank. */
function indentLines(text: string, width: number, includeFirst: boolean): string {
  const pad = ' '.repeat(width);
  return text
    .split('\n')
    .map((line, i) => (line === '' || (i === 0 && !includeFirst) ? line : pad + line))
    .join('\n');
}

/**
 * Last resort: apply the patches through yaml's Document API and re-render
 * the whole block. Values are exact; formatting may change, which is why the
 * result is flagged `reformatted`.
 */
function documentFallback(raw: string, patches: readonly Patch[], style: YamlStyle): string {
  const doc: Document = parseDocument(raw, { ...ASTRO_YAML_OPTIONS });
  // Expand aliases into copies first. Patching an anchored node would
  // otherwise change every alias too, or leave aliases pointing at nothing.
  visit(doc, {
    Alias(_, alias) {
      const target = alias.resolve(doc);
      return target ? doc.createNode(target.toJS(doc)) : undefined;
    },
  });
  visit(doc, {
    Node(_, node) {
      if ('anchor' in node) delete node.anchor;
    },
  });
  for (const patch of patches) {
    if (patch.op === 'set') {
      if (patch.path.length === 0) doc.contents = doc.createNode(patch.value);
      else doc.setIn(patch.path, patch.value);
    } else if (patch.op === 'delete') {
      doc.deleteIn(patch.path);
    } else {
      doc.addIn(patch.path, patch.value);
    }
  }
  const rendered = doc.toString({
    indent: style.indent,
    indentSeq: style.indentSeq,
    lineWidth: 0,
    minContentWidth: 0,
    singleQuote: style.quote === 'QUOTE_SINGLE',
    flowCollectionPadding: style.flowPadding,
  });
  const leading = /^(\r?\n)*/.exec(raw)?.[0] ?? '';
  const body = doc.contents === null || rendered.trim() === '{}' ? '' : rendered;
  const text = withLineEnding(leading + body, lineEndings(raw).dominant);
  return raw.endsWith('\n') || text === '' ? text : text.replace(/\r?\n$/, '');
}
