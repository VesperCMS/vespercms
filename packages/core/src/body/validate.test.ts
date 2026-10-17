import { describe, expect, it } from 'vitest';
import { markdocConfigFromManifest } from '../markdoc/config.ts';
import { extractMarkdocSchema } from '../markdoc/extract.ts';
import { markdocFields } from '../markdoc/fields.ts';
import {
  partialChecker,
  resolvePartial,
  validateMarkdocBody,
  validateMdxBody,
} from './validate.ts';

const manifest = extractMarkdocSchema(
  {
    tags: {
      callout: {
        children: ['paragraph', 'list'],
        attributes: {
          type: { type: String, default: 'note', matches: ['note', 'warning', 'tip'] },
          title: { type: String },
        },
      },
      youtube: {
        selfClosing: true,
        attributes: {
          id: { type: String, required: true },
          title: { type: String, required: true },
        },
      },
      abbr: { inline: true, attributes: { title: { type: String, required: true } } },
    },
  },
  {
    hints: { youtube: { label: 'YouTube video', attributes: { title: { label: 'Video title' } } } },
    fields: (tag, hint) => markdocFields(tag, hint),
  },
);
const options = { config: markdocConfigFromManifest(manifest), tags: manifest.tags };

describe('validateMarkdocBody', () => {
  it('blocks on a missing required attribute, in plain language naming the block', () => {
    const body = '\nIntro.\n\n{% youtube id="abc" /%}\n';
    expect(validateMarkdocBody(body, options)).toEqual([
      {
        line: 4,
        level: 'error',
        code: 'attribute-missing-required',
        name: 'youtube',
        attribute: 'title',
        message: 'YouTube video: Video title is required.',
      },
    ]);
  });

  it('explains a value outside matches, and a misplaced tag', () => {
    const body =
      '{% callout type="danger" %}\nHi.\n{% /callout %}\n\n{% abbr title="x" %}\nBlock.\n{% /abbr %}\n';
    expect(validateMarkdocBody(body, options).map((i) => [i.line, i.level, i.message])).toEqual([
      [1, 'error', 'Callout: Type must be one of Note, Warning or Tip.'],
      [5, 'error', 'Abbr goes inside a line of text, not on a line of its own.'],
    ]);
  });

  it('warns, without blocking, on unknown tags and content a tag can’t hold', () => {
    const body = '{% gallery /%}\n\n{% callout %}\n## A heading\n{% /callout %}\n';
    expect(validateMarkdocBody(body, options).map((i) => [i.level, i.code])).toEqual([
      ['warning', 'tag-undefined'],
      ['warning', 'child-invalid'],
    ]);
  });

  it('ignores undefined variables, as Astro does, and HTML when the site allows it', () => {
    const body = 'Hi {% $who %}.\n\n<div>raw</div>\n';
    expect(validateMarkdocBody(body, { ...options, parse: { allowHTML: true } })).toEqual([]);
  });

  it('checks that a partial’s file exists, instead of Markdoc’s own check', () => {
    const body = '{% partial file="_here.mdoc" /%}\n\n{% partial file="_gone.mdoc" /%}\n';
    const issues = validateMarkdocBody(body, {
      ...options,
      partialExists: (file) => file === '_here.mdoc',
    });
    expect(issues.map((i) => [i.line, i.level, i.code])).toEqual([[3, 'error', 'partial-missing']]);
    expect(validateMarkdocBody(body, options)).toEqual([]);
  });

  it('finds nothing wrong with valid content', () => {
    const body =
      '{% callout type="tip" title="T" %}\nThe {% abbr title="x" %}CMS{% /abbr %}.\n\n- a\n{% /callout %}\n\n{% youtube id="a" title="b" /%}\n';
    expect(validateMarkdocBody(body, options)).toEqual([]);
  });
});

describe('validateMdxBody', () => {
  const components = new Map([
    [
      'YouTube',
      {
        label: 'YouTube video',
        fields: [{ path: ['title'], kind: 'string' as const, required: true, label: 'Title' }],
        validate: (props: Record<string, unknown>) =>
          typeof props.title === 'string'
            ? []
            : [{ path: ['title'], message: 'This is required.' }],
      },
    ],
  ]);

  it('checks declared components, block and inline, with their own validation', async () => {
    const body = '<YouTube id="a" />\n\nText <YouTube id="b" title="ok" /> and <Other />.\n';
    expect(await validateMdxBody(body, components)).toEqual([
      {
        line: 1,
        level: 'error',
        code: 'props',
        name: 'YouTube',
        attribute: 'title',
        message: 'YouTube video: Title: This is required.',
      },
    ]);
  });

  it('skips props that hold code, and components with spreads', async () => {
    const body = '<YouTube title={t} />\n\n<YouTube {...props} />\n';
    expect(await validateMdxBody(body, components)).toEqual([]);
  });
});

describe('resolvePartial', () => {
  it('resolves like @astrojs/markdoc: from the entry’s folder, or the site root', () => {
    const entry = 'src/content/docs/guides/writing.mdoc';
    expect(resolvePartial(entry, '../_support.mdoc')).toBe('src/content/docs/_support.mdoc');
    expect(resolvePartial(entry, './_x.mdoc')).toBe('src/content/docs/guides/_x.mdoc');
    expect(resolvePartial(entry, '_x.mdoc')).toBe('src/content/docs/guides/_x.mdoc');
    expect(resolvePartial(entry, '/src/partials/a.mdoc')).toBe('src/partials/a.mdoc');
    expect(resolvePartial(entry, '../../../../../x.mdoc')).toBeNull();
    const exists = partialChecker(entry, ['src/content/docs/_support.mdoc']);
    expect([exists('../_support.mdoc'), exists('_support.mdoc')]).toEqual([true, false]);
  });
});
