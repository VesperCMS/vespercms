import { z } from 'astro/zod';

/*
 * The contact form (spec §6.13, addendum §4). `defineForm` and <Form> arrive in
 * Phase 6. Until then this is the plain shape `defineForm` will accept, so the
 * Phase 1 manifest can already read the fields:
 *
 * - `department` drives conditional routing ("When Department is Admissions…").
 * - `attachment` stands in for `fields.upload()`, whose stored shape is decided in
 *   Phase 6. Its options are the addendum's example.
 * - `confirmation.emailField` turns on the auto-reply. Only `safeToEcho` fields may
 *   appear in it (D20).
 */
export const forms = {
  contact: {
    schema: z.object({
      name: z.string().min(1).meta({ label: 'Your name', autocomplete: 'name', safeToEcho: true }),
      email: z.email().meta({ label: 'Email', autocomplete: 'email' }),
      department: z.enum(['admissions', 'financial-aid', 'registrar', 'other']).meta({
        label: 'Department',
        widgetOptions: {
          labels: {
            admissions: 'Admissions',
            'financial-aid': 'Financial aid',
            registrar: 'Registrar',
            other: 'Something else',
          },
        },
      }),
      message: z.string().min(10).meta({ label: 'Message', widget: 'textarea' }),
      attachment: z
        .string()
        .optional()
        .meta({
          label: 'Attachment',
          widget: 'upload',
          widgetOptions: { accept: ['application/pdf', '.docx'], maxSizeMB: 10, maxFiles: 1 },
        }),
    }),
    confirmation: { emailField: 'email' },
    successMessage: 'Thanks, we will be in touch.',
  },
};
