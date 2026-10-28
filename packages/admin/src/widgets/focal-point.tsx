import { CENTER, roundFocus, type FocalPoint, type ImageSize } from '@vespercms/core';
import { Button, cx, focusRing } from '@vespercms/ui';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { inputClass } from './basic.tsx';

/*
 * The focal point (spec §6.6.4): what must stay in view when the image is
 * cropped. The image itself is one button: a click or tap sets the point,
 * the marker can be dragged, and with focus on it the arrow keys move the
 * point 1% (Shift for 10%). The "Across" and "Down" number fields beside it
 * set the point without seeing or pointing, and every move made with the
 * keys or the pointer is announced politely.
 */

const percent = (n: number) => Math.round(n * 100);

/** "62% across, 35% down", the words the control and the announcements use. */
export function describeFocus(focus: FocalPoint | undefined): string {
  const point = focus ?? CENTER;
  return `${String(percent(point.x))}% across, ${String(percent(point.y))}% down`;
}

const STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export type FocalPointControlProps = {
  id: string;
  /** The image's URL. */
  src: string;
  focus: FocalPoint | undefined;
  /** A new focal point, or undefined to go back to the centre. */
  onChange: (focus: FocalPoint | undefined) => void;
  /** The image's natural size, once it has loaded (for the crop previews). */
  onImageSize?: (size: ImageSize) => void;
  disabled: boolean;
};

export function FocalPointControl({
  id,
  src,
  focus,
  onChange,
  onImageSize,
  disabled,
}: FocalPointControlProps) {
  const image = useRef<HTMLImageElement>(null);
  const dragging = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const point = focus ?? CENTER;

  const set = (next: FocalPoint, announce: boolean) => {
    const rounded = roundFocus(next);
    onChange(rounded);
    if (announce) setAnnouncement(`Focal point ${describeFocus(rounded)}.`);
  };

  /** The pointer's place on the image, as fractions of it. */
  const pointAt = (clientX: number, clientY: number): FocalPoint | null => {
    const box = image.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return { x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height };
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    const next = pointAt(event.clientX, event.clientY);
    if (!next) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    set(next, false);
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    const next = pointAt(event.clientX, event.clientY);
    if (next) set(next, false);
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const next = pointAt(event.clientX, event.clientY);
    if (next) set(next, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = STEPS[event.key];
    if (!step || disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const by = event.shiftKey ? 0.1 : 0.01;
    set({ x: point.x + step[0] * by, y: point.y + step[1] * by }, true);
  };

  return (
    <div className="flex flex-col gap-3">
      <p id={`${id}-focus-help`} className="text-small text-content-muted">
        The focal point stays in view when the image is cropped. Click the image or drag the marker;
        or focus the image and use the arrow keys (Shift moves 10%).
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <button
          type="button"
          id={`${id}-focus`}
          aria-label="Focal point"
          aria-describedby={`${id}-focus-position ${id}-focus-help`}
          disabled={disabled}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
          className={cx(
            'relative max-w-full cursor-crosshair touch-none rounded-md disabled:cursor-not-allowed',
            focusRing,
          )}
        >
          <img
            ref={image}
            src={src}
            alt=""
            draggable={false}
            onLoad={(event) => {
              const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
              if (width > 0 && height > 0) onImageSize?.({ width, height });
            }}
            className="block max-h-64 max-w-full rounded-md border border-border"
          />
          <span
            aria-hidden="true"
            data-focal-marker=""
            className="pointer-events-none absolute -ml-3 -mt-3 size-6 rounded-full border border-on-accent bg-accent/70"
            style={{ left: `${String(point.x * 100)}%`, top: `${String(point.y * 100)}%` }}
          />
        </button>
        <div className="flex flex-col gap-3">
          <PercentField
            id={`${id}-focus-x`}
            label="Across (%)"
            hint="0 is the left edge, 100 the right"
            value={focus ? percent(focus.x) : undefined}
            placeholder={percent(CENTER.x)}
            disabled={disabled}
            onChange={(n) => {
              set({ x: n / 100, y: point.y }, false);
            }}
          />
          <PercentField
            id={`${id}-focus-y`}
            label="Down (%)"
            hint="0 is the top, 100 the bottom"
            value={focus ? percent(focus.y) : undefined}
            placeholder={percent(CENTER.y)}
            disabled={disabled}
            onChange={(n) => {
              set({ x: point.x, y: n / 100 }, false);
            }}
          />
          {focus && (
            <div>
              <Button
                variant="quiet"
                isDisabled={disabled}
                onPress={() => {
                  onChange(undefined);
                  setAnnouncement('Focal point back to the center.');
                }}
              >
                Use the center
              </Button>
            </div>
          )}
        </div>
      </div>
      <p id={`${id}-focus-position`} className="sr-only">
        {focus ? describeFocus(focus) : `Not set: the center, ${describeFocus(undefined)}`}
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/** A whole percentage, 0 to 100. Text state lets "6" be typed on the way to "62". */
function PercentField({
  id,
  label,
  hint,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number | undefined;
  placeholder: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
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
        inputMode="numeric"
        min={0}
        max={100}
        step={1}
        value={text}
        placeholder={String(placeholder)}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next) && next >= 0 && next <= 100) {
            setShown(Math.round(next));
            onChange(Math.round(next));
          }
        }}
        aria-describedby={`${id}-hint`}
        className={cx(inputClass, 'w-28')}
      />
      <p id={`${id}-hint`} className="text-small text-content-muted">
        {hint}
      </p>
    </div>
  );
}
