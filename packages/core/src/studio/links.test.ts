import { describe, expect, it } from 'vitest';
import type { FieldModel } from '../field-model.ts';
import { rewriteBody, rewriteValues, type FilePlace, type LinkContext } from './links.ts';

const settings = { base: '/', trailingSlash: 'ignore', buildFormat: 'directory' } as const;

/** Nursing moves from academics/nursing to the top level. */
const context: LinkContext = {
  settings: { ...settings, site: 'https://college.example' },
  pages: new Map([
    ['/academics/nursing', '/nursing'],
    ['/academics/nursing/rn-to-bsn', '/nursing/rn-to-bsn'],
  ]),
  files: new Map([
    ['src/content/pages/academics/nursing/index.md', 'src/content/pages/nursing/index.md'],
    ['src/content/pages/academics/nursing/rn-to-bsn.md', 'src/content/pages/nursing/rn-to-bsn.md'],
    ['src/content/pages/academics/nursing/lab.jpg', 'src/content/pages/nursing/lab.jpg'],
  ]),
};

/** A page that stays where it is. */
const stays: FilePlace = {
  path: {
    from: 'src/content/pages/academics/index.md',
    to: 'src/content/pages/academics/index.md',
  },
  url: { from: '/academics/', to: '/academics/' },
};
/** The section page that moves. */
const moves: FilePlace = {
  path: {
    from: 'src/content/pages/academics/nursing/index.md',
    to: 'src/content/pages/nursing/index.md',
  },
  url: { from: '/academics/nursing/', to: '/nursing/' },
};

describe('rewriteBody: links to moved pages', () => {
  it('changes only the address, keeping its shape', () => {
    const body = [
      '',
      'See [Nursing](/academics/nursing/) and [the bridge](/academics/nursing/rn-to-bsn "RN to BSN").',
      'Absolute: [here](https://college.example/academics/nursing/#apply).',
      'Untouched: [Business](/academics/business/), [elsewhere](https://other.example/academics/nursing/).',
      '',
      '[ref]: </academics/nursing/?tab=2>',
      '',
    ].join('\n');
    const result = rewriteBody(body, 'md', context, stays);
    expect(result.text).toBe(
      [
        '',
        'See [Nursing](/nursing/) and [the bridge](/nursing/rn-to-bsn "RN to BSN").',
        'Absolute: [here](https://college.example/nursing/#apply).',
        'Untouched: [Business](/academics/business/), [elsewhere](https://other.example/academics/nursing/).',
        '',
        '[ref]: </nursing/?tab=2>',
        '',
      ].join('\n'),
    );
    expect(result).toMatchObject({ links: 4, paths: 0 });
  });

  it('leaves code alone', () => {
    const body = 'Use `[x](/academics/nursing/)`.\n\n```md\n[x](/academics/nursing/)\n```\n';
    expect(rewriteBody(body, 'md', context, stays).text).toBe(body);
  });

  it('rewrites raw HTML links', () => {
    expect(
      rewriteBody('<a href="/academics/nursing/">Nursing</a>\n', 'md', context, stays).text,
    ).toBe('<a href="/nursing/">Nursing</a>\n');
  });

  it('rewrites links relative to the page’s URL when either end moves', () => {
    expect(rewriteBody('[Nursing](nursing/)\n', 'md', context, stays).text).toBe(
      '[Nursing](/nursing/)\n',
    );
    // From the moved page, `../business/` would now point at /business/.
    expect(rewriteBody('[Business](../business/)\n', 'md', context, moves).text).toBe(
      '[Business](/academics/business/)\n',
    );
    // A link inside the moved section stays right as written.
    expect(rewriteBody('[Bridge](rn-to-bsn/)\n', 'md', context, moves).text).toBe(
      '[Bridge](rn-to-bsn/)\n',
    );
    expect(rewriteBody('[Top](#top)\n', 'md', context, moves).text).toBe('[Top](#top)\n');
  });
});

