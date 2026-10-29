import { useState, type FocusEvent, type KeyboardEvent } from 'react';

/*
 * Safari draws today's date and time, greyed, in an empty date field, and
 * editors took it for a time already chosen: "Comes down" looked set when it
 * wasn't (WebKit bug 233215). An empty field is drawn blank until it's
 * clicked or typed in, and blank again when it's left with nothing in it (studio.css
 * hides `::-webkit-datetime-edit` under `data-blank`). Chrome's
 * "mm/dd/yyyy" goes with it; the label says what goes there, and Firefox,
 * which draws neither, is unchanged.
 */

/** Keys that pass through or leave a field without starting to fill it in. */
const PASSING = new Set(['Tab', 'Shift', 'Escape', 'Enter', 'Meta', 'Control', 'Alt']);

/** Props for a `date` or `datetime-local` input whose value is `value`. */
export function useBlankWhenEmpty(value: string) {
  const [engaged, setEngaged] = useState(false);
  return {
    'data-blank': value === '' && !engaged ? '' : undefined,
    onPointerDown: () => {
      setEngaged(true);
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (!PASSING.has(event.key)) setEngaged(true);
    },
    // A date typed partway has no value yet, but its parts must stay in sight.
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      if (!event.currentTarget.validity.badInput) setEngaged(false);
    },
  };
}
