import { isPlainObject, type DataValue } from '@vesper/core';
import { Button, cx } from '@vesper/ui';
import { Suspense, lazy, useState } from 'react';
import type { ValuePath } from '../editor/values.ts';
import type { WidgetProps } from '../types.ts';
import { inputClass } from './basic.tsx';

const GeoMap = lazy(() => import('./geo-map.tsx'));

export type LatLng = { lat: number; lng: number };

function pointOf(value: DataValue): Partial<LatLng> {
  if (!isPlainObject(value)) return {};
  const { lat, lng } = value;
  return {
    ...(typeof lat === 'number' ? { lat } : {}),
    ...(typeof lng === 'number' ? { lng } : {}),
  };
}

/**
 * A place (spec §6.3.2): latitude and longitude as two number fields, which
 * are the real, always-visible controls. A map with a draggable,
 * keyboard-movable pin loads only when asked for: it fetches map tiles from
 * the internet, and it's a convenience, not the way in.
 */
export function GeoWidget({
  value,
  onChange,
  field,
  id,
  disabled,
  invalid,
  describedBy,
}: WidgetProps<DataValue> & { path: ValuePath }) {
  const point = pointOf(value);
  const [showMap, setShowMap] = useState(false);
  const set = (key: 'lat' | 'lng', next: number | undefined) => {
    const base = isPlainObject(value) ? value : {};
    const merged: Record<string, DataValue> = { ...base, [key]: next };
    if (next === undefined) Reflect.deleteProperty(merged, key);
    onChange(Object.keys(merged).length === 0 && !field.required ? undefined : merged);
  };
  const options = field.widgetOptions as { defaultCenter?: LatLng; zoom?: number } | undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4">
        <Coordinate
          id={id}
          label="Latitude"
          hint="−90 to 90, north is positive"
          value={point.lat}
          min={-90}
          max={90}
          onChange={(next) => {
            set('lat', next);
          }}
          disabled={disabled}
          invalid={invalid}
          describedBy={describedBy}
        />
        <Coordinate
          id={`${id}-lng`}
          label="Longitude"
          hint="−180 to 180, east is positive"
          value={point.lng}
          min={-180}
          max={180}
          onChange={(next) => {
            set('lng', next);
          }}
          disabled={disabled}
          invalid={invalid}
          describedBy={describedBy}
        />
      </div>
      {showMap ? (
        <Suspense fallback={<p className="text-small text-content-muted">Loading the map…</p>}>
          <GeoMap
            label={field.label}
            point={point.lat !== undefined && point.lng !== undefined ? (point as LatLng) : null}
            center={options?.defaultCenter}
            zoom={options?.zoom}
            disabled={disabled}
            onChange={(next) => {
              const base = isPlainObject(value) ? value : {};
              onChange({ ...base, lat: next.lat, lng: next.lng });
            }}
          />
        </Suspense>
      ) : (
        <div>
          <Button
            variant="quiet"
            onPress={() => {
              setShowMap(true);
            }}
          >
            Show on a map
          </Button>
        </div>
      )}
    </div>
  );
}

function Coordinate({
  id,
  label,
  hint,
  value,
  min,
  max,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  hint: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (value: number | undefined) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  // Text state lets "-8" or "36." be typed on the way to a number. A value
  // that changes from outside (the map) replaces it.
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value === undefined ? '' : String(value));
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small text-content">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        min={min}
        max={max}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const next = event.target.value === '' ? undefined : event.target.valueAsNumber;
          if (next === undefined || Number.isFinite(next)) {
            setShown(next);
            onChange(next);
          }
        }}
        aria-describedby={[describedBy, `${id}-hint`].filter(Boolean).join(' ')}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cx(inputClass, 'w-44')}
      />
      <p id={`${id}-hint`} className="text-small text-content-muted">
        {hint}
      </p>
    </div>
  );
}
