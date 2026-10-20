/*
 * DPoP (RFC 9449): tokens bound to a key the browser can't export
 * (DECISIONS.md, "The studio stays signed in with tokens bound to a key").
 *
 * The studio makes an ECDSA P-256 key pair whose private half can't be read
 * back out, keeps it in IndexedDB, and signs a short proof for every request
 * to the cloud. The cloud binds each token to the key's thumbprint and
 * checks the proof, so a token copied off the page is useless anywhere else.
 *
 * Only WebCrypto, so the studio, the cloud's Workers and the tests share it.
 */

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const sha256 = async (text: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

/** The public key as a JWK with only the members RFC 7638 hashes. */
export type PublicJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string };

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** A key pair whose private half can never leave the browser. */
export function createDpopKey(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGORITHM, false, ['sign', 'verify']);
}

export async function publicJwk(key: CryptoKeyPair): Promise<PublicJwk> {
  const jwk = await crypto.subtle.exportKey('jwk', key.publicKey);
  return { kty: 'EC', crv: 'P-256', x: String(jwk.x), y: String(jwk.y) };
}

/** RFC 7638's thumbprint: what a token is bound to (`cnf.jkt`). */
export async function jwkThumbprint(jwk: PublicJwk): Promise<string> {
  // Members in lexicographic order, no whitespace (RFC 7638 §3).
  return base64url(
    await sha256(`{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`),
  );
}

/** `htu`: the request's address without its query or fragment (RFC 9449 §4.2). */
export function proofUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/** A proof for one request. With `accessToken`, it also carries the token's hash (`ath`). */
export async function createDpopProof(
  key: CryptoKeyPair,
  request: { method: string; url: string; accessToken?: string; now?: number },
): Promise<string> {
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: await publicJwk(key) };
  const payload: Record<string, unknown> = {
    jti: base64url(crypto.getRandomValues(new Uint8Array(16))),
    htm: request.method.toUpperCase(),
    htu: proofUrl(request.url),
    iat: Math.floor((request.now ?? Date.now()) / 1000),
  };
  if (request.accessToken !== undefined) payload.ath = base64url(await sha256(request.accessToken));
  const input = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(payload)))}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(SIGNING, key.privateKey, encoder.encode(input)),
  );
  return `${input}.${base64url(signature)}`;
}

export type DpopCheck = { ok: true; jkt: string; jti: string } | { ok: false; message: string };

/**
 * Checks a proof as RFC 9449 §4.3 asks: its form, signature, method, address
 * and age, and with an access token, that it was made for that token.
 * `seen` reports a `jti` already used, so a proof can't be replayed.
 */
export async function verifyDpopProof(
  proof: string | null,
  request: {
    method: string;
    url: string;
    accessToken?: string;
    now?: number;
    maxAgeSeconds?: number;
    seen?: (jti: string) => boolean | Promise<boolean>;
  },
): Promise<DpopCheck> {
  const fail = (message: string): DpopCheck => ({ ok: false, message });
  if (!proof) return fail('This request has no DPoP proof.');
  const parts = proof.split('.');
  if (parts.length !== 3) return fail('The DPoP proof isn’t a JWT.');
  let header: { typ?: unknown; alg?: unknown; jwk?: Record<string, unknown> };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0] ?? ''))) as typeof header;
    payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1] ?? ''))) as typeof payload;
  } catch {
    return fail('The DPoP proof can’t be read.');
  }
  const jwk = header.jwk;
  if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256')
    return fail('The DPoP proof’s type or algorithm is wrong.');
  if (
    !jwk ||
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.y !== 'string' ||
    'd' in jwk
  ) {
    return fail('The DPoP proof’s key is wrong.');
  }
  const publicKey: PublicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { ...publicKey, ext: true },
      ALGORITHM,
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify(
      SIGNING,
      key,
      fromBase64url(parts[2] ?? '') as BufferSource,
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) return fail('The DPoP proof’s signature doesn’t match its key.');
  if (payload.htm !== request.method.toUpperCase())
    return fail('The DPoP proof was made for another method.');
  if (payload.htu !== proofUrl(request.url))
    return fail('The DPoP proof was made for another address.');
  const now = Math.floor((request.now ?? Date.now()) / 1000);
  const maxAge = request.maxAgeSeconds ?? 60;
  if (typeof payload.iat !== 'number' || Math.abs(now - payload.iat) > maxAge)
    return fail('The DPoP proof is too old or from the future.');
  if (typeof payload.jti !== 'string' || payload.jti.length < 8)
    return fail('The DPoP proof has no ID.');
  if (request.accessToken !== undefined) {
    if (payload.ath !== base64url(await sha256(request.accessToken)))
      return fail('The DPoP proof was made for another token.');
  }
  if (request.seen && (await request.seen(payload.jti)))
    return fail('This DPoP proof was already used.');
  return { ok: true, jkt: await jwkThumbprint(publicKey), jti: payload.jti };
}
