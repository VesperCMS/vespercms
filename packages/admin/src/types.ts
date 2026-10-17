import type { FieldModel, Manifest } from '@vesper/core';
import type { ComponentType } from 'react';
import type { StudioApi } from './app/api.ts';

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

// Widgets are registered by name and receive values of many shapes, so the
// registry's component type can't be narrower than this.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WidgetComponent = ComponentType<WidgetProps<any>>;

/** A custom widget from vesper.config.ts, loaded only when a field uses it. */
export type WidgetLoader = () => Promise<{ default: WidgetComponent }>;

export type StudioOptions = {
  manifest: Manifest;
  /**
   * The storage back end, or `null` when this build has none yet: a deployed
   * site before GitHub mode (Phase 3). The studio then explains where to edit.
   */
  api: StudioApi | null;
  /** Custom widgets by name (spec §6.3.3). */
  widgets?: Record<string, WidgetLoader>;
  /** Shown in the top bar and the page title. */
  siteName?: string;
  /** The site's home page, for "View site". */
  siteUrl?: string;
};
