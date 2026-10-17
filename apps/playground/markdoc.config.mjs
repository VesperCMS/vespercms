import { component, defineMarkdocConfig } from '@astrojs/markdoc/config';

// The studio reads this file to build each tag's editing interface, the same
// way it reads content.config.ts (spec §6.5.1). Nothing Vesper-specific goes
// here; UI hints live in vesper.config.ts.
export default defineMarkdocConfig({
  variables: {
    product: { name: 'Vesper', beta: true, tier: 'free' },
  },
  tags: {
    callout: {
      render: component('./src/components/Callout.astro'),
      children: ['paragraph', 'list'],
      attributes: {
        type: { type: String, default: 'note', matches: ['note', 'warning', 'tip'] },
        title: { type: String },
      },
    },
    youtube: {
      render: component('./src/components/YouTube.astro'),
      selfClosing: true,
      attributes: {
        id: { type: String, required: true },
        title: { type: String, required: true },
      },
    },
    abbr: {
      render: component('./src/components/Abbr.astro'),
      inline: true,
      attributes: {
        title: { type: String, required: true },
      },
    },
  },
});
