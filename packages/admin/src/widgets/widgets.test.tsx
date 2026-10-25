// @vitest-environment jsdom
import type { CollectionManifest, EntryDocument, Manifest, SaveRequest } from '@vesper/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

function doc(collection: string, id: string, data: Record<string, unknown>): EntryDocument {
  return {
    collection,
    id,
    path: `src/content/${collection}/${id}.md`,
    version: 'v1',
    format: 'md',
    status: 'editable',
    data,
    body: '\n',
  };
}

async function save(user: ReturnType<typeof userEvent.setup>, api: ReturnType<typeof fakeApi>) {
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(api.saveEntry).toHaveBeenCalled();
  });
  return api.saveEntry.mock.calls.at(-1)?.[0] as SaveRequest & { data: Record<string, unknown> };
}

describe('color', () => {
  it('edits the hex value as text, with a picker beside it', async () => {
    const api = fakeApi({
      documents: {
        'locations/main': doc('locations', 'main', {
          name: 'Main campus',
          address: '1 College Way',
          geo: { lat: 36.69, lng: -81.97 },
          color: '#28335f',
          open: true,
        }),
      },
    });
    renderStudio('#/c/locations/e/main', { api });
    const user = userEvent.setup();
    const hex = await screen.findByRole('textbox', { name: 'Map pin color' });
    expect(hex).toHaveValue('#28335f');
    expect(screen.getByLabelText('Pick map pin color from a colour picker')).toHaveValue('#28335f');
    await user.clear(hex);
    await user.type(hex, '#1A73E8');
    expect((await save(user, api)).data.color).toBe('#1A73E8');
  });

  it('offers a palette as named swatches', async () => {
    const manifest = withField('settings', 'brandColor', {
      widgetOptions: { palette: { Indigo: '#28335f', Rust: '#b5462a' } },
    });
    const api = fakeApi({
      documents: {
        'settings/site': doc('settings', 'site', { siteName: 'X', brandColor: '#28335f' }),
      },
    });
    renderStudio('#/c/settings/e/site', { api, manifest });
    const user = userEvent.setup();
    const group = await screen.findByRole('radiogroup', { name: 'Brand color' });
    expect(within(group).getByRole('radio', { name: 'Indigo (#28335f)' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Rust (#b5462a)' }));
    expect((await save(user, api)).data.brandColor).toBe('#b5462a');
  });
});

describe('geo', () => {
  it('uses two number fields as the real controls, and the map is optional', async () => {
    const api = fakeApi({
      documents: {
        'locations/main': doc('locations', 'main', {
          name: 'Main campus',
          address: '1 College Way',
          geo: { lat: 36.69, lng: -81.97 },
          color: '#28335f',
          open: true,
        }),
      },
    });
    renderStudio('#/c/locations/e/main', { api });
    const user = userEvent.setup();
    const geo = await screen.findByRole('group', { name: 'Map location' });
    const lat = within(geo).getByRole('spinbutton', { name: 'Latitude' });
    expect(lat).toHaveValue(36.69);
    expect(lat).toHaveAccessibleDescription('−90 to 90, north is positive');
    await user.clear(lat);
    await user.type(lat, '-33.8568');
    expect((await save(user, api)).data.geo).toEqual({ lat: -33.8568, lng: -81.97 });
    expect(within(geo).getByRole('button', { name: 'Show on a map' })).toBeInTheDocument();
    await expectNoViolations();
  });
});

describe('date and time', () => {
  it('shows and enters times in the site’s time zone, keeping the right offset across DST', async () => {
    const api = fakeApi({
      documents: {
        'events/concert': doc('events', 'concert', {
          title: 'Harvest concert',
          summary: 'Music.',
          startsAt: { $date: '2026-10-24T14:00:00.000Z' },
        }),
      },
    });
    renderStudio('#/c/events/e/concert', { api });
    const user = userEvent.setup();
    const starts = await screen.findByLabelText('Starts at');
    // 14:00 UTC is 10:00 in New York in October (EDT, -04:00).
    expect(starts).toHaveValue('2026-10-24T10:00');
    expect(starts).toHaveAccessibleDescription('Times are in Eastern Time, the site’s time zone.');

    await user.clear(starts);
    await user.type(starts, '2026-11-07T10:00');
    // After the clocks change, 10:00 in New York is -05:00.
    expect((await save(user, api)).data.startsAt).toEqual({ $date: '2026-11-07T10:00:00-05:00' });
  });
});

describe('references', () => {
  const blogEntries = [
    {
      id: 'harbor-at-dawn',
      path: 'a',
      title: 'Harbor at dawn',
      status: 'editable' as const,
      fields: {},
    },
    {
      id: 'welcome',
      path: 'b',
      title: 'Welcome to the playground',
      status: 'editable' as const,
      fields: {},
    },
    {
      id: 'notes-from-the-field',
      path: 'c',
      title: 'Notes from the field',
      status: 'editable' as const,
      fields: {},
    },
  ];

  it('picks one entry by title and stores its ID', async () => {
    const api = fakeApi({
      entries: {
        locations: [
          { id: 'main', path: 'x', title: 'Main campus', status: 'editable', fields: {} },
        ],
      },
      documents: {
        'events/concert': doc('events', 'concert', {
          title: 'Harvest concert',
          summary: 'Music.',
          startsAt: { $date: '2026-10-24T14:00:00.000Z' },
        }),
      },
    });
    renderStudio('#/c/events/e/concert', { api });
    const user = userEvent.setup();
    const location = await screen.findByRole('combobox', { name: 'Location (optional)' });
    await user.click(location);
    await user.click(await screen.findByRole('option', { name: 'Main campus' }));
    expect((await save(user, api)).data.location).toBe('main');
  });

  it('keeps several in order, never offers the entry itself, and moves them by keyboard', async () => {
    const api = fakeApi({
      entries: { blog: blogEntries, authors: [] },
      documents: {
        'blog/harbor-at-dawn': doc('blog', 'harbor-at-dawn', {
          title: 'Harbor at dawn',
          summary: 'Boats.',
          author: 'ada',
          related: ['welcome'],
          category: 'stories',
          publishedAt: { $date: '2026-09-14T00:00:00.000Z' },
        }),
      },
    });
    renderStudio('#/c/blog/e/harbor-at-dawn', { api });
    const user = userEvent.setup();
    const related = await screen.findByRole('group', { name: 'Related (optional)' });
    expect(await within(related).findByText('Welcome to the playground')).toBeInTheDocument();

    await user.click(within(related).getByRole('combobox'));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Notes from the field']);
    await user.click(options[0] as HTMLElement);
    // Close the list, which hides the rest of the page from assistive tech while open.
    await user.keyboard('{Escape}');
    await user.click(within(related).getByRole('button', { name: 'Move Notes from the field up' }));
    expect((await save(user, api)).data.related).toEqual(['notes-from-the-field', 'welcome']);
  });
});

describe('slug', () => {
  it('follows the title on a new entry until edited by hand', async () => {
    const manifest = withField('authors', 'handle', { widgetOptions: { from: 'name' } });
    const api = fakeApi();
    renderStudio('#/c/authors/new', { api, manifest });
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Ada Moreno');
    // The slug waits in Details.
    await user.click(screen.getByRole('button', { name: 'Details' }));
    const handle = screen.getByRole('textbox', { name: 'Handle (optional)' });
    expect(handle).toHaveValue('ada-moreno');
    expect(handle).toHaveAccessibleDescription('Follows the name until you edit it.');
    await user.type(handle, '-1');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' Jr');
    expect(handle).toHaveValue('ada-moreno-1');
  });
});

describe('url', () => {
  it('offers to open the address, named for screen readers', async () => {
    const api = fakeApi({
      documents: {
        'authors/ada': {
          ...doc('authors', 'ada', {
            name: 'Ada',
            email: 'ada@example.com',
            url: 'https://example.com/ada',
          }),
          format: 'json',
        },
      },
    });
    renderStudio('#/c/authors/e/ada', { api });
    expect(
      await screen.findByRole('link', { name: 'Open https://example.com/ada in a new tab' }),
    ).toHaveAttribute('target', '_blank');
  });
});

/** The playground manifest with extra field model keys on one top-level field. */
function withField(collection: string, key: string, extra: Record<string, unknown>): Manifest {
  return {
    ...playgroundManifest,
    collections: playgroundManifest.collections.map((c): CollectionManifest =>
      c.name !== collection
        ? c
        : {
            ...c,
            fields: (c.fields ?? []).map((f) => (f.path[0] === key ? { ...f, ...extra } : f)),
          },
    ),
  };
}
