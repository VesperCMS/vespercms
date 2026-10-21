import { component, defineMarkdocConfig } from '@astrojs/markdoc/config';
import shiki from '@astrojs/markdoc/shiki';

// The studio reads this file to build each tag's settings (spec §6.5.1); its
// labels and help text live in vesper.config.ts.
export default defineMarkdocConfig({
  // Both themes' colours as CSS variables; site.css picks one with the
  // page's colour scheme. The high-contrast themes, because the plain GitHub
  // ones miss 4.5:1 on some tokens (axe, in e2e/site).
  extends: [
    shiki({
      themes: { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' },
      defaultColor: false,
    }),
  ],
  tags: {
    callout: {
      render: component('./src/components/Callout.astro'),
      children: ['paragraph', 'list', 'fence'],
      attributes: {
        type: { type: String, default: 'note', matches: ['note', 'tip', 'warning'] },
        title: { type: String },
      },
    },
  },
});
