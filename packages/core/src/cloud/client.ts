import { base64url, createDpopProof } from './dpop.ts';
import type {
  BlobsResponse,
  CloudErrorBody,
  CloudStudioSettings,
  DeployStatus,
  DraftsResponse,
  HoldResponse,
  PublishResponse,
  Review,
  ReviewAnswer,
  ReviewRequest,
  ReviewsResponse,
  SaveDraftRequest,
  SaveDraftResponse,
  ScheduleResponse,
  TokenResponse,
  TreeResponse,
} from './protocol.ts';

/*
 * The studio's side of the cloud's API (spec §6.9, §7.2): PKCE for the
 * sign-in, a DPoP proof on every request, and an access token renewed in
 * the background with the rotating refresh token. Where tokens are kept is
 * the caller's business (`onTokens`): the studio keeps them in IndexedDB
 * beside the key they're bound to.
 */

export type CloudTokens = {
  access: string;
  refresh: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
};

export class CloudError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
  }
}

/** A PKCE verifier and its S256 challenge. */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** Where the studio sends the browser to sign in (`app.<domain>/authorize`). */
export function authorizeUrl(
  settings: CloudStudioSettings,
  request: { redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(`${settings.app.replace(/\/+$/, '')}/authorize`);
  url.searchParams.set('site', settings.project);
  url.searchParams.set('redirect_uri', request.redirectUri);
  url.searchParams.set('state', request.state);
  url.searchParams.set('code_challenge', request.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}

export type CloudClientOptions = {
  settings: CloudStudioSettings;
  key: CryptoKeyPair;
  tokens?: CloudTokens | null;
  fetch?: typeof fetch;
  /** Called with every new pair of tokens, and with `null` when the sign-in ends. */
  onTokens?: (tokens: CloudTokens | null) => void;
  /** Renew this long before the access token expires. */
  marginMs?: number;
  now?: () => number;
  /**
   * Runs a renewal alone across the browser's tabs (a Web Lock). Refresh
   * tokens rotate, and a used one coming back ends the sign-in, so two tabs
   * renewing at once would sign each other out.
   */
  exclusive?: <T>(work: () => Promise<T>) => Promise<T>;
  /** The newest tokens another tab may have stored, read inside `exclusive`. */
  latest?: () => Promise<CloudTokens | null>;
};

const isErrorBody = (body: unknown): body is CloudErrorBody =>
  typeof body === 'object' &&
  body !== null &&
  'error' in body &&
  typeof (body as { message?: unknown }).message === 'string';

/** An answer the studio shows rather than throws: a save or publish that didn't go through. */
const isAnswer = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && 'ok' in body;

export class CloudClient {
  readonly settings: CloudStudioSettings;
  private readonly key: CryptoKeyPair;
  private tokens: CloudTokens | null;
  private readonly fetcher: typeof fetch;
  private readonly onTokens: ((tokens: CloudTokens | null) => void) | undefined;
  private readonly margin: number;
  private readonly now: () => number;
  private readonly exclusive: <T>(work: () => Promise<T>) => Promise<T>;
  private readonly latest: (() => Promise<CloudTokens | null>) | undefined;
  private renewing: Promise<void> | null = null;

  constructor(options: CloudClientOptions) {
    this.settings = options.settings;
    this.key = options.key;
    this.tokens = options.tokens ?? null;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.onTokens = options.onTokens;
    this.margin = options.marginMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
    this.exclusive = options.exclusive ?? ((work) => work());
    this.latest = options.latest;
  }

  get signedIn(): boolean {
    return this.tokens !== null;
  }

  private api(path: string): string {
    return `${this.settings.api.replace(/\/+$/, '')}${path}`;
  }

  private async token(body: Record<string, string>): Promise<TokenResponse> {
    const url = this.api('/token');
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        DPoP: await createDpopProof(this.key, { method: 'POST', url, now: this.now() }),
      },
      body: JSON.stringify({ ...body, site: this.settings.project }),
    });
    const answer = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      if (isErrorBody(answer)) throw new CloudError(response.status, answer.error, answer.message);
      throw new CloudError(response.status, 'server_error', 'Vesper had a problem signing you in.');
    }
    const tokens = answer as TokenResponse;
    this.tokens = {
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expiresAt: this.now() + tokens.expires_in * 1000,
    };
    this.onTokens?.(this.tokens);
    return tokens;
  }

  /** Finishes a sign-in: the one-time code and its verifier, for tokens bound to this key. */
  exchangeCode(request: {
    code: string;
    verifier: string;
    redirectUri: string;
  }): Promise<TokenResponse> {
    return this.token({
      grant_type: 'authorization_code',
      code: request.code,
      code_verifier: request.verifier,
      redirect_uri: request.redirectUri,
    });
  }

  /** New tokens from the refresh token. A refusal ends the sign-in. */
  async refresh(): Promise<TokenResponse> {
    const refresh = this.tokens?.refresh;
    if (!refresh) throw new CloudError(401, 'invalid_grant', 'Sign in to Vesper again.');
    try {
      return await this.token({ grant_type: 'refresh_token', refresh_token: refresh });
    } catch (error) {
      if (error instanceof CloudError && error.status >= 400 && error.status < 500) this.end();
      throw error;
    }
  }

  private end(): void {
    this.tokens = null;
    this.onTokens?.(null);
  }

  /** Renews unless another tab already has, adopting its tokens. */
  private renew(): Promise<void> {
    return this.exclusive(async () => {
      const stored = await this.latest?.();
      if (stored && stored.refresh !== this.tokens?.refresh) {
        this.tokens = stored;
        if (stored.expiresAt - this.margin > this.now()) return;
      }
      await this.refresh();
    });
  }

  private async fresh(): Promise<string> {
    if (!this.tokens) throw new CloudError(401, 'invalid_token', 'Sign in to Vesper again.');
    if (this.tokens.expiresAt - this.margin <= this.now()) {
      this.renewing ??= this.renew().finally(() => {
        this.renewing = null;
      });
      // A failed renewal throws, so past here the tokens are fresh.
      await this.renewing;
    }
    return this.tokens.access;
  }

  /**
   * A request about this site. An expired token is renewed first, and a 401
   * is renewed and tried once more. Answers with `ok` come back as they
   * are, whatever their status; anything else that isn't 2xx throws.
   */
  async site<T>(method: string, path: string, body?: unknown): Promise<T> {
    const send = async () => {
      const access = await this.fresh();
      const url = this.api(`/sites/${encodeURIComponent(this.settings.project)}${path}`);
      return this.fetcher(url, {
        method,
        headers: {
          Authorization: `DPoP ${access}`,
          DPoP: await createDpopProof(this.key, {
            method,
            url,
            accessToken: access,
            now: this.now(),
          }),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    };
    let response = await send();
    if (response.status === 401 && this.tokens) {
      await this.renew();
      response = await send();
    }
    const answer = (await response.json().catch(() => null)) as unknown;
    if (response.ok || isAnswer(answer)) return answer as T;
    if (isErrorBody(answer)) throw new CloudError(response.status, answer.error, answer.message);
    throw new CloudError(
      response.status,
      'server_error',
      'Vesper had a problem. Try again in a moment.',
    );
  }

  tree(): Promise<TreeResponse> {
    return this.site('GET', '/tree');
  }
  blobs(versions: readonly string[]): Promise<BlobsResponse> {
    return this.site('POST', '/blobs', { versions });
  }
  drafts(): Promise<DraftsResponse> {
    return this.site('GET', '/drafts');
  }
  saveDraft(request: SaveDraftRequest): Promise<SaveDraftResponse> {
    return this.site('PUT', '/drafts', request);
  }
  discardDraft(id: string): Promise<{ ok: true; version: string }> {
    return this.site('DELETE', `/drafts/${encodeURIComponent(id)}`);
  }
  rebaseDraft(id: string, paths: readonly string[]): Promise<{ ok: true; version: string }> {
    return this.site('POST', `/drafts/${encodeURIComponent(id)}/rebase`, { paths });
  }
  publish(drafts: readonly string[]): Promise<PublishResponse> {
    return this.site('POST', '/publish', { drafts });
  }
  reviews(): Promise<ReviewsResponse> {
    return this.site('GET', '/reviews');
  }
  requestReview(request: ReviewRequest): Promise<Review> {
    return this.site('POST', '/reviews', request);
  }
  answerReview(id: string, answer: ReviewAnswer): Promise<Review> {
    return this.site('POST', `/reviews/${encodeURIComponent(id)}`, answer);
  }
  status(commit: string): Promise<DeployStatus> {
    return this.site('GET', `/status?commit=${encodeURIComponent(commit)}`);
  }
  schedule(): Promise<ScheduleResponse> {
    return this.site('GET', '/schedule');
  }
  hold(drafts: readonly string[], at: string): Promise<HoldResponse> {
    return this.site('POST', '/schedule', { drafts, at });
  }
  /** A held change goes back to being a draft. */
  release(id: string): Promise<{ ok: true; version: string }> {
    return this.site('DELETE', `/schedule/${encodeURIComponent(id)}`);
  }

  /** Ends the sign-in here and in the cloud. */
  async signOut(): Promise<void> {
    const refresh = this.tokens?.refresh;
    this.end();
    if (!refresh) return;
    const url = this.api('/sign-out');
    await this.fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        DPoP: await createDpopProof(this.key, { method: 'POST', url, now: this.now() }),
      },
      body: JSON.stringify({ refresh_token: refresh, site: this.settings.project }),
    }).catch(() => undefined);
  }
}
