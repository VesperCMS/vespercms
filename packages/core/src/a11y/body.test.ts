import { describe, expect, it } from 'vitest';
import type { MarkdocManifest, MdxManifest } from '../markdoc/types.ts';
import { bodyFacts, checkBody, tagDefinitions, type BodyCheckOptions } from './body.ts';
import type { A11yNote } from './types.ts';

const markdoc: MarkdocManifest = {
  options: { allowHTML: true, ignoreIndentation: false },
  tags: [
    {
      name: 'youtube',
      label: 'YouTube video',
      selfClosing: true,
      attributes: [
        { name: 'id', types: ['String'], required: true },
        { name: 'title', types: ['String'], required: true },
        { name: 'captions', types: ['Boolean'], required: false },
      ],
      fields: [
        { path: ['id'], kind: 'string', required: true, label: 'Video ID' },
        { path: ['title'], kind: 'string', required: true, label: 'Title' },
        { path: ['captions'], kind: 'boolean', required: false, label: 'The video has captions' },
      ],
    },
    {
      name: 'callout',
      label: 'Callout',
      selfClosing: false,
      attributes: [{ name: 'title', types: ['String'], required: false }],
      fields: [{ path: ['title'], kind: 'string', required: false, label: 'Title' }],
    },
  ],
  nodes: [],
  variables: {},
  functions: [],
  partials: [],
};

const mdx: MdxManifest = {
  components: [
    {
      name: 'Video',
      label: 'Video',
      children: false,
      inline: false,
      fields: [
        { path: ['src'], kind: 'string', required: true, label: 'Source' },
        { path: ['title'], kind: 'string', required: true, label: 'Title' },
        { path: ['captions'], kind: 'boolean', required: false, label: 'Captions' },
      ],
    },
  ],
};

const options: BodyCheckOptions = {
  markdoc: markdoc.options,
  tags: tagDefinitions(markdoc, mdx),
};

const rules = (notes: readonly A11yNote[]) => notes.map((n) => n.rule);
const check = (body: string, format: 'md' | 'mdx' | 'mdoc', extra: BodyCheckOptions = {}) =>
  checkBody(body, format, { ...options, ...extra });

describe('images', () => {
  it.each(['md', 'mdx', 'mdoc'] as const)('checks alt text in %s', (format) => {
    const body = [
      '![IMG_2041.jpg](a.png)',
      '',
      '![Image of the library steps](a.png)',
      '',
      `![${'A long description of the steps '.repeat(6)}](a.png)`,
      '',
      '![The library steps at dawn](a.png)',
      '',
    ].join('\n');
    expect(rules(check(body, format).notes)).toEqual([
      'alt-file-name',
      'alt-redundant',
      'alt-too-long',
    ]);
  });

  it.each(['md', 'mdx', 'mdoc'] as const)('treats an empty alt as decorative in %s', (format) => {
    expect(check('![](a.png)\n', format).notes).toEqual([]);
  });

  it('flags an HTML image with no alt, but not alt="" or a presentational one', () => {
    for (const format of ['md', 'mdoc'] as const) {
      const { notes } = check(
        '<img src="/a.png">\n\n<img src="/b.png" alt="">\n\n<img src="/c.png" role="presentation">\n',
        format,
      );
      expect(rules(notes)).toEqual(['missing-alt']);
      expect(notes[0]?.message).toBe('Describe this image, or mark it decorative.');
      expect(notes[0]?.subject).toBe('Image “a.png”');
    }
  });

  it('flags a JSX image with no alt in MDX, and leaves an expression alone', () => {
    const { notes } = check('<img src="/a.png" />\n\n<img src="/b.png" alt={caption} />\n', 'mdx');
    expect(rules(notes)).toEqual(['missing-alt']);
  });

  it('points at the image, with its line', () => {
    const body = 'Intro.\n\n![IMG_2041.jpg](a.png)\n';
    const [note] = check(body, 'md').notes;
    expect(note?.target).toEqual({ kind: 'body', start: 8, end: 30, line: 3 });
    expect(body.slice(8, 30)).toBe('![IMG_2041.jpg](a.png)');
  });
});

