// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import {
  assembleBody,
  splitFrontmatter,
  type BodyBlock,
  type Manifest,
  type ParsedBody,
} from '@vesper/core';
import { afterAll, describe, expect, it } from 'vitest';
import { JAZZY_MARKDOC } from '../../../core/test/helpers/jazzy-markdoc.ts';
import { playgroundManifest } from '../test/helpers.tsx';
import { catalogOf } from './catalog.ts';
import { bodyItems, buildDocument, snapshot } from './document.ts';
import { BlockIndex, SourceBlock, VesperCard, VesperInline, containerTypes } from './nodes.ts';

/*
 * Phase 2.5's "variables, conditionals, functions and annotations survive
 * any edit byte-identical", through the real editor: every Markdoc file in
 * the playground and in the jazzy-astro5 corpus is opened, and each block
 * the writing view can edit (at any depth, inside frames too) gets text
 * typed at its end, one at a time. After each edit:
 * - every byte outside that block is unchanged (so every protected chip,
 *   condition, partial and tag elsewhere is byte-identical);
 * - the block itself still holds each of its chips, byte for byte, in order.
 * And opening and saving without an edit changes nothing at all.
 */

// jsdom gives tests an http: import.meta.url, so paths start from where Vitest runs (the repo).
const repo = process.cwd();

function mdocFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return mdocFiles(path);
      return name.endsWith('.mdoc') ? [path] : [];
    });
}

const jazzyManifest = { ...playgroundManifest, markdoc: JAZZY_MARKDOC } as Manifest;
const sources = [
  ...mdocFiles(join(repo, 'apps/playground/src/content')).map((path) => ({
    path,
    manifest: playgroundManifest,
  })),
  ...mdocFiles(join(repo, 'packages/core/test/corpus/jazzy-astro5')).map((path) => ({
    path,
    manifest: jazzyManifest,
  })),
];

let editor: Editor | undefined;
afterAll(() => editor?.destroy());

function open(body: string, manifest: Manifest) {
  const catalog = catalogOf(manifest, 'mdoc');
  const containers = containerTypes(catalog);
  editor?.destroy();
  editor = new Editor({
    extensions: [
      StarterKit.configure({ underline: false, trailingNode: false }),
      Image.configure({ inline: true }),
      Markdown,
      BlockIndex,
      SourceBlock,
      VesperCard,
      VesperInline,
      ...containers.extensions,
    ],
  });
  const e = editor;
  const markdown = e.markdown as MarkdownManager;
  const built = buildDocument(body, {
    format: 'mdoc',
    markdown,
    catalog,
    containers,
    ...(manifest.markdoc ? { markdoc: manifest.markdoc.options } : {}),
  });
  const reset = () => {
    e.commands.setContent(built.doc, { emitUpdate: false });
  };
  reset();
  const initial = snapshot(e.getJSON(), containers);
  const save = () =>
    assembleBody(
      built.parsed,
      bodyItems(e.getJSON(), initial, { markdown, containers, parsed: built.parsed }),
    );
  return { e, built, reset, save };
}

function blockAt(parsed: ParsedBody, path: string): BodyBlock | undefined {
  let blocks: readonly BodyBlock[] = parsed.blocks;
  let block: BodyBlock | undefined;
  for (const part of path.split('.')) {
    block = blocks[Number(part)];
    blocks = block?.tag?.children ?? [];
  }
  return block;
}

/** Markdown blocks the writing view edits (code blocks hold no chips and no tags). */
const EDITABLE = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote']);

describe('Markdoc bodies keep every protected byte through any edit', () => {
  for (const { path, manifest } of sources) {
    const name = path.slice(repo.length + 1).replaceAll('\\', '/');
    const body = splitFrontmatter(readFileSync(path, 'utf8')).body;

    it(`${name}: opening and saving changes nothing`, () => {
      expect(open(body, manifest).save()).toBe(body);
    });

    it(`${name}: typing in any block changes only that block, and keeps its chips`, () => {
      const { e, built, reset, save } = open(body, manifest);
      // Every editable block with a path, and where its last text ends.
      const targets: { path: string; end: number }[] = [];
      e.state.doc.descendants((node, pos) => {
        const blockPath = node.attrs.vesperBlock as unknown;
        // Frames have paths too: look inside them for their editable children.
        if (typeof blockPath !== 'string' || !EDITABLE.has(node.type.name)) return true;
        let end = node.isTextblock ? pos + node.nodeSize - 1 : -1;
        node.descendants((child, childPos) => {
          if (child.isTextblock) end = pos + 1 + childPos + child.nodeSize - 1;
          return true;
        });
        if (end !== -1) targets.push({ path: blockPath, end });
        return false;
      });
      // Every body here has prose the writing view edits (jazzy's recipes keep
      // everything in frontmatter); a body with none would test nothing.
      if (body.trim() !== '') expect(targets.length).toBeGreaterThan(0);
      for (const target of targets.slice(0, 40)) {
        reset();
        e.commands.insertContentAt(target.end, ' Typed.');
        const saved = save();
        const block = blockAt(built.parsed, target.path);
        if (!block) throw new Error(`no block ${target.path}`);
        const delta = saved.length - body.length;
        // Nothing before or after the edited block changed.
        expect(saved.slice(0, block.start), `${target.path}: before`).toBe(
          body.slice(0, block.start),
        );
        expect(saved.slice(block.end + delta), `${target.path}: after`).toBe(body.slice(block.end));
        // The block still holds each of its chips, byte for byte, in order.
        const rewritten = saved.slice(block.start, block.end + delta);
        let at = 0;
        for (const chip of block.chips ?? []) {
          const source = body.slice(chip.start, chip.end);
          const found = rewritten.indexOf(source, at);
          expect(found, `${target.path}: chip ${source}`).toBeGreaterThanOrEqual(0);
          at = found + source.length;
        }
        expect(rewritten).toContain('Typed.');
      }
    });
  }
});
