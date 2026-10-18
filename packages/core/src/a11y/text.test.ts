import { describe, expect, it } from 'vitest';
import {
  isFakeList,
  listLikeLines,
  looksLikeFileName,
  quoted,
  redundantAltPrefix,
  saysNewWindow,
  vagueLinkText,
} from './text.ts';
import { contrastRatio, formatRatio, parseHexColor } from './contrast.ts';
import { decodeEntities, htmlElements, htmlTags, plainText } from './html.ts';

describe('alt text', () => {
  it.each([
    'IMG_2041.jpg',
    'img_2041',
    'DSC0042',
    'PXL_20260412_101500',
    'Screenshot 2026-10-18 at 9.41.12',
    'photo-1.png',
    'hero_banner',
    'header-image-2',
    'campus.webp',
  ])('%s looks like a file name', (alt) => {
    expect(looksLikeFileName(alt)).toBe(true);
  });

  it.each([
    'The library steps at dawn',
    'Harbor-at-dawn',
    'A diagram of the 2026 enrollment process',
    'Three students on the steps, one holding a sign that reads “Welcome week.”',
    'Logo',
    '',
  ])('%s does not', (alt) => {
    expect(looksLikeFileName(alt)).toBe(false);
  });

  it('finds a redundant opening, but not the words elsewhere', () => {
    expect(redundantAltPrefix('Image of the library steps')).toBe('Image of');
    expect(redundantAltPrefix('A photo of a harbor')).toBe('A photo of');
    expect(redundantAltPrefix('picture of a cat')).toBe('picture of');
    expect(redundantAltPrefix('The image of the founder hangs in the hall')).toBeNull();
    expect(redundantAltPrefix('Imagery from the archive')).toBeNull();
  });
});

describe('link text', () => {
  it.each([
    'click here',
    'Click here.',
    'here',
    'Read more',
    'read more →',
    'More',
    'learn more',
    'this link',
  ])('%s is vague', (text) => {
    expect(vagueLinkText(text, '/x/')).toBe('vague');
  });

  it('flags a bare address, with or without its scheme', () => {
    expect(vagueLinkText('https://example.com/programs', 'https://example.com/programs')).toBe(
      'address',
    );
    expect(vagueLinkText('www.example.com', 'https://www.example.com')).toBe('address');
    expect(vagueLinkText('example.com/programs', 'https://example.com/programs/')).toBe('address');
  });

  it('flags a link with no text', () => {
    expect(vagueLinkText('  ', '/x/')).toBe('empty');
  });

  it('accepts text that says where the link goes', () => {
    expect(vagueLinkText('the course brochure', '/files/brochure.pdf')).toBeNull();
    expect(vagueLinkText('Read more about nursing', '/academics/nursing/')).toBeNull();
    expect(vagueLinkText('Example', 'https://example.com')).toBeNull();
  });

  it('knows when a link says it opens a new tab', () => {
    expect(saysNewWindow('Contact us (opens in a new tab)')).toBe(true);
    expect(saysNewWindow('Contact us', 'Contact us, new window')).toBe(true);
    expect(saysNewWindow('Contact us', undefined, 'Opens in a new browser tab')).toBe(true);
    expect(saysNewWindow('What’s new at the library')).toBe(false);
  });
});

describe('fake lists', () => {
  it('needs two lines that start like list items', () => {
    expect(isFakeList('What to bring:\n\\- a photo ID\n\\- your acceptance letter')).toBe(true);
    expect(isFakeList('Steps:\n1\\. Apply\n2. Enrol')).toBe(true);
    expect(isFakeList('• one\n• two')).toBe(true);
    expect(isFakeList('1) first\n2) second')).toBe(true);
    expect(
      listLikeLines(
        'What to bring:\n\\- a photo ID\n\\- your acceptance letter\n1\\. arrive early',
      ),
    ).toBe(3);
  });

  it('leaves ordinary paragraphs alone', () => {
    expect(isFakeList('1999. That was a year.')).toBe(false);
    expect(isFakeList('A line\n*emphasis* on the next\n**bold** after')).toBe(false);
    expect(isFakeList('Prices went up - again - this year.\nAnd again.')).toBe(false);
  });
});

describe('contrast', () => {
  it('reads hex colours', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('#a3abbd')).toEqual({ r: 163, g: 171, b: 189 });
    expect(parseHexColor('#a3abbd80')).toEqual({ r: 163, g: 171, b: 189 });
    expect(parseHexColor('red')).toBeNull();
  });

  it('matches WCAG’s ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // WebAIM's checker: #767676 on white is 4.54:1, the lightest grey that passes.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#ffffff', '#767676')).toBeCloseTo(4.54, 2);
  });

  it('rounds down, so a failing ratio never reads as a pass', () => {
    expect(formatRatio(4.4999)).toBe('4.4:1');
    expect(formatRatio(2.27)).toBe('2.2:1');
    expect(formatRatio(21)).toBe('21:1');
  });
});

describe('HTML', () => {
  it('reads tags and attributes in any quoting', () => {
    const [a, img] = htmlTags(
      `<a href="/x/" target=_blank data-x='1'>x</a><IMG SRC="a.png" alt="">`,
    ).filter((t) => !t.closing);
    expect(a).toMatchObject({
      name: 'a',
      attributes: { href: '/x/', target: '_blank', 'data-x': '1' },
    });
    expect(img).toMatchObject({ name: 'img', attributes: { src: 'a.png', alt: '' } });
  });

  it('skips comments', () => {
    expect(htmlTags('<!-- <img src="x"> -->')).toEqual([]);
  });

  it('finds elements with what is inside them', () => {
    const [table] = htmlElements(
      '<table>\n  <tr><th>Day</th></tr>\n  <tr><td>Monday</td></tr>\n</table>',
      new Set(['table']),
    );
    expect(table?.contains.has('th')).toBe(true);
    const [link] = htmlElements('<a href="/"><em>Home</em> page</a>', new Set(['a']));
    expect(plainText(link?.inner ?? '')).toBe('Home page');
  });

  it('decodes the common entities', () => {
    expect(decodeEntities('Tom &amp; Jerry &#8217;s &#x2019; &nbsp;&unknown;')).toBe(
      'Tom & Jerry ’s ’  &unknown;',
    );
  });

  it('quotes and shortens subjects', () => {
    expect(quoted('IMG_2041.jpg')).toBe('“IMG_2041.jpg”');
    expect(quoted('a'.repeat(60))).toBe(`“${'a'.repeat(39)}…”`);
  });
});
