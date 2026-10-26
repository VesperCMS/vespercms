/*
 * Bodies as blocks with exact source ranges (DECISIONS.md, "The body editor
 * splices changed blocks into the original text"). Phase 2.5 makes blocks
 * nestable: a Markdoc tag or MDX element with content is a container whose
 * children are blocks too, and a Markdown block can hold inline chips
 * (inline tags, variables, annotations, inline JSX), so each can be edited
 * on its own.
 */

export type BodyFormat = 'md' | 'mdx' | 'mdoc';

/**
 * The `@astrojs/markdoc` integration options that change how Astro parses
 * Markdoc. They decide which tokenizer options Vesper parses with.
 */
export type MarkdocParseOptions = { allowHTML?: boolean; ignoreIndentation?: boolean };

export type ParseBodyOptions = { markdoc?: MarkdocParseOptions };

/** Something inside a Markdown block that the writing view keeps as one piece. Offsets are absolute. */
export type InlineChip = {
  start: number;
  end: number;
  /**
   * `tag`: an inline Markdoc tag with its content (`{% abbr %}CMS{% /abbr %}`).
   * `variable`: `{% $x %}` or a function call. `annotation`: `{% .lead %}`.
   * `component`: inline JSX. `expression`: an MDX `{…}`.
   */
  kind: 'tag' | 'variable' | 'annotation' | 'component' | 'expression';
  /** Tag or component name. */
  name?: string;
};

/** A Markdoc tag or MDX element. Offsets are absolute. */
export type BodyTag = {
  syntax: 'markdoc' | 'mdx';
  name: string;
  /** Just after the opening tag (`%}` or `>`). */
  openEnd: number;
  selfClosing: boolean;
  /**
   * Set for a tag laid out as an opening line, content and a closing line:
   * the closing's start and the content's blocks. A tag with content on its
   * opening's line has neither, and its content is kept as written.
   */
  closeStart?: number;
  children?: BodyBlock[];
  /** Whitespace every content line starts with, given to new and changed children. */
  indent?: string;
};

/** A column's alignment, from the colons in a pipe table's delimiter row; null when it has none. */
export type TableAlign = 'left' | 'center' | 'right' | null;

/** One cell of a pipe table. Offsets are absolute. */
export type TableCell = {
  /** The text between the cell's pipes (or the line's edge, without outer pipes). */
  start: number;
  end: number;
  /** The content inside that, without padding. Empty cells have `contentStart === contentEnd`. */
  contentStart: number;
  contentEnd: number;
  chips?: InlineChip[];
};

/** One line of a pipe table. Offsets are absolute. */
export type TableLine = {
  /** From the line's start (the block's start, for the header) to before its line ending. */
  start: number;
  end: number;
  cells: TableCell[];
};

/** A pipe table every cell of which is one line of inline Markdown the writing view writes back. */
export type BodyTable = {
  align: TableAlign[];
  header: TableLine;
  /** The `|---|:---:|` line: its cells hold the dashes and colons. */
  delimiter: TableLine;
  rows: TableLine[];
};

export type BodyBlock = {
  /** Offsets of the block's own text in the body, without surrounding blank lines or indentation. */
  start: number;
  end: number;
  /**
   * `markdown`: Markdown the writing view can show faithfully, perhaps with chips.
   * `tag`: a Markdoc tag or MDX element, with its structure in `tag`.
   * `table`: a pipe table whose cells the writing view can edit, with its structure in `table`.
   * `source`: anything else (expressions, imports, raw HTML, other tables, comments,
   * link definitions). Edited as raw text, never reformatted.
   */
  kind: 'markdown' | 'tag' | 'table' | 'source';
  /** The parser's node type, such as `paragraph`, `heading`, `mdxJsxFlowElement` or `tag`. */
  type: string;
  tag?: BodyTag;
  table?: BodyTable;
  chips?: InlineChip[];
};

export type ParsedBody = { blocks: BodyBlock[]; text: string };

/**
 * One block of the edited body:
 * - `keep`: an original block, byte for byte;
 * - `text`: new text, which takes the place of `replaces` when given (so the
 *   whitespace around it is kept);
 * - a container: a tag with content. With `replaces`, `open` and `close`
 *   default to the original's and `children` index into its children; a new
 *   container needs both.
 */
export type BodyItem =
  | { keep: number }
  | { text: string; replaces?: number }
  | { open?: string; close?: string; children: BodyItem[]; replaces?: number };
