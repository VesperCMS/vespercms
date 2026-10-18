import type { CollectionManifest, Manifest } from '@vesper/core';
import { createContext, useContext } from 'react';
import type { WidgetComponent } from '../types.ts';
import type { StudioApi } from './api.ts';

export type Studio = {
  manifest: Manifest;
  api: StudioApi;
  /** Custom widgets, as lazy components: each loads the first time a field uses it. */
  widgets: Record<string, WidgetComponent>;
  /** Loads declared MDX components' Zod props schemas, from vesper.config.ts (spec §6.5.2). */
  loadMdxProps: () => Promise<Readonly<Record<string, unknown>>>;
  siteName: string;
  siteUrl: string | undefined;
  collection: (name: string) => CollectionManifest | undefined;
};

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw new Error('useStudio() must be used inside <App>.');
  return studio;
}
