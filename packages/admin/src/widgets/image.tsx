import {
  dirOf,
  extensionOf,
  imageValueOf,
  isPlainObject,
  mediaReference,
  resolveMediaPath,
  siteRatios,
  type DataValue,
  type FieldModel,
  type ImageSize,
} from '@vesper/core';
import { Button, Checkbox, Disclosure, cx } from '@vesper/ui';
import { useState } from 'react';
import { useStudio } from '../app/context.tsx';
import { useFileUrl } from '../app/file-url.tsx';
import { useEditor } from '../editor/context.tsx';
import { pathKey, type ValuePath } from '../editor/values.ts';
import { FieldNote, FieldNotes } from '../a11y/FieldNotes.tsx';
import { MediaPicker } from '../media/MediaPicker.tsx';
import type { WidgetProps } from '../types.ts';
import { inputClass } from './basic.tsx';
import { CropPreviews, type Ratio } from './crops.tsx';
import { FocalPointControl } from './focal-point.tsx';

/*
 * The image field (spec §6.6.2) and the file field (§6.3.2). Uploads go
 * through the media picker: hygiene, duplicate check, then into the assets
 * folder, and the entry stores a path relative to its own file, so Astro's
 * image() resolves it. A `fields.image()` field also has a focal point and
 * crops per ratio, behind one "Focal point & crops" disclosure (§6.6.4).
 * They only ever change the entry: the image file is never touched.
 *
 * Replacing the image drops its focal point and crops, which were chosen for
 * the old picture, but keeps its alt text and the decorative option, with a
 * note beside them until the editor changes one (DECISIONS.md, "Replacing an
 * image clears its geometry, not its words").
 */

