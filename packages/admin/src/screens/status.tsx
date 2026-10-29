import {
  scheduleState,
  type CollectionManifest,
  type DataValue,
  type Draft,
  type EntryStatus,
} from '@vespercms/core';
import { StatusPill, type StatusTone } from '@vespercms/ui';

/*
 * An entry's state as one coloured word and the words after it (DECISIONS.md,
 * "Status words have colour"): Draft, Scheduled, Live or Unpublished. The
 * words are the ones the studio already said; only the first takes a colour,
 * so what a screen reader hears, and what type-ahead matches, is unchanged.
 */

export type EntryState = {
  tone: StatusTone;
  /** "Draft", "Scheduled", "Live" or "Unpublished". */
  word: string;
  /** What follows the word, its joiner included: " · Sat, Oct 31, 8:00 AM". */
  rest: string;
};

/**
 * What an entry is now. `times` is the entry's data with its schedule's
 * fields, or null where they aren't known (a page tree's rows), which then
 * never claims Live. Live is said only where an entry could be something
 * else: a collection with a schedule or a `draft` field, or any in the cloud,
 * where a new entry starts as a draft. Elsewhere every entry is live, and
 * saying so on every row would only be noise.
 */
export function entryState(
  collection: CollectionManifest,
  entry: { draft: boolean; times: DataValue | null; newDraft?: boolean },
  options: { zone: string; cloud: boolean; now?: Date },
): EntryState | null {
  const schedule =
    entry.times === null
      ? null
      : scheduleState(
          collection.presentation.schedule,
          entry.times,
          options.now ?? new Date(),
          options.zone,
        );
  if (entry.draft) {
    return {
      tone: 'neutral',
      word: 'Draft',
      rest: schedule ? ` · ${schedule.word}${schedule.rest}` : '',
    };
  }
  if (schedule) {
    return {
      tone:
        schedule.phase === 'scheduled'
          ? 'scheduled'
          : schedule.phase === 'live'
            ? 'live'
            : 'neutral',
      word: schedule.word,
      rest: schedule.rest,
    };
  }
  if (entry.newDraft) return { tone: 'neutral', word: 'Draft', rest: '' };
  const couldBeOther =
    options.cloud ||
    collection.presentation.schedule !== undefined ||
    (collection.fields ?? []).some((field) => field.path.length === 1 && field.path[0] === 'draft');
  if (entry.times === null && collection.presentation.schedule !== undefined) return null;
  return couldBeOther ? { tone: 'live', word: 'Live', rest: '' } : null;
}

/** Whether a file is in a draft that would create it: in the cloud, an entry never published. */
export function isNewInDraft(drafts: readonly Draft[], path: string | undefined): boolean {
  return (
    path !== undefined &&
    drafts.some((draft) =>
      draft.files.some((file) => file.path === path && file.op === 'put' && file.base === null),
    )
  );
}

/** "Read only" or "Edit as YAML": what can be done with the entry, after its state. */
export function kindText(status: EntryStatus | undefined): string {
  return status === 'read-only' ? 'Read only' : status === 'source-only' ? 'Edit as YAML' : '';
}

/** The state as plain words, for names and type-ahead. */
export function stateText(state: EntryState | null): string {
  return state ? `${state.word}${state.rest}` : '';
}

/** The state's word on its colour, then the words after it as text. */
export function StateWords({ state }: { state: EntryState | null }) {
  if (!state) return null;
  return (
    <>
      <StatusPill tone={state.tone}>{state.word}</StatusPill>
      {state.rest}
    </>
  );
}
