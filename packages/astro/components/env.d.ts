// Types for the components: Astro's virtual modules, and the integration's own.
/// <reference types="astro/client" />

declare module 'virtual:vesper/images' {
  /** The site's aspect ratios: `images.ratios` from vesper.config.ts, then the built-in `og`. */
  export const ratios: Record<string, number>;
}

declare module 'virtual:vesper/search' {
  /** What <Search> needs from the integration's `search` options. */
  export const search: {
    /** Pagefind's bundle: `<base>_vesper/search/`. */
    bundle: string;
    /** The /search page's URL. */
    page: string;
    /** The site's home page. */
    home: string;
    siteName: string;
    /** `opensearch.xml`'s URL, or null without Astro's `site`. */
    openSearch: string | null;
    /** The site's host, for DuckDuckGo's `sites=`, or null without `site`. */
    host: string | null;
    sitemap: string | null;
    noJsLink: string | null;
    noJsFallback: 'duckduckgo' | null;
    strings: Record<string, Record<string, string>>;
    sort: Record<string, { key: string; label: string; kind: 'date' | 'number' | 'string' }[]>;
  };
}

// Plain tsc (this package's typecheck) doesn't read .astro files; Astro's own
// tooling types them properly in a site.
declare module '*.astro' {
  const Component: (props: Record<string, unknown>) => unknown;
  export default Component;
}
