import { Extension, type Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type ReactNodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { assembleBody, mediaReference, type BodyFormat } from '@vesper/core';
import {
  Button,
  Checkbox,
  Dialog,
  TextArea,
  TextField,
  ToggleButton,
  ToolButton,
  Toolbar,
  cx,
} from '@vesper/ui';
import { useEffect, useRef, useState } from 'react';
import { useStudio } from '../app/context.tsx';
import { MediaPicker } from '../media/MediaPicker.tsx';
import { inputClass } from '../widgets/basic.tsx';
import {
  BlockIndex,
  SourceBlock,
  bodyItems,
  buildDocument,
  snapshot,
  sourceLabel,
  type BodyDocument,
} from './document.ts';

export type BodyEditorProps = {
  /** The body text, LF line endings, without the line breaks after the frontmatter. */
  value: string;
  onChange: (value: string) => void;
  format: BodyFormat;
  disabled: boolean;
  /** The entry's file, so images are stored relative to it. */
  entryPath: string;
  /** Where images uploaded into the body go. */
  imageFolder: string;
};

const FORMAT_NAMES: Record<BodyFormat, string> = { md: 'Markdown', mdx: 'MDX', mdoc: 'Markdoc' };

/**
 * The body editor (spec §6.5): a writing view and a source view. The writing
 * view owns only the blocks it can show faithfully, and saves splice changed
 * blocks into the original text, so untouched blocks never change.
 */
export function BodyEditor(props: BodyEditorProps) {
  const [mode, setMode] = useState<'writing' | 'source'>('writing');
  // Each switch back to the writing view rebuilds it from the current text.
  const [generation, setGeneration] = useState(0);
  const formatName = FORMAT_NAMES[props.format];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id="entry-body-label" className="text-sm font-semibold text-content">
          Body
        </span>
        <Button
          variant="quiet"
          onPress={() => {
            if (mode === 'source') setGeneration((n) => n + 1);
            setMode(mode === 'writing' ? 'source' : 'writing');
          }}
        >
          {mode === 'writing' ? `Edit as ${formatName}` : 'Back to the writing view'}
        </Button>
      </div>
      {mode === 'writing' ? (
        <WritingView key={generation} {...props} />
      ) : (
        <>
          <textarea
            id="entry-body"
            aria-labelledby="entry-body-label"
            aria-describedby="entry-body-source-help"
            value={props.value}
            onChange={(event) => {
              props.onChange(event.target.value);
            }}
            rows={20}
            spellCheck={false}
            disabled={props.disabled}
            className={cx(inputClass, 'resize-y font-mono text-sm leading-relaxed')}
          />
          <p id="entry-body-source-help" className="text-sm text-content-muted">
            The whole body as {formatName}, exactly as it’s saved.
          </p>
        </>
      )}
    </div>
  );
}

/** A protected block in the writing view: named, shown as source, edited in the source view. */
function SourceChip({ node, selected }: ReactNodeViewProps) {
  const text = String(node.attrs.text ?? '');
  const lines = text.split('\n');
  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      className={cx(
        'my-3 rounded-md border border-dashed border-border-strong bg-surface-sunken p-3',
        selected && 'outline-2 outline-offset-2 outline-focus',
      )}
    >
      <p className="mb-1 text-sm font-semibold text-content-muted">
        {sourceLabel(String(node.attrs.blockType ?? ''))}, kept as written. Edit it in the source
        view.
      </p>
      <pre className="overflow-x-auto font-mono text-sm whitespace-pre-wrap text-content">
        {lines.slice(0, 6).join('\n')}
        {lines.length > 6 ? `\n… ${String(lines.length - 6)} more lines` : ''}
      </pre>
    </NodeViewWrapper>
  );
}

const ReactSourceBlock = SourceBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(SourceChip);
  },
});

