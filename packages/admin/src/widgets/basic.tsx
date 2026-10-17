import {
  formatYamlSnippet,
  parseYamlSnippet,
  type DataValue,
  type FieldModel,
  type FieldOption,
} from '@vesper/core';
import { MultiCombobox, RadioGroup, Select, Switch, cx } from '@vesper/ui';
import { useState } from 'react';
import type { WidgetProps } from '../types.ts';

/*
 * The simple built-in widgets (spec §6.3.2). Each follows the custom widget
 * contract: the control takes `id`, `aria-describedby` and `aria-invalid`,
 * and the editor renders the label. None of them validate.
 */

/** Native inputs share the ui kit's control look. */
export const inputClass = cx(
  'w-full rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-base text-content',
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
  'aria-[invalid=true]:border-danger disabled:opacity-60',
);

/** Clearing an optional field removes its key; a required one keeps `''` so the schema can say why. */
function emptyAs(field: FieldModel): '' | undefined {
  return field.required ? '' : undefined;
}

function textProps(props: WidgetProps<string>) {
  const { onChange, field, id, describedBy, invalid, disabled } = props;
  // A file can hold a number where the schema expects text; show it rather than hide it.
  const value: unknown = props.value;
  return {
    id,
    value:
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '',
    onChange: (event: { target: { value: string } }) => {
      onChange(event.target.value === '' ? emptyAs(field) : event.target.value);
    },
    'aria-describedby': describedBy,
    'aria-invalid': invalid || undefined,
    disabled,
    placeholder: field.placeholder,
    autoComplete: field.autocomplete,
    className: inputClass,
  };
}

export function TextWidget(props: WidgetProps<string>) {
  return <input type="text" {...textProps(props)} />;
}

export function EmailWidget(props: WidgetProps<string>) {
  const input = textProps(props);
  return (
    <input type="email" inputMode="email" {...input} autoComplete={input.autoComplete ?? 'email'} />
  );
}

export function TextAreaWidget(props: WidgetProps<string>) {
  const rows = props.field.widget === 'markdown' ? 8 : 3;
  return <textarea rows={rows} {...textProps(props)} className={cx(inputClass, 'resize-y')} />;
}

export function NumberWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<number>) {
  // The text is kept separately so "1." or "-" can be typed on the way to a number.
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const c = field.constraints;
  return (
    <input
      id={id}
      type="number"
      inputMode={c?.integer ? 'numeric' : 'decimal'}
      value={text}
      min={c?.min}
      max={c?.max}
      step={c?.step ?? (c?.integer ? 1 : 'any')}
      onChange={(event) => {
        setText(event.target.value);
        if (event.target.value === '') onChange(undefined);
        else if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
      }}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      className={cx(inputClass, 'max-w-48')}
    />
  );
}

export function SwitchWidget({
  value,
  onChange,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<boolean>) {
  return (
    <Switch
      id={id}
      isSelected={value === true}
      onChange={onChange}
      isDisabled={disabled}
      isInvalid={invalid}
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy}
    >
      {null}
    </Switch>
  );
}

/** YYYY-MM-DD of a date as stored: date-only values are midnight UTC (YAML timestamps). */
function dateText(value: DataValue): string {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return '';
}

/**
 * A calendar date. The value keeps its type: a Date stays a Date (written
 * back as `2026-10-17`), and a quoted string stays a string.
 */
export function DateWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<Date | string>) {
  return (
    <input
      id={id}
      type="date"
      value={dateText(value)}
      onChange={(event) => {
        const text = event.target.value;
        if (text === '')
          onChange(emptyAs(field) === '' && typeof value === 'string' ? '' : undefined);
        else onChange(typeof value === 'string' ? text : new Date(`${text}T00:00:00.000Z`));
      }}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      className={cx(inputClass, 'max-w-56')}
    />
  );
}

function optionsOf(field: FieldModel): FieldOption[] {
  return field.constraints?.options ?? field.children?.[0]?.constraints?.options ?? [];
}

export function SelectWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<string>) {
  return (
    <Select
      id={id}
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy}
      options={optionsOf(field)}
      value={value ?? null}
      onChange={(next) => {
        onChange(next ?? undefined);
      }}
      isInvalid={invalid}
      isDisabled={disabled}
    />
  );
}

/** Up to four options, all visible. Rendered inside the field's fieldset, which names it. */
export function RadioWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<string>) {
  return (
    <RadioGroup
      id={id}
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy}
      options={optionsOf(field)}
      value={value ?? null}
      onChange={onChange}
      isInvalid={invalid}
      isDisabled={disabled}
      orientation={optionsOf(field).length <= 3 ? 'horizontal' : 'vertical'}
    />
  );
}

/** A list of strings: type and press Enter to add, each with a named remove button. */
export function TagsWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<string[]>) {
  const values = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
  const options = optionsOf(field);
  const multiple = field.children?.[0]?.kind === 'enum';
  return (
    <MultiCombobox
      id={id}
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy}
      options={multiple ? options : values.map((v) => ({ value: v, label: v }))}
      values={values}
      onChange={(next) => {
        onChange(next.length === 0 && !field.required ? undefined : next);
      }}
      allowsCustomValue={!multiple}
      itemName={multiple ? 'option' : 'tag'}
      isInvalid={invalid}
      isDisabled={disabled}
    />
  );
}

/**
 * The raw field (spec §6.3 step 4): any value Vesper can't map to a control,
 * edited as a small YAML snippet and parsed the way Astro parses it. The
 * text is kept while it's invalid, so nothing typed is lost.
 */
export function RawWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<DataValue>) {
  const [text, setText] = useState(() => formatYamlSnippet(value));
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = `${id}-yaml`;
  return (
    <>
      <textarea
        id={id}
        rows={Math.min(12, Math.max(3, text.split('\n').length + 1))}
        value={text}
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseYamlSnippet(event.target.value);
          if (parsed.ok) {
            setProblem(null);
            onChange(parsed.value);
          } else {
            setProblem(parsed.message);
          }
        }}
        aria-describedby={[describedBy, `${id}-raw`, problem ? problemId : undefined]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={invalid || problem !== null || undefined}
        disabled={disabled}
        className={cx(inputClass, 'resize-y font-mono text-sm')}
      />
      <p id={`${id}-raw`} className="text-sm text-content-muted">
        Edited as YAML
        {field.unknownReason
          ? `: Vesper has no control for this ${field.unknownReason} field.`
          : '.'}
      </p>
      {problem && (
        <p id={problemId} className="text-sm text-danger">
          {problem}
        </p>
      )}
    </>
  );
}
