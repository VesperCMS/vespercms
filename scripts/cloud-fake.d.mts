// Types for cloud-fake.mjs, so tests import it with checking.
import type { Server } from 'node:http';
import type {
  CloudStudioSettings,
  DeployStatus,
  DraftState,
  Grant,
  GitHubStorage,
  Manifest,
  Review,
  SiteRole,
} from '@vesper/core';
import type { GitHubFake } from './github-fake.mjs';

export type CloudPerson = {
  id: string;
  name: string;
  email: string;
  role: SiteRole;
  grants?: Grant[] | null;
  /** Serve a picture for them, as the cloud does for someone who has one. */
  picture?: boolean;
};

export type CloudFakeState = {
  signedIn: string | null;
  down: boolean;
  skew: number;
  drafts: DraftState;
  reviews: Review[];
  deploys: Map<string, DeployStatus>;
  emails: { to: string; subject: string; url: string }[];
  log: string[];
};

export type CloudFake = {
  state: CloudFakeState;
  people: CloudPerson[];
  site: { id: string; name: string; origins: string[]; root?: string };
  settings: CloudStudioSettings;
  published: GitHubStorage;
  handle: (request: Request) => Promise<Response>;
  fetch: typeof fetch;
  setDeploy: (commit: string, status: DeployStatus) => void;
  setMember: (id: string, member: { role?: SiteRole; grants?: Grant[] | null }) => void;
};

export function createCloudFake(options: {
  github: GitHubFake;
  manifest: Manifest;
  site: { id: string; name: string; origins: string[]; root?: string };
  people: CloudPerson[];
  base?: string;
}): CloudFake;

export function serveCloudFake(
  fake: CloudFake,
  port: number,
  host?: string,
  options?: { control?: boolean },
): Promise<Server>;
