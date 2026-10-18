import { Extension, type AnyExtension, type Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { assembleBody, mediaReference, type BodyFormat, type BodyIssue } from '@vesper/core';
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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStudio } from '../app/context.tsx';
import { MediaPicker } from '../media/MediaPicker.tsx';
import { inputClass } from '../widgets/basic.tsx';
import { catalogOf, fallbackLabel } from './catalog.ts';
import { chipInfo } from './chips.ts';
import {
  enclosingContainer,
  insertBlock,
  isManaged,
  moveBlock,
  removeBlock,
  selectBlock,
  selectedNode,
} from './commands.ts';
import { bodyItems, buildDocument, snapshot, sourceLabel, type BodyDocument } from './document.ts';
import {
  InsertMenu,
  SlashCommands,
  SlashList,
  choicesAt,
  filterChoices,
  slashAttributes,
  useSlashIds,
  type InsertChoice,
} from './insert.tsx';
import {
  BlockIndex,
  SourceBlock,
  VesperCard,
  VesperInline,
  containerTypes,
  type ContainerTypes,
} from './nodes.ts';
import { BlockSettings, partialFiles, relativePath } from './settings.tsx';
import { BodyUiContext, bodyChecks, type BodyUi } from './ui.ts';
import { CardView, ContainerView, InlineView, SourceView } from './views.tsx';

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
  /** Files a Markdoc partial can point at, once loaded (Markdoc bodies only). */
  partials?: readonly string[] | null;
  /** Problems in the whole body, from the last check: listed under the source view. */
  issues?: readonly BodyIssue[];
};

const FORMAT_NAMES: Record<BodyFormat, string> = { md: 'Markdown', mdx: 'MDX', mdoc: 'Markdoc' };

/**
 * The body editor (spec §6.5): a writing view and a source view. The writing
 * view owns only the blocks it can show faithfully, and saves splice changed
 * blocks into the original text, so untouched blocks never change. Markdoc
 * tags and declared MDX components are blocks with settings (spec §6.5.1,
 * §6.5.2); everything else it can't show is a protected source block.
 */
export function BodyEditor(props: BodyEditorProps) {
  const [mode, setMode] = useState<'writing' | 'source'>('writing');
  // Each switch back to the writing view rebuilds it from the current text.
  const [generation, setGeneration] = useState(0);
  const formatName = FORMAT_NAMES[props.format];
  const blocking = (props.issues ?? []).filter((issue) => issue.level === 'error');

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
            aria-describedby={cx(
              'entry-body-source-help',
              blocking.length > 0 && 'entry-body-issues',
            )}
            aria-invalid={blocking.length > 0 || undefined}
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
          {blocking.length > 0 && (
            <ul id="entry-body-issues" className="flex flex-col gap-1 text-sm text-danger">
              {blocking.map((issue) => (
                <li key={`${String(issue.line)}${issue.message}`}>
                  Line {issue.line}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

const ReactSourceBlock = SourceBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(SourceView);
  },
});
const ReactCard = VesperCard.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CardView);
  },
});
const ReactInline = VesperInline.extend({
  addNodeView() {
    return ReactNodeViewRenderer(InlineView, { as: 'span' });
  },
});

/**
 * Holds what the editor's extensions need from the latest render (they are
 * made once, with the editor).
 */
class Bridge {
  actions: EditorActions = { open: () => undefined, insert: () => undefined, disabled: true };
  update(actions: EditorActions): void {
    this.actions = actions;
  }
}

type EditorActions = {
  open: (pos: number) => void;
  insert: (choice: InsertChoice, range?: { from: number; to: number }) => void;
  disabled: boolean;
};

/**
 * The body's keys: Escape inside a frame selects the frame, and on a
 * selected block (or in plain text) moves to the toolbar, so leaving the
 * editor never depends on Tab, which indents list items. Enter on a
 * selected block opens its settings; Alt+↑ and Alt+↓ move it.
 */
