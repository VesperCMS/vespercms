import { Extension, type JSONContent } from '@tiptap/core';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ToggleButton, ToolButton, Toolbar, cx } from '@vesper/ui';
import { useEffect, useRef, useState } from 'react';
import { LinkDialog } from '../body/BodyEditor.tsx';
import type { WidgetProps } from '../types.ts';
import { inputClass } from './basic.tsx';

/*
 * Markdown in frontmatter (spec §6.3.2): a compact editor for short rich
 * text, with bold, italic, links and (unless the field is inline) paragraphs
 * and lists. Nothing is rewritten until someone edits it. A value that uses
 * Markdown this editor can't show faithfully is edited as plain text, and
 * the field says so.
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

/** Whether the compact editor can own this value: only allowed nodes, and it reads back the same. */
function fits(markdown: MarkdownManager, value: string, inline: boolean): boolean {
  if (/<[a-z!/]/i.test(value)) return false;
  try {
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
        code: false,
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
          'has-[.ProseMirror-focused]:outline-2 has-[.ProseMirror-focused]:outline-offset-2 has-[.ProseMirror-focused]:outline-focus',
          'has-[.ProseMirror-focused]:ring-6 has-[.ProseMirror-focused]:ring-(color:--glow-focus)',
        )}
      >
        <div ref={toolbar} className="border-b border-border p-1">
          <Toolbar label={`Formatting for ${field.label}`}>
            <ToggleButton
              isDisabled={disabled}
              isSelected={state.bold}
              onChange={() => editor.chain().focus().toggleBold().run()}
            >
              Bold
            </ToggleButton>
            <ToggleButton
              isDisabled={disabled}
              isSelected={state.italic}
              onChange={() => editor.chain().focus().toggleItalic().run()}
            >
              Italic
            </ToggleButton>
            <ToolButton
              isDisabled={disabled}
              onPress={() => {
                setLinkOpen(true);
              }}
            >
              {state.link ? 'Edit link' : 'Link'}
            </ToolButton>
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
