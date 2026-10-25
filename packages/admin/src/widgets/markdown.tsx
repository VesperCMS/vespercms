import { Extension, type JSONContent, type MarkdownToken } from '@tiptap/core';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ToggleButton, ToolButton, Toolbar, cx } from '@vesper/ui';
import { useEffect, useRef, useState } from 'react';
import { LinkDialog } from '../body/BodyEditor.tsx';
import { shortcut } from '../body/shortcuts.ts';
import type { WidgetProps } from '../types.ts';
import { inputClass } from './basic.tsx';

/*
 * Markdown in frontmatter (spec §6.3.2): a compact editor for short rich
 * text, with bold, italic, code, links and (unless the field is inline)
 * paragraphs and lists. Nothing is rewritten until someone edits it. A
 * value that uses Markdown this editor can't show faithfully is edited as
 * plain text, and the field says so.
 */

const ALLOWED = new Set([
  'doc',
  'paragraph',
  'text',
  'hardBreak',
  'bulletList',
  'orderedList',
  'listItem',
]);
const INLINE_ALLOWED = new Set(['doc', 'paragraph', 'text', 'hardBreak']);

function nodeTypes(node: JSONContent, found = new Set<string>()): Set<string> {
  if (node.type) found.add(node.type);
  for (const child of node.content ?? []) nodeTypes(child, found);
  return found;
}

/*
 * The tokens of marked, the lexer Tiptap parses with, that the editor holds.
 * Tiptap's parser drops what no extension claims (a strikethrough's tildes,
 * an image, a quote, a rule, a table, a link definition, a list in a
 * one-line field), and the round trip can't see that: it's missing from both
 * sides. HTML is a token too, so a code span holding `<` is still code.
 */
const INLINE_TOKENS = new Set([
  'space',
  'paragraph',
  'text',
  'escape',
  'strong',
  'em',
  'codespan',
  'link',
  'br',
]);
const TOKENS = new Set([...INLINE_TOKENS, 'list', 'list_item']);

/*
 * Text marked keeps as text that the editor would change: a GFM footnote,
 * which it writes back with the brackets escaped, and a named character
 * reference Tiptap doesn't decode (any but `&lt;`, `&gt;`, `&quot;` and
 * `&amp;`), which it shows as written and saves as `&amp;nbsp;`. Escaped
 * characters are tokens of their own, so `\[^1]` and `\&nbsp;` don't match.
 */
