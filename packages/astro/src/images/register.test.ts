import { describe, expect, it } from 'vitest';
import {
  SHARP_IMAGE_SERVICE,
  VESPER_IMAGE_SERVICE,
  serviceKind,
  withCropStep,
} from './register.ts';

describe('withCropStep (spec §6.6.5)', () => {
  it('wraps Astro’s Sharp service, keeping its settings', () => {
    expect(
      withCropStep({ entrypoint: SHARP_IMAGE_SERVICE, config: { kernel: 'lanczos3' } }),
    ).toEqual({ entrypoint: VESPER_IMAGE_SERVICE, config: { kernel: 'lanczos3' } });
  });

  it('wraps each Sharp target of Astro 7.4’s build and runtime services', () => {
    const host = { entrypoint: '@astrojs/cloudflare/image-service', config: {} };
    expect(
      withCropStep({ build: { entrypoint: SHARP_IMAGE_SERVICE, config: {} }, runtime: host }),
    ).toEqual({ build: { entrypoint: VESPER_IMAGE_SERVICE, config: {} }, runtime: host });
    expect(withCropStep({ build: host, runtime: host })).toBeNull();
  });

  it('leaves any other service alone', () => {
    expect(withCropStep({ entrypoint: 'astro/assets/services/noop', config: {} })).toBeNull();
    expect(withCropStep({ entrypoint: './src/my-service.ts', config: {} })).toBeNull();
    expect(withCropStep({ entrypoint: VESPER_IMAGE_SERVICE, config: {} })).toBeNull();
  });
});

describe('serviceKind', () => {
  it('tells <Img> which service renders the page', () => {
    expect(serviceKind(VESPER_IMAGE_SERVICE)).toBe('vesper');
    expect(serviceKind(SHARP_IMAGE_SERVICE)).toBe('sharp');
    expect(serviceKind('@astrojs/netlify/image-service')).toBe('other');
    expect(serviceKind(undefined)).toBe('other');
  });
});
