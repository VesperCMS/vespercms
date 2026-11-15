import type { FormOptions } from '@vespercms/core/forms';
import type { z } from 'astro/zod';

/*
 * `vespercms/forms` (spec §6.13): `defineForm` for `src/forms.config.ts`.
 *
 *   import { defineForm } from 'vespercms/forms';
 *   import { z } from 'astro/zod';
 *   export const forms = {
 *     contact: defineForm({
 *       schema: z.object({ … }),
 *       successMessage: 'Thanks. We’ll be in touch.',
 *     }),
 *   };
 *
 * It checks nothing itself: the manifest's diagnostics do, so the build, the
 * dev server and the cloud see the same form. Delivery settings (who's
 * notified, routing, the confirmation's words) live in the dashboard.
 */

export type FormDefinition<Schema extends z.ZodObject = z.ZodObject> = FormOptions & {
  schema: Schema;
};

export function defineForm<Schema extends z.ZodObject>(
  definition: FormDefinition<Schema>,
): FormDefinition<Schema> {
  return definition;
}

export type { FormOptions };
