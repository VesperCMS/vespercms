import Markdoc from '@markdoc/markdoc';
import { describe, expect, it } from 'vitest';
import { isExternal, links } from './index.ts';

const html = (source: string, options?: Parameters<typeof links>[0]) =>
  Markdoc.renderers.html(
    Markdoc.transform(Markdoc.parse(source), { nodes: { link: links(options) } }),
  );

describe('links', () => {
  it('opens links to other sites in a new tab, and says so to screen readers', () => {
    const out = html('See [the rules](https://forms.example.org/rules).', {
      site: 'https://washcofair.com',
    });
    expect(out).toContain(
      '<a href="https://forms.example.org/rules" target="_blank" rel="noopener noreferrer">',
    );
    expect(out).toContain('the rules<span style="position:absolute;');
    expect(out).toContain('> (opens in a new tab)</span></a>');
  });

  it('leaves the site’s own links, mail and phone links in the tab', () => {
    for (const href of [
      '/schedule/',
      'https://www.washcofair.com/vendors/',
      'mailto:a@b.org',
      'tel:2765551212',
      '#top',
    ]) {
      expect(html(`[x](${href})`, { site: 'https://washcofair.com' })).not.toContain('target=');
    }
  });

  it('takes its own words', () => {
    expect(html('[x](https://a.org)', { newTabLabel: '(nueva pestaña)' })).toContain(
      '(nueva pestaña)',
    );
  });
});

describe('isExternal', () => {
  it('treats every full web address as another site when it doesn’t know its own', () => {
    expect(isExternal('https://washcofair.com/x')).toBe(true);
    expect(isExternal('//cdn.example.com/a')).toBe(true);
    expect(isExternal('/files/a.pdf')).toBe(false);
  });
});
