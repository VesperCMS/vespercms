// Types for the components: Astro's virtual modules, and the integration's own.
/// <reference types="astro/client" />

declare module 'virtual:vesper/images' {
  /** The site's aspect ratios: `images.ratios` from vesper.config.ts, then the built-in `og`. */
  export const ratios: Record<string, number>;
}

// Plain tsc (this package's typecheck) doesn't read .astro files; Astro's own
// tooling types them properly in a site.
declare module '*.astro' {
  const Component: (props: Record<string, unknown>) => unknown;
  export default Component;
}
