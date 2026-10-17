import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleBody, keepAll, parseBody } from '../src/body/blocks.ts';
import { editJsxTag, jsxTagLayout } from '../src/body/jsx-tag.ts';
import { editMarkdocTag, markdocTags } from '../src/body/markdoc-tag.ts';
import type { BodyBlock, BodyFormat, BodyItem, ParsedBody } from '../src/body/types.ts';
import { splitFrontmatter } from '../src/files/frontmatter.ts';

/*
 * Phase 2.5's "editing one tag changes only that tag's text in the file
 * (snapshot tests)": every tag and component in the playground's Markdoc
 * and MDX content gets one attribute edit, spliced through assembleBody as
 * the studio saves it. Each edit must leave every other byte alone, and the
 * snapshot records each tag's text before and after, so a change in how
 * tags are written shows up in review.
 */

const playground = fileURLToPath(new URL('../../../apps/playground/', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(mdoc|mdx)$/.test(name) ? [path] : [];
    });
}

type Edit = { start: number; end: number; before: string; after: string };

/** One edit for a tag's opening: the first attribute changed, or one added when it has none. */
function editOpening(syntax: 'markdoc' | 'mdx', opening: string): string | null {
  if (syntax === 'markdoc') {
    const [token] = markdocTags(opening);
    const first = token?.attributes.find((a) => a.type === 'attribute');
    if (!token?.name || ['if', 'else'].includes(token.name)) return null;
    if (!first) return editMarkdocTag(opening, [['title', 'Added']], ['type', 'title']);
    const value = first.value;
    const next =
      typeof value === 'string'
        ? `${value} (edited)`
        : typeof value === 'boolean'
          ? !value
          : undefined;
    return next === undefined ? null : editMarkdocTag(opening, [[first.name, next]]);
  }
  const layout = jsxTagLayout(opening);
  const first = layout?.attributes.find((a) => a.readable && typeof a.value === 'string');
  if (!first) return null;
  return editJsxTag(opening, [[first.name, `${String(first.value)} (edited)`]]);
}

/** Every tag's opening span, with the path of the top-level block that holds it. */
function openings(
  text: string,
  blocks: readonly BodyBlock[],
  top?: number,
): { start: number; end: number; top: number; syntax: 'markdoc' | 'mdx' }[] {
  return blocks.flatMap((block, i) => {
    const holder = top ?? i;
    const out: { start: number; end: number; top: number; syntax: 'markdoc' | 'mdx' }[] = [];
    if (block.kind === 'tag' && block.tag) {
      out.push({
        start: block.start,
        end: block.tag.openEnd,
        top: holder,
        syntax: block.tag.syntax,
      });
      if (block.tag.children) out.push(...openings(text, block.tag.children, holder));
    }
    for (const chip of block.chips ?? []) {
      const source = text.slice(chip.start, chip.end);
      if (chip.kind === 'tag') {
        out.push({
          start: chip.start,
          end: chip.start + (markdocTags(source)[0]?.end ?? 0),
          top: holder,
          syntax: 'markdoc',
        });
      } else if (chip.kind === 'component') {
        out.push({
          start: chip.start,
          end: chip.start + (jsxTagLayout(source)?.openEnd ?? 0),
          top: holder,
          syntax: 'mdx',
        });
      }
    }
    return out;
  });
}

/** The save the studio makes: the top-level block holding the edit replaced, everything else kept. */
function save(parsed: ParsedBody, top: number, edited: string): string {
  const block = parsed.blocks[top];
  if (!block) throw new Error(`no block ${String(top)}`);
  const delta = edited.length - parsed.text.length;
  const items: BodyItem[] = keepAll(parsed).map((item, i) =>
    i === top ? { text: edited.slice(block.start, block.end + delta), replaces: top } : item,
  );
  return assembleBody(parsed, items);
}

describe('one tag edit changes only that tag', () => {
  const report: string[] = [];

  for (const path of files(join(playground, 'src/content'))) {
    const name = relative(playground, path).replaceAll('\\', '/');
    const format = path.endsWith('.mdx') ? 'mdx' : ('mdoc' as BodyFormat);
    const body = splitFrontmatter(readFileSync(path, 'utf8')).body;
    const parsed = parseBody(
      body,
      format,
      format === 'mdoc' ? { markdoc: { allowHTML: true } } : {},
    );

    it(`${name}: each tag's edit changes only its own text`, () => {
      const edits: Edit[] = [];
      for (const opening of openings(body, parsed.blocks)) {
        const before = body.slice(opening.start, opening.end);
        const after = editOpening(opening.syntax, before);
        if (after === null) continue;
        const expected = body.slice(0, opening.start) + after + body.slice(opening.end);
        expect(save(parsed, opening.top, expected)).toBe(expected);
        edits.push({ start: opening.start, end: opening.end, before, after });
      }
      report.push(`## ${name}`, '', ...edits.flatMap((e) => [`- ${e.before}`, `+ ${e.after}`, '']));
    });
  }

  it('matches the recorded edits', async () => {
    await expect(`${report.join('\n')}\n`).toMatchFileSnapshot('__snapshots__/tag-edits.md');
  });
});