const LOSSY_TEXT = /\[\^|&(?!(?:lt|gt|quot|amp);)[A-Za-z][A-Za-z0-9]*;/;

function holds(tokens: MarkdownToken[], allowed: Set<string>): boolean {
  return tokens.every(
    (token) =>
      allowed.has(token.type ?? '') &&
      // A list item's text token carries its line's raw source, escapes and all.
      !(token.type === 'text' && !token.tokens && LOSSY_TEXT.test(token.raw ?? '')) &&
      holds(token.tokens ?? [], allowed) &&
      holds(token.items ?? [], allowed),
  );
}

/** Whether the compact editor can own this value: only tokens and nodes it holds, and it reads back the same. */
function fits(markdown: MarkdownManager, value: string, inline: boolean): boolean {
  try {
    const tokens = markdown.instance.lexer(value) as MarkdownToken[];
    if (!holds(tokens, inline ? INLINE_TOKENS : TOKENS)) return false;
    const doc = markdown.parse(value);
    const allowed = inline ? INLINE_ALLOWED : ALLOWED;
    if (![...nodeTypes(doc)].every((type) => allowed.has(type))) return false;
    if (inline && (doc.content?.length ?? 0) > 1) return false;
    const again = markdown.parse(markdown.serialize(doc));
    return JSON.stringify(again) === JSON.stringify(doc);
  } catch {
    return false;
  }
}

export function MarkdownWidget(props: WidgetProps<string>) {
  const { value, onChange, field, id, describedBy, invalid, disabled } = props;
  const inline = field.widgetOptions?.inline === true;
  const [plain, setPlain] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const toolbar = useRef<HTMLDivElement>(null);
  const [extras] = useState(() =>
    Extension.create({
      name: 'vesperCompactKeys',
      addKeyboardShortcuts() {
        return {
          'Mod-k': () => {
            setLinkOpen(true);
            return true;
          },
          Escape: () => {
            toolbar.current?.querySelector<HTMLElement>('button')?.focus();
            return true;
          },
          // An inline field is one paragraph.
          ...(inline ? { Enter: () => true, 'Shift-Enter': () => true } : {}),
        };
      },
    }),
  );

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        trailingNode: false,
        ...(inline
          ? { bulletList: false, orderedList: false, listItem: false, listKeymap: false }
          : {}),
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Markdown,
      extras,
    ],
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': inline ? 'false' : 'true',
        'aria-labelledby': `${id}-label`,
        'aria-describedby': [describedBy, `${id}-md`].filter(Boolean).join(' '),
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
        ...(field.required ? { 'aria-required': 'true' } : {}),
        class: cx(
          'vesper-body w-full px-3 py-2 text-body text-content outline-none',
          inline ? 'min-h-10' : 'min-h-24',
        ),
      },
    },
    onCreate: ({ editor: created }) => {
      const text = typeof value === 'string' ? value : '';
      const markdown = created.markdown as MarkdownManager;
      if (text !== '' && !fits(markdown, text, inline)) {
        setPlain(true);
        return;
      }
      created.commands.setContent(markdown.parse(text), { emitUpdate: false });
    },
    onUpdate: ({ editor: updated }) => {
      const text = updated.getMarkdown().trim();
      onChangeRef.current(text === '' && !field.required ? undefined : text);
    },
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      code: e.isActive('code'),
      link: e.isActive('link'),
    }),
  });

  if (plain) {
    return (
      <>
        <textarea
          id={id}
          rows={inline ? 2 : 5}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            onChange(event.target.value === '' && !field.required ? undefined : event.target.value);
          }}
          aria-describedby={[describedBy, `${id}-md`].filter(Boolean).join(' ')}
          aria-invalid={invalid || undefined}
          aria-required={field.required || undefined}
          disabled={disabled}
          className={cx(inputClass, 'resize-y font-mono text-small')}
        />
        <p id={`${id}-md`} className="text-small text-content-muted">
          This uses Markdown the compact editor can’t show, so it’s edited as text.
        </p>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Framed like the body: the toolbar and the text in one hairline box. */}
      <div
        className={cx(
          'rounded-md border border-border-strong bg-surface-raised',
          invalid && 'border-danger',
          disabled && 'opacity-60',
          'has-[.ProseMirror-focused]:outline-2 has-[.ProseMirror-focused]:outline-solid has-[.ProseMirror-focused]:outline-offset-2 has-[.ProseMirror-focused]:outline-focus',
          'has-[.ProseMirror-focused]:ring-6 has-[.ProseMirror-focused]:ring-(color:--glow-focus)',
        )}
      >
        <div ref={toolbar} className="border-b border-border p-1">
          <Toolbar label={`Formatting for ${field.label}`}>
            <ToggleButton
              icon="bold"
              label="Bold"
              shortcut={shortcut('Mod', 'B')}
              isDisabled={disabled}
              isSelected={state.bold}
              onChange={() => editor.chain().focus().toggleBold().run()}
            />
            <ToggleButton
              icon="italic"
              label="Italic"
              shortcut={shortcut('Mod', 'I')}
              isDisabled={disabled}
              isSelected={state.italic}
              onChange={() => editor.chain().focus().toggleItalic().run()}
            />
            <ToggleButton
              icon="code"
              label="Code"
              shortcut={shortcut('Mod', 'E')}
              isDisabled={disabled}
              isSelected={state.code}
              onChange={() => editor.chain().focus().toggleCode().run()}
            />
            <ToolButton
              icon="link"
              label={state.link ? 'Edit link' : 'Link'}
              shortcut={shortcut('Mod', 'K')}
              isDisabled={disabled}
              onPress={() => {
                setLinkOpen(true);
              }}
            />
          </Toolbar>
        </div>
        <EditorContent editor={editor} />
      </div>
      <p id={`${id}-md`} className="text-small text-content-muted">
        Saved as Markdown. Escape moves to the formatting buttons.
      </p>
      <LinkDialog editor={editor} isOpen={linkOpen} onOpenChange={setLinkOpen} />
    </div>
  );
}
