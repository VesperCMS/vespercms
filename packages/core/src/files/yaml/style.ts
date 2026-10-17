import { isMap, isSeq, visit, type Document, type Scalar } from 'yaml';

/** How a file writes its YAML, so new text matches the text around it. */
export type YamlStyle = {
  /** Spaces per nesting level. */
  indent: number;
  /** Whether block sequences under a key are indented (`key:\n  - a`) or not (`key:\n- a`). */
  indentSeq: boolean;
  /** Quote style for strings that can't be plain. */
  quote: 'QUOTE_DOUBLE' | 'QUOTE_SINGLE';
  /** `{ a: 1 }` rather than `{a: 1}`. */
  flowPadding: boolean;
};

export const DEFAULT_STYLE: YamlStyle = {
  indent: 2,
  indentSeq: true,
  quote: 'QUOTE_DOUBLE',
  flowPadding: true,
};

type Counter<T extends string | number> = Map<T, number>;
const bump = <T extends string | number>(counter: Counter<T>, key: T) => {
  counter.set(key, (counter.get(key) ?? 0) + 1);
};
const mostCommon = <T extends string | number>(counter: Counter<T>, fallback: T): T => {
  let best = fallback;
  let bestCount = 0;
  for (const [key, count] of counter) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
};

/** Infers the file's YAML style from a document parsed with `keepSourceTokens`. */
export function detectStyle(doc: Document.Parsed, raw: string): YamlStyle {
  const indents: Counter<number> = new Map();
  const seqIndented: Counter<'yes' | 'no'> = new Map();
  const quotes: Counter<YamlStyle['quote']> = new Map();
  const padding: Counter<'yes' | 'no'> = new Map();

  visit(doc, {
    Pair(_, pair, path) {
      const parent = path.at(-1);
      if (!isMap(parent) || parent.flow) return;
      const parentIndent =
        parent.srcToken && 'indent' in parent.srcToken ? parent.srcToken.indent : 0;
      const value = pair.value;
      if (
        (isMap(value) || isSeq(value)) &&
        !value.flow &&
        value.srcToken &&
        'indent' in value.srcToken
      ) {
        const delta = value.srcToken.indent - parentIndent;
        if (isSeq(value)) bump(seqIndented, delta > 0 ? 'yes' : 'no');
        if (delta > 0) bump(indents, delta);
      }
    },
    Scalar(_, node: Scalar) {
      if (typeof node.value !== 'string') return;
      if (node.type === 'QUOTE_DOUBLE' || node.type === 'QUOTE_SINGLE') bump(quotes, node.type);
    },
    Map(_, node) {
      if (node.flow && node.items.length > 0 && node.range)
        bump(padding, raw[node.range[0] + 1] === ' ' ? 'yes' : 'no');
    },
    Seq(_, node) {
      if (node.flow && node.items.length > 0 && node.range)
        bump(padding, raw[node.range[0] + 1] === ' ' ? 'yes' : 'no');
    },
  });

  return {
    indent: mostCommon(indents, DEFAULT_STYLE.indent),
    indentSeq: mostCommon(seqIndented, 'yes') === 'yes',
    quote: mostCommon(quotes, DEFAULT_STYLE.quote),
    flowPadding: mostCommon(padding, 'yes') === 'yes',
  };
}
