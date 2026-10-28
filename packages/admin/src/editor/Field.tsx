import type { FieldModel } from '@vespercms/core';
import { cx, OptionalMark } from '@vespercms/ui';
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
  /**
   * A list item. An item of objects or images sits in its row's panel, which
   * names and frames it, so its legend is for screen readers only. An item is
   * never marked optional: it exists or it doesn't.
   */
  item?: 'row' | 'inline';
  /** A top-level object or list is a section, except where the place already has its own heading (Details). */
  asSection?: boolean;
};

/**
 * One field: its label, help and error text, and the widget that edits it
 * (spec §6.3.3: the editor renders the label, the widget the control).
 * Group widgets (objects, lists, choices) render as a fieldset whose legend
 * is the label. Errors are linked to the control with aria-describedby.
 */
export function Field({ field, path, label, item, asSection = true }: FieldProps) {
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

  const own = item === 'row' ? { ...props, inRow: true } : props;
  const control = Custom ? (
    <WidgetBoundary fallback={<builtin.component {...own} />} name={field.widget ?? ''}>
      <Suspense fallback={<p className="text-small text-content-muted">Loading…</p>}>
        <Custom {...props} />
      </Suspense>
    </WidgetBoundary>
  ) : (
    <builtin.component {...own} />
  );

  const text = label ?? field.label;
  // Most fields are required, so the few that aren't say so (DECISIONS.md,
  // "The studio marks what's optional"). A switch is never empty, so it's never optional.
  const mark =
    !field.required && !item && field.kind !== 'boolean' && field.readOnly !== true ? (
      <OptionalMark />
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
    const section = builtin.section && path.length === 1 && asSection && !editor.idPrefix && !item;
    // Objects inside the form are set off by an indent guide, never a frame (spec §10.2).
    const guided =
      builtin.section &&
      (field.kind === 'object' || field.kind === 'union') &&
      !section &&
      item !== 'row';
    const fieldset = (
      <fieldset
        aria-describedby={describedBy}
        className={cx(
          'flex min-w-0 flex-col gap-2',
          section && 'gap-3',
          guided && 'border-l border-border pl-4',
          builtin.group === 'boxed' && !item && 'rounded-md border border-border p-4',
        )}
      >
        <legend
          id={`${id}-label`}
          tabIndex={-1}
          className={cx(
            'mb-1 outline-none',
            // The row above it shows the item's name; screen readers still hear the group's.
            item === 'row' ? 'sr-only' : 'text-label text-content',
          )}
        >
          {section ? (
            <h2 className="text-heading-3 text-content">
              {text}
              {mark}
            </h2>
          ) : (
            <>
              {text}
              {mark}
            </>
          )}
        </legend>
        {help}
        {control}
        {error}
        {noteList}
      </fieldset>
    );
    // A section starts after a hairline, with more space above it than between fields.
    return section ? <div className="mt-4 border-t border-border pt-6">{fieldset}</div> : fieldset;
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label id={`${id}-label`} htmlFor={id} className="text-label text-content">
        {text}
        {mark}
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