function bodyShortcuts(options: {
  containers: ContainerTypes;
  actions: () => EditorActions;
  onLink: () => void;
}) {
  const { containers, actions } = options;
  const move = (editor: Editor, direction: -1 | 1): boolean => {
    if (actions().disabled) return false;
    const selected = selectedNode(editor, containers);
    const pos =
      selected && selected.type !== 'vesperInline'
        ? selected.pos
        : enclosingContainer(editor, containers);
    if (pos === null) return false;
    moveBlock(editor, pos, direction);
    return true;
  };
  return Extension.create({
    name: 'vesperShortcuts',
    addKeyboardShortcuts() {
      const editor = this.editor;
      return {
        'Mod-k': () => {
          options.onLink();
          return true;
        },
        Escape: () => {
          if (!selectedNode(editor, containers)) {
            const container = enclosingContainer(editor, containers);
            if (container !== null) {
              selectBlock(editor, container);
              return true;
            }
          }
          // The formatting toolbar sits just before the text, in the same body editor.
          editor.view.dom
            .closest('[data-vesper-body]')
            ?.querySelector<HTMLElement>('[role="toolbar"] button')
            ?.focus();
          return true;
        },
        Enter: () => {
          const selected = selectedNode(editor, containers);
          if (!selected || actions().disabled) return false;
          actions().open(selected.pos);
          return true;
        },
        'Alt-ArrowUp': () => move(editor, -1),
        'Alt-ArrowDown': () => move(editor, 1),
      };
    },
  });
}

/** A name for the selected block, read out when the arrow keys land on it. */
function selectionAnnouncement(editor: Editor, ui: Pick<BodyUi, 'catalog' | 'containers'>): string {
  const selected = selectedNode(editor, ui.containers);
  if (!selected) return '';
  const node = editor.state.doc.nodeAt(selected.pos);
  if (!node) return '';
  let label: string;
  if (node.type.name === 'sourceBlock') label = sourceLabel(String(node.attrs.blockType ?? ''));
  else if (node.type.name === 'vesperInline') {
    const info = chipInfo(String(node.attrs.source));
    const kind = info.name ? ui.catalog.find(info.syntax, info.name) : undefined;
    label =
      kind?.label ??
      (info.kind === 'variable' ? 'Variable' : info.kind === 'annotation' ? 'Annotation' : 'Tag');
  } else {
    const syntax = node.attrs.syntax as 'markdoc' | 'mdx';
    const name = String(node.attrs.name);
    label = ui.catalog.find(syntax, name)?.label ?? fallbackLabel(syntax, name);
  }
  return `${label} selected. Press Enter for its settings.`;
}

