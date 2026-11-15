import { z } from 'astro/zod';
import { defineForm } from 'vespercms/forms';

/*
 * The contact form (spec §6.13), drawn by <Form name="contact" /> on
 * /contact/. Who's notified, the routing rules and the confirmation's words
 * live in the dashboard, not here.
 *
 * - `department` drives conditional routing ("When Department is Admissions…").
 * - `name` is safe to echo in the confirmation by its `autocomplete`; nothing
 *   else is (D20).
 * - `confirmation.emailField` turns on the confirmation email.
 * - An attachment, `fields.upload()`, arrives with Phase 6b.
 */
export const forms = {
  contact: defineForm({
    title: 'Contact us',
    schema: z.object({
      name: z.string().min(1).meta({ label: 'Your name', autocomplete: 'name' }),
      email: z.email().meta({ label: 'Email', autocomplete: 'email' }),
      phone: z.string().optional().meta({
        label: 'Phone',
        widget: 'tel',
        autocomplete: 'tel',
        description: 'If you’d rather we call.',
      }),
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
      message: z.string().min(10).max(5000).meta({ label: 'Message', widget: 'textarea' }),
      updates: z.boolean().optional().meta({ label: 'Send me news about events' }),
    }),
    confirmation: { emailField: 'email' },
    successMessage: 'Thanks, we will be in touch.',
  }),
};
