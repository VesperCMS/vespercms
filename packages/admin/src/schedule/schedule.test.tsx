// @vitest-environment jsdom
import type { EntryDocument, EntrySummary, Manifest, ScheduledChange } from '@vesper/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';
import { dstNote } from './ScheduleDialog.tsx';

/*
 * Scheduling in the studio (spec §6.17; PLAN.md, Phase 4.5's step 3): the
 * schedule's words in the lists and the editor's bar, Publish ▾, the
 * Schedule dialog and its checks, the schedule in Details, and the
 * Scheduled view. The playground's events, in its zone (America/New_York),
 * on 26 October 2026; only Date is faked, so timers run as usual.
 */

const NY = 'America/New_York';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T16:00:00Z') });
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.useRealTimers();
});

const doc = (id: string, data: Record<string, unknown>): EntryDocument => ({
  collection: 'events',
  id,
  path: `src/content/events/${id}.md`,
  version: 'v1',
  format: 'md',
  status: 'editable',
  data: { summary: 'An event.', startsAt: { $date: '2026-11-07T00:00:00.000Z' }, ...data },
  body: '\nText.\n',
});
const concert = doc('harvest-concert', {
  title: 'Harvest concert',
  publishAt: { $date: '2026-10-31T08:00:00-04:00' },
});
const session = doc('nursing-info-session', {
  title: 'Nursing information session',
  unpublishAt: { $date: '2026-11-13T00:00:00-05:00' },
  unpublishRedirect: '/academics/nursing/',
});
const commencement = doc('spring-commencement', { title: 'Spring commencement' });

const row = (d: EntryDocument, schedule?: EntrySummary['schedule']): EntrySummary => ({
  id: d.id,
  path: d.path,
  title: (d.data as { title: string }).title,
  status: 'editable',
  fields: {},
  ...(schedule ? { schedule } : {}),
});
const changes: ScheduledChange[] = [
  {
    at: '2026-10-31T12:00:00.000Z',
    change: 'publish',
    collection: 'events',
    id: 'harvest-concert',
    path: concert.path,
    title: 'Harvest concert',
  },
  {
    at: '2026-11-13T05:00:00.000Z',
    change: 'unpublish',
    collection: 'events',
    id: 'nursing-info-session',
    path: session.path,
    title: 'Nursing information session',
  },
];

function setup(hash: string, manifest: Manifest = playgroundManifest) {
  const api = fakeApi({
    entries: {
      events: [
        row(concert, { publishAt: '2026-10-31T12:00:00.000Z' }),
        row(session, { unpublishAt: '2026-11-13T05:00:00.000Z' }),
        row(commencement),
      ],
    },
    documents: {
      'events/harvest-concert': concert,
      'events/nursing-info-session': session,
      'events/spring-commencement': commencement,
    },
    scheduled: changes,
  });
  const user = userEvent.setup();
  return { ...renderStudio(hash, { api, manifest }), api, user };
}

const savedData = (api: ReturnType<typeof fakeApi>) =>
  api.saveEntry.mock.calls.at(-1)?.[0].data as Record<string, unknown> | undefined;

const setTime = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
};

describe('the schedule in words', () => {
  it('says each entry’s schedule in the list, and filters to what’s scheduled', async () => {
    const { user } = setup('#/c/events');
    const table = await screen.findByRole('grid', { name: 'Events' });
    expect(await within(table).findByRole('row', { name: /^Harvest concert/ })).toHaveTextContent(
      'Scheduled · Sat, Oct 31, 8:00 AM',
    );
    expect(
      within(table).getByRole('row', { name: /^Nursing information session/ }),
    ).toHaveTextContent('Live until Fri, Nov 13, 12:00 AM');
    await user.click(screen.getByRole('button', { name: /All entries/ }));
    await user.click(await screen.findByRole('option', { name: 'Scheduled' }));
    await waitFor(() => {
      // The header row, then the two scheduled events.
      expect(within(table).getAllByRole('row')).toHaveLength(3);
    });
    expect(screen.getByRole('link', { name: 'Everything scheduled on the site' })).toHaveAttribute(
      'href',
      '#/scheduled',
    );
    await expectNoViolations();
  });

  it('heads the editor’s status with the schedule', async () => {
    setup('#/c/events/e/harvest-concert');
    await screen.findByRole('textbox', { name: 'Title' });
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Scheduled · Sat, Oct 31, 8:00 AM');
  });
});

describe('the Scheduled view', () => {
  it('is linked from the collections, and lists every change soonest first', async () => {
    const { user } = setup('#/');
    await user.click(await screen.findByRole('link', { name: '2 scheduled changes' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/scheduled');
    });
    const table = await screen.findByRole('grid', { name: 'Scheduled changes' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Sat, Oct 31, 8:00 AMHarvest concertGoes liveEvents/),
      expect.stringMatching(/^Fri, Nov 13, 12:00 AMNursing information sessionComes downEvents/),
    ]);
    expect(
      screen.getByText(/Times are in Eastern Time, the site’s time zone\./),
    ).toBeInTheDocument();
    await expectNoViolations();
  });

  it('cancels a time to come down, and reschedules a publish from the dialog', async () => {
    const { api, user } = setup('#/scheduled');
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Nursing information session, coming down',
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
    });
    expect(savedData(api)).not.toHaveProperty('unpublishAt');
    expect(savedData(api)).not.toHaveProperty('unpublishRedirect');
    expect(
      await screen.findByText('“Nursing information session” no longer comes down.'),
    ).toBeInTheDocument();

    // A publish is only rescheduled: there's no draft to go back to.
    await user.click(
      screen.getByRole('button', { name: 'Actions for Harvest concert, going live' }),
    );
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Reschedule…']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Reschedule…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule' });
    const live = within(dialog).getByLabelText('Goes live');
    expect(live).toHaveValue('2026-10-31T08:00');
    setTime(live, '2026-11-02T09:00');
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(2);
    });
    expect(savedData(api)?.publishAt).toEqual({ $date: '2026-11-02T09:00:00-05:00' });
  });
});

