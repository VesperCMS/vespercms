// Types for the runtime files: Astro's virtual modules, and the integration's own.
/// <reference types="astro/client" />

declare module 'virtual:vesper/page' {
  export const siteName: string;
  /** The studio's URL, with Astro's base: `/admin/` or `/sub/admin/`. */
  export const adminUrl: string;
}
