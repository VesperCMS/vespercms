import type { BodyBlock } from './types.ts';

/** The whole body as one protected block, for bodies that don't parse. */
export function wholeBody(body: string): BodyBlock[] {
  const start = body.search(/\S/);
  if (start === -1) return [];
  return [{ start, end: body.trimEnd().length, kind: 'source', type: 'unparsed' }];
}

/**
 * The indentation every content line of a container shares, when the first
 * child's line starts with some: new and changed children get the same.
 */
export function contentIndent(
  text: string,
  from: number,
  to: number,
  children: readonly BodyBlock[],
): string {
  const first = children[0];
  if (!first) return '';
  const lineStart = text.lastIndexOf('\n', first.start - 1) + 1;
  const indent = text.slice(lineStart, first.start);
  if (!/^[ \t]+$/.test(indent)) return '';
  const content = text.slice(from, to).split('\n').slice(1);
  return content.every((line) => line.trim() === '' || line.startsWith(indent)) ? indent : '';
}

/** Text with `indent` taken off every line after the first; null when a line isn't indented so. */
export function dedent(text: string, indent: string): string | null {
  if (indent === '') return text;
  const lines = text.split('\n');
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (i === 0) out.push(line);
    else if (line.trim() === '') out.push(line.trim());
    else if (line.startsWith(indent)) out.push(line.slice(indent.length));
    else return null;
  }
  return out.join('\n');
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}
