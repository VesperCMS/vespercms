/*
 * Where the crop step goes (spec §6.6.5): around Astro's own Sharp service,
 * and nowhere else. A site that chose another service (a host's, or its own)
 * keeps it, and `<Img>` falls back to Astro's server crop there.
 */

/** The crop step's entrypoint, as Astro's `image.service.entrypoint`. */
export const VESPER_IMAGE_SERVICE = 'vespercms/image-service';

/** Astro's default service. */
export const SHARP_IMAGE_SERVICE = 'astro/assets/services/sharp';

type ServiceConfig = { entrypoint: string; config?: Record<string, unknown> };
type ImageServices = ServiceConfig | { build: ServiceConfig; runtime: ServiceConfig };

const isSharp = (service: ServiceConfig) => service.entrypoint === SHARP_IMAGE_SERVICE;

const wrap = (service: ServiceConfig): ServiceConfig =>
  isSharp(service) ? { entrypoint: VESPER_IMAGE_SERVICE, config: service.config ?? {} } : service;

/**
 * Astro's `image.service` with the crop step in place of each use of
 * Astro's Sharp service (the one service, or Astro 7.4's `build` and
 * `runtime` targets), keeping its `config`. Null when the site uses no
 * Sharp service, so nothing changes.
 */
export function withCropStep(service: ImageServices): ImageServices | null {
  if ('build' in service) {
    if (!isSharp(service.build) && !isSharp(service.runtime)) return null;
    return { build: wrap(service.build), runtime: wrap(service.runtime) };
  }
  return isSharp(service) ? wrap(service) : null;
}

/** What `<Img>` can rely on, from the entrypoint `astro:assets` reports for this page. */
export type ServiceKind = 'vesper' | 'sharp' | 'other';

export function serviceKind(entrypoint: unknown): ServiceKind {
  return entrypoint === VESPER_IMAGE_SERVICE
    ? 'vesper'
    : entrypoint === SHARP_IMAGE_SERVICE
      ? 'sharp'
      : 'other';
}
