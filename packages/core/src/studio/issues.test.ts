import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { issuesFromZod } from './issues.ts';

const messages = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value, { reportInput: true });
  return result.success ? [] : issuesFromZod(result.error.issues).map((i) => i.message);
};

describe('issuesFromZod', () => {
  it('rewrites Zod’s defaults in plain language', () => {
    const schema = z.object({
      title: z.string().min(1),
      count: z.number().int().max(10),
      email: z.email().optional(),
      kind: z.enum(['news', 'guide']),
      tags: z.array(z.string()).min(1),
    });
    expect(messages(schema, { count: 12, email: 'nope', kind: 'x', tags: [] })).toEqual([
      'This is required.',
      'Enter 10 or less.',
      'Enter an email address, like name@example.com.',
      'Choose one of: news, guide.',
      'Add at least one.',
    ]);
    expect(messages(schema, { title: '', count: 'x', kind: 'news', tags: ['a'] })).toEqual([
      'This can’t be empty.',
      'Enter a number.',
    ]);
  });

  it('keeps messages the schema’s author wrote, and the path', () => {
    const schema = z.object({
      hero: z
        .object({ alt: z.string().optional(), decorative: z.boolean().optional() })
        .refine((h) => h.decorative === true || Boolean(h.alt), {
          message: 'Describe the image, or mark it decorative.',
          path: ['alt'],
        }),
      title: z.string().min(3, 'Titles need at least three letters.'),
    });
    const result = schema.safeParse({ hero: {}, title: 'ab' });
    expect(result.success).toBe(false);
    expect(issuesFromZod(result.error?.issues ?? [])).toEqual([
      { path: ['hero', 'alt'], message: 'Describe the image, or mark it decorative.' },
      { path: ['title'], message: 'Titles need at least three letters.' },
    ]);
  });

  it('asks for a kind when a discriminated union’s key matches none, at the key', () => {
    const blocks = z.array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('faq'), heading: z.string() }),
        z.object({ type: z.literal('stats') }),
      ]),
    );
    const result = blocks.safeParse([{ type: 'hero' }, { type: 'faq' }]);
    expect(issuesFromZod(result.error?.issues ?? [])).toEqual([
      { path: [0, 'type'], message: 'Choose one of the kinds the site has.' },
      { path: [1, 'heading'], message: 'This is required.' },
    ]);
    // A plain union still says its shapes don't match.
    expect(messages(z.union([z.string(), z.number()]), true)).toEqual([
      'This value doesn’t match any of the allowed shapes.',
    ]);
  });

  it('works without reportInput too', () => {
    const result = z.object({ title: z.string() }).safeParse({});
    expect(issuesFromZod(result.error?.issues ?? [])[0]?.message).toBe('This is required.');
  });
});