function WritingView({
  value,
  onChange,
  format,
  disabled,
  entryPath,
  imageFolder,
  partials = null,
}: BodyEditorProps) {
  const { api, manifest, mdxProps } = useStudio();
  const model = useRef<{ built: BodyDocument; initial: Map<string, string> } | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [settingsAt, setSettingsAt] = useState<number | null>(null);
  const slashIds = useSlashIds();

  // The schema is made once per editor: the catalog decides its node types.
  const [setup] = useState(() => {
    const catalog = catalogOf(manifest, format);
    const containers = containerTypes(catalog);
    return { catalog, containers };
  });
  const { catalog, containers } = setup;
  // The editor's extensions are made once, so they reach the latest props through this.
  const [bridge] = useState(() => new Bridge());

  const [extensions] = useState<AnyExtension[]>(() => {
    const choices = (state: EditorState) => choicesAt(state, catalog, containers);
    return [
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
      ReactCard,
      ReactInline,
      ...containers.extensions.map((extension) =>
        (extension as ReturnType<typeof VesperCard.extend>).extend({
          addNodeView() {
            return ReactNodeViewRenderer(ContainerView);
          },
        }),
      ),
      SlashCommands({
        ...slashIds,
        choices,
        choose: (choice, range) => {
          bridge.actions.insert(choice, range);
        },
        disabled: () => bridge.actions.disabled,
      }),
      bodyShortcuts({
        containers,
        actions: () => bridge.actions,
        onLink: () => {
          setLinkOpen(true);
        },
      }),
    ];
  });

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editable: !disabled,
    extensions,
    editorProps: {
      attributes: (state) => ({
        id: 'entry-body',
        'aria-labelledby': 'entry-body-label',
        'aria-describedby': 'entry-body-help',
        class: cx(
          inputClass,
          'vesper-body min-h-72 resize-y overflow-y-auto leading-relaxed outline-none',
        ),
        // A textbox, or a combobox while the "/" list is open.
        ...slashAttributes(state, {
          ...slashIds,
          count: (query) => filterChoices(choicesAt(state, catalog, containers), query).length,
        }),
      }),
    },
    onCreate: ({ editor: created }) => {
      const built = buildDocument(value, {
        format,
        markdown: created.markdown as MarkdownManager,
        catalog,
        containers,
        ...(manifest.markdoc ? { markdoc: manifest.markdoc.options } : {}),
      });
      created.commands.setContent(built.doc, { emitUpdate: false });
      model.current = { built, initial: snapshot(created.getJSON(), containers) };
    },
    onUpdate: ({ editor: updated }) => {
      if (!model.current) return;
      const items = bodyItems(updated.getJSON(), model.current.initial, {
        markdown: updated.markdown as MarkdownManager,
        containers,
        parsed: model.current.built.parsed,
      });
      onChangeRef.current(assembleBody(model.current.built.parsed, items));
    },
  });

  function insertChoice(choice: InsertChoice, range?: { from: number; to: number }) {
    const pos = insertBlock(
      editor,
      choice.kind,
      choice.shape,
      containers,
      range,
      defaultsFor(choice),
    );
    // A new tag with attributes opens its settings straight away (spec §6.5.1).
    if (pos !== null && (choice.kind.fields.length > 0 || choice.shape === 'inline'))
      setSettingsAt(pos);
  }

  /** A new partial starts out pointing at the first partial file, so it's valid from the start. */
  function defaultsFor(choice: InsertChoice): Record<string, unknown> {
    if (choice.kind.builtin !== 'partial') return {};
    const [first] = partialFiles(partials ?? [], entryPath);
    return first ? { file: relativePath(entryPath, first) } : {};
  }

  useEffect(() => {
    bridge.update({
      open: (pos) => {
        setSettingsAt(pos);
      },
      insert: insertChoice,
      disabled,
    });
  });

  const checks = useMemo(
    () => bodyChecks({ manifest, format, mdxProps, partials, entryPath }),
    [manifest, format, mdxProps, partials, entryPath],
  );
  const ui = useMemo<BodyUi>(
    () => ({
      catalog,
      containers,
      disabled,
      checks,
      partials,
      entryPath,
      openSettings: (pos) => {
        setSettingsAt(pos);
      },
      move: (pos, direction) => {
        const moved = moveBlock(editor, pos, direction);
        if (moved !== null) setSettingsAt((open) => (open === null ? null : moved));
      },
      remove: (pos) => {
        removeBlock(editor, pos);
      },
    }),
    [catalog, containers, disabled, checks, partials, entryPath, editor],
  );

  const announcement = useEditorState({
    editor,
    selector: ({ editor: e }) => selectionAnnouncement(e, { catalog, containers }),
  });
  const hasBlocks = catalog.kinds.size > 0;

  return (
    <BodyUiContext.Provider value={ui}>
      <div data-vesper-body="" className="flex flex-col gap-2">
        <div>
          <FormatToolbar
            editor={editor}
            disabled={disabled}
            onLink={() => {
              setLinkOpen(true);
            }}
            onImage={() => {
              setPicking(true);
            }}
            insert={
              hasBlocks ? (
                <InsertMenu
                  editor={editor}
                  choices={(state) => choicesAt(state, catalog, containers)}
                  onChoose={(choice) => {
                    insertChoice(choice);
                  }}
                  disabled={disabled}
                />
              ) : null
            }
          />
        </div>
        <EditorContent editor={editor} />
        <SlashList
          editor={editor}
          {...slashIds}
          choices={(state) => choicesAt(state, catalog, containers)}
          onChoose={(choice, range) => {
            insertChoice(choice, range);
          }}
        />
        <p className="sr-only" role="status">
          {announcement}
        </p>
        <p id="entry-body-help" className="text-sm text-content-muted">
          Ctrl+B bold, Ctrl+I italic, Ctrl+K link.
          {hasBlocks &&
            ' Type / to insert a block. Arrow onto a block and press Enter for its settings; Alt+↑ and Alt+↓ move it.'}{' '}
          Escape leaves a block, then the text. Dashed boxes are kept exactly as written.
        </p>

        <BlockSettings
          editor={editor}
          pos={settingsAt}
          onClose={() => {
            const pos = settingsAt;
            setSettingsAt(null);
            // Back to the text with the block still selected, so Enter reopens
            // its settings and Alt+↑/↓ or cut moves it. After the dialog has
            // put focus back where it was, which would move the selection.
            setTimeout(() => {
              editor.view.focus();
              const node = pos === null ? null : editor.state.doc.nodeAt(pos);
              if (pos !== null && node && isManaged(node.type.name, containers)) {
                editor.view.dispatch(
                  editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
                );
              }
            }, 0);
          }}
        />
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
    </BodyUiContext.Provider>
  );
}

function FormatToolbar({
  editor,
  disabled,
  onLink,
  onImage,
  insert,
}: {
  editor: Editor;
  disabled: boolean;
  onLink: () => void;
  onImage: () => void;
  /** The Insert menu, for bodies whose site has tags or components. */
  insert: ReactNode;
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
      {insert}
    </Toolbar>
  );
}

export function LinkDialog({
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