function WritingView({
  value,
  onChange,
  format,
  disabled,
  entryPath,
  imageFolder,
}: BodyEditorProps) {
  const { api } = useStudio();
  const model = useRef<{ built: BodyDocument; initial: Map<number, string> } | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const toolbar = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);

  // Made once: the extension is part of the editor's schema setup.
  const [shortcuts] = useState(() =>
    Extension.create({
      name: 'vesperShortcuts',
      addKeyboardShortcuts() {
        return {
          'Mod-k': () => {
            setLinkOpen(true);
            return true;
          },
          // A way out of the editor that never depends on Tab (which indents list items).
          Escape: () => {
            toolbar.current?.querySelector<HTMLElement>('button')?.focus();
            return true;
          },
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
        // Underline has no Markdown; a trailing empty line would add text nobody typed.
        underline: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Image.configure({ inline: true }),
      Markdown,
      BlockIndex,
      ReactSourceBlock,
      shortcuts,
    ],
    editorProps: {
      attributes: {
        id: 'entry-body',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': 'entry-body-label',
        'aria-describedby': 'entry-body-help',
        class: cx(
          inputClass,
          'vesper-body min-h-72 resize-y overflow-y-auto leading-relaxed outline-none',
        ),
      },
    },
    onCreate: ({ editor: created }) => {
      const built = buildDocument(value, format, created.markdown as MarkdownManager);
      created.commands.setContent(built.doc, { emitUpdate: false });
      model.current = { built, initial: snapshot(created.getJSON()) };
    },
    onUpdate: ({ editor: updated }) => {
      if (!model.current) return;
      const items = bodyItems(
        updated.getJSON(),
        model.current.initial,
        updated.markdown as MarkdownManager,
      );
      onChangeRef.current(assembleBody(model.current.built.parsed, items));
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <div ref={toolbar}>
        <FormatToolbar
          editor={editor}
          disabled={disabled}
          onLink={() => {
            setLinkOpen(true);
          }}
          onImage={() => {
            setPicking(true);
          }}
        />
      </div>
      <EditorContent editor={editor} />
      <p id="entry-body-help" className="text-sm text-content-muted">
        Ctrl+B bold, Ctrl+I italic, Ctrl+K link. Escape moves to the toolbar. Grey boxes are kept
        exactly as written; edit them in the source view.
      </p>

      <LinkDialog editor={editor} isOpen={linkOpen} onOpenChange={setLinkOpen} />
      <MediaPicker
        isOpen={picking}
        onOpenChange={setPicking}
        kind="image"
        folder={imageFolder}
        onChoose={(path) => {
          setImagePath(path);
        }}
      />
      <ImageAltDialog
        path={imagePath}
        previewUrl={imagePath ? api.fileUrl(imagePath) : ''}
        onCancel={() => {
          setImagePath(null);
          editor.commands.focus();
        }}
        onInsert={(alt) => {
          if (!imagePath) return;
          editor
            .chain()
            .focus()
            .setImage({ src: mediaReference(imagePath, entryPath), alt })
            .run();
          setImagePath(null);
        }}
      />
    </div>
  );
}

function FormatToolbar({
  editor,
  disabled,
  onLink,
  onImage,
}: {
  editor: Editor;
  disabled: boolean;
  onLink: () => void;
  onImage: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      code: e.isActive('code'),
      heading2: e.isActive('heading', { level: 2 }),
      heading3: e.isActive('heading', { level: 3 }),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <Toolbar label="Formatting">
      <ToggleButton
        isDisabled={disabled}
        isSelected={state.bold}
        onChange={() => chain().toggleBold().run()}
      >
        Bold
      </ToggleButton>
      <ToggleButton
        isDisabled={disabled}
        isSelected={state.italic}
        onChange={() => chain().toggleItalic().run()}
      >
        Italic
      </ToggleButton>
      <ToggleButton
        isDisabled={disabled}
        isSelected={state.heading2}
        onChange={() => chain().toggleHeading({ level: 2 }).run()}
      >
        Heading
      </ToggleButton>
      <ToggleButton
        isDisabled={disabled}
        isSelected={state.heading3}
        onChange={() => chain().toggleHeading({ level: 3 }).run()}
      >
        Subheading
      </ToggleButton>
      <ToggleButton
        isDisabled={disabled}
        isSelected={state.bullets}
        onChange={() => chain().toggleBulletList().run()}
      >
        Bullets
      </ToggleButton>
      <ToggleButton
        isDisabled={disabled}
        isSelected={state.numbers}
        onChange={() => chain().toggleOrderedList().run()}
      >
        Numbers
      </ToggleButton>
      <ToggleButton
        isDisabled={disabled}
        isSelected={state.quote}
        onChange={() => chain().toggleBlockquote().run()}
      >
        Quote
      </ToggleButton>
      <ToggleButton
        isDisabled={disabled}
        isSelected={state.code}
        onChange={() => chain().toggleCode().run()}
      >
        Code
      </ToggleButton>
      <ToolButton isDisabled={disabled} onPress={onLink}>
        {state.link ? 'Edit link' : 'Link'}
      </ToolButton>
      <ToolButton isDisabled={disabled} onPress={onImage}>
        Image
      </ToolButton>
    </Toolbar>
  );
}

function LinkDialog({
  editor,
  isOpen,
  onOpenChange,
}: {
  editor: Editor;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const current = editor.getAttributes('link').href as string | undefined;
  const close = () => {
    onOpenChange(false);
    editor.commands.focus();
  };
  return (
    <Dialog
      title={current ? 'Edit link' : 'Add a link'}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) onOpenChange(true);
        else close();
      }}
    >
      {isOpen && <LinkForm editor={editor} current={current} onDone={close} />}
    </Dialog>
  );
}

function LinkForm({
  editor,
  current,
  onDone,
}: {
  editor: Editor;
  current: string | undefined;
  onDone: () => void;
}) {
  const [href, setHref] = useState(current ?? '');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const url = href.trim();
        if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
        else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        onDone();
      }}
    >
      <TextField
        label="Web address or page path"
        description="For example https://example.com or /about."
        value={href}
        onChange={setHref}
      />
      <div className="flex flex-wrap justify-end gap-3">
        {current && (
          <Button
            variant="quiet"
            onPress={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              onDone();
            }}
          >
            Remove link
          </Button>
        )}
        <Button type="submit" variant="primary">
          {current ? 'Update link' : 'Add link'}
        </Button>
      </div>
    </form>
  );
}