/** Where new uploads for this field go: beside the current file, else `src/assets/<collection>`. */
function uploadFolder(current: string | null, srcDir: string, collection: string): string {
  return current ? dirOf(current) : `${srcDir}/assets/${collection}`;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The ratios a field previews: the ones it lists, else every ratio the site has (spec §6.6.3). */
export function fieldRatios(field: FieldModel, site: Record<string, number>): Ratio[] {
  const listed = field.widgetOptions?.ratios;
  const names = Array.isArray(listed)
    ? listed.filter((name): name is string => typeof name === 'string' && name in site)
    : Object.keys(site);
  return names.map((name) => ({ name, ratio: site[name] ?? 1 }));
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
  path,
}: WidgetProps<DataValue> & { path: ValuePath }) {
  const { manifest } = useStudio();
  const editor = useEditor();
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState<readonly string[]>([]);
  // The image the editor replaced the old one with, while its alt text is unchecked.
  const [replacedWith, setReplacedWith] = useState<string | null>(null);

  const objectShape = field.kind === 'object';
  const record = isPlainObject(value) ? value : {};
  const src = objectShape ? record.src : value;
  const srcText = typeof src === 'string' ? src : '';
  const sitePath = srcText ? resolveMediaPath(srcText, editor.entryPath) : null;
  const fileUrl = useFileUrl(sitePath);
  const hasAlt = objectShape && (field.children ?? []).some((c) => c.path.at(-1) === 'alt');
  const hasDecorative =
    objectShape && (field.children ?? []).some((c) => c.path.at(-1) === 'decorative');
  const decorative = record.decorative === true;
  const alt = typeof record.alt === 'string' ? record.alt : '';
  // Accessibility notes about the alt text (spec §6.18), shown beside it.
  const altNotes = (editor.notes?.get(pathKey(path)) ?? []).filter(
    (note) => note.target.kind === 'field' && note.target.path[path.length] === 'alt',
  );
  const childNamed = (name: string) =>
    objectShape && (field.children ?? []).some((c) => c.path.at(-1) === name);
  const hasFocus = childNamed('focus');
  const hasCrops = childNamed('crops');
  const [size, setSize] = useState<ImageSize | null>(null);
  const [sizeOf, setSizeOf] = useState(srcText);
  if (sizeOf !== srcText) {
    // A new image: its size, and so its crops, are measured again.
    setSizeOf(srcText);
    setSize(null);
  }

  const replaced = replacedWith === srcText;
  const replacedNote = decorative
    ? 'You replaced the image. Check that it’s still decorative.'
    : 'You replaced the image. Check that the alt text still describes it.';

  const setSrc = (path: string) => {
    // The same image again changes nothing, not even how its path is written.
    if (path === sitePath) return;
    const reference = mediaReference(path, editor.entryPath);
    if (!objectShape) {
      onChange(reference);
      return;
    }
    const { focus: _focus, crops: _crops, ...rest } = record;
    onChange({ ...rest, src: reference });
    if (srcText && (alt !== '' || decorative)) setReplacedWith(reference);
  };
  const setRecord = (next: Record<string, DataValue>) => {
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {srcText ? (
        <div className="flex flex-wrap items-start gap-4">
          {sitePath ? (
            fileUrl && (
              <img
                src={fileUrl}
                alt=""
                className="max-h-48 max-w-full rounded-md border border-border object-contain"
              />
            )
          ) : (
            <p className="text-small text-content-muted">
              The studio can’t show a preview of {srcText}.
            </p>
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <p id={`${id}-file`} className="font-mono text-small break-all">
              {fileName(srcText)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                id={id}
                isDisabled={disabled}
                aria-describedby={[describedBy, `${id}-file`].filter(Boolean).join(' ')}
                icon="replace-image"
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
                  setReplacedWith(null);
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
        <p role="status" className="text-small text-content-muted">
          Added. {notes.join('. ')}.
        </p>
      )}

      {hasAlt && !decorative && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-alt`} className="text-label text-content">
            Alt text
          </label>
          <textarea
            id={`${id}-alt`}
            rows={2}
            value={alt}
            onChange={(event) => {
              setReplacedWith(null);
              setRecord({ ...record, alt: event.target.value });
            }}
            aria-describedby={[
              `${id}-alt-help`,
              altNotes.length > 0 ? `${id}-alt-a11y` : '',
              replaced ? `${id}-replaced` : '',
              describedBy,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-invalid={invalid || undefined}
            aria-required="true"
            disabled={disabled}
            className={cx(inputClass, 'resize-y')}
          />
          <p id={`${id}-alt-help`} className="text-small text-content-muted">
            Describe what this image communicates on this page.
          </p>
          {altNotes.length > 0 && <FieldNotes id={`${id}-alt-a11y`} notes={altNotes} />}
          {replaced && <FieldNote id={`${id}-replaced`}>{replacedNote}</FieldNote>}
        </div>
      )}
      {hasDecorative && (
        <Checkbox
          isSelected={decorative}
          isDisabled={disabled}
          aria-describedby={decorative && replaced ? `${id}-replaced` : undefined}
          onChange={(checked) => {
            setReplacedWith(null);
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
      {hasDecorative && decorative && replaced && (
        <FieldNote id={`${id}-replaced`}>{replacedNote}</FieldNote>
      )}

      {sitePath && (hasFocus || hasCrops) && (
        <Disclosure title="Focal point & crops">
          <div className="flex flex-col gap-6">
            {hasFocus && fileUrl && (
              <FocalPointControl
                id={id}
                src={fileUrl}
                focus={imageValueOf(record).focus}
                disabled={disabled}
                onImageSize={setSize}
                onChange={(focus) => {
                  const { focus: _old, ...rest } = record;
                  setRecord(focus ? { ...rest, focus } : rest);
                }}
              />
            )}
            {hasCrops && fileUrl && (
              <CropPreviews
                id={id}
                src={fileUrl}
                size={size}
                value={imageValueOf(record)}
                ratios={fieldRatios(field, siteRatios(manifest.site.images?.ratios))}
                disabled={disabled}
                onChange={(crops) => {
                  const { crops: _old, ...rest } = record;
                  setRecord(Object.keys(crops).length > 0 ? { ...rest, crops } : rest);
                }}
              />
            )}
            {hasCrops && !hasFocus && fileUrl && (
              <img
                src={fileUrl}
                alt=""
                hidden
                onLoad={(event) => {
                  const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                  if (width > 0 && height > 0) setSize({ width, height });
                }}
              />
            )}
          </div>
        </Disclosure>
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
  const editor = useEditor();
  const [picking, setPicking] = useState(false);
  const current = typeof value === 'string' ? value : '';
  const sitePath = current ? resolveMediaPath(current, editor.entryPath) : null;
  const fileUrl = useFileUrl(sitePath);
  const extensions = acceptedExtensions(field.widgetOptions?.accept);
  return (
    <div className="flex flex-col gap-2">
      {current && (
        <p id={`${id}-file`} className="text-small">
          {sitePath && fileUrl ? (
            <a
              href={fileUrl}
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
