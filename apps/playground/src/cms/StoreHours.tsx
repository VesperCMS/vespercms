/** @jsxImportSource react */
import type { WidgetProps } from '@vesper/astro/config';
import { useRef } from 'react';

/*
 * The playground's example custom widget (spec §6.3.3): opening hours as rows
 * of days, opening time and closing time. It follows the widget contract:
 * - the editor renders the field's label (id `${id}-label`), and the first
 *   control takes `id`, so the label points at it;
 * - `describedBy` and `invalid` reach the controls;
 * - everything works by keyboard, with named buttons;
 * - it never validates: the schema in content.config.ts does.
 *
 * Styling is plain inline CSS with the studio's colour tokens, so it fits the
 * studio without depending on its stylesheet. The pragma on the first line
 * tells TypeScript this file is React JSX; Astro sites default to Astro's own.
 */

type Row = { days: string; opens: string; closes: string };

const input = {
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '0.375rem',
  background: 'var(--color-surface-sunken)',
  color: 'var(--color-content)',
  font: 'inherit',
} as const;

const button = {
  padding: '0.375rem 0.75rem',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '0.375rem',
  background: 'var(--color-surface)',
  color: 'var(--color-content)',
  font: 'inherit',
  cursor: 'pointer',
} as const;

export default function StoreHours({
  value,
  onChange,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<Row[]>) {
  const rows = Array.isArray(value) ? value : [];
  const status = useRef<HTMLParagraphElement>(null);
  const update = (next: Row[]) => {
    onChange(next.length > 0 ? next : undefined);
  };
  const set = (index: number, key: keyof Row, text: string) => {
    update(rows.map((row, i) => (i === index ? { ...row, [key]: text } : row)));
  };

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
      {rows.length === 0 && <p style={{ margin: '0 0 0.5rem' }}>No opening hours yet.</p>}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.75rem' }}>
        {rows.map((row, index) => {
          const n = String(index + 1);
          return (
            <li
              key={index}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'end' }}
            >
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>Days, row {n}</span>
                <input
                  id={index === 0 ? id : undefined}
                  value={row.days}
                  placeholder="Mon–Fri"
                  onChange={(event) => {
                    set(index, 'days', event.target.value);
                  }}
                  aria-invalid={invalid || undefined}
                  disabled={disabled}
                  style={{ ...input, width: '9rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>Opens, row {n}</span>
                <input
                  type="time"
                  value={row.opens}
                  onChange={(event) => {
                    set(index, 'opens', event.target.value);
                  }}
                  aria-invalid={invalid || undefined}
                  disabled={disabled}
                  style={input}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>Closes, row {n}</span>
                <input
                  type="time"
                  value={row.closes}
                  onChange={(event) => {
                    set(index, 'closes', event.target.value);
                  }}
                  aria-invalid={invalid || undefined}
                  disabled={disabled}
                  style={input}
                />
              </label>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  update(rows.filter((_, i) => i !== index));
                  if (status.current) status.current.textContent = `Removed row ${n}.`;
                }}
                style={button}
              >
                Remove row {n}
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          update([...rows, { days: '', opens: '09:00', closes: '17:00' }]);
          if (status.current) status.current.textContent = `Added row ${String(rows.length + 1)}.`;
        }}
        style={{ ...button, marginTop: '0.75rem' }}
      >
        Add opening hours
      </button>
      <p
        ref={status}
        role="status"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
        }}
      />
    </div>
  );
}
