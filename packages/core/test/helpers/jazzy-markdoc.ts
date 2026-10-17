import { extractMarkdocSchema, type MarkdocConfigLike } from '../../src/markdoc/extract.ts';
import { markdocFields } from '../../src/markdoc/fields.ts';
import type { MarkdocManifest } from '../../src/markdoc/types.ts';

/*
 * The schema parts of jazzy-astro5's markdoc.config.mjs, at the commit the
 * corpus was taken from (ea28ab6, 2026-10-16), merged as @astrojs/markdoc
 * merges it (Astro's heading node with ids). The site uses `markdoc()` with
 * no options, so it parses with Astro's defaults. Render targets are
 * component paths, as Vesper records them.
 */
export const JAZZY_MARKDOC_CONFIG: MarkdocConfigLike = {
  nodes: {
    heading: {
      children: ['inline'],
      attributes: { id: { type: String }, level: { type: Number, required: true, default: 1 } },
    },
  },
  tags: {
    calculatorTool: { render: './src/components/CalculatorTool.astro', selfClosing: true },
    installCalculator: { render: './src/components/InstallCalculator.astro', selfClosing: true },
    faq: {
      render: './src/components/Faq.astro',
      selfClosing: true,
      attributes: { items: { type: Array, required: true } },
    },
    affiliateLink: {
      render: './src/components/AffiliateLink.astro',
      attributes: { slug: { type: String, required: true }, text: { type: String } },
    },
  },
};

export const JAZZY_MARKDOC: MarkdocManifest = extractMarkdocSchema(JAZZY_MARKDOC_CONFIG, {
  fields: (tag, hint) => markdocFields(tag, hint),
});
