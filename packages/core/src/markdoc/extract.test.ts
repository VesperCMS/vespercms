import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../field-model.ts';
import { markdocConfigFromManifest } from './config.ts';
import { extractMarkdocSchema } from './extract.ts';
import { markdocFields } from './fields.ts';

class Slug {
  validate(value: unknown) {
    return typeof value === 'string' && /^[a-z-]+$/.test(value)
      ? []
      : [{ id: 'slug', level: 'error', message: 'Not a slug' }];
  }
}

/** The playground's tags, as @astrojs/markdoc's setupConfig would merge them (plus edge cases). */
const config = {
  variables: { product: { name: 'Vesper', beta: true, tier: 'free' }, list: [1, 2] },
  functions: { upper: { transform: () => '' } },
  partials: { 'footer.mdoc': {} },
  nodes: {
    heading: {
      children: ['inline'],
      attributes: { id: { type: String }, level: { type: Number, required: true, default: 1 } },
    },
  },
  tags: {
    callout: {
      render: { type: 'local', path: './src/components/Callout.astro', namedExport: undefined },
      children: ['paragraph', 'list'],
      attributes: {
        type: { type: String, default: 'note', matches: ['note', 'warning', 'tip'] },
        title: { type: String },
      },
    },
    youtube: {
      render: 'iframe',
      selfClosing: true,
      attributes: {
        id: { type: String, required: true, matches: /^[\w-]{11}$/ },
        title: { type: String, required: true },
        captions: { type: Boolean },
        start: { type: Number },
        chapters: { type: Array },
        slug: { type: Slug },
        either: { type: [String, Number] },
        dynamic: { type: String, matches: () => ['a'] },
      },
      validate: () => [],
    },
    abbr: { inline: true, attributes: { title: { type: String, required: true } } },
    'html-tag': { attributes: { name: { type: String } } },
  },
};

describe('extractMarkdocSchema', () => {
  const diagnostics: Diagnostic[] = [];
  const manifest = extractMarkdocSchema(config, {
    options: { allowHTML: true },
    hints: {
      callout: {
        label: 'Callout',
        summary: 'type',
        attributes: { type: { labels: { tip: 'Tip!' } }, colour: { label: 'x' } },
      },
      gallery: { label: 'Gallery' },
    },
    diagnostics,
    fields: (tag, hint) => markdocFields(tag, hint),
  });

  it('records tags, attributes and render targets by name only, and skips Astro’s own tags', () => {
    expect(manifest.options).toEqual({ allowHTML: true, ignoreIndentation: false });
    expect(manifest.tags.map((t) => [t.name, t.label, t.render, t.selfClosing, t.inline])).toEqual([
      ['callout', 'Callout', './src/components/Callout.astro', false, undefined],
      ['youtube', 'Youtube', 'iframe', true, undefined],
      ['abbr', 'Abbr', undefined, false, true],
    ]);
    expect(manifest.tags[0]?.children).toEqual(['paragraph', 'list']);
    expect(manifest.tags[1]?.customValidation).toBe(true);
    expect(manifest.tags[1]?.attributes).toEqual([
      {
        name: 'id',
        types: ['String'],
        required: true,
        matches: { pattern: '^[\\w-]{11}$', flags: '' },
      },
      { name: 'title', types: ['String'], required: true },
      { name: 'captions', types: ['Boolean'], required: false },
      { name: 'start', types: ['Number'], required: false },
      { name: 'chapters', types: ['Array'], required: false },
      { name: 'slug', types: [], customType: 'Slug', required: false },
      { name: 'either', types: ['String', 'Number'], required: false },
      { name: 'dynamic', types: ['String'], required: false, matches: { dynamic: true } },
    ]);
  });

  it('keeps variables’ keys, never their values, and lists functions, partials and nodes', () => {
    expect(manifest.variables).toEqual({ product: { name: {}, beta: {}, tier: {} }, list: {} });
    expect(manifest.functions).toEqual(['upper']);
    expect(manifest.partials).toEqual(['footer.mdoc']);
    expect(manifest.nodes.map((n) => n.name)).toEqual(['heading']);
    expect(JSON.stringify(manifest)).not.toContain('Vesper');
  });

  it('warns about hints for tags and attributes the config doesn’t have', () => {
    expect(diagnostics.map((d) => d.message)).toEqual([
      'vesper.config.ts has hints for "colour" on the Markdoc tag "callout", which has no such attribute.',
      'vesper.config.ts has hints for the Markdoc tag "gallery", but markdoc.config doesn\'t define it.',
    ]);
  });

  it('maps attributes to settings fields', () => {
    const callout = manifest.tags[0]?.fields ?? [];
    expect(callout[0]).toMatchObject({
      kind: 'enum',
      widget: 'radio',
      default: 'note',
      constraints: {
        options: [
          { value: 'note', label: 'Note' },
          { value: 'warning', label: 'Warning' },
          { value: 'tip', label: 'Tip!' },
        ],
      },
    });
    expect((manifest.tags[1]?.fields ?? []).map((f) => [f.path[0], f.kind, f.required])).toEqual([
      ['id', 'string', true],
      ['title', 'string', true],
      ['captions', 'boolean', false],
      ['start', 'number', false],
      ['chapters', 'unknown', false],
      ['slug', 'string', false],
      ['either', 'unknown', false],
      ['dynamic', 'string', false],
    ]);
    expect(manifest.tags[1]?.fields[0]?.constraints).toEqual({ pattern: '^[\\w-]{11}$' });
  });

  it('rebuilds a config Markdoc validates with', () => {
    const rebuilt = markdocConfigFromManifest(manifest);
    expect(rebuilt.tags?.youtube?.attributes?.id).toMatchObject({ type: String, required: true });
    expect(rebuilt.tags?.youtube?.attributes?.id?.matches).toBeInstanceOf(RegExp);
    expect(rebuilt.tags?.callout?.attributes?.type?.matches).toEqual(['note', 'warning', 'tip']);
    expect(rebuilt.tags?.youtube?.attributes?.slug?.type).toBeUndefined();
    expect(rebuilt.tags?.abbr?.inline).toBe(true);
  });
});
