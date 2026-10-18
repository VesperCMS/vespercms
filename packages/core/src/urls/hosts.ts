import { formatUrl, type UrlSettings } from './pattern.ts';
import { isExternal, statusOf, type Redirect } from './redirects.ts';

/*
 * How redirects reach the live site (spec §6.15.5). By default the
 * integration hands them to Astro, which writes a small HTML page at each
 * old URL: that works on any host, but it isn't a true 301. Hosts with
 * their own redirect rules get those too, written here as plain text:
 *
 * | Target       | Output                                                    |
 * |--------------|-----------------------------------------------------------|
 * | `netlify`    | `_redirects`, forced (`301!`) so a file never wins         |
 * | `cloudflare` | `_redirects` (Cloudflare Pages has no forced form)         |
 * | `vercel`     | `redirects` entries for the site's `vercel.json`           |
 * | `apache`     | `.htaccess` `RedirectMatch` lines (most FTP shared hosts)  |
 * | `nginx`      | `location` blocks for the server admin to include          |
 */

export type NativeTarget = 'netlify' | 'cloudflare' | 'vercel' | 'apache' | 'nginx';

export const NATIVE_TARGETS: readonly NativeTarget[] = [
  'netlify',
  'cloudflare',
  'vercel',
  'apache',
  'nginx',
];

/** Markers around Vesper's part of a file it shares with the site's own rules. */
export const BEGIN_MARKER = '# BEGIN vesper';
export const END_MARKER = '# END vesper';

/** A redirect as a host sees it: the old URL as requested, and where to send the visitor. */
export type HostRedirect = { from: string; to: string; status: number };

/**
 * The URLs a host matches and sends visitors to: `from` with the site's
 * base (no trailing slash; each target also matches the slash form), `to`
 * in the page's canonical form, so the redirect lands in one hop.
 */
export function hostRedirects(
  redirects: readonly Redirect[],
  settings: UrlSettings,
): HostRedirect[] {
  return redirects.map((redirect) => {
    const from = formatUrl(redirect.from, { ...settings, trailingSlash: 'never' });
    const to = isExternal(redirect.to) ? redirect.to : formatUrl(redirect.to, settings);
    return { from, to, status: statusOf(redirect) };
  });
}

/** Netlify or Cloudflare Pages `_redirects` lines. */
export function redirectsFileRules(
  redirects: readonly HostRedirect[],
  target: 'netlify' | 'cloudflare',
): string {
  return redirects
    .flatMap((r) => {
      if (target === 'netlify') return [`${r.from} ${r.to} ${String(r.status)}!`];
      // Cloudflare matches the path as written, so both forms get a rule.
      const lines = [`${r.from} ${r.to} ${String(r.status)}`];
      if (r.from !== '/' && !r.from.endsWith('/'))
        lines.push(`${r.from}/ ${r.to} ${String(r.status)}`);
      return lines;
    })
    .join('\n');
}

/** Apache `.htaccess` rules (mod_alias, so no mod_rewrite is needed). Each matches with or without a trailing slash. */
export function htaccessRules(redirects: readonly HostRedirect[]): string {
  return redirects
    .map((r) => {
      const from = r.from.replace(/\/$/, '');
      return `RedirectMatch ${String(r.status)} ${quote(`^${escapeRegex(from)}/?$`)} ${quote(r.to)}`;
    })
    .join('\n');
}

/** nginx `location` blocks, for `include` inside the site's `server` block. */
export function nginxRules(redirects: readonly HostRedirect[]): string {
  return redirects
    .flatMap((r) => {
      const from = r.from.replace(/\/$/, '');
      const forms = from === '' ? ['/'] : [from, `${from}/`];
      return forms.map(
        (path) =>
          `location = ${nginxString(path)} { return ${String(r.status)} ${nginxString(r.to)}; }`,
      );
    })
    .join('\n');
}

export type VercelRedirect = {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
};

/** Entries for `vercel.json`'s `redirects`, one for each form of the old URL. */
export function vercelRules(redirects: readonly HostRedirect[]): VercelRedirect[] {
  return redirects.flatMap((r) => {
    const status =
      r.status === 301 || r.status === 308
        ? { permanent: true }
        : r.status === 302 || r.status === 307
          ? { permanent: false }
          : { statusCode: r.status };
    const from = r.from.replace(/\/$/, '') || '/';
    const forms = from === '/' ? ['/'] : [from, `${from}/`];
    return forms.map((source) => ({ source, destination: r.to, ...status }));
  });
}

/**
 * Puts Vesper's block into a file the site may also edit by hand, between
 * `# BEGIN vesper` and `# END vesper`. An existing block is replaced in
 * place; otherwise the block goes at the start (for `_redirects`, where the
 * first matching rule wins) or the end. Everything else stays byte for byte,
 * line endings included. An empty block removes Vesper's part.
 */
export function mergeMarkedBlock(
  existing: string | null,
  rules: string,
  position: 'start' | 'end',
): string {
  const text = existing ?? '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block =
    rules.trim() === ''
      ? ''
      : [
          BEGIN_MARKER,
          '# Written by Vesper from vesper.redirects.yaml. Edits here are replaced.',
          rules,
          END_MARKER,
        ]
          .join('\n')
          .split('\n')
          .join(eol) + eol;
  const lines = text.split(/(?<=\n)/);
  const begin = lines.findIndex((line) => line.trim() === BEGIN_MARKER);
  const end =
    begin === -1 ? -1 : lines.findIndex((line, i) => i > begin && line.trim() === END_MARKER);
  if (begin !== -1 && end !== -1) {
    return lines.slice(0, begin).join('') + block + lines.slice(end + 1).join('');
  }
  if (block === '') return text;
  if (text === '') return block;
  if (position === 'start') return block + text;
  return text + (text.endsWith('\n') ? '' : eol) + block;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Apache arguments with spaces must be quoted. */
function quote(text: string): string {
  return /[\s"]/.test(text) ? `"${text.replace(/["\\]/g, '\\$&')}"` : text;
}

function nginxString(text: string): string {
  return /[\s;{}"'#]/.test(text) ? `"${text.replace(/["\\]/g, '\\$&')}"` : text;
}
