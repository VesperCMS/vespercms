import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  deepEqual,
  editJsxTag,
  editMarkdocTag,
  markdocTagLayout,
  markdocTags,
  jsxTagLayout,
  type DataObject,
  type DataValue,
  type FieldModel,
} from '@vesper/core';
import { Button, Dialog, Select, TextArea, TextField } from '@vesper/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EditorContext, useEditor, type EditorState } from '../editor/context.tsx';
import { Field } from '../editor/Field.tsx';
import { pathKey, setIn, type ValuePath } from '../editor/values.ts';
import { fallbackLabel, type BlockKind } from './catalog.ts';
import { chipInfo, tagValues } from './chips.ts';
import { sourceLabel } from './document.ts';
import { useBlockIssues, useBodyUi } from './ui.ts';

/*
 * A block's settings (spec §6.5.1, "Settings form"): its attributes as
 * fields, rendered with the same widgets as frontmatter. Changes apply as
 * they're made, splicing only the attribute that changed into the tag's
 * text, so Ctrl+Z undoes them like typing. The same dialog moves and
 * removes the block, so one keystroke (Enter on a selected block) reaches
 * every action.
 *
 * Protected constructs (variables, conditions, unknown tags, raw HTML) get
 * a small text field instead: edited as written, never reformatted.
 */

/** A node attribute that holds text. */
const attrText = (value: unknown): string => (typeof value === 'string' ? value : '');

type Target = {
  pos: number;
  type: string;
  attrs: Record<string, unknown>;
  inline: boolean;
};

