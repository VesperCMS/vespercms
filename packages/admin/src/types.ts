import type { Manifest, WidgetProps } from '@vesper/core';
import type { ComponentType } from 'react';
import type { StudioApi } from './app/api.ts';

/** What a widget receives (spec §6.3.3); defined in core so sites can type widgets without the studio. */
export type { WidgetProps };

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
  /**
   * Loads declared MDX components' Zod props schemas from vesper.config.ts,
   * so props are checked exactly as the site checks them (spec §6.5.2). On
   * first use: Zod stays out of the studio's first load.
   */
  loadMdxProps?: () => Promise<Record<string, unknown>>;
  /** Shown in the top bar and the page title. */
  siteName?: string;
  /** The site's home page, for "View site". */
  siteUrl?: string;
};
