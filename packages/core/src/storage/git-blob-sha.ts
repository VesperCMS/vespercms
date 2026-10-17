const encoder = new TextEncoder();

/**
 * Git's blob SHA-1 for `bytes`: `sha1("blob <length>\0" + bytes)`. It's the same
 * value `git hash-object` prints and GitHub's API returns as a file's `sha`,
 * computed with Web Crypto so it works in browsers, Workers and Node alike.
 */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = encoder.encode(`blob ${String(bytes.length)}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header, 0);
  data.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
