// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { assembleBody } from '@vesper/core';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockIndex, SourceBlock, bodyItems, buildDocument, snapshot } from './document.ts';

const BODY =
  [
    'An *intro* with __strong__ text and a [link](/about).',
    '* first\n* second',
    'Setext heading\n==============',
    '<div class="note">Raw HTML</div>',
    '| a | b |\n|---|---|\n| 1 | 2 |',
    '```js\nconst x  =  1;\n```',
    'Last paragraph.',
  ].join('\n\n') + '\n';

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function open(body: string) {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ underline: false, trailingNode: false }),
      Image.configure({ inline: true }),
      Markdown,
      BlockIndex,
      SourceBlock,
    ],
  });
  const markdown = editor.markdown as MarkdownManager;
  const built = buildDocument(body, 'md', markdown);
  editor.commands.setContent(built.doc, { emitUpdate: false });
  const initial = snapshot(editor.getJSON());
  const save = () =>
    assembleBody(built.parsed, bodyItems(editor?.getJSON() ?? {}, initial, markdown));
  return { built, save, editor };
}

describe('the body document', () => {
  it('makes Markdown blocks editable and protects what the writing view can’t show', () => {
    const { built } = open(BODY);
    expect(built.doc.content?.map((n) => n.type)).toEqual([
      'paragraph',
      'bulletList',
      'heading',
      'sourceBlock',
      'sourceBlock',
      'codeBlock',
      'paragraph',
    ]);
  });

  it('writes back every byte when nothing changed', () => {
    const { save } = open(BODY);
    expect(save()).toBe(BODY);
  });

  it('rewrites only the edited block', () => {
    const { save, editor: e } = open(BODY);
    // Type at the end of the last paragraph.
    const end = e.state.doc.content.size - 1;
    e.chain().setTextSelection(end).insertContent(' Edited.').run();
    expect(save()).toBe(BODY.replace('Last paragraph.', 'Last paragraph. Edited.'));
  });

  it('keeps an edited block’s neighbours and their spacing exactly', () => {
    const { save, editor: e } = open(BODY);
    // Bold the word "intro" in the first paragraph, which is in a mixed style.
    e.chain().setTextSelection({ from: 5, to: 10 }).toggleBold().run();
    const saved = save();
    const [first, ...rest] = saved.split('\n\n');
    expect(first).not.toBe('An *intro* with __strong__ text and a [link](/about).');
    expect(rest.join('\n\n')).toBe(BODY.split('\n\n').slice(1).join('\n\n'));
  });

  it('adds new paragraphs with a blank line before them', () => {
    const { save, editor: e } = open('One.\n');
    e.chain()
      .setTextSelection(e.state.doc.content.size - 1)
      .splitBlock()
      .insertContent('Two.')
      .run();
    expect(save()).toBe('One.\n\nTwo.\n');
  });
});
