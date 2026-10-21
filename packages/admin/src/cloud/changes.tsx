import { collectionOf, defaultEntryId, type Draft, type Review } from '@vesper/core';
import { Button, Checkbox, Dialog, Drawer, Link, TextArea } from '@vesper/ui';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useStudio } from '../app/context.tsx';
import { formatCount, formatRelative } from '../app/format.ts';
import { hrefFor, navigate, parseRoute } from '../app/router.ts';
import { DeployLine, useDrafts } from './editor.tsx';

/*
 * Changes (DECISIONS.md, "Drafts, reviews and Publish live behind a Changes
 * button"): one quiet button in the top bar, its count in words, opening a
 * drawer with the site's drafts and, for approvers, what waits for their
 * review. "Publish 3 changes" is the drawer's one primary button. Only when
 * the studio is connected to the cloud (spec §6.9).
 */

type ChangesState = { open: boolean; setOpen: (open: boolean) => void };

const ChangesContext = createContext<ChangesState | null>(null);

/**
 * `linked` is the `#/changes` address, where review emails send an approver:
 * it opens the drawer, and closing the drawer goes back to `#/`, so a reload
 * or Back doesn't open it again.
 */
export function ChangesProvider({ children, linked }: { children: ReactNode; linked: boolean }) {
  const [shown, setShown] = useState(false);
  const open = linked || shown;
  const setOpen = useCallback((next: boolean) => {
    setShown(next);
    if (!next && parseRoute(window.location.hash).screen === 'changes') {
      navigate({ screen: 'home' }, { replace: true });
    }
  }, []);
  const value = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  return (
    <ChangesContext.Provider value={value}>
      {children}
      <ChangesDrawer />
    </ChangesContext.Provider>
  );
}

/** Opens and closes the drawer; null when the studio isn't connected. */
export function useChanges(): ChangesState | null {
  return useContext(ChangesContext);
}

/** What waits for this member: drafts, and reviews they can answer. */
function useWaiting() {
  const cloud = useStudio().cloud;
  const { drafts, reviews } = useDrafts();
  const toReview = cloud
    ? reviews.filter(
        (review) =>
          review.requestedBy.id !== cloud.user.id &&
          review.drafts.every((id) => {
            const draft = drafts.find((d) => d.id === id);
            return draft !== undefined && cloud.draftAccess(draft).publish;
          }),
      )
    : [];
  return { drafts, reviews, toReview };
}

/** The top bar's button: "3 changes", and how many wait for this member's review. */
export function ChangesButton() {
  const changes = useChanges();
  const { drafts, toReview } = useWaiting();
  if (!changes || drafts.length === 0) return null;
  const text = [
    formatCount(drafts.length, 'change', 'changes'),
    toReview.length > 0 ? `${String(toReview.length)} to review` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Button
      variant="quiet"
      onPress={() => {
        changes.setOpen(true);
      }}
    >
      {text}
    </Button>
  );
}

/** Home's line about drafts waiting to be published, which opens Changes. */
export function DraftsWaiting() {
  const changes = useChanges();
  const { drafts } = useWaiting();
  if (!changes || drafts.length === 0) return null;
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        {drafts.length === 1
          ? '1 draft is waiting to be published.'
          : `${String(drafts.length)} drafts are waiting to be published.`}
      </span>
      <Button
        variant="quiet"
        onPress={() => {
          changes.setOpen(true);
        }}
      >
        See changes
      </Button>
    </p>
  );
}

/** The entry a draft's file belongs to, for "Open". */
function entryOf(
  manifest: Parameters<typeof collectionOf>[0],
  path: string,
): { collection: string; id: string } | null {
  const owner = collectionOf(manifest, path);
  if (!owner?.relative) return null;
  return { collection: owner.collection.name, id: defaultEntryId(owner.relative) };
}

type Outcome =
  | { kind: 'published'; commit: string; count: number }
  | { kind: 'requested'; count: number }
  | { kind: 'refused'; text: string }
  | null;

