import Markdoc, { type Config, type Node, type Schema } from '@markdoc/markdoc';

/*
 * Helpers for a site's markdoc.config.mjs.
 *
 * Markdoc can't put an attribute on one link (an annotation attaches to the
 * paragraph around it), so "open in a new tab" is a rule for the whole site
 * instead: links to other sites open in a new tab and say so to screen
 * readers, and links within the site don't (DECISIONS.md, "Links to other
 * sites open in a new tab, site-wide").
 */

export type LinksOptions = {
  /** The site's own address, so a full URL to it stays in the tab. Astro's `site`. */
  site?: string;
  /** Words screen readers hear after a link that opens a new tab. */
  newTabLabel?: string;
};

const HIDDEN =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

/** Whether `href` leaves the site: a web address on another host. */
export function isExternal(href: string, site?: string): boolean {
  if (!/^(?:https?:)?\/\//i.test(href)) return false;
  if (!site) return true;
  try {
    const own = new URL(site).host.toLowerCase().replace(/^www\./, '');
    const there = new URL(href, site).host.toLowerCase().replace(/^www\./, '');
    return own !== there;
  } catch {
    return true;
  }
}

/**
 * Markdoc's `link` node, with links to other sites opening in a new tab:
 *
 *   import { links } from 'vespercms/markdoc';
 *   export default defineMarkdocConfig({ nodes: { link: links({ site: 'https://example.com' }) } });
 */
export function links(options: LinksOptions = {}): Schema {
  const label = options.newTabLabel ?? '(opens in a new tab)';
  return {
    ...Markdoc.nodes.link,
    transform(node: Node, config: Config) {
      const attributes = node.transformAttributes(config) as Record<string, unknown>;
      const children = node.transformChildren(config);
      const href = typeof attributes.href === 'string' ? attributes.href : '';
      if (!isExternal(href, options.site)) return new Markdoc.Tag('a', attributes, children);
      return new Markdoc.Tag('a', { ...attributes, target: '_blank', rel: 'noopener noreferrer' }, [
        ...children,
        new Markdoc.Tag('span', { style: HIDDEN }, [` ${label}`]),
      ]);
    },
  };
}
