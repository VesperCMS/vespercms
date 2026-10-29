import {
  fromWallTime,
  isRepeatedTime,
  scheduleDay,
  scheduleTime,
  wallTime,
  zoneName,
  type CollectionManifest,
} from '@vespercms/core';
import { Button, Dialog, TextField, cx } from '@vespercms/ui';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStudio } from '../app/context.tsx';
import { useDrafts } from '../cloud/editor.tsx';
import { ChoosePageButton } from '../editor/PagePicker.tsx';
import { inputClass } from '../widgets/basic.tsx';
import { useBlankWhenEmpty } from '../widgets/blank-date.ts';
import { cloudKeepsTime } from './cloud.ts';
import { useNow } from './now.ts';
import { everyText, redirectField, siteZone, type ScheduleTimes } from './times.ts';

/*
 * Schedule… (spec §6.17; DECISIONS.md, "Where scheduling lives in the
 * studio"): when an entry goes live and when it comes down, in the site's
 * time zone, and where visitors go then. One line says how exact the time
 * is, since the site changes only when it's built.
 */

export type ScheduleDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  collection: CollectionManifest;
  initial: ScheduleTimes;
  /** Already live: only when it comes down can be set (call 8). */
  live: boolean;
  /**
   * `publish`: Schedule… from Publish ▾, which saves or publishes with the
   * times. `set`: Change schedule… from Details, which only sets them.
   */
  purpose: 'publish' | 'set';
  /** What going live without a time is called here: "Publish now", or "Save now" in local mode. */
  nowLabel: string;
  onSubmit: (times: ScheduleTimes) => void;
  /** Goes live now instead, when the chosen time has passed. */
  onNow?: () => void;
};

export function ScheduleDialog(props: ScheduleDialogProps) {
  return (
    <Dialog
      title={props.purpose === 'publish' ? 'Schedule' : 'Change schedule'}
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
    >
      {(close) => <ScheduleForm {...props} onClose={close} />}
    </Dialog>
  );
}

type Problems = { publishAt?: string; unpublishAt?: string };

function ScheduleForm({
  collection,
  initial,
  live,
  purpose,
  nowLabel,
  onSubmit,
  onNow,
  onClose,
}: ScheduleDialogProps & { onClose: () => void }) {
  const { manifest, account, cloud } = useStudio();
  const cloudSchedule = useDrafts().schedule;
  const { zone, isSite } = siteZone(manifest);
  const schedule = collection.presentation.schedule;
  const redirect = redirectField(collection);
  const [goesLive, setGoesLive] = useState(() =>
    initial.publishAt ? wallTime(initial.publishAt, zone) : '',
  );
  const [comesDown, setComesDown] = useState(() =>
    initial.unpublishAt ? wallTime(initial.unpublishAt, zone) : '',
  );
  const [sendTo, setSendTo] = useState(initial.redirect ?? '');
  const [problems, setProblems] = useState<Problems>({});
  const form = useRef<HTMLFormElement>(null);
  // The first time is what the dialog is for. Before React Aria's dialog
  // effect, which then finds focus inside and leaves it, as the crop dialog does.
  useLayoutEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.focus();
  }, []);
  const ids = { zone: useId(), live: useId(), down: useId(), accuracy: useId() };
  const now = useNow();
  const publishAt = !live && goesLive ? fromWallTime(goesLive, zone) : null;
  const unpublishAt = schedule?.unpublish && comesDown ? fromWallTime(comesDown, zone) : null;

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const found: Problems = {};
    if (!live && purpose === 'publish' && !publishAt) found.publishAt = 'Choose when it goes live.';
    else if (publishAt && publishAt.getTime() <= now.getTime())
      found.publishAt = 'That time has passed.';
    if (unpublishAt && unpublishAt.getTime() <= now.getTime())
      found.unpublishAt = 'That time has passed.';
    else if (unpublishAt && publishAt && unpublishAt.getTime() <= publishAt.getTime())
      found.unpublishAt = 'It comes down before it goes live. Choose a later time.';
    setProblems(found);
    if (found.publishAt || found.unpublishAt) return;
    onSubmit({
      ...(live
        ? initial.publishAt
          ? { publishAt: initial.publishAt }
          : {}
        : publishAt
          ? { publishAt }
          : {}),
      ...(unpublishAt ? { unpublishAt } : {}),
      ...(unpublishAt && sendTo.trim() ? { redirect: sendTo.trim() } : {}),
    });
    onClose();
  };

  // How exact the first time is: the site changes only when it's built,
  // unless the cloud rebuilds at the time or publishes held drafts then.
  const first = publishAt ?? unpublishAt;
  const verb = publishAt ? 'Goes live' : 'Comes down';
  const rebuild = manifest.site.rebuildEvery;
  const accuracy = first
    ? cloudKeepsTime(cloudSchedule, publishAt ? 'publish' : 'unpublish')
      ? `${verb} at ${scheduleTime(first, zone, now)}.`
      : rebuild
        ? `${verb} at the first rebuild after ${scheduleTime(first, zone, now)}. This site rebuilds ${everyText(rebuild)}.`
        : `${verb} the next time the site is built after ${scheduleTime(first, zone, now)}.`
    : null;
  const name = zoneName(zone, first ?? now);
  // Who can read it before then: the cloud says when it holds drafts, GitHub when the repository is public.
  const early = !publishAt
    ? null
    : cloudSchedule?.holdScheduledDrafts
      ? 'Vesper keeps it as a draft until then, and publishes it at that time.'
      : (cloudSchedule?.publicRepository ?? (!cloud && account?.publicRepository))
        ? `This site’s repository is public, so anyone can read this there before it goes live.${cloudSchedule ? ' A site admin can have Vesper keep scheduled changes until their time.' : ''}`
        : null;

  return (
    <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-6">
      <p id={ids.zone} className="m-0 text-small text-content-muted">
        {isSite
          ? `Times are in ${name}, the site’s time zone.`
          : `Times are in your time zone, ${name}.`}
      </p>
      {!live && (
        <TimeField
          id={ids.live}
          label={purpose === 'publish' ? 'Goes live' : 'Goes live (optional)'}
          value={goesLive}
          onChange={setGoesLive}
          zone={zone}
          now={now}
          describedBy={`${ids.zone} ${ids.accuracy}`}
          problem={problems.publishAt}
          action={
            problems.publishAt === 'That time has passed.' && onNow ? (
              <Button
                variant="quiet"
                onPress={() => {
                  onNow();
                  onClose();
                }}
              >
                {`${nowLabel} instead`}
              </Button>
            ) : null
          }
        />
      )}
      {schedule?.unpublish && (
        <TimeField
          id={ids.down}
          label="Comes down (optional)"
          value={comesDown}
          onChange={setComesDown}
          zone={zone}
          now={now}
          describedBy={`${ids.zone} ${ids.accuracy}`}
          problem={problems.unpublishAt}
        />
      )}
      {redirect && schedule?.unpublish && (
        <div className="flex flex-col gap-2">
          <TextField
            label="Then send visitors to (optional)"
            description="A page on this site, or a full address. Without one, the page’s address is simply gone."
            value={sendTo}
            onChange={setSendTo}
            inputClassName="font-mono"
          />
          <ChoosePageButton fieldLabel="Then send visitors to" onPick={setSendTo} />
        </div>
      )}
      {accuracy && (
        <p id={ids.accuracy} className="m-0 text-small">
          {accuracy}
        </p>
      )}
      {early && <p className="m-0 text-small">{early}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <Button onPress={onClose}>Cancel</Button>
        <Button variant="primary" type="submit">
          {purpose === 'publish' ? 'Schedule' : 'Change schedule'}
        </Button>
      </div>
    </form>
  );
}

