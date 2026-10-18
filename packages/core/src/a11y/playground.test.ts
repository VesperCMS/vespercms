import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Manifest } from '../manifest/types.ts';
import { MemoryStorage } from '../storage/memory.ts';
import { ContentService } from '../studio/service.ts';
import { entryChecker } from './entry.ts';
import { pdfNotes } from './fields.ts';
import { A11Y_RULE_IDS } from './rules.ts';
import type { A11yNote } from './types.ts';

/*
 * The layer-1 rules over the playground itself (spec §11, Phase 2.8: "every
 * layer-1 rule fires on the playground's deliberately flawed fixtures, with
 * the message shown beside the right field"), with the manifest the astro
 * package keeps current. And the other side: the real content, whose pages
 * already pass axe, gets no notes.
 */

const playground = fileURLToPath(new URL('../../../../apps/playground/', import.meta.url));
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../astro/test/__snapshots__/playground.manifest.json', import.meta.url),
    ),
    'utf8',
  ),
) as Manifest;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

async function content(): Promise<ContentService> {
  const found: Record<string, Uint8Array> = {};
  for (const path of [
    ...files(join(playground, 'src/content')),
    ...files(join(playground, 'src/data')),
  ])
    found[relative(playground, path).replaceAll('\\', '/')] = new Uint8Array(readFileSync(path));
  return new ContentService(await MemoryStorage.create(found), manifest);
}

/** Where each note is shown, as the studio places it: a field path, or a body line. */
const place = (note: A11yNote) =>
  note.target.kind === 'field'
    ? note.target.path.join('.')
    : `body line ${String(note.target.line)}`;

/** What the studio reads from public/files/untagged-brochure.pdf with PDF.js (admin pdf.test.ts reads the file). */
const UNTAGGED = { tagged: false, title: null, language: null };

describe('the playground', () => {
  it('fires every layer-1 rule on the accessibility fixture, each beside its field', async () => {
    const service = await content();
    const collection = manifest.collections.find((c) => c.name === 'fixtures');
    const [entry] = await service.entriesOf('fixtures');
    if (!collection || !entry) throw new Error('The playground has no accessibility fixture.');
    // The studio edits the body without the line breaks after the frontmatter.
    const body = (entry.body ?? '').replace(/^(?:\r?\n)+/, '');
    const found = entryChecker(manifest)(collection, { values: entry.data, body, format: 'mdoc' });
    const notes = [...found.notes, ...found.pdfs.flatMap((pdf) => pdfNotes(pdf, UNTAGGED))];

    expect(new Set(notes.map((n) => n.rule))).toEqual(new Set(A11Y_RULE_IDS));
    expect(notes.map((n) => [n.rule, place(n), n.subject ?? ''])).toEqual([
      ['color-contrast', 'textColor', ''],
      ['alt-file-name', 'body line 9', 'Image “IMG_2041.jpg”'],
      ['alt-redundant', 'body line 11', 'Image “Image of the library steps”'],
      ['alt-too-long', 'body line 13', 'Image “A very long description of the library …”'],
      ['missing-alt', 'body line 15', 'Image “favicon.svg”'],
      ['heading-skip', 'body line 17', 'Heading “A heading that skips level 3”'],
      ['heading-extra-top', 'body line 19', 'Heading “A second top-level heading”'],
      ['heading-empty', 'body line 21', 'Level 2 heading'],
      ['link-vague', 'body line 25', 'Link “click here”'],
      ['link-vague', 'body line 25', 'Link “read more”'],
      ['link-vague', 'body line 25', 'Link “https://example.com/programs”'],
      ['link-new-window', 'body line 27', 'Link “Contact the welcome center”'],
      ['table-header', 'body line 33', 'Table'],
      ['fake-list', 'body line 40', 'Paragraph “What to bring:”'],
      ['tag-name-empty', 'body line 47', ''],
      ['video-captions', 'body line 47', 'YouTube video'],
      ['video-captions', 'body line 49', 'YouTube video “A campus walking tour”'],
      ['pdf-untagged', 'brochure', 'PDF “untagged-brochure.pdf”'],
      ['pdf-no-title', 'brochure', 'PDF “untagged-brochure.pdf”'],
      ['pdf-no-language', 'brochure', 'PDF “untagged-brochure.pdf”'],
      ['pdf-untagged', 'body line 29', 'PDF “course brochure”'],
      ['pdf-no-title', 'body line 29', 'PDF “course brochure”'],
      ['pdf-no-language', 'body line 29', 'PDF “course brochure”'],
    ]);
    // The lines are the body's own, as the source view shows them.
    const lines = body.split('\n');
    expect(lines[16]).toBe('#### A heading that skips level 3');
    expect(lines[46]).toBe('{% youtube id="VsprDemo002" title="" /%}');
  });

  it('finds nothing in the real content but one question about captions', async () => {
    const service = await content();
    const check = entryChecker(manifest);
    const found: string[] = [];
    for (const collection of manifest.collections) {
      if (collection.name === 'fixtures') continue;
      for (const entry of await service.entriesOf(collection.name)) {
        const body = entry.body?.replace(/^(?:\r?\n)+/, '');
        const format = entry.format === 'mdx' || entry.format === 'mdoc' ? entry.format : 'md';
        const result = check(collection, {
          values: entry.data,
          ...(body !== undefined ? { body } : {}),
          format,
        });
        for (const note of result.notes)
          found.push(`${collection.name}/${entry.id} ${place(note)}: ${note.message}`);
      }
    }
    // A confirmation, not a mistake: the guide's video doesn't say whether it has
    // captions. The file stays as it is: the Markdoc e2e test toggles that attribute.
    expect(found).toEqual([
      'docs/guides/writing-callouts body line 11: Confirm this video has captions.',
    ]);
  });
});
