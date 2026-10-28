// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { assembleBody, type BodyFormat } from '@vespercms/core';
import { afterEach, describe, expect, it } from 'vitest';
import { playgroundManifest } from '../test/helpers.tsx';
import { catalogOf } from './catalog.ts';
import { bodyItems, buildDocument, snapshot } from './document.ts';
import {
  BlockIndex,
  SourceBlock,
  VesperCard,
  VesperInline,
  VesperTable,
  containerTypes,
} from './nodes.ts';

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

/** The body in an editor with the studio's nodes (no React views), and its save. */
export function open(body: string, format: BodyFormat = 'md') {
  const catalog = catalogOf(playgroundManifest, format);
  const containers = containerTypes(catalog);
  editor = new Editor({
    extensions: [
      StarterKit.configure({ underline: false, trailingNode: false }),
      Image.configure({ inline: true }),
      Markdown,
      BlockIndex,
      SourceBlock,
      VesperCard,
      VesperInline,
      VesperTable,
      ...containers.extensions,
    ],
  });
  const markdown = editor.markdown as MarkdownManager;
  const built = buildDocument(body, {
    format,
    markdown,
    catalog,
    containers,
    ...(playgroundManifest.markdoc ? { markdoc: playgroundManifest.markdoc.options } : {}),
  });
  editor.commands.setContent(built.doc, { emitUpdate: false });
  const initial = snapshot(editor.getJSON(), containers);
  const save = () =>
    assembleBody(
      built.parsed,
      bodyItems(editor?.getJSON() ?? {}, initial, {
        markdown,
        containers,
        parsed: built.parsed,
        format,
        ...(playgroundManifest.markdoc ? { markdoc: playgroundManifest.markdoc.options } : {}),
      }),
    );
  return { built, save, editor, containers };
}

/** The position of the first node of `type` whose attributes match. */
function find(
  e: Editor,
  type: string,
  match: (attrs: Record<string, unknown>) => boolean = () => true,
) {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.type.name.startsWith(type) && match(node.attrs)) found = pos;
    return true;
  });
  if (found === -1) throw new Error(`no ${type}`);
  return found;
}

