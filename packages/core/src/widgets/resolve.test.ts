import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Diagnostic, FieldModel } from '../field-model.ts';
import { walkSchema } from '../schema/walk.ts';
import { inferWidget, resolveWidgets } from './resolve.ts';

function resolve(shape: z.ZodRawShape, custom = {}) {
  const diagnostics: Diagnostic[] = [];
  const fields = resolveWidgets(walkSchema(z.object(shape)).fields ?? [], diagnostics, { custom });
  return { fields, diagnostics };
}
const only = (shape: z.ZodRawShape, custom = {}) => {
  const { fields, diagnostics } = resolve(shape, custom);
  return { field: fields[0] as FieldModel, diagnostics };
};

describe('inferWidget (spec §6.3 step 3)', () => {
  it.each([
    [z.string(), 'text'],
    [z.email(), 'email'],
    [z.url(), 'url'],
    [z.number(), 'number'],
    [z.boolean(), 'switch'],
    [z.date(), 'date'],
    [z.enum(['a', 'b', 'c', 'd']), 'radio'],
    [z.enum(['a', 'b', 'c', 'd', 'e']), 'select'],
    [z.array(z.string()), 'tags'],
    [z.array(z.enum(['a'])), 'multiselect'],
    [z.array(z.object({ a: z.string() })), 'repeater'],
    [z.object({ a: z.string() }), 'group'],
    [z.union([z.string(), z.number()]), 'raw'],
  ])('%# → %s', (schema, widget) => {
    expect(only({ x: schema }).field.widget).toBe(widget);
  });

  it('is exported for the studio’s fallback', () => {
    expect(inferWidget({ path: ['x'], kind: 'unknown', required: false, label: 'X' })).toBe('raw');
  });
});

describe('resolveWidgets (spec §6.3 order)', () => {
  it('uses an explicit widget that accepts the field', () => {
    const { field, diagnostics } = only({ x: z.string().meta({ widget: 'textarea' }) });
    expect(field).toMatchObject({ widget: 'textarea', inferredWidget: 'text' });
    expect(diagnostics).toEqual([]);
  });

  it('falls back to the inferred widget, with a warning, for an unknown name (Phase 1 criterion)', () => {
    const { field, diagnostics } = only({ summary: z.string().meta({ widget: 'fancy-editor' }) });
    expect(field.widget).toBe('text');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      level: 'warning',
      code: 'unknown-widget',
      path: ['summary'],
    });
    expect(diagnostics[0]?.message).toContain('fancy-editor');
    expect(diagnostics[0]?.message).toContain('summary');
  });

  it('falls back when the widget can’t edit the field’s type', () => {
    const { field, diagnostics } = only({ count: z.number().meta({ widget: 'color' }) });
    expect(field.widget).toBe('number');
    expect(diagnostics[0]?.code).toBe('widget-rejected');
  });

  it('accepts geo and image only for the right shapes', () => {
    expect(
      only({ g: z.object({ lat: z.number(), lng: z.number() }).meta({ widget: 'geo' }) }).field
        .widget,
    ).toBe('geo');
    expect(only({ g: z.object({ lat: z.string() }).meta({ widget: 'geo' }) }).field.widget).toBe(
      'group',
    );
  });

  it('lets a custom widget claim fields with match(), in declaration order', () => {
    const custom = {
      'store-hours': {
        accepts: (f: FieldModel) => f.kind === 'array',
        match: (f: FieldModel) => f.path.at(-1) === 'hours',
      },
      'never-used': { match: () => true },
    };
    const { fields } = resolve({ hours: z.array(z.string()), name: z.string() }, custom);
    expect(fields.map((f) => f.widget)).toEqual(['store-hours', 'never-used']);
  });

  it('skips a matching custom widget whose accepts() rejects the field, with a warning', () => {
    const custom = { picky: { accepts: () => false, match: () => true } };
    const { field, diagnostics } = only({ name: z.string() }, custom);
    expect(field.widget).toBe('text');
    expect(diagnostics[0]?.code).toBe('widget-rejected');
  });

  it('never throws when a custom check throws', () => {
    const custom = {
      broken: {
        accepts: () => {
          throw new Error('bug');
        },
      },
    };
    const { field, diagnostics } = only({ name: z.string().meta({ widget: 'broken' }) }, custom);
    expect(field.widget).toBe('text');
    expect(diagnostics[0]?.message).toContain('threw');
  });

  it('keeps upload for forms: elsewhere the studio has no control for it, so it warns', () => {
    const attachment = { attachment: z.string().meta({ widget: 'upload' }) };
    const { field, diagnostics } = only(attachment);
    expect(field.widget).toBe('text');
    expect(diagnostics[0]).toMatchObject({ code: 'form-widget', path: ['attachment'] });

    const form: Diagnostic[] = [];
    const [formField] = resolveWidgets(walkSchema(z.object(attachment)).fields ?? [], form, {
      form: true,
    });
    expect(formField?.widget).toBe('upload');
    expect(form).toEqual([]);

    // A site's own widget of that name is its own business.
    expect(only(attachment, { upload: {} }).field.widget).toBe('upload');
  });

  it('resolves nested fields too', () => {
    const { field } = only({ nav: z.object({ blurb: z.string().meta({ widget: 'markdown' }) }) });
    expect(field.children?.[0]?.widget).toBe('markdown');
  });
});