describe('rewriteBody: files relative to a moved file', () => {
  it('keeps images pointing at the same files', () => {
    const body = '![Lab](./lab.jpg)\n\n![Logo](../../../assets/logo.png)\n';
    const result = rewriteBody(body, 'md', context, moves);
    // lab.jpg moved with the folder; the logo didn't move, but the page did.
    expect(result.text).toBe('![Lab](./lab.jpg)\n\n![Logo](../../assets/logo.png)\n');
    expect(result).toMatchObject({ links: 0, paths: 1 });
  });

  it('updates a page that stays when an image it shows moves', () => {
    expect(rewriteBody('![Lab](nursing/lab.jpg)\n', 'md', context, stays).text).toBe(
      '![Lab](../nursing/lab.jpg)\n',
    );
  });

  it('fixes MDX imports and Markdoc partials in a moved file', () => {
    const mdx = "import Gallery from '../../../../components/Gallery.astro';\n\n<Gallery />\n";
    expect(rewriteBody(mdx, 'mdx', context, moves).text).toBe(
      "import Gallery from '../../../components/Gallery.astro';\n\n<Gallery />\n",
    );
    const mdoc = '{% partial file="../../_hours.mdoc" /%}\n';
    expect(rewriteBody(mdoc, 'mdoc', context, moves).text).toBe(
      '{% partial file="../_hours.mdoc" /%}\n',
    );
  });
});

describe('rewriteBody: tag attributes', () => {
  it('rewrites Markdoc attributes that hold a moved page’s URL', () => {
    const body =
      '{% callout type="tip" link="/academics/nursing/" %}\nSee [it](/academics/nursing/).\n{% /callout %}\n\n```\n{% x link="/academics/nursing/" /%}\n```\n';
    expect(rewriteBody(body, 'mdoc', context, stays).text).toBe(
      '{% callout type="tip" link="/nursing/" %}\nSee [it](/nursing/).\n{% /callout %}\n\n```\n{% x link="/academics/nursing/" /%}\n```\n',
    );
  });

  it('rewrites MDX attributes that hold a moved page’s URL', () => {
    const body =
      '<Callout type="tip" href="/academics/nursing/">\n  Read [more](/academics/nursing/rn-to-bsn/).\n</Callout>\n\nInline <Link to=\'/academics/nursing\' /> too.\n';
    expect(rewriteBody(body, 'mdx', context, stays).text).toBe(
      '<Callout type="tip" href="/nursing/">\n  Read [more](/nursing/rn-to-bsn/).\n</Callout>\n\nInline <Link to="/nursing" /> too.\n',
    );
  });
});

describe('rewriteValues', () => {
  const field = (path: string[], extra: Partial<FieldModel> = {}): FieldModel => ({
    path,
    kind: 'string',
    required: false,
    label: path.join('.'),
    ...extra,
  });
  const fields: FieldModel[] = [
    field(['unpublishRedirect'], { widget: 'url' }),
    field(['note']),
    field(['links'], { kind: 'array', children: [field(['links', '*'], { widget: 'url' })] }),
    field(['hero'], { kind: 'object', children: [field(['hero', 'src'], { kind: 'image' })] }),
  ];

  it('rewrites URL fields, at any depth, and only those', () => {
    const result = rewriteValues(
      {
        unpublishRedirect: '/academics/nursing/',
        note: '/academics/nursing/',
        links: ['/academics/nursing/rn-to-bsn/', '/about/'],
      },
      fields,
      context,
      stays,
    );
    expect(result.data).toEqual({
      unpublishRedirect: '/nursing/',
      note: '/academics/nursing/',
      links: ['/nursing/rn-to-bsn/', '/about/'],
    });
    expect(result.links).toBe(2);
  });

  it('rewrites a URL field by each item’s own kind', () => {
    const blocks = field(['blocks'], {
      kind: 'array',
      children: [
        field(['blocks', '[]'], {
          kind: 'union',
          discriminator: 'type',
          variants: [
            {
              value: 'cta',
              label: 'CTA',
              children: [field(['blocks', '[]', 'href'], { widget: 'url' })],
            },
            { value: 'text', label: 'Text', children: [field(['blocks', '[]', 'href'])] },
          ],
        }),
      ],
    });
    const result = rewriteValues(
      {
        blocks: [
          { type: 'cta', href: '/academics/nursing/' },
          // The same key in a kind where it isn't a URL field stays as it is.
          { type: 'text', href: '/academics/nursing/' },
        ],
      },
      [blocks],
      context,
      stays,
    );
    expect(result.data).toEqual({
      blocks: [
        { type: 'cta', href: '/nursing/' },
        { type: 'text', href: '/academics/nursing/' },
      ],
    });
    expect(result.links).toBe(1);
  });

  it('keeps relative paths pointing at the same files', () => {
    const result = rewriteValues(
      { hero: { src: '../../../assets/blog/harbor.jpg' }, note: './lab.jpg' },
      fields,
      context,
      moves,
    );
    expect(result.data).toEqual({
      hero: { src: '../../assets/blog/harbor.jpg' },
      note: './lab.jpg',
    });
    expect(result.paths).toBe(1);
  });
});
