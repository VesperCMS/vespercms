import {
  humanize,
  isPlainObject,
  variantFor,
  type DataObject,
  type DataValue,
  type FieldModel,
  type FieldVariant,
} from '@vespercms/core';
import { RadioGroup, Select } from '@vespercms/ui';
import { useRef } from 'react';
import { formatCount } from '../app/format.ts';
import { Field } from '../editor/Field.tsx';
import { initialValues, keyOf, type ValuePath } from '../editor/values.ts';
import type { WidgetProps } from '../types.ts';
import { RawWidget } from './basic.tsx';

/*
 * A discriminated union of objects: one value of several kinds (DECISIONS.md,
 * "Blocks are a discriminated union of objects"). In a list each item is a
 * row named by its kind, and its "…" menu adds and changes kinds; on its own
 * the field starts with a choice of kind. Either way the fields shown are the
 * chosen kind's, and a kind the schema doesn't list is edited as YAML.
 */

/** A new value of a kind: its key first, then its fields' own defaults, as a new entry gets them. */
export function kindValue(union: FieldModel, kind: FieldVariant): DataObject {
  return { [union.discriminator ?? '']: kind.value, ...initialValues(kind.children) };
}

/** A value that holds nothing a person typed: undefined, empty text, an empty list or object. */
function isBlank(value: DataValue): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return isPlainObject(value) && Object.values(value).every(isBlank);
}

export type KindChange = {
  value: DataObject;
  /** Labels of the fields both kinds have, whose values carried over. */
  kept: string[];
  /** Labels of the fields with content the new kind has no place for. */
  dropped: string[];
};

/**
 * A value moved to another kind. A field the new kind has under the same key
 * and of the same kind keeps its value; the rest are dropped. `setAside` is
 * what this value last held as the new kind, in this visit: changing back
 * before saving brings it back.
 */
export function changeKind(
  union: FieldModel,
  value: DataValue,
  to: FieldVariant,
  setAside?: DataObject,
): KindChange {
  const key = union.discriminator ?? '';
  const from = variantFor(union, value);
  const current = isPlainObject(value) ? value : {};
  const defaults = initialValues(to.children);
  const next: DataObject = { [key]: to.value };
  const kept: string[] = [];
  for (const child of to.children) {
    const name = keyOf(child);
    const was = from?.children.find((c) => keyOf(c) === name);
    // An unknown kind's fields can't be compared, so any the new kind has are offered to it.
    const fits = from ? was?.kind === child.kind : true;
    const carried = fits ? current[name] : undefined;
    if (carried !== undefined) {
      next[name] = carried;
      if (!isBlank(carried)) kept.push(child.label);
    } else if (setAside?.[name] !== undefined) {
      next[name] = setAside[name];
    } else if (defaults[name] !== undefined) {
      next[name] = defaults[name];
    }
  }
  const dropped = Object.keys(current)
    .filter((name) => name !== key && !(name in next) && !isBlank(current[name]))
    .map((name) => from?.children.find((c) => keyOf(c) === name)?.label ?? humanize(name));
  return { value: next, kept, dropped };
}

