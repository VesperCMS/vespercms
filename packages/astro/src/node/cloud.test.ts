import { describe, expect, it } from 'vitest';
import { cloudSettings } from './cloud.ts';

const addresses = { app: 'https://app.example.test', api: 'https://api.example.test/' };

describe('the cloud option', () => {
  it('takes the project and addresses from the option, then the environment', () => {
    expect(cloudSettings({ project: 'site_abc', ...addresses }, {})).toEqual({
      settings: {
        project: 'site_abc',
        app: 'https://app.example.test',
        api: 'https://api.example.test',
      },
    });
    expect(
      cloudSettings(true, {
        VESPER_PROJECT: 'site_env',
        VESPER_CLOUD_APP: 'http://127.0.0.1:4406/app',
        VESPER_CLOUD_API: 'http://127.0.0.1:4406/api',
      }),
    ).toEqual({
      settings: {
        project: 'site_env',
        app: 'http://127.0.0.1:4406/app',
        api: 'http://127.0.0.1:4406/api',
      },
    });
  });

  it('defaults to Vesper’s own cloud, so a site needs only its project ID', () => {
    expect(cloudSettings({ project: 'site_abc' }, {})).toEqual({
      settings: {
        project: 'site_abc',
        app: 'https://app.vespercms.com',
        api: 'https://api.vespercms.com',
      },
    });
    expect(cloudSettings(true, { VESPER_PROJECT: 'site_env' })).toEqual({
      settings: {
        project: 'site_env',
        app: 'https://app.vespercms.com',
        api: 'https://api.vespercms.com',
      },
    });
  });

  it('takes the addresses as a pair, never one with the other defaulted', () => {
    const pair = expect.stringContaining('together') as unknown;
    expect(cloudSettings({ project: 'site_abc', app: addresses.app }, {})).toEqual({
      problem: pair,
    });
    expect(
      cloudSettings({ project: 'site_abc' }, { VESPER_CLOUD_API: 'https://api.example.test' }),
    ).toEqual({ problem: pair });
    // The option's app and the environment's API still make a pair.
    expect(
      cloudSettings(
        { project: 'site_abc', app: addresses.app },
        { VESPER_CLOUD_API: 'https://api.example.test' },
      ),
    ).toMatchObject({ settings: { app: 'https://app.example.test' } });
  });

  it('says what’s missing in one line for the build log', () => {
    expect(cloudSettings({ ...addresses }, {})).toEqual({
      problem:
        "Cloud: no project ID. Set VESPER_PROJECT, or vesper({ cloud: { project: '…' } }), to the ID from the site's settings in the dashboard.",
    });
    expect(cloudSettings({ project: 'no spaces allowed', ...addresses }, {})).toMatchObject({
      problem: expect.stringContaining("isn't a project ID") as unknown,
    });
    for (const app of ['http://app.example.test', 'https://app.example.test/?x=1', 'not a url']) {
      expect(cloudSettings({ project: 'site_abc', app, api: addresses.api }, {})).toMatchObject({
        problem: expect.stringContaining('https URLs') as unknown,
      });
    }
  });
});
