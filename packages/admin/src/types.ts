import type { Manifest, UrlEntry, WidgetProps } from '@vespercms/core';
import type { CloudConnection } from './cloud/connection.ts';
import type { CloudSettings } from './cloud/session.ts';
import type { GitHubStudioSettings } from './github/session.ts';
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
  /**
   * GitHub mode in a built site (spec §6.8): with no `api`, the studio
   * signs the editor in with GitHub and saves to this repository.
   */
  github?: GitHubStudioSettings | null;
  /** The site's static routes at build, for GitHub mode's collision checks. */
  routes?: readonly (readonly [string, string])[];
  /** Function-form URL patterns from vesper.config.ts, for GitHub mode's moves and links. */
  loadUrlFunctions?: () => Promise<Readonly<Record<string, (entry: UrlEntry) => unknown>>>;
  /** Who is signed in, set by GitHub mode and the cloud. */
  account?: Account;
  /**
   * The cloud in a built site (spec §6.9): with no `api`, the studio signs
   * the editor in to Vesper, and saves become drafts.
   */
  cloud?: CloudSettings | null;
  /** The studio connected to the cloud, set by the cloud's gate once signed in. */
  connection?: CloudConnection;
};

/** The signed-in editor, in GitHub mode or the cloud: the user menu shows it. */
export type Account = {
  /** The user menu's button: `@login` on GitHub, the person's name on Vesper. */
  label: string;
  /** The person's name, at the top of the open menu and for their initials. */
  name: string;
  /** Their picture's address, beside the name; without one, their initials show. */
  picture?: string;
  /** The menu's name: "Signed in to GitHub as @login". */
  description: string;
  /** The menu's way out: "Sign out of GitHub", "Sign out of Vesper". */
  signOutLabel: string;
  /** The cloud's dashboard, for "Open dashboard". */
  dashboardUrl?: string;
  /**
   * GitHub mode: the repository is public, so a change scheduled there can
   * be read before it goes live (spec §6.17). The Schedule dialog says so.
   */
  publicRepository?: boolean;
  signOut: () => void;
  /** Signs in again after the session expired, coming back to the same screen. */
  signInAgain: () => void;
  /** True once GitHub has said the session expired. */
  expired: boolean;
};