describe('Publish ▾ and the Schedule dialog', () => {
  it('offers Schedule… and going live now for an entry waiting to go live', async () => {
    const { api, user } = setup('#/c/events/e/harvest-concert');
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'More ways to publish' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Schedule…', 'Make it live now']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Make it live now' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
    });
    expect(savedData(api)).not.toHaveProperty('publishAt');
  });

  it('checks the times, and says what a daylight-saving change does to them', async () => {
    const { api, user } = setup('#/c/events/e/harvest-concert');
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'More ways to publish' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Schedule…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule' });
    expect(
      within(dialog).getByText('Times are in Eastern Time, the site’s time zone.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Goes live the next time the site is built after Sat, Oct 31, 8:00 AM.',
      ),
    ).toBeInTheDocument();
    await expectNoViolations(dialog);

    const live = within(dialog).getByLabelText('Goes live');
    const down = within(dialog).getByLabelText('Comes down (optional)');
    setTime(live, '2026-10-01T08:00');
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(live).toHaveAccessibleDescription(/That time has passed\./);
    expect(
      within(dialog).getByRole('button', { name: 'Make it live now instead' }),
    ).toBeInTheDocument();

    setTime(live, '2026-11-20T09:00');
    setTime(down, '2026-11-19T09:00');
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(down).toHaveAccessibleDescription(
      /It comes down before it goes live\. Choose a later time\./,
    );
    expect(api.saveEntry).not.toHaveBeenCalled();

    setTime(live, '2027-03-14T02:30');
    expect(live).toHaveAccessibleDescription(
      /2:30 AM doesn’t happen on Sun, Mar 14, 2027; this is 3:30 AM\./,
    );
    setTime(down, '2027-03-21T09:00');
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
    });
    expect(savedData(api)).toMatchObject({
      publishAt: { $date: '2027-03-14T03:30:00-04:00' },
      unpublishAt: { $date: '2027-03-21T09:00:00-04:00' },
    });
  });

  it('says how often the site rebuilds, where the site says', async () => {
    const manifest = {
      ...playgroundManifest,
      site: { ...playgroundManifest.site, rebuildEvery: 60 },
    };
    const { user } = setup('#/c/events/e/harvest-concert', manifest);
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'More ways to publish' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Schedule…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule' });
    expect(
      within(dialog).getByText(
        'Goes live at the first rebuild after Sat, Oct 31, 8:00 AM. This site rebuilds every hour.',
      ),
    ).toBeInTheDocument();
  });

  it('sets only when a live entry comes down, and cancels that from the menu', async () => {
    const { api, user } = setup('#/c/events/e/nursing-info-session');
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'More ways to publish' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Schedule…', 'Cancel schedule']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Schedule…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule' });
    expect(within(dialog).queryByLabelText('Goes live')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Comes down (optional)')).toHaveValue('2026-11-13T00:00');
    expect(within(dialog).getByRole('textbox', { name: /Then send visitors to/ })).toHaveValue(
      '/academics/nursing/',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'More ways to publish' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel schedule' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalledTimes(1);
    });
    expect(savedData(api)).not.toHaveProperty('unpublishAt');
    expect(savedData(api)).not.toHaveProperty('unpublishRedirect');
  });
});

describe('the schedule in Details', () => {
  it('shows the times in words, and Change schedule… sets them without saving', async () => {
    const { api, user } = setup('#/c/events/e/nursing-info-session');
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    const group = await screen.findByRole('group', { name: 'Schedule' });
    expect(group).toHaveTextContent(
      'Comes down Fri, Nov 13, 12:00 AM · then visitors go to /academics/nursing/',
    );
    // The raw fields give way to the summary.
    expect(screen.queryByRole('textbox', { name: /Unpublish redirect/ })).not.toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Change schedule…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change schedule' });
    setTime(within(dialog).getByLabelText('Comes down (optional)'), '2026-11-20T17:00');
    await user.click(within(dialog).getByRole('button', { name: 'Change schedule' }));
    await waitFor(() => {
      expect(group).toHaveTextContent('Comes down Fri, Nov 20, 5:00 PM');
    });
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Unsaved changes');
    expect(api.saveEntry).not.toHaveBeenCalled();
    await expectNoViolations();
  });
});

describe('dstNote', () => {
  it('names the first of a repeated time by its zone', () => {
    expect(dstNote('2026-11-01T01:30', NY, new Date('2026-10-26T16:00:00Z'))).toBe(
      '1:30 AM happens twice that night; this is the first, EDT.',
    );
    expect(dstNote('2026-11-01T03:30', NY, new Date('2026-10-26T16:00:00Z'))).toBeNull();
  });
});
