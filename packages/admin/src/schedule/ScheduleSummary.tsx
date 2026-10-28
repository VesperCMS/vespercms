import { scheduleTime, type CollectionManifest, type DataObject } from '@vespercms/core';
import { Button } from '@vespercms/ui';
import { useId } from 'react';
import { useEditor } from '../editor/context.tsx';
import { fieldId, pathKey } from '../editor/values.ts';
import { useNow } from './now.ts';
import { scheduleKeys, timesOf } from './times.ts';

/**
 * The schedule in Details (spec §6.17), in place of its raw fields: "Goes
 * live Sat, Oct 31, 8:00 AM · Comes down Sun, Nov 8, 12:00 AM", in the site's
 * zone, and Change schedule… to set the times in the Schedule dialog.
 */
export function ScheduleSummary({
  collection,
  values,
  zone,
  onChange,
}: {
  collection: CollectionManifest;
  values: DataObject;
  zone: string;
  onChange: () => void;
}) {
  const editor = useEditor();
  const id = useId();
  const schedule = collection.presentation.schedule;
  const times = timesOf(collection, values);
  const now = useNow();
  const later = (date: Date) => date.getTime() > now.getTime();
  const parts = [
    times.publishAt
      ? `${later(times.publishAt) ? 'Goes live' : 'Went live'} ${scheduleTime(times.publishAt, zone, now)}`
      : '',
    times.unpublishAt
      ? `${later(times.unpublishAt) ? 'Comes down' : 'Came down'} ${scheduleTime(times.unpublishAt, zone, now)}`
      : '',
    times.unpublishAt && times.redirect ? `then visitors go to ${times.redirect}` : '',
  ].filter(Boolean);
  // A refused save's problems with the times show here, where the times are.
  const problems = scheduleKeys(collection).flatMap(
    (key) => editor.issues.get(pathKey([key])) ?? [],
  );
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col items-start gap-2">
      <p id={id} className="m-0 text-label font-semibold text-content">
        Schedule
      </p>
      <p className="m-0">{parts.length > 0 ? parts.join(' · ') : 'Not scheduled.'}</p>
      {problems.length > 0 && <p className="m-0 text-small text-danger">{problems.join(' ')}</p>}
      {!editor.disabled && schedule && (
        // Its id is the time field's, so the error summary's links land here.
        <Button id={fieldId([schedule.publishAt])} onPress={onChange}>
          Change schedule…
        </Button>
      )}
    </div>
  );
}
