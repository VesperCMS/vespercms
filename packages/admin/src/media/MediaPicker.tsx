import { extensionOf, isImagePath, type MediaItem } from '@vesper/core';
import { Button, Dialog, TextField } from '@vesper/ui';
import { useMemo, useRef, useState } from 'react';
import { useStudio } from '../app/context.tsx';
import { useLoad } from '../app/load.ts';
import { fileSize, megabytes } from './hygiene.ts';
import { checkUpload, sendUpload, type UploadStep } from './upload.ts';

export type MediaPickerProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  kind: 'image' | 'file';
  /** File extensions a file field accepts, lower case without dots. Empty for any. */
  extensions?: readonly string[];
  /** Where a new upload goes, site-relative. */
  folder: string;
  /** Called with the chosen file's site-relative path, and what hygiene did to a new upload. */
  onChoose: (path: string, notes?: readonly string[]) => void;
};

/**
 * Choose a file: upload a new one (after hygiene and a duplicate check) or
 * pick one already in the site. One dialog, two plain sections.
 */
export function MediaPicker({
  isOpen,
  onOpenChange,
  kind,
  extensions = [],
  folder,
  onChoose,
}: MediaPickerProps) {
  return (
    <Dialog
      title={kind === 'image' ? 'Choose an image' : 'Choose a file'}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      {isOpen && (
        <PickerBody
          kind={kind}
          extensions={extensions}
          folder={folder}
          onChoose={(path, notes) => {
            onChoose(path, notes);
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}

function PickerBody({
  kind,
  extensions = [],
  folder,
  onChoose,
}: Pick<MediaPickerProps, 'kind' | 'extensions' | 'folder' | 'onChoose'>) {
  const { api, siteName, manifest } = useStudio();
  const maxEdge = manifest.site.images?.maxUploadEdge;
  const [media, reloadMedia] = useLoad(() => api.listMedia(), 'media');
  const [step, setStep] = useState<UploadStep | { step: 'working'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const fits = (path: string) =>
    kind === 'image'
      ? isImagePath(path)
      : extensions.length === 0 || extensions.includes(extensionOf(path));
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (media.state === 'ready' ? media.value : [])
      .filter((item) => fits(item.path))
      .filter((item) => needle === '' || item.path.toLowerCase().includes(needle));
    // `fits` only reads props that key this body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, query]);

  const upload = async (ready: Extract<UploadStep, { upload: unknown }>) => {
    setStep({ step: 'working', text: 'Uploading…' });
    const result = await sendUpload(api, ready.upload, folder);
    if (result.ok) {
      reloadMedia();
      onChoose(result.path, ready.upload.notes);
    } else {
      setStep({ step: 'refused', message: result.message });
    }
  };

  const accept =
    kind === 'image'
      ? 'image/*,.heic,.heif'
      : extensions.length > 0
        ? extensions.map((e) => `.${e}`).join(',')
        : undefined;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="picker-upload" className="flex flex-col gap-3">
        <h3 id="picker-upload" className="text-heading-3">
          Upload from your computer
        </h3>
        <p className="text-small text-content-muted">
          {kind === 'image'
            ? `Large photos are scaled down, turned upright, and stripped of location data before they’re added to ${siteName}.`
            : `The file is added to ${folder}.`}
        </p>
        <input
          ref={input}
          type="file"
          accept={accept}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setStep({ step: 'working', text: `Preparing ${file.name}…` });
            void checkUpload(file, media.state === 'ready' ? media.value : [], {
              accept: kind === 'image' ? 'image' : 'any',
              ...(maxEdge ? { maxEdge } : {}),
            }).then((next) => {
              if (next.step === 'ready') void upload(next);
              else setStep(next);
            });
          }}
        />
        <div>
          <Button
            onPress={() => {
              input.current?.click();
            }}
          >
            {kind === 'image' ? 'Upload an image' : 'Upload a file'}
          </Button>
        </div>
        <UploadStatus
          step={step}
          onUpload={(ready) => void upload(ready)}
          onReuse={onChoose}
          onCancel={() => {
            setStep(null);
          }}
        />
      </section>

      <section aria-labelledby="picker-existing" className="flex flex-col gap-3">
        <h3 id="picker-existing" className="text-heading-3">
          Or choose one already in the site
        </h3>
        <TextField label="Search by file name" type="search" value={query} onChange={setQuery} />
        {media.state === 'loading' && (
          <p className="text-small text-content-muted">Loading files…</p>
        )}
        {media.state === 'failed' && (
          <p role="alert" className="text-danger">
            Couldn’t list files: {media.message}
          </p>
        )}
        {media.state === 'ready' && items.length === 0 && (
          <p className="text-content-muted">No {kind === 'image' ? 'images' : 'files'} found.</p>
        )}
        <ul className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.path}>
              <MediaChoice item={item} onChoose={onChoose} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function MediaChoice({ item, onChoose }: { item: MediaItem; onChoose: (path: string) => void }) {
  const { api } = useStudio();
  const name = item.path.slice(item.path.lastIndexOf('/') + 1);
  return (
    <button
      type="button"
      onClick={() => {
        onChoose(item.path);
      }}
      className="flex w-full items-center gap-3 rounded-md border border-border p-2 text-left hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:ring-6 focus-visible:ring-(color:--glow-focus)"
    >
      {isImagePath(item.path) ? (
        <img
          src={api.fileUrl(item.path)}
          alt=""
          loading="lazy"
          className="size-12 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-caption text-content-muted uppercase"
        >
          {extensionOf(item.path)}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-semibold">{name}</span>
        <span className="block font-mono text-caption break-all text-content-muted">
          {item.path.slice(0, item.path.lastIndexOf('/'))} · {fileSize(item.size)}
        </span>
      </span>
    </button>
  );
}

export function UploadStatus({
  step,
  onUpload,
  onReuse,
  onCancel,
}: {
  step: UploadStep | { step: 'working'; text: string } | null;
  onUpload: (ready: Extract<UploadStep, { upload: unknown }>) => void;
  onReuse: (path: string) => void;
  onCancel: () => void;
}) {
  if (!step) return null;
  if (step.step === 'working') return <p role="status">{step.text}</p>;
  if (step.step === 'refused') {
    return (
      <p role="alert" className="text-danger">
        {step.message}
      </p>
    );
  }
  const notes = step.upload.notes.length > 0 && (
    <ul className="list-disc pl-6 text-small text-content-muted">
      {step.upload.notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
  if (step.step === 'duplicate') {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-md border border-warning bg-surface-raised p-4"
      >
        <p>This file is already in the site as {step.existing}.</p>
        <div className="flex flex-wrap gap-3">
          <Button
            onPress={() => {
              onReuse(step.existing);
            }}
          >
            Use the existing file
          </Button>
          <Button
            variant="quiet"
            onPress={() => {
              onUpload(step);
            }}
          >
            Upload a copy anyway
          </Button>
        </div>
      </div>
    );
  }
  if (step.step === 'confirm-large') {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-md border border-warning bg-surface-raised p-4"
      >
        <p>
          {step.upload.name} is {megabytes(step.upload.bytes.length)}. Large files make the site’s
          repository and pages heavier. Upload it anyway?
        </p>
        {notes}
        <div className="flex flex-wrap gap-3">
          <Button
            onPress={() => {
              onUpload(step);
            }}
          >
            Upload it
          </Button>
          <Button variant="quiet" onPress={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return null;
}