function ChangesDrawer() {
  const { cloud, manifest } = useStudio();
  const changes = useChanges();
  const { drafts, reviews, toReview } = useWaiting();
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState<Draft | null>(null);
  if (!cloud || !changes) return null;

  const publishes = cloud.member.role === 'admin' || cloud.member.role === 'editor';
  const actionable = drafts.filter((d) => {
    const access = cloud.draftAccess(d);
    return publishes ? access.publish : access.edit && !d.review;
  });
  // Everything actionable starts chosen, until the member changes that.
  const selected = chosen ?? new Set(actionable.map((d) => d.id));
  const picked = actionable.filter((d) => selected.has(d.id));

  const act = async () => {
    if (picked.length === 0) return;
    setBusy(true);
    setOutcome(null);
    try {
      if (publishes) {
        const result = await cloud.drafts.publish(picked.map((d) => d.id));
        if (result.ok)
          setOutcome({ kind: 'published', commit: result.commit, count: picked.length });
        else if (result.reason === 'conflict') {
          setOutcome({
            kind: 'refused',
            text: `Someone published ${result.conflicts.map((c) => c.path).join(', ')} since its draft began. Open it to compare the two.`,
          });
        } else setOutcome({ kind: 'refused', text: result.message });
      } else {
        await cloud.drafts.requestReview(
          picked.map((d) => d.id),
          '',
        );
        setOutcome({ kind: 'requested', count: picked.length });
      }
      setChosen(null);
    } catch (error) {
      setOutcome({ kind: 'refused', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title="Changes"
      isOpen={changes.open}
      onOpenChange={(open) => {
        changes.setOpen(open);
        if (!open) setOutcome(null);
      }}
    >
      <div className="flex flex-col gap-8">
        {outcome?.kind === 'published' && (
          <div className="flex flex-col gap-1">
            <p className="m-0 font-semibold">
              {outcome.count === 1
                ? 'Published 1 change.'
                : `Published ${String(outcome.count)} changes.`}
            </p>
            <DeployLine commit={outcome.commit} />
          </div>
        )}
        {outcome?.kind === 'requested' && (
          <p className="m-0">
            Sent for review. An approver will publish {outcome.count === 1 ? 'it' : 'them'} or ask
            for changes.
          </p>
        )}
        {outcome?.kind === 'refused' && (
          <p role="alert" className="m-0 rounded-md border border-danger bg-surface-raised p-4">
            Nothing was published. {outcome.text}
          </p>
        )}

        {toReview.length > 0 && (
          <section aria-labelledby="changes-review" className="flex flex-col gap-4">
            <h3 id="changes-review" className="m-0 text-heading-3 text-content">
              Waiting for your review
            </h3>
            {toReview.map((review) => (
              <ReviewItem key={review.id} review={review} drafts={drafts} onOutcome={setOutcome} />
            ))}
          </section>
        )}

        <section aria-labelledby="changes-drafts" className="flex flex-col gap-4">
          <h3 id="changes-drafts" className="m-0 text-heading-3 text-content">
            Drafts
          </h3>
          {drafts.length === 0 ? (
            <p className="m-0 text-content-muted">Nothing is waiting to be published.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {drafts.map((draft) => {
                const open = draft.files.map((f) => entryOf(manifest, f.path)).find(Boolean);
                const review = reviews.find((r) => r.id === draft.review);
                const canAct = actionable.includes(draft);
                const meta = [
                  `${draft.updatedBy.name}, ${formatRelative(draft.updatedAt)}`,
                  draft.files.length > 1 ? formatCount(draft.files.length, 'file', 'files') : '',
                  review
                    ? review.state === 'open'
                      ? 'waiting for review'
                      : 'changes requested'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={draft.id} className="flex flex-col gap-1">
                    {canAct ? (
                      <Checkbox
                        isSelected={selected.has(draft.id)}
                        onChange={(on) => {
                          const next = new Set(selected);
                          if (on) next.add(draft.id);
                          else next.delete(draft.id);
                          setChosen(next);
                        }}
                      >
                        {draft.summary}
                      </Checkbox>
                    ) : (
                      <span>{draft.summary}</span>
                    )}
                    <span className="text-small text-content-muted">{meta}</span>
                    <span className="flex flex-wrap gap-3">
                      {open && (
                        <Link
                          href={hrefFor({
                            screen: 'edit',
                            collection: open.collection,
                            id: open.id,
                          })}
                          onPress={() => {
                            changes.setOpen(false);
                          }}
                        >
                          Open
                        </Link>
                      )}
                      {cloud.draftAccess(draft).edit && (
                        <Button
                          variant="quiet"
                          onPress={() => {
                            setDiscarding(draft);
                          }}
                        >
                          Discard…
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {actionable.length > 0 && (
          <div>
            <Button
              variant="primary"
              isPending={busy}
              onPress={() => void act()}
              isDisabled={picked.length === 0}
            >
              {publishes
                ? `Publish ${formatCount(picked.length, 'change', 'changes')}`
                : `Request review for ${formatCount(picked.length, 'change', 'changes')}`}
            </Button>
          </div>
        )}
      </div>
      <Dialog
        title={`Discard “${discarding?.summary ?? ''}”?`}
        role="alertdialog"
        isOpen={discarding !== null}
        onOpenChange={(open) => {
          if (!open) setDiscarding(null);
        }}
      >
        <p className="mb-6">The changes that haven’t been published are thrown away.</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            onPress={() => {
              setDiscarding(null);
            }}
          >
            Keep the draft
          </Button>
          <Button
            variant="danger"
            onPress={() => {
              const draft = discarding;
              setDiscarding(null);
              if (draft) void cloud.drafts.discard(draft.id);
            }}
          >
            Discard draft
          </Button>
        </div>
      </Dialog>
    </Drawer>
  );
}

/** One review waiting for this approver: who asked, what they said, and the answers. */
function ReviewItem({
  review,
  drafts,
  onOutcome,
}: {
  review: Review;
  drafts: readonly Draft[];
  /** Published, the review closes, so the drawer says what happened. */
  onOutcome: (outcome: Outcome) => void;
}) {
  const cloud = useStudio().cloud;
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  if (!cloud) return null;
  const titled = `${review.requestedBy.name} asked ${formatRelative(review.requestedAt)}`;
  const summaries = review.drafts
    .map((id) => drafts.find((d) => d.id === id)?.summary)
    .filter((s): s is string => Boolean(s));
  const publish = async () => {
    setBusy(true);
    try {
      const result = await cloud.drafts.publish(review.drafts);
      if (result.ok)
        onOutcome({ kind: 'published', commit: result.commit, count: review.drafts.length });
      else if (result.reason === 'conflict') {
        onOutcome({
          kind: 'refused',
          text: `Someone published ${result.conflicts.map((c) => c.path).join(', ')} since its draft began. Open it to compare the two.`,
        });
      } else onOutcome({ kind: 'refused', text: result.message });
    } catch (error) {
      onOutcome({ kind: 'refused', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };
  const askForChanges = async () => {
    setBusy(true);
    try {
      await cloud.drafts.answer(review.id, 'request-changes', text.trim());
      setOutcome(`Sent to ${review.requestedBy.name}.`);
      setAsking(false);
      setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article
      aria-label={titled}
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <p className="m-0 font-semibold">{titled}</p>
      <ul className="m-0 pl-6">
        {summaries.map((summary) => (
          <li key={summary}>{summary}</li>
        ))}
      </ul>
      {review.comments.map((comment) => (
        <p key={`${comment.at}-${comment.by.id}`} className="m-0 text-small">
          <span className="font-semibold">{comment.by.name}:</span> {comment.body}
        </p>
      ))}
      {outcome && (
        <p role="status" className="m-0 text-small text-content-muted">
          {outcome}
        </p>
      )}
      {asking ? (
        <div className="flex flex-col gap-2">
          <TextArea label="What should change?" value={text} onChange={setText} />
          <div className="flex flex-wrap gap-3">
            <Button
              isPending={busy}
              isDisabled={text.trim() === ''}
              onPress={() => void askForChanges()}
            >
              Send
            </Button>
            <Button
              variant="quiet"
              onPress={() => {
                setAsking(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button isPending={busy} onPress={() => void publish()}>
            Publish
          </Button>
          <Button
            variant="quiet"
            onPress={() => {
              setAsking(true);
            }}
          >
            Ask for changes
          </Button>
        </div>
      )}
    </article>
  );
}
