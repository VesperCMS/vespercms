import {
  cropForRatio,
  dragCorner,
  humanize,
  moveRect,
  ratioLabel,
  resizeRect,
  roundRect,
  type Corner,
  type CropRect,
  type FocalPoint,
  type ImageSize,
  type ImageValue,
} from '@vesper/core';
import { Button, Dialog, cx, focusRing } from '@vesper/ui';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/*
 * Crop previews and the crop dialog (spec §6.6.4). Each preview is the image
 * cropped by CSS to one ratio, from the same `cropForRatio` the site's <Img>
 * uses, so it follows the focal point live and shows exactly what the site
 * renders. "Adjust crop" opens a dialog with a fixed-ratio box: drag it,
 * drag a corner, or focus it and use the arrow keys (Shift resizes).
 */

export type Ratio = { name: string; ratio: number };

/** A ratio's name for people: "Wide", or "Social image" for the built-in og. */
export function ratioName(name: string): string {
  return name === 'og' ? 'Social image' : humanize(name);
}

const percent = (n: number) => Math.round(n * 100);

/** The image positioned inside a box of the crop's shape so only the crop shows. */
export function cropStyle(rect: CropRect) {
  return {
    width: `${String(100 / rect.w)}%`,
    height: `${String(100 / rect.h)}%`,
    left: `${String((-rect.x / rect.w) * 100)}%`,
    top: `${String((-rect.y / rect.h) * 100)}%`,
  };
}

export type CropPreviewsProps = {
  id: string;
  src: string;
  /** The image's natural size; previews wait for it. */
  size: ImageSize | null;
  value: ImageValue;
  ratios: Ratio[];
  /** The field's crops after a change: one applied, or one reset to the focal point. */
  onChange: (crops: Record<string, CropRect>) => void;
  disabled: boolean;
};