/** A date and time in the site's zone, with what a DST change does to it said beside it. */
function TimeField({
  id,
  label,
  value,
  onChange,
  zone,
  now,
  describedBy,
  problem,
  action,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  zone: string;
  now: Date;
  describedBy: string;
  problem?: string | undefined;
  action?: ReactNode;
}) {
  const note = value ? dstNote(value, zone, now) : null;
  const blank = useBlankWhenEmpty(value);
  const described = [describedBy, note ? `${id}-note` : '', problem ? `${id}-problem` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-label font-semibold text-content">
        {label}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        {...blank}
        aria-describedby={described}
        aria-invalid={problem ? true : undefined}
        className={cx(inputClass, 'max-w-64')}
      />
      {note && (
        <p id={`${id}-note`} className="m-0 text-small text-content-muted">
          {note}
        </p>
      )}
      {problem && (
        <p
          id={`${id}-problem`}
          className="m-0 flex flex-wrap items-center gap-x-3 text-small text-danger"
        >
          {problem}
          {action}
        </p>
      )}
    </div>
  );
}

/** "2:30 AM" from a wall time's own text. */
function clockOf(wall: string): string {
  const [hours = 0, minutes = 0] = (wall.split('T')[1] ?? '').split(':').map(Number);
  return `${String(hours % 12 || 12)}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/**
 * What a daylight-saving change does to a wall time: a skipped one moves
 * forward ("2:30 AM doesn't happen on Sun, Mar 14; this is 3:30 AM."), and
 * a repeated one is the first ("1:30 AM happens twice that night; this is
 * the first, EDT.").
 */
export function dstNote(wall: string, zone: string, now: Date): string | null {
  const instant = fromWallTime(wall, zone);
  if (!instant) return null;
  const actual = wallTime(instant, zone);
  if (actual !== wall.slice(0, 16)) {
    return `${clockOf(wall)} doesn’t happen on ${scheduleDay(instant, zone, now)}; this is ${clockOf(actual)}.`;
  }
  if (isRepeatedTime(instant, zone)) {
    const short = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value;
    return `${clockOf(wall)} happens twice that night; this is the first${short ? `, ${short}` : ''}.`;
  }
  return null;
}
