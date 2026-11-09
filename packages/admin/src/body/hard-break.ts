import HardBreak from '@tiptap/extension-hard-break';

/*
 * A line break inside a paragraph (Shift+Enter) is written `\` and a
 * newline, never Tiptap's two trailing spaces. Two breaks in a row as
 * spaces left a line of nothing but spaces, which Markdown reads as a blank
 * line: the paragraph came back as two, so the writing view kept it as
 * written, and a save from it split it (DECISIONS.md, "A line break is
 * written as a backslash"). A backslash line reads back as a break in
 * Markdown, MDX and Markdoc alike, and trailing spaces don't survive editors
 * that trim them.
 */
export const LineBreak = HardBreak.extend({
  renderMarkdown: () => '\\\n',
});

/**
 * A break at the very end of a block shows nothing, and as a backslash it
 * would read back as a literal `\`: drop it, at the end of the text and
 * before a blank line (a paragraph's end inside a quote or list item).
 * An escaped backslash (`\\`) is text, and stays.
 */
export function dropEndBreaks(markdown: string): string {
  return markdown
    .replace(/(^|[^\\])((?:\\\\)*)\\(\n[ \t>]*)(?=\n)/g, '$1$2$3')
    .replace(/(^|[^\\])((?:\\\\)*)\\\s*$/, '$1$2');
}
