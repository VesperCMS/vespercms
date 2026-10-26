import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { planDeploy } from '../src/node/deploy-init.ts';
import { loadAstroSettings } from '../src/node/load-site.ts';

// `vesper deploy init` on this repository's own sites: astro.config read
// through the site's Vite, as the other configs are.
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const site = join(repo, 'apps', 'site');
const playground = join(repo, 'apps', 'playground');

describe('vesper deploy init on real sites', () => {
  it('reads the live address and output folder from astro.config', async () => {
    expect(await loadAstroSettings(site)).toEqual({ site: 'https://vespercms.com' });
    expect(await loadAstroSettings(playground)).toEqual({});
  });

  it('plans vespercms.com’s scheduled rebuild from the repository’s root', async () => {
    const plan = await planDeploy({
      root: site,
      target: 'hook',
      command: 'vesper deploy init --target hook',
    });
    expect(plan.file).toBe(join(repo, '.github', 'workflows', 'vesper-deploy.yml'));
    const workflow = parse(plan.contents) as { env: { VESPER_SITE_URL: string } };
    expect(workflow.env.VESPER_SITE_URL).toBe('https://vespercms.com/');
    expect(plan.next).toContain('https://vespercms.com/_vesper/schedule.json');

    const sftp = await planDeploy({
      root: site,
      target: 'sftp',
      command: 'vesper deploy init --target sftp',
      branch: 'main',
    });
    expect(sftp.contents).toContain("node-version-file: '.node-version'");
    expect(sftp.contents).toContain('working-directory: apps/site');
    expect(sftp.next).toContain('uploads apps/site/dist/ by SFTP');
  });
});