describe('the body document', () => {
  it('makes Markdown blocks editable and protects what the writing view can’t show', () => {
    const { built } = open(BODY);
    expect(built.doc.content?.map((n) => n.type)).toEqual([
      'paragraph',
      'bulletList',
      'heading',
      'sourceBlock',
      'vesperTable',
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

  it('saves a protected block’s text as edited, and only that', () => {
    const { save, editor: e } = open(BODY);
    const pos = find(e, 'sourceBlock');
    e.view.dispatch(
      e.state.tr.setNodeMarkup(pos, undefined, {
        ...e.state.doc.nodeAt(pos)?.attrs,
        text: '<div class="note">Edited HTML</div>',
      }),
    );
    expect(save()).toBe(BODY.replace('Raw HTML', 'Edited HTML'));
  });
});

const DOC =
  [
    '{% $product.name %} builds its editor. {% .lead %}',
    '{% if $product.beta %}\nThis is a beta.\n{% else /%}\nStable.\n{% /if %}',
    'The {% abbr title="content management system" %}CMS{% /abbr %} appears.',
    '{% callout type="tip" title="Before you start" %}\nYou’ll need:\n\n- Astro 6 or 7\n- a collection\n{% /callout %}',
    '{% youtube id="VsprDemo001" title="A tour" /%}',
    '{% partial file="_support-hours.mdoc" /%}',
    '{% gallery /%}',
  ].join('\n\n') + '\n';

describe('Markdoc blocks', () => {
  it('shows tags as containers, cards and chips, and unknown tags as protected blocks', () => {
    const { built } = open(DOC, 'mdoc');
    const types = (built.doc.content ?? []).map((n) =>
      n.type?.replace(/^vesperTag\d+_/, 'container:'),
    );
    expect(types).toEqual([
      'paragraph',
      'container:if',
      'paragraph',
      'container:callout',
      'vesperCard',
      'vesperCard',
      'sourceBlock',
    ]);
    const callout = built.doc.content?.[3];
    expect(callout?.attrs).toMatchObject({
      open: '{% callout type="tip" title="Before you start" %}',
      close: '{% /callout %}',
    });
    expect(callout?.content?.map((n) => n.type)).toEqual(['paragraph', 'bulletList']);
    const chips = built.doc.content?.[0]?.content?.filter((n) => n.type === 'vesperInline');
    expect(chips?.map((c) => c.attrs?.source as unknown)).toEqual([
      '{% $product.name %}',
      '{% .lead %}',
    ]);
  });

  it('writes back every byte when nothing changed', () => {
    expect(open(DOC, 'mdoc').save()).toBe(DOC);
  });

  it('editing text inside a callout rewrites only that paragraph', () => {
    const { save, editor: e } = open(DOC, 'mdoc');
    const callout = find(e, 'vesperTag', (a) => a.name === 'callout');
    // Inside the callout's first paragraph, at its end.
    const paragraph = e.state.doc.nodeAt(callout)?.firstChild;
    e.chain()
      .setTextSelection(callout + 1 + (paragraph?.nodeSize ?? 0) - 1)
      .insertContent(' Bring water.')
      .run();
    expect(save()).toBe(DOC.replace('You’ll need:', 'You’ll need: Bring water.'));
  });

  it('changing an attribute rewrites only the opening tag', () => {
    const { save, editor: e } = open(DOC, 'mdoc');
    const pos = find(e, 'vesperTag', (a) => a.name === 'callout');
    const attrs = e.state.doc.nodeAt(pos)?.attrs;
    e.view.dispatch(
      e.state.tr.setNodeMarkup(pos, undefined, {
        ...attrs,
        open: '{% callout type="warning" title="Before you start" %}',
      }),
    );
    expect(save()).toBe(DOC.replace('type="tip"', 'type="warning"'));
  });

  it('changing an inline tag changes only that tag, even beside Markdown the editor would restyle', () => {
    const body = 'A __strong__ word and the {% abbr title="x" %}CMS{% /abbr %}  \nhere.\n';
    const { save, editor: e } = open(body, 'mdoc');
    const pos = find(e, 'vesperInline');
    e.view.dispatch(
      e.state.tr.setNodeMarkup(pos, undefined, {
        source: '{% abbr title="content system" %}CMS{% /abbr %}',
      }),
    );
    expect(save()).toBe(body.replace('title="x"', 'title="content system"'));
  });

  it('typing next to a chip keeps the chip’s bytes', () => {
    const { save, editor: e } = open(DOC, 'mdoc');
    // The end of the abbr paragraph: after "appears."
    let end = -1;
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent.includes('appears'))
        end = pos + node.nodeSize - 1;
      return true;
    });
    e.chain().setTextSelection(end).insertContent(' Really.').run();
    expect(save()).toBe(DOC.replace('{% /abbr %} appears.', '{% /abbr %} appears. Really.'));
  });

  it('keeps variables, conditions and annotations byte for byte when their neighbours change', () => {
    const { save, editor: e } = open(DOC, 'mdoc');
    // Edit the text inside the if (a child of a protected-opening container).
    let end = -1;
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'This is a beta.')
        end = pos + node.nodeSize - 1;
      return true;
    });
    e.chain().setTextSelection(end).insertContent(' Expect bugs.').run();
    // And the first paragraph's plain text, between two chips.
    e.chain().setTextSelection(3).insertContent('!').run();
    const saved = save();
    expect(saved).toContain('{% if $product.beta %}\nThis is a beta. Expect bugs.\n{% else /%}');
    expect(saved).toContain('{% .lead %}');
    expect(saved.startsWith('{% $product.name %}')).toBe(true);
  });

  it('moves and removes whole tags, and their neighbours keep their spacing', () => {
    const { save, editor: e } = open(DOC, 'mdoc');
    const youtube = find(e, 'vesperCard', (a) => a.name === 'youtube');
    const node = e.state.doc.nodeAt(youtube);
    if (!node) throw new Error('no node');
    e.view.dispatch(e.state.tr.delete(youtube, youtube + node.nodeSize));
    expect(save()).toBe(DOC.replace('{% youtube id="VsprDemo001" title="A tour" /%}\n\n', ''));
  });

  it('writes a new tag in house style', () => {
    const { save, editor: e } = open('Intro.\n', 'mdoc');
    e.chain()
      .setTextSelection(e.state.doc.content.size)
      .insertContent({
        type: 'vesperCard',
        attrs: { syntax: 'markdoc', name: 'youtube', source: '{% youtube id="abc" title="T" /%}' },
      })
      .run();
    expect(save()).toBe('Intro.\n\n{% youtube id="abc" title="T" /%}\n');
  });
});

describe('MDX blocks', () => {
  const MDX =
    [
      "import Gallery from '../../components/Gallery.astro';",
      'Campus is busiest on weekday afternoons.',
      '<Callout type="tip" title="Visiting?">\n  Tours leave the welcome center every weekday at 10 and 2.\n</Callout>',
      "<Gallery caption=\"A year\" items={['a', 'b']} />",
    ].join('\n\n') + '\n';

  it('shows declared components as blocks and undeclared ones as protected blocks', () => {
    const { built, save } = open(MDX, 'mdx');
    expect(
      (built.doc.content ?? []).map((n) => n.type?.replace(/^vesperTag\d+_/, 'container:')),
    ).toEqual(['sourceBlock', 'paragraph', 'container:Callout', 'sourceBlock']);
    expect(save()).toBe(MDX);
  });

  it('keeps the indentation of a component’s children when one is edited', () => {
    const { save, editor: e } = open(MDX, 'mdx');
    let end = -1;
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent.startsWith('Tours'))
        end = pos + node.nodeSize - 1;
      return true;
    });
    e.chain().setTextSelection(end).insertContent(' Book ahead.').run();
    expect(save()).toBe(MDX.replace('at 10 and 2.', 'at 10 and 2. Book ahead.'));
  });
});
