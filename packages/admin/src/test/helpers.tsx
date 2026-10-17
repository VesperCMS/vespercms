import type {
  CollectionSummary,
  EntryDocument,
  EntrySummary,
  Manifest,
  MediaItem,
} from '@vesper/core';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import { expect, vi, type Mock } from 'vitest';
import snapshot from '../../../astro/test/__snapshots__/playground.manifest.json' with { type: 'json' };
import type { StudioApi } from '../app/api.ts';
import { App } from '../app/App.tsx';
import type { StudioOptions } from '../types.ts';

/**
 * The playground's real manifest (the Phase 1 snapshot), so studio tests
 * exercise the field models a site actually produces.
 */
export const playgroundManifest = {
  ...snapshot,
  generator: { name: '@vesper/astro', version: '0.0.0' },
  hash: 'test',
} as Manifest;

/** axe without colour contrast: jsdom computes no layout (scripts/a11y-contrast.mjs checks the tokens). */
export async function expectNoViolations(container: Element = document.body) {
  const { violations } = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

export type FakeData = {
  summary?: CollectionSummary[];
  entries?: Record<string, EntrySummary[]>;
  documents?: Record<string, EntryDocument>;
  media?: MediaItem[];
};

/** An in-memory StudioApi. Every method is a `vi.fn`, so tests can assert on calls. */
export function fakeApi(data: FakeData = {}): { [K in keyof StudioApi]: Mock<StudioApi[K]> } {
  const notFound = (what: string) => Promise.reject(new Error(`${what} not found`));
  return {
    summary: vi.fn(() => Promise.resolve(data.summary ?? [])),
    listEntries: vi.fn((collection: string) => Promise.resolve(data.entries?.[collection] ?? [])),
    readEntry: vi.fn((collection: string, id: string) => {
      const doc = data.documents?.[`${collection}/${id}`];
      return doc ? Promise.resolve(structuredClone(doc)) : notFound(`${collection}/${id}`);
    }),
    saveEntry: vi.fn((request: { id: string }) =>
      Promise.resolve({
        ok: true,
        id: request.id || 'new-entry',
        path: 'x',
        version: 'v2',
        reformatted: false,
      }),
    ),
    deleteEntry: vi.fn(() =>
      Promise.resolve({ ok: true, id: 'x', path: 'x', version: '', reformatted: false }),
    ),
    listMedia: vi.fn(() => Promise.resolve(data.media ?? [])),
    upload: vi.fn(() => Promise.resolve({ ok: true, path: 'src/assets/x.jpg', reused: false })),
    deleteMedia: vi.fn(() =>
      Promise.resolve({ ok: true, id: '', path: '', version: '', reformatted: false }),
    ),
    fileUrl: vi.fn((path: string) => `/_vesper/api/file?path=${encodeURIComponent(path)}`),
  } as never;
}

/** Renders the whole studio at `hash`. */
export function renderStudio(hash: string, options: Partial<StudioOptions> = {}) {
  window.location.hash = hash;
  const api = options.api === undefined ? fakeApi() : options.api;
  const result = render(
    <App manifest={playgroundManifest} siteName="Playground" {...options} api={api} />,
  );
  return { ...result, api };
}
