// @vitest-environment jsdom
import type { EntryDocument, SaveRequest, WidgetProps } from '@vesper/core';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const mainCampus: EntryDocument = {
  collection: 'locations',
  id: 'main-campus',
  path: 'src/data/locations.yaml',
  version: 'entry:1',
  format: 'yaml',
  status: 'editable',
  data: {
    id: 'main-campus',
    name: 'Main campus',
    address: '100 College Drive',
    geo: { lat: 36.69, lng: -81.97 },
    color: '#28335f',
    open: true,
    hours: [{ days: 'Mon–Fri', opens: '07:30', closes: '22:00' }],
  },
};

type Row = { days: string; opens: string; closes: string };

/** A tiny widget that follows the contract: the first control takes `id`. */
function FirstDays({ value, onChange, id, describedBy, invalid }: WidgetProps<Row[]>) {
  const rows = value ?? [];
  return (
    <input
      id={id}
      value={rows[0]?.days ?? ''}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        onChange([
          { ...(rows[0] ?? { opens: '09:00', closes: '17:00' }), days: event.target.value },
        ]);
      }}
    />
  );
}

describe('custom widgets', () => {
  it('render for the fields they claim, labelled by the editor, and save through onChange', async () => {
    const api = fakeApi({ documents: { 'locations/main-campus': mainCampus } });
    renderStudio('#/c/locations/e/main-campus', {
      api,
      widgets: { 'store-hours': () => Promise.resolve({ default: FirstDays }) },
    });
    const user = userEvent.setup();
    const days = await screen.findByRole('textbox', { name: 'Hours' });
    expect(days).toHaveValue('Mon–Fri');
    await user.clear(days);
    await user.type(days, 'Weekdays');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saveEntry).toHaveBeenCalled();
    });
    const request = api.saveEntry.mock.calls[0]?.[0] as SaveRequest & { data: { hours: Row[] } };
    expect(request.data.hours).toEqual([{ days: 'Weekdays', opens: '07:30', closes: '22:00' }]);
    await expectNoViolations();
  });

  it('fall back to the built-in control, with a note, when they fail to load', async () => {
    renderStudio('#/c/locations/e/main-campus', {
      api: fakeApi({ documents: { 'locations/main-campus': mainCampus } }),
      widgets: { 'store-hours': () => Promise.reject(new Error('Syntax error in StoreHours.tsx')) },
    });
    expect(await screen.findByText(/The “store-hours” control couldn’t load/)).toBeInTheDocument();
    // The list editor the field's type implies.
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument();
  });
});
