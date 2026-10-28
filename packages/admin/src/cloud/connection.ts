import {
  CloudError,
  changeAccess,
  editsAnything,
  encodeChange,
  fileAccess,
  fromBase64,
  wholeSite,
  type CloudClient,
  type CloudUser,
  type CommitTrailers,
  type DeployStatus,
  type Draft,
  type HoldResponse,
  type Manifest,
  type Member,
  type PublishResponse,
  type Review,
  type ScheduleResponse,
} from '@vespercms/core';
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
  /** What the member may do with a whole draft: the API refuses the same (spec §7.5). */
  draftAccess: (draft: Draft) => { edit: boolean; publish: boolean };
  /** True when the member's grants cover the whole site (the redirects, settings outside collections). */
  wholeSite: boolean;
  /** True when the member may change anything at all. */
  editsAnything: boolean;
};

export type DraftsSnapshot = {
  drafts: readonly Draft[];
  reviews: readonly Review[];
  version: string;
  /**
   * How the site publishes on schedule, and where each change stands (spec
   * §6.17). Absent on a site with no scheduled collection, or until read.
   */
  schedule?: ScheduleResponse;
};

/** Drafts and reviews as screens see them, kept current after every change. */
export class DraftsStore {
  private snapshot: DraftsSnapshot = { drafts: [], reviews: [], version: '' };
  private readonly listeners = new Set<() => void>();
  private readonly client: CloudClient;
  private readonly storage: CloudStorage;
  private readonly scheduled: boolean;

  /** `scheduled`: the site has a scheduled collection, so the schedule is read with the drafts. */
  constructor(client: CloudClient, storage: CloudStorage, scheduled = false) {
    this.client = client;
    this.storage = storage;
    this.scheduled = scheduled;
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

  /** Asks the cloud for the drafts and reviews again, and the schedule where the site has one. */
  async refresh(): Promise<void> {
    this.storage.invalidate();
    const [{ drafts, version }, { reviews }, schedule] = await Promise.all([
      this.storage.drafts(),
      this.client.reviews(),
      // The schedule only adds words; without it, scheduling works as in GitHub mode.
      this.scheduled
        ? this.client.schedule().catch(() => this.snapshot.schedule)
        : Promise.resolve(undefined),
    ]);
    this.snapshot = { drafts, reviews, version, ...(schedule ? { schedule } : {}) };
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

  /** Holds drafts in the cloud until `at`, to be published then (`holdScheduledDrafts`). */
  async hold(ids: readonly string[], at: Date): Promise<HoldResponse> {
    const result = await this.client.hold(ids, at.toISOString());
    await this.refresh();
    return result;
  }

  /** A held draft stops waiting, and stays a draft. */
  async release(event: string): Promise<void> {
    await this.client.release(event);
    await this.refresh();
  }

  /**
   * Cancels a published entry's time to go live (call 9): one publish takes
   * its file out of the site, and its content comes back as a draft. The
   * file isn't live yet, so visitors see no change.
   */
  async backToDraft(
    path: string,
    message: { summary: string; trailers?: CommitTrailers },
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const words = (result: { ok: false; reason: string; message?: string }) =>
      result.message ?? 'Someone changed it since you opened it. Reload to see the new version.';
    const version = (await this.client.tree()).entries.find((e) => e.path === path)?.version;
    if (!version)
      return { ok: false, message: 'It isn’t published, so there’s nothing to cancel.' };
    const text = (await this.client.blobs([version])).blobs[version];
    if (text === undefined) return { ok: false, message: 'Its text couldn’t be read. Try again.' };
    const removal = await this.client.saveDraft({
      changes: [{ op: 'delete', path, expectedVersion: version }],
      message,
    });
    if (!removal.ok) {
      await this.refresh();
      return { ok: false, message: words(removal) };
    }
    const published = removal.draft ? await this.client.publish([removal.draft.id]) : null;
    if (!published?.ok) {
      if (removal.draft) await this.client.discardDraft(removal.draft.id);
      await this.refresh();
      return { ok: false, message: published ? words(published) : 'Nothing changed.' };
    }
    const kept = await this.client.saveDraft({
      changes: [encodeChange({ op: 'put', path, bytes: fromBase64(text), expectedVersion: null })],
      message,
    });
    await this.refresh();
    return kept.ok
      ? { ok: true }
      : {
          ok: false,
          message: `It’s off the site, but its draft couldn’t be saved: ${words(kept)} It’s in the site’s history.`,
        };
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
  store = new DraftsStore(
    options.client,
    storage,
    options.manifest.collections.some((c) => c.presentation.schedule),
  );
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
    draftAccess: (draft) => {
      const result = changeAccess(
        member,
        options.manifest,
        draft.files.map((file) =>
          file.op === 'delete'
            ? { op: 'delete', path: file.path, expectedVersion: file.base }
            : { op: 'put', path: file.path, bytes: new Uint8Array(), expectedVersion: file.base },
        ),
      );
      return result.ok ? { edit: true, publish: result.publish } : { edit: false, publish: false };
    },
    wholeSite: wholeSite(member),
    editsAnything: editsAnything(member),
  };
  return { api, connection };
}
