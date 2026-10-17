export class InvalidPathError extends Error {
  constructor(path: string, reason: string) {
    super(`Invalid content path "${path}": ${reason}`);
    this.name = 'InvalidPathError';
  }
}

/**
 * Validates and normalizes a site-relative path. Storage only ever deals in
 * POSIX paths inside the site, so anything that could escape it, or mean
 * different files on different systems, is refused rather than repaired.
 */
export function normalizePath(path: string): string {
  if (path.length === 0) throw new InvalidPathError(path, 'empty');
  if (path.includes('\0')) throw new InvalidPathError(path, 'contains a NUL byte');
  if (path.includes('\\')) throw new InvalidPathError(path, 'use forward slashes');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path))
    throw new InvalidPathError(path, 'must be relative');
  const segments = path.replace(/^\.\//, '').split('/');
  if (segments.some((segment) => segment === '..'))
    throw new InvalidPathError(path, 'may not leave the site');
  if (segments.some((segment) => segment === '' || segment === '.')) {
    throw new InvalidPathError(path, 'has an empty segment');
  }
  return segments.join('/');
}
