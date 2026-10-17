import type { FieldModel } from '../field-model.ts';

/**
 * What a widget receives (spec §6.3.3). The editor renders the label, the
 * description and the error message; the widget renders the control.
 *
 * A widget must:
 * - label its control through `id` (`<input id={id}>`, or `aria-labelledby`
 *   pointing at `${id}-label` for composite controls);
 * - forward `describedBy` to `aria-describedby` and `invalid` to
 *   `aria-invalid`;
 * - be keyboard operable.
 *
 * It must not validate: the editor validates with the site's Zod schema and
 * shows errors in the standard place.
 */
export type WidgetProps<T = unknown> = {
  /** The field's current value, or `undefined` when the entry has none. */
  value: T | undefined;
  /** Pass `undefined` to remove the key from the file. */
  onChange: (value: T | undefined) => void;
  field: FieldModel;
  /** The control's id. The editor's `<label>` points at it. */
  id: string;
  /** Ids of the description and error message, for `aria-describedby`. */
  describedBy: string | undefined;
  invalid: boolean;
  disabled: boolean;
};
