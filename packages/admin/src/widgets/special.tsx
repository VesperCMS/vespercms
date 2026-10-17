import { isoWithOffset, offsetOf, slugify } from '@vesper/core';
import { RadioGroup, cx } from '@vesper/ui';
import { useEffect, useState } from 'react';
import { useStudio } from '../app/context.tsx';
import { fromWallTime, resolveTimeZone, wallTime, zoneName } from '../app/time.ts';
import { useEditor } from '../editor/context.tsx';
import type { WidgetProps } from '../types.ts';
import { inputClass } from './basic.tsx';

/*
 * The built-in widgets with behaviour of their own (spec §6.3.2). Every one
 * keeps a plain native or ui-kit control as its primary, accessible control.
 */

const HEX6 = /^#[0-9a-f]{6}$/i;

function describedByWith(describedBy: string | undefined, ...ids: (string | false)[]): string {
  return [describedBy, ...ids].filter(Boolean).join(' ');
}

/** A small square showing a colour, with a hairline so pale colours stay visible. */
function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-6 shrink-0 rounded-sm border border-border-strong"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Colour (spec §6.3.2). The hex text field is the primary control; the
 * native picker is a convenience beside it. With a palette, it's a radio
 * group of named swatches instead, each named in words.
 */
export function ColorWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<string>) {
  const palette = field.widgetOptions?.palette as Record<string, string> | undefined;
  const current = typeof value === 'string' ? value : '';

  if (palette && Object.keys(palette).length > 0) {
    const options = Object.entries(palette).map(([name, hex]) => ({
      value: hex,
      label: `${name} (${hex})`,
      prefix: <Swatch color={hex} />,
    }));
    if (current && !options.some((o) => o.value.toLowerCase() === current.toLowerCase())) {
      options.push({
        value: current,
        label: `Current colour (${current})`,
        prefix: <Swatch color={current} />,
      });
    }
    return (
      <RadioGroup
        id={id}
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        options={options}
        value={options.find((o) => o.value.toLowerCase() === current.toLowerCase())?.value ?? null}
        onChange={onChange}
        isInvalid={invalid}
        isDisabled={disabled}
      />
    );
  }

  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="text"
        value={current}
        placeholder="#1a73e8"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value === '' && !field.required ? undefined : event.target.value);
        }}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cx(inputClass, 'max-w-40 font-mono')}
      />
      {/* The picker can't show alpha, so 8-digit colours are text only. */}
      {field.widgetOptions?.alpha !== true && (
        <input
          type="color"
          aria-label={`Pick ${field.label.toLowerCase()} from a colour picker`}
          value={HEX6.test(current) ? current.toLowerCase() : '#000000'}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          disabled={disabled}
          className="size-10 cursor-pointer rounded-md border border-border-strong bg-surface p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
      )}
    </div>
  );
}

/**
 * Slug (spec §6.3.2): follows its source field (usually the title) until
 * someone edits it by hand. It follows only on entries that haven't been
 * saved yet, so a published page's URL never changes behind anyone's back.
 */
export function SlugWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<string>) {
  const editor = useEditor();
  const from = typeof field.widgetOptions?.from === 'string' ? field.widgetOptions.from : undefined;
  const source = from ? editor.values[from] : undefined;
  const sourceText = typeof source === 'string' ? source : '';
  const current = typeof value === 'string' ? value : '';
  const [following, setFollowing] = useState(
    () => editor.isNew && from !== undefined && (current === '' || current === toSlug(sourceText)),
  );

  useEffect(() => {
    if (!following) return;
    const next = toSlug(sourceText);
    if (next !== current) onChange(next === '' && !field.required ? undefined : next);
  }, [following, sourceText, current, onChange, field.required]);

  const sourceLabel = editor.collection.fields?.find((f) => f.path[0] === from)?.label ?? from;
  return (
    <>
      <input
        id={id}
        type="text"
        value={current}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setFollowing(false);
          onChange(event.target.value === '' && !field.required ? undefined : event.target.value);
        }}
        aria-describedby={describedByWith(describedBy, following && `${id}-follows`)}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cx(inputClass, 'font-mono')}
      />
      {following && sourceLabel && (
        <p id={`${id}-follows`} className="text-sm text-content-muted">
          Follows the {sourceLabel.toLowerCase()} until you edit it.
        </p>
      )}
    </>
  );
}

function toSlug(text: string): string {
  return slugify(text).replaceAll('/', '-');
}

/** URL, with a link that opens it (spec §6.3.2). */
export function UrlWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<string>) {
  const current = typeof value === 'string' ? value : '';
  const openable = /^https?:\/\/\S+$/i.test(current);
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="url"
        inputMode="url"
        value={current}
        placeholder={field.placeholder ?? 'https://'}
        onChange={(event) => {
          onChange(event.target.value === '' && !field.required ? undefined : event.target.value);
        }}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={inputClass}
      />
      {openable && (
        <a
          href={current}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-sm text-accent underline underline-offset-2 hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Open <span className="sr-only">{current} in a new tab</span>
        </a>
      )}
    </div>
  );
}

/**
 * Date and time in the site's time zone, named in text (spec §6.17). The
 * value keeps its type: a Date stays a Date, written with that day's offset.
 */
export function DateTimeWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<Date | string>) {
  const { manifest } = useStudio();
  const { zone, isSite } = resolveTimeZone(manifest.site.timeZone);
  const instant =
    value instanceof Date ? value : typeof value === 'string' && value ? new Date(value) : null;
  const valid = instant !== null && !Number.isNaN(instant.getTime());
  const name = zoneName(zone, valid ? instant : new Date());
  return (
    <>
      <input
        id={id}
        type="datetime-local"
        value={valid ? wallTime(instant, zone) : ''}
        onChange={(event) => {
          if (event.target.value === '') {
            onChange(undefined);
            return;
          }
          const next = fromWallTime(event.target.value, zone);
          if (!next) return;
          // A quoted string stays a string, with the offset written out.
          onChange(typeof value === 'string' ? isoWithOffset(next, offsetOf(next) ?? 0) : next);
        }}
        aria-describedby={describedByWith(describedBy, `${id}-zone`)}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        required={field.required}
        className={cx(inputClass, 'max-w-64')}
      />
      <p id={`${id}-zone`} className="text-sm text-content-muted">
        {isSite
          ? `Times are in ${name}, the site’s time zone.`
          : `Times are in your time zone, ${name}.`}
      </p>
    </>
  );
}

/**
 * Markdown in frontmatter (spec §6.3.2). A plain text area for now, said so
 * in words; the compact rich editor arrives with the body editor.
 */
export function MarkdownWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<string>) {
  const inline = field.widgetOptions?.inline === true;
  return (
    <>
      <textarea
        id={id}
        rows={inline ? 2 : 6}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => {
          onChange(event.target.value === '' && !field.required ? undefined : event.target.value);
        }}
        aria-describedby={describedByWith(describedBy, `${id}-md`)}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cx(inputClass, 'resize-y')}
      />
      <p id={`${id}-md`} className="text-sm text-content-muted">
        Markdown: **bold**, *italic*, [links](https://example.com).
      </p>
    </>
  );
}
