import {
  decodeUtf8,
  fromBase64,
  type DeployStatus,
  type Draft,
  type Review,
} from '@vespercms/core';
import { Button, Dialog, Link, TextArea } from '@vespercms/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStudio } from '../app/context.tsx';
import { keyValueStore } from '../app/idb.ts';
import type { CloudConnection, DraftsSnapshot } from './connection.ts';

/*
 * The cloud's parts of the entry editor (spec §7.4): the entry's draft and
 * its review, deploy status after a publish, the side-by-side compare for a
 * conflict, and the review request. The editor itself stays one screen for
 * every mode; these appear only when the studio is connected (spec §6.9).
 */

const EMPTY: DraftsSnapshot = { drafts: [], reviews: [], version: '' };
const noSubscribe = () => () => undefined;

/** The drafts and reviews, current after every change. Empty when not connected. */
export function useDrafts(): DraftsSnapshot {
  const cloud = useStudio().cloud;
  return useSyncExternalStore(
    cloud ? cloud.drafts.subscribe : noSubscribe,
    cloud ? cloud.drafts.get : () => EMPTY,
  );
}

/** The draft holding a file, and the review that draft waits in. */
export function useEntryDraft(path: string): {
  draft: Draft | undefined;
  review: Review | undefined;
} {
  const { drafts, reviews } = useDrafts();
  const draft = drafts.find((d) => d.files.some((f) => f.path === path));
  const review = draft?.review ? reviews.find((r) => r.id === draft.review) : undefined;
  return { draft, review };
}

/** What the host reported for a published commit, asked again until the build is done. */
export function useDeployStatus(commit: string | null): DeployStatus | null {
  const cloud = useStudio().cloud;
  const [status, setStatus] = useState<DeployStatus | null>(null);
  useEffect(() => {
    if (!cloud || !commit) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const ask = async () => {
      const next = await cloud.drafts.status(commit).catch(() => null);
      if (!live) return;
      if (next) setStatus(next);
      // A build takes minutes; asking every 10 seconds for 15 minutes covers most hosts.
      if ((!next || next.state === 'building' || next.state === 'unknown') && ++tries < 90) {
        timer = setTimeout(() => void ask(), 10_000);
      }
    };
    void ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [cloud, commit]);
  return status;
}

/** The plain sentence after a publish (spec §6.16): building, live, failed, or nothing reported. */
export function DeployLine({ commit }: { commit: string }) {
  const status = useDeployStatus(commit);
  const state = status?.state ?? 'unknown';
  const text =
    state === 'live'
      ? 'Published. It’s live on the site.'
      : state === 'failed'
        ? 'Published, but the site’s build failed, so it isn’t live yet.'
        : state === 'building'
          ? 'Published. The site is building now.'
          : 'Published. It will be live after the site is next built.';
  return (
    <p className="text-small text-content-muted">
      {text}
      {status?.url && state !== 'unknown' && (
        <>
          {' '}
          <Link href={status.url} target="_blank" rel="noopener">
            {state === 'failed' ? 'See what went wrong' : 'See the build'}
          </Link>
        </>
      )}
    </p>
  );
}

/** A file's text at a version, through the cloud. */
async function textAt(cloud: CloudConnection, version: string | null): Promise<string> {
  if (!version) return '';
  const { blobs } = await cloud.client.blobs([version]);
  const found = blobs[version];
  return found === undefined ? '' : (decodeUtf8(fromBase64(found)) ?? '');
}

/**
 * A change published since the draft began (spec §7.4): the published file
 * and the draft side by side, and the editor's choice. Nothing is
 * overwritten silently.
 */
export function ConflictCompare({
  path,
  draft,
  publishedVersion,
  onKeep,
  onDiscard,
}: {
  path: string;
  draft: Draft;
  publishedVersion: string | null;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const cloud = useStudio().cloud;
  const [texts, setTexts] = useState<{ published: string; mine: string } | null>(null);
  const file = draft.files.find((f) => f.path === path);
  const mineVersion = file?.op === 'put' ? file.version : null;
  useEffect(() => {
    if (!cloud) return;
    let live = true;
    void Promise.all([textAt(cloud, publishedVersion), textAt(cloud, mineVersion)]).then(
      ([published, mine]) => {
        if (live) setTexts({ published, mine });
      },
      () => {
        if (live) setTexts({ published: '', mine: '' });
      },
    );
    return () => {
      live = false;
    };
  }, [cloud, publishedVersion, mineVersion]);
  return (
    <section
      aria-labelledby="conflict-title"
      className="flex flex-col gap-4 rounded-md border border-danger bg-surface-raised p-4"
    >
      <h2 id="conflict-title" className="m-0 text-heading-3 text-content">
        Someone published this entry since your draft began
      </h2>
      <p className="m-0">
        Nothing was published. Compare the two, then keep your draft (it replaces theirs when you
        publish) or use theirs.
      </p>
      {texts ? (
        <div className="grid gap-4 md:grid-cols-2">
          <CompareColumn title="Published now" text={texts.published} />
          <CompareColumn title="Your draft" text={texts.mine} />
        </div>
      ) : (
        <p role="status" className="m-0 text-content-muted">
          Loading both versions…
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onPress={onKeep}>Keep my draft</Button>
        <Button onPress={onDiscard}>Use the published version</Button>
      </div>
    </section>
  );
}

function CompareColumn({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="m-0 text-label text-content">{title}</h3>
      {/* A scrolling box must be reachable by keyboard to be read (WCAG 2.1.1). */}
      <pre
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        aria-label={title}
        className="m-0 max-h-96 overflow-auto rounded-sm border border-border bg-surface p-3 font-mono text-small whitespace-pre-wrap"
      >
        {text}
      </pre>
    </div>
  );
}

/** Asks for review, with an optional note for the approvers. */
export function RequestReviewDialog({
  isOpen,
  onOpenChange,
  onSend,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <Dialog title="Request review" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-4">
        <p className="m-0">
          An approver for this site gets an email, and can publish your changes or ask for more.
        </p>
        <TextArea label="Note for the approver (optional)" value={note} onChange={setNote} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            onPress={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            isPending={sending}
            onPress={() => {
              setSending(true);
              void onSend(note.trim()).finally(() => {
                setSending(false);
                setNote('');
              });
            }}
          >
            Send for review
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Unsaved changes kept on this device while the cloud can't be reached
 * (spec §6.9): written as they're typed, cleared once a draft is saved.
 */
export type KeptChanges = { values: unknown; body: string; raw: string };

let keptStore: ReturnType<typeof keyValueStore<KeptChanges>> | null = null;
export function keptChanges() {
  keptStore ??= keyValueStore<KeptChanges>('vesper-cloud-unsaved', 'entries');
  return keptStore;
}

export function keptKey(project: string, collection: string, id: string | null): string {
  return `${project}:${collection}:${id ?? '(new)'}`;
}
