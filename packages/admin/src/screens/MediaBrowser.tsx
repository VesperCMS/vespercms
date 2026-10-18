import { dirOf, extensionOf, isImagePath, type MediaItem } from '@vesper/core';
import { Button, Dialog, Select, TextField } from '@vesper/ui';
import { useMemo, useRef, useState } from 'react';
import { useStudio } from '../app/context.tsx';
import { useLoad } from '../app/load.ts';
import { hrefFor } from '../app/router.ts';
import { Screen } from '../app/Screen.tsx';
import { fileSize } from '../media/hygiene.ts';
import { UploadStatus } from '../media/MediaPicker.tsx';
import { checkUpload, sendUpload, type UploadStep } from '../media/upload.ts';

type Show = 'all' | 'unused';

/**
 * The media browser (spec §6.6.6): every image and file in the site's
 * assets folders, with where each is used. Search by name, filter by
 * folder, and an "Unused" view for cleaning up. Deleting is confirmed, and
 * only possible for files nothing uses.
 */
export function MediaBrowser() {
  const { api, manifest } = useStudio();
  const maxEdge = manifest.site.images?.maxUploadEdge;
  const [load, reload] = useLoad(() => api.listMedia(), 'media');
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('all');
  const [show, setShow] = useState<Show>('all');
  const [deleting, setDeleting] = useState<MediaItem | null>(null);
  const [step, setStep] = useState<UploadStep | { step: 'working'; text: string } | null>(null);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo(() => (load.state === 'ready' ? load.value : []), [load]);
  const folders = useMemo(() => [...new Set(items.map((i) => dirOf(i.path)))].sort(), [items]);
  const shown = items.filter(
    (item) =>
      (folder === 'all' || dirOf(item.path) === folder) &&
      (show === 'all' || item.usedBy.length === 0) &&
      (query.trim() === '' || item.path.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const uploadFolder = folder === 'all' ? `${manifest.site.srcDir}/assets` : folder;

  const upload = async (ready: Extract<UploadStep, { upload: unknown }>) => {
    setStep({ step: 'working', text: 'Uploading…' });
    const result = await sendUpload(api, ready.upload, uploadFolder);
    if (result.ok) {
      setStep(null);
      setMessage(`Added ${result.path}. ${ready.upload.notes.join('. ')}`.trim());
      reload();
    } else {
      setStep({ step: 'refused', message: result.message });
    }
  };

  return (
    <Screen title="Media">
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <TextField
          label="Search by file name"
          type="search"
          value={query}
          onChange={setQuery}
          className="w-full max-w-xs"
        />
        <Select
          label="Folder"
          value={folder}
          onChange={(value) => {
            setFolder(value ?? 'all');
          }}
          options={[
            { value: 'all', label: 'All folders' },
            ...folders.map((f) => ({ value: f, label: f })),
          ]}
          className="w-56"
        />
        <Select
          label="Show"
          value={show}
          onChange={(value) => {
            setShow((value ?? 'all') as Show);
          }}
          options={[
            { value: 'all', label: 'All files' },
            { value: 'unused', label: 'Unused files' },
          ]}
          className="w-44"
        />
        <input
          ref={input}
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setMessage('');
            setStep({ step: 'working', text: `Preparing ${file.name}…` });
            void checkUpload(file, items, { accept: 'any', ...(maxEdge ? { maxEdge } : {}) }).then(
              (next) => {
                if (next.step === 'ready') void upload(next);
                else setStep(next);
              },
            );
          }}
        />
        <Button
          variant="primary"
          className="ml-auto"
          onPress={() => {
            input.current?.click();
          }}
        >
          Upload
        </Button>
      </div>
      <div className="mb-6 flex flex-col gap-2">
        <UploadStatus
          step={step}
          onUpload={(ready) => void upload(ready)}
          onReuse={(path) => {
            setStep(null);
            setMessage(`${path} is already in the site, so nothing was added.`);
          }}
          onCancel={() => {
            setStep(null);
          }}
        />
        <p role="status" className="text-sm text-content-muted">
          {message}
        </p>
      </div>

      {load.state === 'loading' && <p className="text-content-muted">Loading files…</p>}
      {load.state === 'failed' && (
        <p role="alert" className="text-danger">
          Couldn’t list files: {load.message}
        </p>
      )}
      {load.state === 'ready' && shown.length === 0 && (
        <p className="text-content-muted">
          {items.length === 0 ? 'This site has no images or files yet.' : 'No files match.'}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((item) => (
          <li key={item.path} className="flex flex-col gap-2 rounded-md border border-border p-3">
            {isImagePath(item.path) ? (
              <img
                src={api.fileUrl(item.path)}
                alt=""
                loading="lazy"
                className="h-36 w-full rounded-sm bg-surface-sunken object-contain"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-36 items-center justify-center rounded-sm bg-surface-sunken text-sm uppercase text-content-muted"
              >
                {extensionOf(item.path)}
              </span>
            )}
            <h2 className="break-all text-base">
              {item.path.slice(item.path.lastIndexOf('/') + 1)}
            </h2>
            <p className="break-all text-sm text-content-muted">
              {dirOf(item.path)} · {fileSize(item.size)}
            </p>
            <UsedOn item={item} />
            {item.usedBy.length === 0 && (
              <div>
                <Button
                  variant="quiet"
                  onPress={() => {
                    setDeleting(item);
                  }}
                  aria-label={`Delete ${item.path}`}
                >
                  Delete
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Dialog
        title="Delete this file?"
        role="alertdialog"
        isOpen={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <p className="mb-6">
          {deleting?.path} isn’t used on any page. Deleting removes it from the site; git can bring
          it back.
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            onPress={() => {
              setDeleting(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onPress={() => {
              const target = deleting;
              setDeleting(null);
              if (!target) return;
              void api.deleteMedia(target.path).then((result) => {
                setMessage(
                  result.ok ? `Deleted ${target.path}.` : 'message' in result ? result.message : '',
                );
                reload();
              });
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </Screen>
  );
}

function UsedOn({ item }: { item: MediaItem }) {
  if (item.usedBy.length === 0)
    return <p className="text-sm text-content-muted">Not used on any page</p>;
  return (
    <p className="text-sm">
      Used on{' '}
      {item.usedBy.map((use, index) => (
        <span key={`${use.collection}/${use.id}`}>
          {index > 0 && ', '}
          <a
            href={hrefFor({ screen: 'edit', collection: use.collection, id: use.id })}
            className="text-accent underline underline-offset-2"
          >
            {use.title}
          </a>
        </span>
      ))}
    </p>
  );
}