describe('headings', () => {
  it.each(['md', 'mdx', 'mdoc'] as const)(
    'finds skips, extra top-level and empty headings in %s',
    (format) => {
      const body = '## Images\n\n#### Skipped\n\n# Second top\n\n##\n\n## Links\n\n### Fine\n';
      const { notes } = check(body, format);
      expect(notes.map((n) => [n.rule, n.message])).toEqual([
        ['heading-skip', 'Heading jumps from level 2 to level 4.'],
        ['heading-extra-top', 'The title is already the page’s main heading. Use level 2 here.'],
        ['heading-empty', 'This heading is empty.'],
      ]);
    },
  );

  it('names the title when the first heading skips a level', () => {
    expect(check('### Too deep\n', 'md').notes[0]?.message).toBe(
      'Heading jumps from level 1 (the title) to level 3.',
    );
  });

  it('follows the collection’s start level', () => {
    expect(check('# Title\n\n## Part\n', 'md', { headingStart: 1 }).notes).toEqual([]);
    expect(
      check('# Title\n\n# Another\n', 'md', { headingStart: 1 }).notes.map((n) => n.message),
    ).toEqual(['This page already has a main heading. Use level 2 here.']);
    expect(check('### Part\n', 'md', { headingStart: 3 }).notes).toEqual([]);
    expect(check('## Part\n', 'md', { headingStart: 3 }).notes.map((n) => n.message)).toEqual([
      'Headings here start at level 3. Use level 3 here.',
    ]);
    expect(check('## Part\n', 'md', { headingStart: 1 }).notes.map((n) => n.message)).toEqual([
      'The first heading should be level 1, not 2.',
    ]);
  });

  it('reads HTML headings in order with the rest', () => {
    expect(rules(check('## One\n\n<h4>Four</h4>\n', 'md').notes)).toEqual(['heading-skip']);
  });

  it('can leave headings out, for compact Markdown fields', () => {
    expect(check('# Big\n\n####\n', 'md', { headings: false }).notes).toEqual([]);
  });
});

describe('links', () => {
  it.each(['md', 'mdx', 'mdoc'] as const)('finds vague text and bare addresses in %s', (format) => {
    const body =
      'For the timetable, [click here](/academics/). [Read more](/blog/). See [https://example.com/programs](https://example.com/programs) or [the nursing program](/nursing/).\n';
    const { notes } = check(body, format);
    expect(notes.map((n) => [n.rule, n.subject])).toEqual([
      ['link-vague', 'Link “click here”'],
      ['link-vague', 'Link “Read more”'],
      ['link-vague', 'Link “https://example.com/programs”'],
    ]);
  });

  it('finds bare autolinks in Markdown', () => {
    expect(rules(check('Visit https://example.com/programs today.\n', 'md').notes)).toEqual([
      'link-vague',
    ]);
  });

  it('asks a new-window link to say so, in HTML and JSX', () => {
    const html = '<a href="/contact/" target="_blank">Contact the welcome center</a> to book.\n';
    expect(rules(check(html, 'md').notes)).toEqual(['link-new-window']);
    expect(rules(check(html, 'mdoc').notes)).toEqual(['link-new-window']);
    expect(rules(check(html, 'mdx').notes)).toEqual(['link-new-window']);
    const said =
      '<a href="/contact/" target="_blank">Contact us (opens in a new tab)</a>\n\n<a href="/x/" target="_blank" aria-label="Map, new window">Map</a>\n';
    expect(check(said, 'md').notes).toEqual([]);
  });

  it('names a link by the image inside it', () => {
    expect(check('[![IMG_1.jpg](a.png)](/x/)\n', 'md').notes.map((n) => n.rule)).toEqual([
      'alt-file-name',
    ]);
    expect(rules(check('<a href="/x/"><img src="a.png" alt=""></a>\n', 'md').notes)).toEqual([
      'link-vague',
    ]);
  });

  it('lists links to the site’s PDFs, not other sites’', () => {
    const { pdfs } = check(
      'Get the [course brochure](/files/brochure.pdf), the [map](./map.PDF?v=2) or [theirs](https://example.com/a.pdf).\n',
      'md',
    );
    expect(pdfs.map((p) => [p.href, p.subject])).toEqual([
      ['/files/brochure.pdf', 'PDF “course brochure”'],
      ['./map.PDF?v=2', 'PDF “map”'],
    ]);
    expect(pdfs[0]?.target).toMatchObject({ kind: 'body', line: 1 });
  });
});

