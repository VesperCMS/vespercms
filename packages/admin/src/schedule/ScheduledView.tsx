import {
  decodeData,
  encodeValue,
  scheduleTime,
  zoneName,
  type EntryDocument,
  type ScheduledChange,
} from '@vesper/core';
import { Link, Menu, Table, cx, type TableColumn } from '@vesper/ui';
import { useState } from 'react';
import { useStudio } from '../app/context.tsx';
import { useLoad } from '../app/load.ts';
import { entriesChanged } from '../app/entries-changed.ts';
import { hrefFor } from '../app/router.ts';
import { Screen } from '../app/Screen.tsx';
import { entryShownTo } from '../cloud/access.ts';
import { useNow } from './now.ts';
import { ScheduleDialog } from './ScheduleDialog.tsx';
import { siteZone, timesOf, withTimes, type ScheduleTimes } from './times.ts';

/*
 * The Scheduled view (spec §6.17, call 11): every change still to come
 * across the site, soonest first, read from the files in every mode. It's
 * a screen reached from Home's line and from a list's Scheduled filter,
 * never a navigation item. A row's "…" menu reschedules it, and cancels a
 * time to come down; a publish can't be cancelled where there are no
 * drafts to go back to (call 9), so it's rescheduled instead.
 */

const COLUMNS: TableColumn[] = [
  { id: 'at', label: 'When' },
  { id: 'entry', label: 'Entry', isRowHeader: true },
  { id: 'change', label: 'Change' },
  { id: 'collection', label: 'Collection' },
  { id: 'actions', label: 'Actions' },
];

type Row = ScheduledChange & { id: string; entryId: string };

