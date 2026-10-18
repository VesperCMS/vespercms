import { describe, expect, it } from 'vitest';
import type { FieldModel } from '../field-model.ts';
import { checkFields, pdfNotes } from './fields.ts';

const field = (
  path: string[],
  kind: FieldModel['kind'],
  widget: string,
  extra: Partial<FieldModel> = {},
): FieldModel => ({
  path,
  kind,
  widget,
  required: false,
  label: path.at(-1) ?? '',
  ...extra,
});

const fields: FieldModel[] = [
  field(['hero'], 'object', 'image', {
    children: [field(['hero', 'src'], 'image', 'image'), field(['hero', 'alt'], 'string', 'text')],
  }),
  field(['textColor'], 'string', 'color', { widgetOptions: { contrast: 'text' } }),
  field(['pinColor'], 'string', 'color'),
  field(['brochure'], 'string', 'file'),
  field(['sections'], 'array', 'repeater', {
    children: [
      field(['sections', '[]'], 'object', 'group', {
        children: [field(['sections', '[]', 'body'], 'string', 'markdown')],
      }),
    ],
  }),
];

const light = { name: 'Page, light', color: '#ffffff' };
const backgrounds = [light, { name: 'Page, dark', color: '#12151f' }];

describe('checkFields', () => {
  it('finds each problem under its field, in form order', () => {
    const { notes, pdfs } = checkFields(
      fields,
      {
        hero: { src: './a.jpg', alt: 'IMG_2041.jpg' },
        textColor: '#a3abbd',
        pinColor: '#ffff00',
        brochure: '/files/brochure.pdf',
        sections: [{ body: 'Fine.' }, { body: '[Click here](/x/) or ![IMG_1.png](/a.png)' }],
      },
      { backgrounds },
    );
    expect(notes.map((n) => [n.rule, n.target, n.message])).toEqual([
      [
        'alt-file-name',
        { kind: 'field', path: ['hero', 'alt'] },
        'Alt text looks like a file name.',
      ],
      [
        'color-contrast',
        { kind: 'field', path: ['textColor'] },
        'Contrast 2.3:1 against Page, light is below 4.5:1.',
      ],
      [
        'link-vague',
        { kind: 'field', path: ['sections', 1, 'body'] },
        'Link text should say where it goes.',
      ],
      [
        'alt-file-name',
        { kind: 'field', path: ['sections', 1, 'body'] },
        'Alt text looks like a file name.',
      ],
    ]);
    expect(pdfs).toEqual([
      { href: '/files/brochure.pdf', target: { kind: 'field', path: ['brochure'] } },
    ]);
  });

  it('asks for alt text unless the image is decorative, and only when there is an image', () => {
    const missing = checkFields(fields, { hero: { src: './a.jpg', alt: '' } });
    expect(missing.notes.map((n) => [n.rule, n.target])).toEqual([
      ['missing-alt', { kind: 'field', path: ['hero', 'alt'] }],
    ]);
    expect(
      checkFields(fields, { hero: { src: './a.jpg', alt: '', decorative: true } }).notes,
    ).toEqual([]);
    expect(checkFields(fields, { hero: { src: '', alt: '' } }).notes).toEqual([]);
  });

  it('checks contrast only for colours marked as text, and only against declared backgrounds', () => {
    expect(checkFields(fields, { textColor: '#a3abbd' }).notes).toEqual([]);
    expect(checkFields(fields, { textColor: '#1d2433' }, { backgrounds: [light] }).notes).toEqual(
      [],
    );
    const large = [
      field(['heading'], 'string', 'color', { widgetOptions: { contrast: 'large-text' } }),
    ];
    // #949494 on white is about 3.03:1: enough for large text, not for body text.
    expect(checkFields(large, { heading: '#949494' }, { backgrounds }).notes).toEqual([]);
  });

  it('ignores remote PDFs and values that aren’t PDFs', () => {
    expect(checkFields(fields, { brochure: 'https://example.com/a.pdf' }).pdfs).toEqual([]);
    expect(checkFields(fields, { brochure: '/files/a.docx' }).pdfs).toEqual([]);
  });
});

describe('pdfNotes', () => {
  const pdf = {
    href: '/files/untagged-brochure.pdf',
    target: { kind: 'field' as const, path: ['brochure'] },
  };

  it('notes each missing fact, naming the file', () => {
    const notes = pdfNotes(pdf, { tagged: false, title: null, language: null });
    expect(notes.map((n) => [n.rule, n.subject])).toEqual([
      ['pdf-untagged', 'PDF “untagged-brochure.pdf”'],
      ['pdf-no-title', 'PDF “untagged-brochure.pdf”'],
      ['pdf-no-language', 'PDF “untagged-brochure.pdf”'],
    ]);
    expect(notes[0]?.message).toBe(
      'This PDF isn’t tagged, so screen readers can’t read its structure. Consider an HTML page instead, or tag the PDF.',
    );
  });

  it('says nothing about a tagged PDF with a title and a language', () => {
    expect(pdfNotes(pdf, { tagged: true, title: 'Course brochure', language: 'en-US' })).toEqual(
      [],
    );
    expect(pdfNotes(pdf, { tagged: true, title: '  ', language: 'en' }).map((n) => n.rule)).toEqual(
      ['pdf-no-title'],
    );
  });
});
