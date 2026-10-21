import { readFileSync } from 'node:fs';
import type { CollectionManifest, FieldModel, Manifest } from '@vesper/core';
import { describe, expect, it } from 'vitest';
import { AGENTS_END, AGENTS_START, agentGuide, withAgentGuide } from './agents.ts';

// The playground's committed manifest (manifest.integration.test.ts keeps it
// current), so these tests need no Vite and no Astro.
const playground = JSON.parse(
  readFileSync(
    new URL('../../test/__snapshots__/playground.manifest.json', import.meta.url),
    'utf8',
  ),
) as Manifest;

const field = (path: string, model: Partial<FieldModel>): FieldModel => ({
  path: path.split('.'),
  kind: 'string',
  required: true,
  label: path.split('.').at(-1) ?? path,
  ...model,
});

const site = (collections: CollectionManifest[], extra: Partial<Manifest> = {}): Manifest => ({
  manifestVersion: 1,
  generator: { name: 'test', version: '0' },
  hash: '',
  site: { srcDir: 'src', contentConfig: 'src/content.config.ts' },
  collections,
  forms: [],
  diagnostics: [],
  ...extra,
});

const notes = (
  fields: FieldModel[],
  presentation: CollectionManifest['presentation'] = {},
): CollectionManifest => ({
  name: 'notes',
  label: 'Notes',
  editable: true,
  source: {
    loader: 'glob',
    base: 'src/content/notes',
    pattern: '**/*.md',
    generateId: 'default',
    formats: ['md'],
  },
  entryKind: 'content',
  fields,
  presentation,
});

describe('agentGuide', () => {
  it('describes the playground (snapshot)', async () => {
    await expect(agentGuide(playground)).toMatchFileSnapshot('__snapshots__/playground.agents.md');
  });

  it('is the same text every time, so --check can compare it', () => {
    expect(agentGuide(playground)).toBe(agentGuide(structuredClone(playground)));
  });

  it('describes each field with whether it must be there', () => {
    const guide = agentGuide(
      site([
        notes([
          field('title', {}),
          field('subtitle', { required: false }),
          field('tags', {
            kind: 'array',
            required: false,
            default: [],
            children: [field('tags.[]', {})],
          }),
          field('author', { kind: 'reference', reference: { collection: 'people' } }),
          field('level', {
            kind: 'enum',
            constraints: {
              options: [
                { value: 'a', label: 'A' },
                { value: 'pro', label: 'Professional' },
              ],
            },
          }),
          field('rating', { kind: 'number', constraints: { integer: true, min: 1, max: 5 } }),
        ]),
      ]),
    );
    expect(guide).toContain('- `title`: text. Required.');
    expect(guide).toContain('- `subtitle`: text. Optional.');
    expect(guide).toContain('- `tags`: a list of strings. Default `[]`.');
    expect(guide).toContain('- `author`: the ID of an entry in `people`. Required.');
    expect(guide).toContain('- `level`: one of `a`, `pro` (Professional). Required.');
    expect(guide).toContain('- `rating`: a whole number from 1 to 5. Required.');
  });

  it('nests an object’s fields under it', () => {
    const guide = agentGuide(
      site([
        notes([
          field('seo', {
            kind: 'object',
            required: false,
            label: 'Search engines',
            children: [field('seo.title', { description: 'For the browser tab.' })],
          }),
        ]),
      ]),
    );
    expect(guide).toContain(
      '- `seo` (Search engines): an object with the fields below. Optional.\n  - `title`: text. Required. For the browser tab.',
    );
  });

  it('explains images, trees, redirects and tags only for sites that have them', () => {
    const plain = agentGuide(site([notes([field('title', {})])]));
    expect(plain).not.toContain('### Images');
    expect(plain).not.toContain('### Page trees');
    expect(plain).not.toContain('### Redirects');
    expect(plain).not.toContain('### Markdoc tags');

    const full = agentGuide(playground);
    expect(full).toContain('### Images');
    expect(full).toContain('In `pages`, the folder is the hierarchy');
    expect(full).toContain('### Redirects');
    expect(full).toContain('- `{% youtube /%}` (YouTube video): self-closing.');
    expect(full).toContain('  - `id` (Video ID): text. Required.');
  });

  it('says why a read-only collection is read only', () => {
    const custom = {
      ...notes([]),
      editable: false,
      readOnlyReason: 'custom-loader' as const,
      source: { loader: 'other' as const },
    };
    expect(agentGuide(site([custom]))).toContain(
      'The studio shows this collection read only: it uses a loader other than glob() or file()',
    );
  });

  it('lists the accessibility rules that refuse a save', () => {
    const guide = agentGuide(
      site([notes([field('title', {})])], {
        site: { srcDir: 'src', a11y: { blockPublishOn: ['missing-alt'], backgrounds: [] } },
      }),
    );
    expect(guide).toContain('these accessibility issues:** `missing-alt`');
  });
});

describe('withAgentGuide', () => {
  const guide = '## Content\n\nRules.\n';

  it('makes a new file of just the marked section', () => {
    const file = withAgentGuide(null, guide);
    expect(file.startsWith(`${AGENTS_START}\n`)).toBe(true);
    expect(file.endsWith(`## Content\n\nRules.\n${AGENTS_END}\n`)).toBe(true);
  });

  it('adds the section after what the file already says', () => {
    const file = withAgentGuide('# My site\n\nUse pnpm.\n', guide);
    expect(file.startsWith('# My site\n\nUse pnpm.\n\n<!-- vesper:agents:start -->\n')).toBe(true);
  });

  it('replaces only the marked section, and changes nothing the second time', () => {
    const before = '# My site\n\n';
    const after = '\n## Deploying\n\nRun the script.\n';
    const old = `${before}${AGENTS_START}\nOld rules.\n${AGENTS_END}\n${after}`;
    const once = withAgentGuide(old, guide);
    expect(once.startsWith(before)).toBe(true);
    expect(once.endsWith(`${AGENTS_END}\n${after}`)).toBe(true);
    expect(once).not.toContain('Old rules.');
    expect(withAgentGuide(once, guide)).toBe(once);
  });

  it('keeps a file’s Windows line endings', () => {
    const file = withAgentGuide('# My site\r\n', guide);
    expect(file).toContain(`\r\n${AGENTS_START}\r\n`);
    expect(file.replace(/\r\n/g, '')).not.toContain('\n');
  });
});
