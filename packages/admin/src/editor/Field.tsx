import type { FieldModel } from '@vesper/core';
import { cx } from '@vesper/ui';
import { Component, Suspense, type ReactNode } from 'react';
import { useStudio } from '../app/context.tsx';
import type { WidgetProps } from '../types.ts';
import { builtinWidget } from '../widgets/registry.ts';
import { FieldNotes } from '../a11y/FieldNotes.tsx';
import { useEditor } from './context.tsx';
import { fieldId, getIn, pathKey, type ValuePath } from './values.ts';

export type FieldProps = {
  field: FieldModel;
  /** Where the value lives in the entry (concrete indexes for array items). */
  path: ValuePath;
  /** Replaces the field's label, e.g. "Speaker 2" for an array item. */
  label?: string;
};

/**
 * One field: its label, help and error text, and the widget that edits it
 * (spec §6.3.3: the editor renders the label, the widget the control).
 * Group widgets (objects, lists, choices) render as a fieldset whose legend
 * is the label. Errors are linked to the control with aria-describedby.
 */
export function Field({ field, path, label }: FieldProps) {
  const editor = useEditor();
  const { widgets } = useStudio();
  const id = fieldId(path, editor.idPrefix);
  const errors = editor.issues.get(pathKey(path)) ?? [];
  const Custom = field.widget ? widgets[field.widget] : undefined;
  const builtin = builtinWidget(field);
  // Notes about a child the widget draws its own control for (an image's alt
  // text) are shown by the widget, beside that control.
  const childControls = Custom ? undefined : builtin.childControls;
  const notes = (editor.notes?.get(pathKey(path)) ?? []).filter((note) => {
    const child = note.target.kind === 'field' ? note.target.path[path.length] : undefined;
    return !(typeof child === 'string' && childControls && child in childControls);
  });
  const helpId = field.description ? `${id}-help` : undefined;
  const errorId = errors.length > 0 ? `${id}-error` : undefined;
  const notesId = notes.length > 0 ? `${id}-a11y` : undefined;
  const describedBy = [helpId, errorId, notesId].filter(Boolean).join(' ') || undefined;

  const props: WidgetProps & { path: ValuePath } = {
    value: getIn(editor.values, path),
    onChange: (value) => {
      editor.setValue(path, value as never);
    },
    field,
    id,
    describedBy,
    invalid: errors.length > 0,
    disabled: editor.disabled || field.readOnly === true,
    path,
  };

  const control = Custom ? (
    <WidgetBoundary fallback={<builtin.component {...props} />} name={field.widget ?? ''}>
      <Suspense fallback={<p className="text-small text-content-muted">Loading…</p>}>
        <Custom {...props} />
      </Suspense>
    </WidgetBoundary>
  ) : (
    <builtin.component {...props} />
  );

  const text = label ?? field.label;
  const required = field.required ? (
    <>
      {' '}
      <span className="font-normal text-content-muted">(required)</span>
    </>
  ) : null;
  const help = helpId ? (
    <p id={helpId} className="text-small text-content-muted">
      {field.description}
    </p>
  ) : null;
  const error = errorId ? (
    <p id={errorId} className="text-small text-danger">
      {errors.join(' ')}
    </p>
  ) : null;
  const noteList = notesId ? <FieldNotes id={notesId} notes={notes} /> : null;

  if (!Custom && builtin.group) {
    return (
      <fieldset
        aria-describedby={describedBy}
        className={cx(
          'flex min-w-0 flex-col gap-2',
          builtin.group === 'boxed' && 'rounded-md border border-border p-4',
        )}
      >
        <legend
          id={`${id}-label`}
          tabIndex={-1}
          className="mb-1 text-label text-content outline-none"
        >
          {text}
          {required}
        </legend>
        {help}
        {control}
        {error}
        {noteList}
      </fieldset>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label id={`${id}-label`} htmlFor={id} className="text-label text-content">
        {text}
        {required}
      </label>
      {control}
      {help}
      {error}
      {noteList}
    </div>
  );
}

/**
 * A custom widget that throws falls back to the built-in control for the
 * field, with a note, instead of taking the whole editor down.
 */
class WidgetBoundary extends Component<
  { fallback: ReactNode; name: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <>
        <p className="text-small text-content-muted">
          The “{this.props.name}” control couldn’t load, so this is a plain one.
        </p>
        {this.props.fallback}
      </>
    );
  }
}