describe('tables', () => {
  it('asks an HTML or JSX table for a header row', () => {
    const bare = '<table>\n  <tr><td>Monday</td><td>9 to 5</td></tr>\n</table>\n';
    const headed =
      '<table>\n  <tr><th>Day</th><th>Hours</th></tr>\n  <tr><td>Monday</td><td>9 to 5</td></tr>\n</table>\n';
    for (const format of ['md', 'mdoc', 'mdx'] as const) {
      expect(rules(check(bare, format).notes)).toEqual(['table-header']);
      expect(check(headed, format).notes).toEqual([]);
    }
  });

  it('leaves Markdown tables alone: their syntax always has a header row', () => {
    expect(check('| Day | Hours |\n| --- | --- |\n| Mon | 9–5 |\n', 'md').notes).toEqual([]);
  });
});

describe('fake lists', () => {
  it.each(['md', 'mdx', 'mdoc'] as const)('finds typed lists in %s', (format) => {
    const body = 'What to bring:\n\\- a photo ID\n\\- your acceptance letter\n1\\. arrive early\n';
    const { notes } = check(body, format);
    expect(notes.map((n) => [n.rule, n.subject])).toEqual([
      ['fake-list', 'Paragraph “What to bring:”'],
    ]);
  });

  it('leaves real lists alone', () => {
    expect(check('What to bring:\n\n- a photo ID\n- your letter\n', 'md').notes).toEqual([]);
  });
});

describe('tags and components', () => {
  it('asks for an embed’s name when it is empty, not when it is set', () => {
    const { notes } = check(
      '{% youtube id="a" title="" captions=true /%}\n\n{% youtube id="b" title="A tour" captions=true /%}\n',
      'mdoc',
    );
    expect(notes.map((n) => [n.rule, n.message, n.subject])).toEqual([
      ['tag-name-empty', 'YouTube video needs a title.', 'YouTube video'],
    ]);
  });

  it('asks to confirm captions when a video doesn’t say', () => {
    const { notes } = check(
      '{% youtube id="a" title="A" /%}\n\n{% youtube id="b" title="B" captions=false /%}\n\n{% youtube id="c" title="C" captions=true /%}\n',
      'mdoc',
    );
    expect(notes.map((n) => [n.rule, n.message])).toEqual([
      ['video-captions', 'Confirm this video has captions.'],
      ['video-captions', 'Confirm this video has captions.'],
    ]);
  });

  it('does the same for declared MDX components', () => {
    const { notes } = check(
      '<Video src="a.mp4" title="" />\n\n<Video src="b.mp4" title="Tour" captions />\n\n<Video src="c.mp4" title={t} captions={false} />\n',
      'mdx',
    );
    expect(notes.map((n) => [n.rule, n.message])).toEqual([
      ['tag-name-empty', 'Video needs a title.'],
      ['video-captions', 'Confirm this video has captions.'],
      ['video-captions', 'Confirm this video has captions.'],
    ]);
  });

  it('ignores tags it has no definition for, and optional titles', () => {
    expect(
      check('{% callout title="" %}\nHi.\n{% /callout %}\n\n{% unknown title="" /%}\n', 'mdoc')
        .notes,
    ).toEqual([]);
  });

  it('checks content inside a tag', () => {
    expect(
      rules(check('{% callout %}\n[Click here](/x/).\n{% /callout %}\n', 'mdoc').notes),
    ).toEqual(['link-vague']);
  });
});

describe('facts', () => {
  it('gives each Markdoc fact the lines it spans', () => {
    const body = 'Intro.\n\n## Images\n\n![a](b.png)\n';
    const facts = bodyFacts(body, 'mdoc', markdoc.options);
    const heading = facts.find((f) => f.kind === 'heading');
    expect(heading && body.slice(heading.start, heading.end)).toBe('## Images');
  });

  it('returns nothing for a body that doesn’t parse', () => {
    expect(bodyFacts('<Broken', 'mdx')).toEqual([]);
  });
});
