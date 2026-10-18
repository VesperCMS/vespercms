import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildManifest, type ManifestInput } from '../manifest/build.ts';
import type { CollectionManifest, Manifest } from '../manifest/types.ts';
import { BUILD_RULE_IDS, BUILD_RULES } from './build.ts';
import { blockingNotes, entryChecker } from './entry.ts';

const site = (config: ManifestInput['config']) =>
  buildManifest({
    site: { srcDir: 'src' },
    collections: [
      {
        name: 'pages',
        loader: { kind: 'glob', base: './src/content/pages', pattern: '**/*.md', customId: false },
        schema: z.object({
          title: z.string(),
          brochure: z.string().meta({ widget: 'file' }).optional(),
        }),
      },
      {
        name: 'people',
        loader: { kind: 'file', path: 'src/data/people.json', customParser: false },
        schema: z.object({ name: z.string(), bio: z.string().meta({ widget: 'markdown' }) }),
      },
    ],
    ...(config ? { config } : {}),
  });

function collectionAt(manifest: Manifest, index: number): CollectionManifest {
  const collection = manifest.collections[index];
  if (!collection) throw new Error(`No collection ${String(index)}.`);
  return collection;
}

describe('entryChecker', () => {
  it('checks fields, then the body, with the collection’s heading start', async () => {
    const manifest = await site({ collections: { pages: { headingStart: 1 } } });
    const check = entryChecker(manifest);
    const pages = collectionAt(manifest, 0);
    const result = check(pages, {
      values: { title: 'About', brochure: '/files/about.pdf' },
      body: '# About us\n\n#### Skipped\n\n[Click here](/x/).\n',
      format: 'md',
    });
    expect(result.notes.map((n) => n.rule)).toEqual(['heading-skip', 'link-vague']);
    expect(result.pdfs.map((p) => p.href)).toEqual(['/files/about.pdf']);
  });

  it('checks only fields for data entries', async () => {
    const manifest = await site(undefined);
    const people = collectionAt(manifest, 1);
    const result = entryChecker(manifest)(people, {
      values: { name: 'Ada', bio: '[Read more](/ada/)' },
      body: '## ignored',
    });
    expect(result.notes.map((n) => [n.rule, n.target])).toEqual([
      ['link-vague', { kind: 'field', path: ['bio'] }],
    ]);
  });

  it('picks out the notes the publish gate blocks on', async () => {
    const manifest = await site({ a11y: { blockPublishOn: ['link-vague'] } });
    const pages = collectionAt(manifest, 0);
    const { notes } = entryChecker(manifest)(pages, {
      values: { title: 'About' },
      body: '#### Deep\n\n[here](/x/)\n',
    });
    expect(blockingNotes(manifest, notes).map((n) => n.rule)).toEqual(['link-vague']);
    expect(blockingNotes(await site(undefined), notes)).toEqual([]);
  });
});

describe('the build’s rules', () => {
  it('are the structure rules, with no colour or layout rules', () => {
    // Pinned: a rule joins only after its result in a DOM without layout is checked (DECISIONS.md).
    expect(BUILD_RULE_IDS).toMatchSnapshot();
    for (const visual of [
      'color-contrast',
      'link-in-text-block',
      'target-size',
      'scrollable-region-focusable',
    ])
      expect(BUILD_RULE_IDS).not.toContain(visual);
  });

  it('each has a plain message and a reason', () => {
    for (const [id, rule] of Object.entries(BUILD_RULES)) {
      expect(rule.message, id).toMatch(/^[A-Z“].*\.$/);
      expect(rule.why, id).toMatch(/^[A-Z].*\.$/);
    }
  });
});