export function CropPreviews({
  id,
  src,
  size,
  value,
  ratios,
  onChange,
  disabled,
}: CropPreviewsProps) {
  const [open, setOpen] = useState<Ratio | null>(null);
  const [announcement, setAnnouncement] = useState('');
  if (!size) {
    return (
      <p className="text-small text-content-muted">Loading the image for the crop previews…</p>
    );
  }
  const buttonId = (name: string) => `${id}-crop-${name}`;
  const afterDialog = (name: string) => {
    requestAnimationFrame(() => {
      document.getElementById(buttonId(name))?.focus();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Crops" className="flex flex-wrap items-end gap-4">
        {ratios.map(({ name, ratio }) => {
          const { rect, custom } = cropForRatio(value, name, ratio, size);
          const label = ratioName(name);
          return (
            <li key={name}>
              <figure className="flex flex-col gap-1">
                <div
                  className="relative h-24 self-start overflow-hidden rounded-sm border border-border"
                  style={{ aspectRatio: String(ratio) }}
                >
                  <img
                    src={src}
                    alt=""
                    draggable={false}
                    className="absolute max-w-none"
                    style={cropStyle(rect)}
                  />
                </div>
                <figcaption className="text-small text-content">
                  {label} · {ratioLabel(ratio)}
                  {custom && <span className="text-content-muted"> · Custom crop</span>}
                </figcaption>
              </figure>
              <Button
                id={buttonId(name)}
                variant="quiet"
                isDisabled={disabled}
                className="-ml-4"
                onPress={() => {
                  setOpen({ name, ratio });
                }}
              >
                Adjust crop <span className="sr-only">for {label}</span>
              </Button>
            </li>
          );
        })}
      </ul>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {open && (
        <CropDialog
          src={src}
          size={size}
          name={open.name}
          ratio={open.ratio}
          start={cropForRatio(value, open.name, open.ratio, size)}
          onClose={() => {
            setOpen(null);
            afterDialog(open.name);
          }}
          onApply={(rect) => {
            onChange({ ...value.crops, [open.name]: roundRect(rect) });
            setAnnouncement(`Custom crop applied to ${ratioName(open.name)}.`);
          }}
          onReset={() => {
            const { [open.name]: _removed, ...rest } = value.crops;
            onChange(rest);
            setAnnouncement(`${ratioName(open.name)} crop reset to the focal point.`);
          }}
        />
      )}
    </div>
  );
}

/** "40% from the left, 10% from the top, 45% of the width", for the crop box. */
export function describeCrop(rect: CropRect): string {
  return `${String(percent(rect.x))}% from the left, ${String(percent(rect.y))}% from the top, ${String(percent(rect.w))}% of the width`;
}

const MOVES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Shift+→ and Shift+↓ grow the box, Shift+← and Shift+↑ shrink it. */
const GROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

const CORNERS: { corner: Corner; className: string }[] = [
  { corner: 'top-left', className: '-left-1.5 -top-1.5 cursor-nwse-resize' },
  { corner: 'top-right', className: '-right-1.5 -top-1.5 cursor-nesw-resize' },
  { corner: 'bottom-left', className: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
  { corner: 'bottom-right', className: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
];

type Drag =
  | { kind: 'move'; from: FocalPoint; start: CropRect }
  | { kind: 'corner'; corner: Corner; start: CropRect };

export type CropDialogProps = {
  src: string;
  size: ImageSize;
  name: string;
  ratio: number;
  /** Where the box starts: the custom crop, or the focal point's. */
  start: { rect: CropRect; custom: boolean };
  onClose: () => void;
  onApply: (rect: CropRect) => void;
  onReset: () => void;
};

export function CropDialog({
  src,
  size,
  name,
  ratio,
  start,
  onClose,
  onApply,
  onReset,
}: CropDialogProps) {
  const [rect, setRect] = useState(start.rect);
  const [touched, setTouched] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const image = useRef<HTMLImageElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const label = `${ratioName(name)} (${ratioLabel(ratio)})`;

  // The box is what the dialog is for, so the keys work at once. A layout
  // effect runs before React Aria's dialog effect, which then finds focus
  // inside and leaves it. (React's autoFocus only works on form controls.)
  useLayoutEffect(() => {
    box.current?.focus();
  }, []);

  const change = (next: CropRect, announce: boolean) => {
    setRect(next);
    setTouched(true);
    if (announce) setAnnouncement(`Crop ${describeCrop(next)}.`);
  };
  const apply = (close: () => void) => {
    // Untouched over a ratio with no custom crop: nothing to write.
    if (touched || start.custom) onApply(rect);
    close();
  };

  const pointAt = (event: PointerEvent): FocalPoint | null => {
    const box = image.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const corner = (event.target as HTMLElement).dataset.corner as Corner | undefined;
    const from = pointAt(event);
    if (!from) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = corner
      ? { kind: 'corner', corner, start: rect }
      : { kind: 'move', from, start: rect };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    const at = current ? pointAt(event) : null;
    if (!current || !at) return;
    change(
      current.kind === 'move'
        ? moveRect(current.start, at.x - current.from.x, at.y - current.from.y)
        : dragCorner(current.start, current.corner, at, ratio, size),
      false,
    );
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setAnnouncement(`Crop ${describeCrop(rect)}.`);
  };

  return (
    <Dialog
      title={`Adjust the ${ratioName(name)} crop`}
      size="wide"
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      {(close) => {
        const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply(close);
            return;
          }
          const move = MOVES[event.key];
          if (!move || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          change(
            event.shiftKey
              ? resizeRect(rect, rect.w + (GROWS[event.key] ?? 0) * 0.01, ratio, size)
              : moveRect(rect, move[0] * 0.01, move[1] * 0.01),
            true,
          );
        };
        return (
          <>
            <p id="vesper-crop-help" className="text-small text-content-muted">
              Drag the box to move it, or a corner to resize it. With the box focused, the arrow
              keys move it, Shift and the arrow keys resize it, Enter applies and Escape cancels.
            </p>
            <div className="relative mx-auto w-fit max-w-full touch-none select-none">
              <img
                ref={image}
                src={src}
                alt=""
                draggable={false}
                className="block max-h-[60vh] max-w-full"
              />
              {/* The image outside the crop, dimmed. */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 bg-content/50"
                style={{ height: `${String(rect.y * 100)}%` }}
              />
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 bg-content/50"
                style={{ height: `${String((1 - rect.y - rect.h) * 100)}%` }}
              />
              <span
                aria-hidden="true"
                className="absolute left-0 bg-content/50"
                style={{
                  top: `${String(rect.y * 100)}%`,
                  height: `${String(rect.h * 100)}%`,
                  width: `${String(rect.x * 100)}%`,
                }}
              />
              <span
                aria-hidden="true"
                className="absolute right-0 bg-content/50"
                style={{
                  top: `${String(rect.y * 100)}%`,
                  height: `${String(rect.h * 100)}%`,
                  width: `${String((1 - rect.x - rect.w) * 100)}%`,
                }}
              />
              {/*
                A two-way box has no ARIA widget role of its own. `application`
                makes screen readers pass the arrow keys through to it, which
                its keyboard model needs (DECISIONS.md, "The crop box").
              */}
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
              <div
                ref={box}
                role="application"
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={0}
                aria-label={`Crop box for ${label}`}
                aria-describedby="vesper-crop-position vesper-crop-help"
                data-crop-box=""
                onKeyDown={onKeyDown}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={cx(
                  'absolute cursor-move border border-on-accent outline-offset-0',
                  focusRing,
                )}
                style={{
                  left: `${String(rect.x * 100)}%`,
                  top: `${String(rect.y * 100)}%`,
                  width: `${String(rect.w * 100)}%`,
                  height: `${String(rect.h * 100)}%`,
                }}
              >
                <span aria-hidden="true" className="absolute inset-0 border border-content/60" />
                {CORNERS.map(({ corner, className }) => (
                  <span
                    key={corner}
                    aria-hidden="true"
                    data-corner={corner}
                    className={cx('absolute size-3 border border-content bg-on-accent', className)}
                  />
                ))}
              </div>
            </div>
            <p id="vesper-crop-position" className="sr-only">
              {describeCrop(rect)}
            </p>
            <p role="status" className="sr-only">
              {announcement}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {start.custom && (
                <Button
                  onPress={() => {
                    onReset();
                    close();
                  }}
                >
                  Reset to focal point
                </Button>
              )}
              <Button variant="quiet" onPress={close}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onPress={() => {
                  apply(close);
                }}
              >
                Apply crop
              </Button>
            </div>
          </>
        );
      }}
    </Dialog>
  );
}
