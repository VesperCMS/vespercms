import type { CollectionManifest, Manifest } from '@vesper/core';
import { createContext, useContext } from 'react';
import type { WidgetLoader } from '../types.ts';
import type { StudioApi } from './api.ts';

export type Studio = {
  manifest: Manifest;
  api: StudioApi;
  widgets: Record<string, WidgetLoader>;
  siteName: string;
  siteUrl: string | undefined;
  collection(name: string): CollectionManifest | undefined;
};

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw new Error('useStudio() must be used inside <App>.');
  return studio;
}
