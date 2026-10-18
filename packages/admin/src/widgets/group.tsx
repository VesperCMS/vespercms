import { isPlainObject, type DataValue, type FieldModel } from '@vesper/core';
import { Button } from '@vesper/ui';
import { useRef } from 'react';
import { Field } from '../editor/Field.tsx';
import { keyOf, type ValuePath } from '../editor/values.ts';
import type { WidgetProps } from '../types.ts';

type GroupProps = WidgetProps<DataValue> & { path: ValuePath };

/** An object: its fields, in schema order, inside the field's fieldset. */
export function GroupWidget({ field, path }: GroupProps) {
  const children = (field.children ?? []).filter((child) => !child.hidden);
  return (
    <div className="flex flex-col gap-4">
      {children.map((child) => (
        <Field key={keyOf(child)} field={child} path={[...path, keyOf(child)]} />
      ))}
    </div>
  );
}

/** A short name for a list item, from its first text-like value. */
function itemSummary(value: DataValue, index: number, itemLabel: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (isPlainObject(value)) {
    for (const key of ['title', 'name', 'label', 'heading', 'text']) {
      const text = value[key];
      if (typeof text === 'string' && text.trim()) return text.trim();
    }
  }
  return `${itemLabel} ${String(index + 1)}`;
}

/** What an empty new item holds: `{}` for objects, nothing for scalars. */
function emptyItem(item: FieldModel | undefined): DataValue {
  if (!item) return null;
  if (item.default !== undefined && !item.defaultDynamic)
    return structuredClone(item.default) as DataValue;
  if (item.kind === 'object') return {};
  if (item.kind === 'boolean') return false;
  if (item.kind === 'array') return [];
  if (item.kind === 'number') return 0;
  return '';
}

/**
 * The repeater (spec §6.3.2): a list of items, each in its own group with
 * Move up, Move down and Remove buttons, so order never depends on
 * drag-and-drop (spec §10.6). After a move or removal, focus follows the
 * item or lands on a sensible neighbour, and the change is announced.
 */
export function RepeaterWidget({ value, onChange, field, path, disabled, id }: GroupProps) {
  const items: DataValue[] = Array.isArray(value) ? value : [];
  const item = field.children?.[0];
  const itemLabel = item?.label && item.label !== '[]' ? item.label : 'Item';
  const status = useRef<HTMLParagraphElement>(null);

  const announce = (text: string) => {
    if (status.current) status.current.textContent = text;
  };
  const focusItem = (index: number) => {
    requestAnimationFrame(() => {
      document.getElementById(`${id}-item-${String(index)}`)?.focus();
    });
  };
  const update = (next: DataValue[]) => {
    onChange(next.length === 0 && !field.required ? undefined : next);
  };
  const move = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    update(next);
    announce(
      `Moved ${itemSummary(moved, from, itemLabel)} to position ${String(to + 1)} of ${String(next.length)}.`,
    );
    focusItem(to);
  };

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && <p className="text-small text-content-muted">None yet.</p>}
      <ol className="flex flex-col gap-3">
        {items.map((entry, index) => {
          const name = itemSummary(entry, index, itemLabel);
          return (
            <li
              // Items have no stable identity of their own; the index is the identity here.
              key={index}
              id={`${id}-item-${String(index)}`}
              tabIndex={-1}
              aria-label={name}
              className="flex flex-col gap-2 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            >
              {item && (
                <Field
                  field={item}
                  path={[...path, index]}
                  label={`${itemLabel} ${String(index + 1)}`}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="quiet"
                  isDisabled={disabled || index === 0}
                  onPress={() => {
                    move(index, index - 1);
                  }}
                  aria-label={`Move ${name} up`}
                >
                  Move up
                </Button>
                <Button
                  variant="quiet"
                  isDisabled={disabled || index === items.length - 1}
                  onPress={() => {
                    move(index, index + 1);
                  }}
                  aria-label={`Move ${name} down`}
                >
                  Move down
                </Button>
                <Button
                  variant="quiet"
                  isDisabled={disabled}
                  onPress={() => {
                    update(items.filter((_, i) => i !== index));
                    announce(`Removed ${name}.`);
                    focusItem(Math.min(index, items.length - 2));
                  }}
                  aria-label={`Remove ${name}`}
                >
                  Remove
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <div>
        <Button
          isDisabled={disabled}
          onPress={() => {
            update([...items, emptyItem(item)]);
            announce(`Added ${itemLabel.toLowerCase()} ${String(items.length + 1)}.`);
            focusItem(items.length);
          }}
        >
          Add {itemLabel.toLowerCase()}
        </Button>
      </div>
      <p ref={status} role="status" className="sr-only" />
    </div>
  );
}