export function ScheduledView() {
  const { api, manifest, cloud } = useStudio();
  const [load, reload] = useLoad(() => api.listScheduled(), 'scheduled');
  const { zone, isSite } = siteZone(manifest);
  const [editing, setEditing] = useState<{ row: Row; doc: EntryDocument } | null>(null);
  const [outcome, setOutcome] = useState('');
  const now = useNow();
  const rows: Row[] =
    load.state === 'ready'
      ? load.value
          .filter((change) => entryShownTo(cloud, change.path))
          .map((change) => ({
            ...change,
            entryId: change.id,
            id: `${change.collection}/${change.id}/${change.change}`,
          }))
      : [];
  const collectionOf = (name: string) => manifest.collections.find((c) => c.name === name);
  const mayChange = (row: Row) =>
    collectionOf(row.collection)?.editable === true && (cloud?.access(row.path).edit ?? true);

  /** Saves new times into the entry; in the cloud, publishes the draft where the member may. */
  const apply = async (row: Row, doc: EntryDocument, times: ScheduleTimes, done: string) => {
    const collection = collectionOf(row.collection);
    if (!collection) return;
    setOutcome('');
    const next = withTimes(collection, decodeData(doc.data), times);
    const result = await api.saveEntry({
      collection: row.collection,
      id: row.entryId,
      version: doc.version,
      data: encodeValue(next),
    });
    if (!result.ok) {
      setOutcome(
        `Nothing changed. ${'message' in result ? result.message : 'The entry has problems to fix in its editor first.'}`,
      );
      return;
    }
    let text = done;
    if (cloud) {
      await cloud.drafts.refresh();
      const draft = cloud.drafts.draftOf(result.path);
      if (draft && cloud.access(result.path).publish) {
        const published = await cloud.drafts.publish([draft.id]);
        if (!published.ok) text = `${done} It’s saved as a draft, not published yet.`;
      } else if (draft) text = `${done} It’s saved as a draft for review.`;
    }
    entriesChanged(row.collection);
    setOutcome(text);
    reload();
  };

  const open = async (row: Row) => {
    setOutcome('');
    try {
      setEditing({ row, doc: await api.readEntry(row.collection, row.entryId) });
    } catch (error) {
      setOutcome(error instanceof Error ? error.message : String(error));
    }
  };

  const editingCollection = editing ? collectionOf(editing.row.collection) : undefined;
  const editingTimes =
    editing && editingCollection ? timesOf(editingCollection, decodeData(editing.doc.data)) : {};

  return (
    <Screen title="Scheduled">
      <p className="mb-6 max-w-2xl text-content-muted">
        Changes still to come across the site, soonest first.{' '}
        {isSite
          ? `Times are in ${zoneName(zone)}, the site’s time zone.`
          : `Times are in your time zone, ${zoneName(zone)}.`}
      </p>
      {load.state === 'failed' && (
        <p role="alert" className="mb-6 text-danger">
          Couldn’t read what’s scheduled: {load.message}
        </p>
      )}
      <p role="status" className={cx('mb-6 max-w-2xl', !outcome && 'sr-only')}>
        {outcome}
      </p>
      {load.state === 'loading' ? (
        <p className="text-small text-content-muted">Reading the schedule…</p>
      ) : (
        <Table
          label="Scheduled changes"
          columns={COLUMNS}
          rows={rows}
          emptyState="Nothing is scheduled."
          renderCell={(row, column) => {
            if (column === 'at') return scheduleTime(new Date(row.at), zone, now);
            if (column === 'entry') {
              return (
                <Link
                  href={hrefFor({ screen: 'edit', collection: row.collection, id: row.entryId })}
                >
                  {row.title}
                </Link>
              );
            }
            if (column === 'change') return row.change === 'publish' ? 'Goes live' : 'Comes down';
            if (column === 'collection')
              return collectionOf(row.collection)?.label ?? row.collection;
            if (!mayChange(row)) return null;
            return (
              <Menu
                label={`Actions for ${row.title}, ${row.change === 'publish' ? 'going live' : 'coming down'}`}
                items={[
                  { id: 'reschedule', label: 'Reschedule…', icon: 'schedule' },
                  ...(row.change === 'unpublish'
                    ? [{ id: 'cancel', label: 'Cancel', icon: 'unschedule' as const }]
                    : []),
                ]}
                onAction={(action) => {
                  if (action === 'reschedule') void open(row);
                  if (action === 'cancel') {
                    void api.readEntry(row.collection, row.entryId).then((doc) => {
                      const collection = collectionOf(row.collection);
                      if (!collection) return;
                      const times = timesOf(collection, decodeData(doc.data));
                      return apply(
                        row,
                        doc,
                        { ...(times.publishAt ? { publishAt: times.publishAt } : {}) },
                        `“${row.title}” no longer comes down.`,
                      );
                    });
                  }
                }}
              />
            );
          }}
        />
      )}
      {editing && editingCollection && (
        <ScheduleDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          collection={editingCollection}
          initial={editingTimes}
          live={!(editingTimes.publishAt && editingTimes.publishAt.getTime() > now.getTime())}
          purpose="publish"
          nowLabel={api.publishesOnSave() ? 'Publish now' : 'Make it live now'}
          onSubmit={(times) => {
            const { row, doc } = editing;
            void apply(row, doc, times, `“${row.title}” is rescheduled.`);
          }}
          onNow={() => {
            const { row, doc } = editing;
            const { publishAt: _now, ...rest } = editingTimes;
            void apply(row, doc, rest, `“${row.title}” goes live at the next build.`);
          }}
        />
      )}
    </Screen>
  );
}

/**
 * "3 scheduled changes", linking to the Scheduled view: on Home, and among
 * panes at the top of the collections. Absent when nothing is scheduled.
 */
export function ScheduledLine({ className }: { className?: string }) {
  const { api, manifest, cloud } = useStudio();
  const scheduled = manifest.collections.some((c) => c.presentation.schedule);
  const [load] = useLoad(
    () => (scheduled ? api.listScheduled() : Promise.resolve([])),
    'scheduled-line',
  );
  const count =
    load.state === 'ready'
      ? load.value.filter((change) => entryShownTo(cloud, change.path)).length
      : 0;
  if (count === 0) return null;
  return (
    <p className={cx('m-0 text-small', className)}>
      <Link href={hrefFor({ screen: 'scheduled' })}>
        {count === 1 ? '1 scheduled change' : `${String(count)} scheduled changes`}
      </Link>
    </p>
  );
}