/** "Heading kept. Cards and Layout removed." for the status line after a change of kind. */
export function changeSummary(change: KindChange): string {
  const list = (labels: string[]) =>
    labels.length <= 1
      ? (labels[0] ?? '')
      : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`;
  return [
    change.kept.length > 0 ? `${list(change.kept)} kept.` : '',
    change.dropped.length > 0 ? `${list(change.dropped)} removed.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

const NAME_KEYS = ['title', 'name', 'label', 'heading', 'text'];
const plain = (text: string) => text.replace(/[*_`]/g, '').trim();

/**
 * How a list names an item of a kind: by its kind, with its own words after
 * it ("Card grid", "This industry has rules"). On a page, the order of kinds
 * is what someone scans for, and kinds are short names.
 */
export function kindRow(value: DataValue, union: FieldModel): { name: string; detail: string } {
  const kind = variantFor(union, value);
  if (!kind) {
    const named = isPlainObject(value) ? value[union.discriminator ?? ''] : undefined;
    return {
      name: typeof named === 'string' && named ? `Unknown kind: ${named}` : 'No kind',
      detail: '',
    };
  }
  if (!isPlainObject(value)) return { name: kind.label, detail: '' };
  const shown = kind.children.filter((child) => !child.hidden);
  for (const key of [kind.summary, ...NAME_KEYS, ...shown.map(keyOf)]) {
    const text = key ? value[key] : undefined;
    if (typeof text === 'string' && plain(text)) return { name: kind.label, detail: plain(text) };
  }
  const list = shown.find((child) => child.kind === 'array');
  if (list) {
    const held = value[keyOf(list)];
    const many = list.label.toLowerCase();
    const one = /[^s]s$/.test(many) ? many.slice(0, -1) : many;
    return {
      name: kind.label,
      detail: formatCount(Array.isArray(held) ? held.length : 0, one, many),
    };
  }
  return { name: kind.label, detail: '' };
}

/** A kind's fields, as an object's are shown. */
function KindFields({ kind, path }: { kind: FieldVariant; path: ValuePath }) {
  return (
    <div className="flex flex-col gap-4">
      {kind.children
        .filter((child) => !child.hidden)
        .map((child) => (
          <Field key={keyOf(child)} field={child} path={[...path, keyOf(child)]} />
        ))}
    </div>
  );
}

const NONE = '';

type UnionProps = WidgetProps<DataValue> & { path: ValuePath; inRow?: boolean };

export function UnionWidget(props: UnionProps) {
  const { value, onChange, field, path, id, describedBy, invalid, disabled, inRow } = props;
  // What the value held as each kind it left, so changing back brings it back.
  const setAside = useRef(new Map<string, DataObject>());
  const kind = variantFor(field, value);
  const kinds = field.variants ?? [];
  const unknown = value !== undefined && value !== null && !kind;

  const body = kind ? (
    kind.children.length > 0 ? (
      <KindFields kind={kind} path={path} />
    ) : inRow ? (
      <p className="text-small text-content-muted">This kind has nothing more to fill in.</p>
    ) : null
  ) : unknown ? (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-yaml`} className="text-label text-content">
        {kindRow(value, field).name}
      </label>
      <p id={`${id}-unknown`} className="text-small text-content-muted">
        The site has no kind by this name. Change it to one it has, or edit it here.
      </p>
      <RawWidget
        value={value}
        onChange={onChange}
        field={{ ...field, unknownReason: undefined }}
        id={`${id}-yaml`}
        describedBy={[describedBy, `${id}-unknown`].filter(Boolean).join(' ')}
        invalid={invalid}
        disabled={disabled}
      />
    </div>
  ) : null;

  // In a list, the row names the kind and its "…" menu changes it.
  if (inRow) return body;

  const choose = (next: string) => {
    if (kind) setAside.current.set(kind.value, isPlainObject(value) ? value : {});
    const to = kinds.find((one) => one.value === next);
    if (!to) {
      onChange(undefined);
      return;
    }
    onChange(changeKind(field, value, to, setAside.current.get(to.value)).value);
  };
  const options = [
    ...(field.required ? [] : [{ value: NONE, label: 'None' }]),
    ...kinds.map((one) => ({ value: one.value, label: one.label })),
  ];
  const selected = kind ? kind.value : value === undefined ? NONE : null;
  const chooser =
    options.length <= 4 ? (
      <RadioGroup
        id={`${id}-kind`}
        label="Kind"
        options={options}
        value={selected}
        onChange={choose}
        isDisabled={disabled}
        orientation={options.length <= 3 ? 'horizontal' : 'vertical'}
      />
    ) : (
      <Select
        id={`${id}-kind`}
        label="Kind"
        options={options}
        value={selected}
        onChange={(next) => {
          choose(next ?? NONE);
        }}
        isDisabled={disabled}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      {chooser}
      {kind?.description && <p className="text-small text-content-muted">{kind.description}</p>}
      {body}
    </div>
  );
}
