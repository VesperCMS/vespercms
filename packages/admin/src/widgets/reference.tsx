import { isPlainObject, type DataValue, type EntrySummary, type FieldModel } from '@vespercms/core';
import { Button, Combobox, type Option } from '@vespercms/ui';
import { useMemo, useRef } from 'react';
import { useStudio } from '../app/context.tsx';
import { useLoad } from '../app/load.ts';
import { useEditor } from '../editor/context.tsx';
import type { WidgetProps } from '../types.ts';

/*
 * References (spec §6.2): pick entries of another collection by title. The
 * file stores what Astro's reference() reads, an entry ID, and an existing
 * `{ collection, id }` object keeps that shape.
 */

/** The ID a stored reference points at. */
export function referenceId(value: DataValue): string | undefined {
  if (typeof value === 'string') return value;
  if (isPlainObject(value)) {
    const id = value.id ?? value.slug;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

/** A new reference in the same shape as the old one. */
function withId(previous: DataValue, id: string): DataValue {
  return isPlainObject(previous) ? { ...previous, id } : id;
}

function useEntryOptions(collection: string | undefined) {
  const { api, collection: find } = useStudio();
  const editor = useEditor();
  const [load] = useLoad<EntrySummary[]>(
    () => (collection ? api.listEntries(collection) : Promise.resolve([])),
    collection ?? '',
  );
  const entries = useMemo(() => (load.state === 'ready' ? load.value : []), [load]);
  const options = useMemo(() => {
    // An entry can't point at itself.
    const others = entries.filter(
      (e) => !(collection === editor.collection.name && e.id === editor.entryId),
    );
    const titles = new Map<string, number>();
    for (const e of others) titles.set(e.title, (titles.get(e.title) ?? 0) + 1);
    return others.map((e): Option => ({
      value: e.id,
      // Two entries with one title are told apart by their IDs.
      label: (titles.get(e.title) ?? 0) > 1 ? `${e.title} (${e.id})` : e.title,
    }));
  }, [entries, collection, editor.collection.name, editor.entryId]);
  const label = (collection ? find(collection)?.label : undefined) ?? collection ?? 'entries';
  return { options, load, label };
}

function labelFor(options: Option[], id: string): string {
  return options.find((o) => o.value === id)?.label ?? `${id} (not found)`;
}

function targetOf(field: FieldModel): string | undefined {
  return field.reference?.collection ?? field.children?.[0]?.reference?.collection;
}

/** One reference: a searchable list of the other collection's entries. */
export function ReferenceWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<DataValue>) {
  const { options, load, label } = useEntryOptions(targetOf(field));
  const current = referenceId(value);
  const all =
    current && !options.some((o) => o.value === current)
      ? [...options, { value: current, label: labelFor(options, current) }]
      : options;
  return (
    <Combobox
      id={id}
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy}
      options={all}
      value={current ?? null}
      onChange={(next) => {
        onChange(next === null ? undefined : withId(value, next));
      }}
      placeholder={load.state === 'loading' ? 'Loading…' : `Search ${label.toLowerCase()}`}
      isInvalid={invalid}
      isDisabled={disabled}
    />
  );
}

/**
 * Several references, in order. Order usually matters (related posts), so
 * each has Move up, Move down and Remove buttons, and new ones are added
 * from a search box at the end.
 */
export function ReferencesWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<DataValue[]>) {
  const { options, load, label } = useEntryOptions(targetOf(field));
  const items: DataValue[] = Array.isArray(value) ? value : [];
  const ids = items.map(referenceId);
  const status = useRef<HTMLParagraphElement>(null);
  const announce = (text: string) => {
    if (status.current) status.current.textContent = text;
  };
  const update = (next: DataValue[]) => {
    onChange(next.length === 0 && !field.required ? undefined : next);
  };
  const move = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    update(next);
    announce(`Moved ${labelFor(options, referenceId(moved) ?? '')} to position ${String(to + 1)}.`);
  };
  const available = options.filter((o) => !ids.includes(o.value));

  return (
    <div className="flex flex-col gap-3">
      {items.length > 0 && (
        <ol className="flex flex-col divide-y divide-border border-y border-border">
          {items.map((item, index) => {
            const name = labelFor(options, referenceId(item) ?? '');
            return (
              <li
                key={`${String(referenceId(item))}-${String(index)}`}
                className="flex flex-wrap items-center gap-2 py-2"
              >
                <span className="min-w-0 flex-1">{name}</span>
                <Button
                  variant="quiet"
                  isDisabled={disabled || index === 0}
                  onPress={() => {
                    move(index, index - 1);
                  }}
                  aria-label={`Move ${name} up`}
                >
                  Up
                </Button>
                <Button
                  variant="quiet"
                  isDisabled={disabled || index === items.length - 1}
                  onPress={() => {
                    move(index, index + 1);
                  }}
                  aria-label={`Move ${name} down`}
                >
                  Down
                </Button>
                <Button
                  variant="quiet"
                  isDisabled={disabled}
                  onPress={() => {
                    update(items.filter((_, i) => i !== index));
                    announce(`Removed ${name}.`);
                    document.getElementById(id)?.focus();
                  }}
                  aria-label={`Remove ${name}`}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ol>
      )}
      <Combobox
        id={id}
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        options={available}
        value={null}
        onChange={(next) => {
          if (next === null) return;
          update([...items, next]);
          announce(`Added ${labelFor(options, next)}.`);
        }}
        placeholder={load.state === 'loading' ? 'Loading…' : `Add from ${label.toLowerCase()}`}
        isInvalid={invalid}
        isDisabled={disabled}
      />
      <p ref={status} role="status" className="sr-only" />
    </div>
  );
}
