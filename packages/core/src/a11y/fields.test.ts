import { describe, expect, it } from 'vitest';
import type { FieldModel } from '../field-model.ts';
import { checkFields } from './fields.ts';

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
    const { notes } = checkFields(
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

  it('checks the fields of each item’s own kind', () => {
    const blocks: FieldModel[] = [
      field(['blocks'], 'array', 'repeater', {
        children: [
          field(['blocks', '[]'], 'union', 'union', {
            discriminator: 'type',
            variants: [
              {
                value: 'showcase',
                label: 'Showcase',
                children: [
                  field(['blocks', '[]', 'image'], 'object', 'image', {
                    children: [
                      field(['blocks', '[]', 'image', 'src'], 'image', 'image'),
                      field(['blocks', '[]', 'image', 'alt'], 'string', 'text'),
                    ],
                  }),
                ],
              },
              {
                value: 'text',
                label: 'Text',
                children: [field(['blocks', '[]', 'image'], 'string', 'markdown')],
              },
            ],
          }),
        ],
      }),
    ];
    const { notes } = checkFields(blocks, {
      blocks: [
        { type: 'showcase', image: { src: './a.png', alt: '' } },
        // The same key in another kind is that kind's field: here, Markdown.
        { type: 'text', image: '[Click here](/x/)' },
        { type: 'unknown', image: { src: './b.png', alt: '' } },
      ],
    });
    expect(notes.map((n) => [n.rule, n.target])).toEqual([
      ['missing-alt', { kind: 'field', path: ['blocks', 0, 'image', 'alt'] }],
      ['link-vague', { kind: 'field', path: ['blocks', 1, 'image'] }],
    ]);
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

  it('says nothing about a PDF in a file field', () => {
    // A file's contents are its author's: Vesper doesn't open them.
    expect(checkFields(fields, { brochure: '/files/brochure.pdf' })).toEqual({ notes: [] });
  });

});
