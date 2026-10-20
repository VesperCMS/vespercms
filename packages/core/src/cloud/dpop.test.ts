import { describe, expect, it } from 'vitest';
import {
  base64url,
  createDpopKey,
  createDpopProof,
  fromBase64url,
  jwkThumbprint,
  publicJwk,
  verifyDpopProof,
} from './dpop.ts';

const URL_ = 'https://api.example.test/sites/site_1/drafts?x=1#y';

describe('DPoP proofs', () => {
  it('round-trip base64url', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(257));
    expect(fromBase64url(base64url(bytes))).toEqual(bytes);
    expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('keep the private key out of reach', async () => {
    const key = await createDpopKey();
    expect(key.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', key.privateKey)).rejects.toThrow();
  });

  it('verify for the right method, address and token, and give the key’s thumbprint', async () => {
    const key = await createDpopKey();
    const proof = await createDpopProof(key, { method: 'put', url: URL_, accessToken: 'tok' });
    const check = await verifyDpopProof(proof, {
      method: 'PUT',
      url: 'https://api.example.test/sites/site_1/drafts',
      accessToken: 'tok',
    });
    expect(check).toMatchObject({ ok: true, jkt: await jwkThumbprint(await publicJwk(key)) });
  });

  it('refuse another method, address, token, age or a replay', async () => {
    const key = await createDpopKey();
    const now = Date.now();
    const proof = await createDpopProof(key, { method: 'GET', url: URL_, accessToken: 'tok', now });
    const base = { method: 'GET', url: URL_, accessToken: 'tok', now };
    expect((await verifyDpopProof(proof, { ...base, method: 'POST' })).ok).toBe(false);
    expect(
      (await verifyDpopProof(proof, { ...base, url: 'https://api.example.test/other' })).ok,
    ).toBe(false);
    expect((await verifyDpopProof(proof, { ...base, accessToken: 'other' })).ok).toBe(false);
    expect((await verifyDpopProof(proof, { ...base, now: now + 5 * 60_000 })).ok).toBe(false);
    const used = new Set<string>();
    const seen = (jti: string) => used.has(jti) || (used.add(jti), false);
    expect((await verifyDpopProof(proof, { ...base, seen })).ok).toBe(true);
    expect(await verifyDpopProof(proof, { ...base, seen })).toEqual({
      ok: false,
      message: 'This DPoP proof was already used.',
    });
    expect((await verifyDpopProof(null, base)).ok).toBe(false);
  });

  it('refuse a proof signed by another key than the one it names', async () => {
    const [mine, theirs] = [await createDpopKey(), await createDpopKey()];
    const proof = await createDpopProof(mine, { method: 'GET', url: URL_ });
    const [, payload, signature] = proof.split('.');
    const header = base64url(
      new TextEncoder().encode(
        JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: await publicJwk(theirs) }),
      ),
    );
    const forged = `${header}.${payload}.${signature}`;
    expect(await verifyDpopProof(forged, { method: 'GET', url: URL_ })).toEqual({
      ok: false,
      message: 'The DPoP proof’s signature doesn’t match its key.',
    });
  });

  it('computes RFC 7638’s thumbprint', async () => {
    // RFC 7638's example is RSA; this checks the EC member order instead.
    const jwk = { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' } as const;
    const expected = base64url(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode('{"crv":"P-256","kty":"EC","x":"a","y":"b"}'),
        ),
      ),
    );
    expect(await jwkThumbprint(jwk)).toBe(expected);
  });
});