/** Alt text before an image goes into the body: required, unless it's decorative. */
function ImageAltDialog({
  path,
  previewUrl,
  onCancel,
  onInsert,
}: {
  path: string | null;
  previewUrl: string;
  onCancel: () => void;
  onInsert: (alt: string) => void;
}) {
  const [alt, setAlt] = useState('');
  const [decorative, setDecorative] = useState(false);
  const [missing, setMissing] = useState(false);
  return (
    <Dialog
      title="Describe the image"
      isOpen={path !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!decorative && alt.trim() === '') {
            setMissing(true);
            return;
          }
          onInsert(decorative ? '' : alt.trim());
          setAlt('');
          setDecorative(false);
          setMissing(false);
        }}
      >
        {previewUrl && (
          <img src={previewUrl} alt="" className="max-h-40 self-start rounded-md object-contain" />
        )}
        {path && (
          <p className="text-sm text-content-muted">{path.slice(path.lastIndexOf('/') + 1)}</p>
        )}
        {!decorative && (
          <TextArea
            label="Alt text"
            isRequired
            description="Describe what this image communicates here."
            value={alt}
            onChange={(next) => {
              setAlt(next);
              setMissing(false);
            }}
            isInvalid={missing}
            errorMessage="Describe the image, or mark it decorative."
            rows={2}
          />
        )}
        <Checkbox isSelected={decorative} onChange={setDecorative}>
          Decorative image (it adds nothing a reader needs)
        </Checkbox>
        <div className="flex justify-end">
          <Button type="submit" variant="primary">
            Insert image
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