export function BlockSettings({
  editor,
  pos,
  onClose,
}: {
  editor: Editor;
  pos: number | null;
  onClose: () => void;
}) {
  const ui = useBodyUi();
  // Follow the node as the document changes (its attributes, or a move).
  const target = useEditorState({
    editor,
    selector: ({ editor: e }): Target | null => {
      if (pos === null) return null;
      const node = e.state.doc.nodeAt(pos);
      if (!node) return null;
      return { pos, type: node.type.name, attrs: node.attrs, inline: node.isInline };
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const view = target ? describe(target, ui) : null;
  return (
    <Dialog
      title={view?.title ?? 'Settings'}
      isOpen={pos !== null && target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {target && view && (
        <FirstFieldFocus className="flex flex-col gap-6">
          {view.mode === 'tag' && view.kind && (
            <TagForm editor={editor} target={target} kind={view.kind} />
          )}
          {view.mode === 'condition' && <ConditionForm editor={editor} target={target} />}
          {view.mode === 'raw' && <RawForm editor={editor} target={target} label={view.label} />}
          <Actions editor={editor} target={target} onClose={onClose} />
        </FirstFieldFocus>
      )}
    </Dialog>
  );
}

/**
 * Moves focus to the dialog's first field when it opens, so typing goes
 * straight into it rather than to the dialog's Close button.
 */
function FirstFieldFocus({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // After the opener (a menu, say) has had its turn at restoring focus.
    const timer = setTimeout(() => {
      const first = ref.current?.querySelector<HTMLInputElement>(
        'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), button:not([disabled])',
      );
      // In a radio group, focus belongs on the chosen option, as Tab would put it.
      const checked =
        first?.type === 'radio'
          ? ref.current?.querySelector<HTMLInputElement>(
              `input[type=radio][name="${CSS.escape(first.name)}"]:checked`,
            )
          : null;
      (checked ?? first)?.focus();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

type View = { mode: 'tag' | 'condition' | 'raw'; title: string; label: string; kind?: BlockKind };

function describe(target: Target, ui: ReturnType<typeof useBodyUi>): View {
  if (target.type === 'sourceBlock') {
    const label = sourceLabel(attrText(target.attrs.blockType));
    return { mode: 'raw', title: `Edit ${label.toLowerCase()} as text`, label };
  }
  const container = ui.containers.kindOf(target.type);
  if (container) {
    if (container.builtin === 'if')
      return { mode: 'condition', title: 'Conditional content', label: container.label };
    return {
      mode: 'tag',
      title: `${container.label} settings`,
      label: container.label,
      kind: container,
    };
  }
  if (target.type === 'vesperCard') {
    const syntax = target.attrs.syntax as 'markdoc' | 'mdx';
    const name = attrText(target.attrs.name);
    const kind = ui.catalog.find(syntax, name);
    if (kind && !kind.builtin)
      return { mode: 'tag', title: `${kind.label} settings`, label: kind.label, kind };
    if (kind?.builtin === 'partial')
      return { mode: 'tag', title: 'Partial settings', label: kind.label, kind };
    const label = kind?.label ?? fallbackLabel(syntax, name);
    return { mode: 'raw', title: `Edit ${label} as text`, label };
  }
  const info = chipInfo(attrText(target.attrs.source));
  const kind = info.name ? ui.catalog.find(info.syntax, info.name) : undefined;
  if (kind && !kind.builtin && (info.kind === 'tag' || info.kind === 'component')) {
    return { mode: 'tag', title: `${kind.label} settings`, label: kind.label, kind };
  }
  const label =
    info.kind === 'variable'
      ? 'Variable'
      : info.kind === 'annotation'
        ? 'Annotation'
        : info.kind === 'expression'
          ? 'Expression'
          : info.name
            ? fallbackLabel(info.syntax, info.name)
            : 'Tag';
  return { mode: 'raw', title: `Edit ${label.toLowerCase()} as text`, label };
}

/** A node's tag text split as opening, the rest, and how to put a new opening back. */
function partsOf(target: Target): {
  syntax: 'markdoc' | 'mdx';
  open: string;
  rest: string;
  inner?: string;
  close?: string;
} {
  if (target.type === 'vesperInline') {
    const source = attrText(target.attrs.source);
    const info = chipInfo(source);
    return {
      syntax: info.syntax,
      open: info.open ?? source,
      rest: source.slice((info.open ?? source).length),
      inner: info.inner ?? '',
      close: info.close ?? '',
    };
  }
  const syntax = target.attrs.syntax as 'markdoc' | 'mdx';
  if (target.type === 'vesperCard') {
    const source = attrText(target.attrs.source);
    const end =
      syntax === 'markdoc'
        ? (markdocTags(source)[0]?.end ?? source.length)
        : (jsxTagLayout(source)?.openEnd ?? source.length);
    return { syntax, open: source.slice(0, end), rest: source.slice(end) };
  }
  return { syntax, open: attrText(target.attrs.open), rest: '' };
}

function setAttrs(editor: Editor, target: Target, attrs: Record<string, unknown>): void {
  const tr = editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, ...attrs });
  editor.view.dispatch(tr);
}

/** Writes a new opening back into the node it came from. */
function applyOpening(editor: Editor, target: Target, open: string): void {
  const parts = partsOf(target);
  if (target.type === 'vesperInline' || target.type === 'vesperCard') {
    setAttrs(editor, target, { source: open + parts.rest });
  } else setAttrs(editor, target, { open });
}

function TagForm({ editor, target, kind }: { editor: Editor; target: Target; kind: BlockKind }) {
  const ui = useBodyUi();
  const outer = useEditor();
  const parts = partsOf(target);
  const { values, code } = tagValues(parts.syntax, parts.open);
  const [problem, setProblem] = useState<string | null>(null);
  const fullText =
    target.type === 'vesperInline'
      ? attrText(target.attrs.source)
      : target.type === 'vesperCard'
        ? attrText(target.attrs.source)
        : parts.syntax === 'mdx'
          ? `${parts.open}\n\n${attrText(target.attrs.close)}`
          : `${parts.open}\n${attrText(target.attrs.close)}`;
  const issues = useBlockIssues(fullText);

  const display = useMemo(() => {
    const out: DataObject = {};
    for (const field of kind.fields) {
      const key = field.path[0] ?? '';
      const value = key in values ? values[key] : field.default;
      if (value !== undefined) out[key] = value as DataValue;
    }
    return out;
  }, [kind.fields, values]);

  const issueMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of issues) {
      if (!issue.attribute || issue.level !== 'error') continue;
      const key = pathKey([issue.attribute]);
      // Under the field, the block's name would only repeat the dialog's title.
      const message = issue.message.replace(/^[^:]+: /, '');
      map.set(key, [...(map.get(key) ?? []), message]);
    }
    return map;
  }, [issues]);

  const fields =
    kind.builtin === 'partial' ? kind.fields.filter((f) => f.path[0] !== 'file') : kind.fields;
  const state: EditorState = {
    ...outer,
    values: display,
    issues: issueMap,
    disabled: ui.disabled,
    idPrefix: `block${String(target.pos)}`,
    setValue: (path: ValuePath, changed: DataValue) => {
      const key = String(path[0]);
      // A field inside a list or object attribute changes its part of the attribute's value.
      const value = path.length > 1 ? (setIn(display, path, changed)[key] ?? null) : changed;
      const field = kind.fields.find((f) => f.path[0] === key);
      // A value set back to its default is left out of the tag (house style).
      const next =
        field?.default !== undefined && deepEqual(value, field.default) ? undefined : value;
      const edit = parts.syntax === 'markdoc' ? editMarkdocTag : editJsxTag;
      const edited = edit(parts.open, [[key, next]], kind.order);
      if (edited === null) {
        setProblem(
          'This tag is written in a way the form can’t change. Edit it as Markdoc instead.',
        );
        return;
      }
      setProblem(null);
      applyOpening(editor, target, edited);
    },
  };

  return (
    <EditorContext.Provider value={state}>
      {kind.description && <p className="text-small text-content-muted">{kind.description}</p>}
      {problem && (
        <p role="alert" className="text-small text-danger">
          {problem}
        </p>
      )}
      {kind.builtin === 'partial' && (
        <PartialFile
          value={typeof values.file === 'string' ? values.file : ''}
          message={issues.find((i) => i.code === 'partial-missing')?.message}
          onChange={(file) => {
            const edited = editMarkdocTag(parts.open, [['file', file]], kind.order);
            if (edited) applyOpening(editor, target, edited);
          }}
        />
      )}
      {fields.map((field: FieldModel) => (
        <Field key={field.path.join('.')} field={field} path={field.path} />
      ))}
      {target.type === 'vesperInline' && parts.close !== '' && (
        <TextField
          label="Text"
          description="What the reader sees."
          value={parts.inner ?? ''}
          isDisabled={ui.disabled}
          onChange={(inner) => {
            setAttrs(editor, target, { source: parts.open + inner + (parts.close ?? '') });
          }}
        />
      )}
      {Object.keys(code).length > 0 && (
        <div className="text-small text-content-muted">
          <p>Set in the page’s code, so kept as written:</p>
          <ul className="list-disc pl-6">
            {Object.entries(code).map(([key, text]) => (
              <li key={key}>
                <code className="font-mono">{key}</code>: <code className="font-mono">{text}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </EditorContext.Provider>
  );
}

/** The partial's file: one of the site's partials, stored relative to this entry. */
function PartialFile({
  value,
  message,
  onChange,
}: {
  value: string;
  message: string | undefined;
  onChange: (file: string) => void;
}) {
  const ui = useBodyUi();
  const options = partialOptions(ui.partials ?? [], ui.entryPath, value);
  return (
    <Select
      label="File"
      description="Text kept in its own file and shown here. Files whose names start with an underscore, or that sit in a partials folder, are listed."
      options={options}
      value={value === '' ? null : value}
      onChange={(next) => {
        if (next !== null) onChange(next);
      }}
      isInvalid={message !== undefined}
      errorMessage={message?.replace(/^[^:]+: /, '')}
      isRequired
      isDisabled={ui.disabled}
    />
  );
}

/** Partial-like files, as paths relative to the entry (how the tag stores them), labelled by site path. */
export function partialOptions(
  files: readonly string[],
  entryPath: string,
  current: string,
): { value: string; label: string }[] {
  const options = partialFiles(files, entryPath).map((path) => ({
    value: relativePath(entryPath, path),
    label: path,
  }));
  if (current !== '' && !options.some((o) => o.value === current)) {
    options.unshift({ value: current, label: `${current} (as written)` });
  }
  return options;
}

/**
 * Markdoc files named like partials (`_name.mdoc`, or in a `partials`
 * folder), nearest the entry first: its own folder, then the folders above
 * it, then everything else.
 */
export function partialFiles(files: readonly string[], entryPath: string): string[] {
  // How far a file is from the entry: the folders between them (`_x.mdoc` 0, `../_x.mdoc` 1).
  const distance = (path: string) => relativePath(entryPath, path).split('/').length - 1;
  return files
    .filter((path) => path !== entryPath && path.endsWith('.mdoc'))
    .filter((path) => /(^|\/)_[^/]+$/.test(path) || /(^|\/)_?partials\//.test(path))
    .sort((a, b) => distance(a) - distance(b) || a.localeCompare(b));
}

/** `to` relative to the folder holding `from`, both site-relative: `_x.mdoc`, `../_x.mdoc`. */
export function relativePath(from: string, to: string): string {
  const base = from.split('/').slice(0, -1);
  const target = to.split('/');
  let common = 0;
  while (common < base.length && common < target.length - 1 && base[common] === target[common])
    common++;
  return [...Array<string>(base.length - common).fill('..'), ...target.slice(common)].join('/');
}

function ConditionForm({ editor, target }: { editor: Editor; target: Target }) {
  const ui = useBodyUi();
  const open = attrText(target.attrs.open);
  const layout = markdocTagLayout(open);
  const primary = layout?.attributes.find((a) => a.kind === 'primary');
  const [text, setText] = useState(primary ? open.slice(primary.valueStart, primary.valueEnd) : '');
  const [invalid, setInvalid] = useState(false);
  if (!layout || !primary)
    return <RawForm editor={editor} target={target} label="Condition" field="open" />;
  return (
    <TextField
      label="Shown when"
      description='A Markdoc condition, such as $product.beta or equals($tier, "free"). The content inside is shown only when it’s true.'
      value={text}
      isDisabled={ui.disabled}
      isInvalid={invalid}
      errorMessage="That isn’t a condition Markdoc can read, so it wasn’t changed."
      inputClassName="font-mono"
      onChange={(next) => {
        setText(next);
        const edited = open.slice(0, primary.valueStart) + next + open.slice(primary.valueEnd);
        const ok =
          next.trim() !== '' &&
          markdocTagLayout(edited)?.attributes.some((a) => a.kind === 'primary');
        setInvalid(!ok);
        if (ok) setAttrs(editor, target, { open: edited });
      }}
    />
  );
}

/** A protected construct's text, edited as written. */
function RawForm({
  editor,
  target,
  label,
  field,
}: {
  editor: Editor;
  target: Target;
  label: string;
  field?: string;
}) {
  const ui = useBodyUi();
  const key = field ?? (target.type === 'sourceBlock' ? 'text' : 'source');
  const value = attrText(target.attrs[key]);
  return (
    <TextArea
      label={label}
      description="Kept exactly as written: Vesper never reformats it. Change it with care; the site reads it as code."
      value={value}
      rows={Math.min(12, value.split('\n').length + 1)}
      isDisabled={ui.disabled}
      inputClassName="font-mono text-small"
      onChange={(next) => {
        setAttrs(editor, target, { [key]: next });
      }}
    />
  );
}

function Actions({
  editor,
  target,
  onClose,
}: {
  editor: Editor;
  target: Target;
  onClose: () => void;
}) {
  const ui = useBodyUi();
  const $pos = editor.state.doc.resolve(target.pos);
  const index = $pos.index();
  const count = $pos.parent.childCount;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap gap-2">
        {!target.inline && (
          <>
            <Button
              isDisabled={ui.disabled || index === 0}
              onPress={() => {
                ui.move(target.pos, -1);
              }}
            >
              Move up
            </Button>
            <Button
              isDisabled={ui.disabled || index >= count - 1}
              onPress={() => {
                ui.move(target.pos, 1);
              }}
            >
              Move down
            </Button>
          </>
        )}
        <Button
          variant="quiet"
          isDisabled={ui.disabled}
          onPress={() => {
            onClose();
            ui.remove(target.pos);
          }}
        >
          Remove
        </Button>
      </div>
      <Button variant="primary" onPress={onClose}>
        Done
      </Button>
    </div>
  );
}
