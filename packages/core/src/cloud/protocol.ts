import type {
  ChangeSet,
  CommitTrailers,
  Conflict,
  FileChange,
  StorageEntry,
} from '../storage/types.ts';
import { toBase64 } from '../storage/github.ts';
import { fromBase64url } from './dpop.ts';
import type { Member } from './grants.ts';

/*
 * The cloud's API as the studio speaks it (spec §6.9, §7.2 to §7.5). The
 * studio is MIT and ships on every site, so this contract is public; the
 * cloud's private code implements it, and `runCloudContract` checks that it
 * does (DECISIONS.md, "The split").
 *
 * Every site request carries `Authorization: DPoP <token>` and a `DPoP`
 * proof header. Answers are JSON. A refusal the studio should explain is
 * `{ error, message }` with a 4xx status; `message` is plain words for editors.
 */

export const CLOUD_PROTOCOL_VERSION = 1;

/** What the build writes into the studio: the public project ID and the cloud's two addresses. */
export type CloudStudioSettings = {
  /** The site's public ID: an identifier, not a secret (spec §6.9). */
  project: string;
  /** Sign-in and the dashboard: `https://app.<domain>`. */
  app: string;
  /** The API: `https://api.<domain>`. */
  api: string;
};

export type CloudUser = { id: string; name: string; email: string };

/** `POST /token`, with a DPoP proof. */
export type TokenRequest =
  | {
      grant_type: 'authorization_code';
      code: string;
      code_verifier: string;
      /** The studio's own address the code was issued to. */
      redirect_uri: string;
      site: string;
    }
  | { grant_type: 'refresh_token'; refresh_token: string; site: string };

export type TokenResponse = {
  access_token: string;
  token_type: 'DPoP';
  /** Seconds. About 10 minutes. */
  expires_in: number;
  /** Rotates on every use; the old one stops working. */
  refresh_token: string;
  user: CloudUser;
  site: { id: string; name: string };
  member: Member;
};

/** `POST /sign-out`: ends the refresh token. */
export type SignOutRequest = { refresh_token: string; site: string };

export type CloudErrorCode =
  | 'invalid_request'
  | 'invalid_grant'
  | 'invalid_token'
  | 'invalid_dpop_proof'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'server_error';

export type CloudErrorBody = { error: CloudErrorCode; message: string };

/** `GET /sites/{site}/tree`: the published files at the branch's head. */
export type TreeResponse = { commit: string; entries: StorageEntry[] };

/** `POST /sites/{site}/blobs`: file contents by version, published or drafted. */
export type BlobsRequest = { versions: string[] };
export type BlobsResponse = { blobs: Record<string, string> };

/** A file change on the wire: bytes as base64. */
export type WireChange =
  | { op: 'put'; path: string; bytes: string; expectedVersion?: string | null }
  | { op: 'delete'; path: string; expectedVersion?: string }
  | { op: 'move'; from: string; to: string; bytes?: string; expectedVersion?: string };

/** One file in a draft. `base` is the published version it started from (`null`: a new file). */
export type DraftFile =
  | { op: 'put'; path: string; version: string; size: number; base: string | null }
  | { op: 'delete'; path: string; base: string };

/**
 * A draft: changes saved together and published together (spec §7.4). Saves
 * that touch a file already in a draft join that draft, so a move and the
 * links it rewrote can't be published apart.
 */
export type Draft = {
  id: string;
  /** The latest save's summary ("Update “Harbor at dawn” in Blog posts"). */
  summary: string;
  /** Every save's trailers, each name's values once. */
  trailers?: CommitTrailers;
  files: DraftFile[];
  /** Everyone who saved it, each once, in the order they first did. A publish credits them all. */
  authors: { id: string; name: string }[];
  updatedBy: { id: string; name: string };
  updatedAt: string;
  /** Set while the draft waits for an approver. */
  review?: string;
};

/** `GET /sites/{site}/drafts`. `version` changes whenever any draft does. */
export type DraftsResponse = { version: string; drafts: Draft[] };

/** `PUT /sites/{site}/drafts`: a change set saved as a draft. */
export type SaveDraftRequest = {
  changes: WireChange[];
  message: ChangeSet['message'];
  /** The drafts' `version` the studio saw, for its own bookkeeping. */
  baseVersion?: string;
};

export type SaveDraftResponse =
  | { ok: true; version: string; draft: Draft | null }
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] }
  | { ok: false; reason: 'rejected'; message: string }
  | { ok: false; reason: 'forbidden'; path: string; message: string };

/** `POST /sites/{site}/publish`: drafts committed as one commit. */
export type PublishRequest = { drafts: string[] };

export type PublishResponse =
  | { ok: true; commit: string }
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] }
  | { ok: false; reason: 'forbidden' | 'rejected'; message: string };

/** `POST /sites/{site}/drafts/{id}/rebase`: keep the draft, now based on what's published. */
export type RebaseRequest = { paths: string[] };

export type ReviewComment = { by: { id: string; name: string }; at: string; body: string };

export type Review = {
  id: string;
  drafts: string[];
  requestedBy: { id: string; name: string };
  requestedAt: string;
  state: 'open' | 'changes-requested';
  comments: ReviewComment[];
};

/** `POST /sites/{site}/reviews`. */
export type ReviewRequest = { drafts: string[]; note?: string };
/** `GET /sites/{site}/reviews`. */
export type ReviewsResponse = { reviews: Review[] };
/** `POST /sites/{site}/reviews/{id}`: an approver's answer short of publishing. */
export type ReviewAnswer = { action: 'comment' | 'request-changes'; body: string };

/** `GET /sites/{site}/status?commit=…`: what the host reported for a published commit (spec §6.16). */
export type DeployStatus = {
  state: 'building' | 'live' | 'failed' | 'unknown';
  /** The host's log or deploy page. */
  url?: string;
};

export function encodeChange(change: FileChange): WireChange {
  switch (change.op) {
    case 'put':
      return {
        op: 'put',
        path: change.path,
        bytes: toBase64(change.bytes),
        ...(change.expectedVersion !== undefined
          ? { expectedVersion: change.expectedVersion }
          : {}),
      };
    case 'delete':
      return {
        op: 'delete',
        path: change.path,
        ...(change.expectedVersion !== undefined
          ? { expectedVersion: change.expectedVersion }
          : {}),
      };
    case 'move':
      return {
        op: 'move',
        from: change.from,
        to: change.to,
        ...(change.bytes ? { bytes: toBase64(change.bytes) } : {}),
        ...(change.expectedVersion !== undefined
          ? { expectedVersion: change.expectedVersion }
          : {}),
      };
  }
}

export function decodeChange(change: WireChange): FileChange {
  switch (change.op) {
    case 'put':
      return {
        op: 'put',
        path: change.path,
        bytes: fromBase64(change.bytes),
        ...(change.expectedVersion !== undefined
          ? { expectedVersion: change.expectedVersion }
          : {}),
      };
    case 'delete':
      return {
        op: 'delete',
        path: change.path,
        ...(change.expectedVersion !== undefined
          ? { expectedVersion: change.expectedVersion }
          : {}),
      };
    case 'move':
      return {
        op: 'move',
        from: change.from,
        to: change.to,
        ...(change.bytes !== undefined ? { bytes: fromBase64(change.bytes) } : {}),
        ...(change.expectedVersion !== undefined
          ? { expectedVersion: change.expectedVersion }
          : {}),
      };
  }
}

/** Standard base64 to bytes (`fromBase64url` reads both alphabets). */
export function fromBase64(text: string): Uint8Array {
  return fromBase64url(text);
}
