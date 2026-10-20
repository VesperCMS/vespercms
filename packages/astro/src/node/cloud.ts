import type { CloudStudioSettings } from '@vesper/core';

/*
 * The cloud at build (spec §6.9): the site's public project ID and the
 * cloud's two addresses, written into the studio. None of it is a secret;
 * the project ID only names the site when the studio signs in.
 */

/** The integration's `cloud` option. */
export type CloudOptions = {
  /** The site's project ID from the dashboard. `VESPER_PROJECT` when absent. */
  project?: string;
  /**
   * The cloud's sign-in and dashboard (`https://app.<domain>`), and its API
   * (`https://api.<domain>`). `VESPER_CLOUD_APP` and `VESPER_CLOUD_API`
   * when absent. Required until Vesper's domain is registered (spec §13.1);
   * after that they default to it, and staging and tests still set them.
   */
  app?: string;
  api?: string;
};

const PROJECT = /^[\w-]{3,64}$/;

/** `https:`, or plain `http:` on this machine for tests. */
function address(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    if (url.search || url.hash) return null;
    return url.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** The settings, or why the cloud can't be on, in a sentence for the build log. */
export function cloudSettings(
  options: CloudOptions | true,
  env: Record<string, string | undefined> = process.env,
): { settings: CloudStudioSettings } | { problem: string } {
  const given = options === true ? {} : options;
  const project = given.project ?? env.VESPER_PROJECT ?? '';
  if (!PROJECT.test(project)) {
    return {
      problem: project
        ? `Cloud: "${project}" isn't a project ID. Copy it from the site's settings in the dashboard.`
        : "Cloud: no project ID. Set VESPER_PROJECT, or vesper({ cloud: { project: '…' } }), to the ID from the site's settings in the dashboard.",
    };
  }
  const app = address(given.app ?? env.VESPER_CLOUD_APP);
  const api = address(given.api ?? env.VESPER_CLOUD_API);
  if (!app || !api) {
    return {
      problem:
        'Cloud: the app and API addresses must be https URLs (vesper({ cloud: { app, api } }), or VESPER_CLOUD_APP and VESPER_CLOUD_API).',
    };
  }
  return { settings: { project, app, api } };
}
