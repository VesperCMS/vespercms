import {
  CloudError,
  editsAnything,
  fileAccess,
  wholeSite,
  type CloudClient,
  type CloudUser,
  type DeployStatus,
  type Draft,
  type Manifest,
  type Member,
  type PublishResponse,
  type Review,
} from '@vesper/core';
import { ApiError, type StudioApi } from '../app/api.ts';
import { createBrowserApi } from '../app/browser-api.ts';
import { keyValueStore } from '../app/idb.ts';
import type { CloudSettings } from './session.ts';
import { CloudStorage } from './storage.ts';

/*
 * The studio connected to the cloud (spec §6.9): its back end, the drafts
 * and reviews screens subscribe to, and what the signed-in member may do.
 * Screens find it on the studio as `cloud`; when it's absent, every cloud
 * feature is absent too, never disabled (spec §6.9).
 */

export type CloudConnection = {
  user: CloudUser;
  member: Member;
  siteName: string;
  dashboardUrl: string;
  client: CloudClient;
  storage: CloudStorage;
  drafts: DraftsStore;
  /** What the member may do to a file. */
  access: (path: string) => { edit: boolean; publish: boolean };
  /** True when the member's grants cover the whole site (the redirects, settings outside collections). */
  wholeSite: boolean;
  /** True when the member may change anything at all. */
  editsAnything: boolean;
};

export type DraftsSnapshot = {
  drafts: readonly Draft[];
  reviews: readonly Review[];
  version: string;
};

/** Drafts and reviews as screens see them, kept current after every change. */
export class DraftsStore {
  private snapshot: DraftsSnapshot = { drafts: [], reviews: [], version: '' };
  private readonly listeners = new Set<() => void>();
  private readonly client: CloudClient;
  private readonly storage: CloudStorage;

  constructor(client: CloudClient, storage: CloudStorage) {
    this.client = client;
    this.storage = storage;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = (): DraftsSnapshot => this.snapshot;

  /** Called by the storage whenever the drafts change. */
  setDrafts(drafts: readonly Draft[], version: string): void {
    this.snapshot = { ...this.snapshot, drafts, version };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Asks the cloud for the drafts and reviews again. */
  async refresh(): Promise<void> {
    this.storage.invalidate();
    const [{ drafts, version }, { reviews }] = await Promise.all([
      this.storage.drafts(),
      this.client.reviews(),
    ]);
    this.snapshot = { drafts, reviews, version };
    this.emit();
  }

  /** The draft holding a file, if one does. */
  draftOf(path: string): Draft | undefined {
    return this.snapshot.drafts.find((d) => d.files.some((f) => f.path === path));
  }

  async publish(ids: readonly string[]): Promise<PublishResponse> {
    const result = await this.client.publish(ids);
    await this.refresh();
    return result;
  }

  async discard(id: string): Promise<void> {
    await this.client.discardDraft(id);
    await this.refresh();
  }

  async keepMine(id: string, paths: readonly string[]): Promise<void> {
    await this.client.rebaseDraft(id, paths);
    await this.refresh();
  }

  async requestReview(ids: readonly string[], note: string): Promise<Review> {
    const review = await this.client.requestReview({ drafts: [...ids], ...(note ? { note } : {}) });
    await this.refresh();
    return review;
  }

  async answer(id: string, action: 'comment' | 'request-changes', body: string): Promise<Review> {
    const review = await this.client.answerReview(id, { action, body });
    await this.refresh();
    return review;
  }

  status(commit: string): Promise<DeployStatus> {
    return this.client.status(commit);
  }
}

/** The cloud's errors in the studio's terms: plain words, and a status the screens understand. */
export function cloudApiError(error: unknown, onExpired?: () => void): unknown {
  if (error instanceof CloudError) {
    if (error.status === 401) {
      onExpired?.();
      return new ApiError(401, 'Your Vesper sign-in has ended. Sign in again to keep working.');
    }
    return new ApiError(error.status, error.message);
  }
  if (error instanceof TypeError) {
    return new ApiError(0, 'Vesper can’t be reached. Your changes are kept on this device.');
  }
  return error;
}

export type ConnectOptions = {
  settings: CloudSettings;
  client: CloudClient;
  user: CloudUser;
  member: Member;
  siteName: string;
  manifest: Manifest;
  loadMdxProps: () => Promise<Readonly<Record<string, unknown>>>;
  loadUrlFunctions?: Parameters<typeof createBrowserApi>[0]['loadUrlFunctions'];
  routes?: readonly (readonly [string, string])[];
  onExpired?: () => void;
};

/** The studio's back end over the cloud, and the connection screens use. */
export function connect(options: ConnectOptions): { api: StudioApi; connection: CloudConnection } {
  let store: DraftsStore | null = null;
  const storage = new CloudStorage({
    client: options.client,
    cache: keyValueStore<Uint8Array>('vesper-cloud-blobs', 'blobs'),
    onDrafts: (drafts, version) => store?.setDrafts(drafts, version),
  });
  store = new DraftsStore(options.client, storage);
  const api = createBrowserApi({
    storage,
    manifest: options.manifest,
    schemas: options.settings.schemas,
    loadMdxProps: options.loadMdxProps,
    ...(options.loadUrlFunctions ? { loadUrlFunctions: options.loadUrlFunctions } : {}),
    ...(options.routes ? { routes: options.routes } : {}),
    publishesOnSave: false,
    mapError: (error) => cloudApiError(error, options.onExpired),
  });
  const member = options.member;
  const connection: CloudConnection = {
    user: options.user,
    member,
    siteName: options.siteName,
    dashboardUrl: `${options.settings.app.replace(/\/+$/, '')}/sites/${encodeURIComponent(options.settings.project)}`,
    client: options.client,
    storage,
    drafts: store,
    access: (path) => fileAccess(member, options.manifest, path),
    wholeSite: wholeSite(member),
    editsAnything: editsAnything(member),
  };
  return { api, connection };
}
