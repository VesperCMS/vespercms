import {
  dirOf,
  extensionOf,
  isPlainObject,
  mediaReference,
  resolveMediaPath,
  type DataValue,
} from '@vesper/core';
import { Button, Checkbox, cx } from '@vesper/ui';
import { useState } from 'react';
import { useStudio } from '../app/context.tsx';
import { useEditor } from '../editor/context.tsx';
import type { ValuePath } from '../editor/values.ts';
import { MediaPicker } from '../media/MediaPicker.tsx';
import type { WidgetProps } from '../types.ts';
import { inputClass } from './basic.tsx';

/*
 * The image field (spec §6.6.2) and the file field (§6.3.2). Uploads go
 * through the media picker: hygiene, duplicate check, then into the assets
 * folder, and the entry stores a path relative to its own file, so Astro's
 * image() resolves it. Focal point and crops arrive in Phase 2.7; values
 * already in the file are kept as they are.
 */

/** Where new uploads for this field go: beside the current file, else `src/assets/<collection>`. */
function uploadFolder(current: string | null, srcDir: string, collection: string): string {
  return current ? dirOf(current) : `${srcDir}/assets/${collection}`;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Problems with alt text worth a gentle word, never a block (spec §6.6.2). */
export function altAdvice(alt: string): string | null {
  const text = alt.trim();
  if (text === '') return null;
  if (
    /\.(jpe?g|png|webp|gif|avif|svg|heic)$/i.test(text) ||
    /^(img|dsc|pxl|image|photo|screenshot)[-_ ]?\d+/i.test(text)
  ) {
    return 'This looks like a file name. Describe what the image shows instead.';
  }
  if (/^(an? )?(image|picture|photo|graphic) of\b/i.test(text)) {
    return 'Screen readers already say it’s an image, so you can start with what it shows.';
  }
  if (text.length > 150) {
    return 'Long alt text is tiring to listen to. Keep it to what matters on this page, and put details in the text.';
  }
  return null;
}

/**
 * An image: preview, choose or replace, alt text written for this page, and
 * a "Decorative image" option that stores `alt: ""` and `decorative: true`.
 * A plain `image()` field stores just the path, with no alt text here.
 */
export function ImageWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<DataValue> & { path: ValuePath }) {
  const { api, manifest } = useStudio();
  const editor = useEditor();
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState<readonly string[]>([]);

  const objectShape = field.kind === 'object';
  const record = isPlainObject(value) ? value : {};
  const src = objectShape ? record.src : value;
  const srcText = typeof src === 'string' ? src : '';
  const sitePath = srcText ? resolveMediaPath(srcText, editor.entryPath) : null;
  const hasAlt = objectShape && (field.children ?? []).some((c) => c.path.at(-1) === 'alt');
  const hasDecorative =
    objectShape && (field.children ?? []).some((c) => c.path.at(-1) === 'decorative');
  const decorative = record.decorative === true;
  const alt = typeof record.alt === 'string' ? record.alt : '';
  const advice = altAdvice(alt);

  const setSrc = (path: string) => {
    const reference = mediaReference(path, editor.entryPath);
    onChange(objectShape ? { ...record, src: reference } : reference);
  };
  const setRecord = (next: Record<string, DataValue>) => {
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {srcText ? (
        <div className="flex flex-wrap items-start gap-4">
          {sitePath ? (
            <img
              src={api.fileUrl(sitePath)}
              alt=""
              className="max-h-48 max-w-full rounded-md border border-border object-contain"
            />
          ) : (
            <p className="text-sm text-content-muted">
              The studio can’t show a preview of {srcText}.
            </p>
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <p id={`${id}-file`} className="break-all text-sm">
              {fileName(srcText)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                id={id}
                isDisabled={disabled}
                aria-describedby={[describedBy, `${id}-file`].filter(Boolean).join(' ')}
                onPress={() => {
                  setPicking(true);
                }}
              >
                Replace image
              </Button>
              <Button
                variant="quiet"
                isDisabled={disabled}
                onPress={() => {
                  setNotes([]);
                  onChange(
                    field.required ? (objectShape ? { ...record, src: '' } : '') : undefined,
                  );
                }}
              >
                Remove image
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <Button
            id={id}
            isDisabled={disabled}
            aria-describedby={describedBy}
            onPress={() => {
              setPicking(true);
            }}
          >
            Choose image
          </Button>
        </div>
      )}
      {notes.length > 0 && (
        <p role="status" className="text-sm text-content-muted">
          Added. {notes.join('. ')}.
        </p>
      )}

      {hasAlt && !decorative && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-alt`} className="text-sm font-semibold text-content">
            Alt text <span className="font-normal text-content-muted">(required)</span>
          </label>
          <textarea
            id={`${id}-alt`}
            rows={2}
            value={alt}
            onChange={(event) => {
              setRecord({ ...record, alt: event.target.value });
            }}
            aria-describedby={[`${id}-alt-help`, advice ? `${id}-alt-advice` : '', describedBy]
              .filter(Boolean)
              .join(' ')}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={cx(inputClass, 'resize-y')}
          />
          <p id={`${id}-alt-help`} className="text-sm text-content-muted">
            Describe what this image communicates on this page.
          </p>
          {advice && (
            <p id={`${id}-alt-advice`} className="text-sm text-content">
              {advice}
            </p>
          )}
        </div>
      )}
      {hasDecorative && (
        <Checkbox
          isSelected={decorative}
          isDisabled={disabled}
          onChange={(checked) => {
            if (checked) {
              setRecord({ ...record, alt: '', decorative: true });
            } else {
              const { decorative: _decorative, ...rest } = record;
              setRecord(rest);
            }
          }}
        >
          Decorative image (it adds nothing a reader needs)
        </Checkbox>
      )}

      <MediaPicker
        isOpen={picking}
        onOpenChange={setPicking}
        kind="image"
        folder={uploadFolder(sitePath, manifest.site.srcDir, editor.collection.name)}
        onChoose={(path, uploadNotes) => {
          setNotes(uploadNotes ?? []);
          setSrc(path);
          // Focus returns to the button that opened the picker.
          requestAnimationFrame(() => {
            document.getElementById(id)?.focus();
          });
        }}
      />
    </div>
  );
}

/** Extensions a `fields.file({ accept })` allows: `application/pdf` or `.pdf` → `pdf`. */
function acceptedExtensions(accept: unknown): string[] {
  const list = typeof accept === 'string' ? accept.split(',') : Array.isArray(accept) ? accept : [];
  const byMime: Record<string, string[]> = {
    'application/pdf': ['pdf'],
    'video/mp4': ['mp4'],
    'audio/mpeg': ['mp3'],
    'text/csv': ['csv'],
  };
  return list.flatMap((item) => {
    const text = String(item).trim().toLowerCase();
    if (text.startsWith('.')) return [text.slice(1)];
    return byMime[text] ?? [];
  });
}

/** A file (PDF and so on): its name, type and size, with choose, replace and remove. */
export function FileWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  disabled,
}: WidgetProps<string>) {
  const { api } = useStudio();
  const editor = useEditor();
  const [picking, setPicking] = useState(false);
  const current = typeof value === 'string' ? value : '';
  const sitePath = current ? resolveMediaPath(current, editor.entryPath) : null;
  const extensions = acceptedExtensions(field.widgetOptions?.accept);
  return (
    <div className="flex flex-col gap-2">
      {current && (
        <p id={`${id}-file`} className="text-sm">
          {sitePath ? (
            <a
              href={api.fileUrl(sitePath)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2"
            >
              {fileName(current)}
            </a>
          ) : (
            fileName(current)
          )}{' '}
          <span className="text-content-muted">
            ({extensionOf(current).toUpperCase() || 'file'})
          </span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          id={id}
          isDisabled={disabled}
          aria-describedby={
            [describedBy, current ? `${id}-file` : ''].filter(Boolean).join(' ') || undefined
          }
          onPress={() => {
            setPicking(true);
          }}
        >
          {current ? 'Replace file' : 'Choose file'}
        </Button>
        {current && (
          <Button
            variant="quiet"
            isDisabled={disabled}
            onPress={() => {
              onChange(field.required ? '' : undefined);
            }}
          >
            Remove file
          </Button>
        )}
      </div>
      <MediaPicker
        isOpen={picking}
        onOpenChange={setPicking}
        kind="file"
        extensions={extensions}
        folder={sitePath ? dirOf(sitePath) : `public/files`}
        onChoose={(path) => {
          onChange(mediaReference(path, editor.entryPath));
          requestAnimationFrame(() => {
            document.getElementById(id)?.focus();
          });
        }}
      />
    </div>
  );
}
