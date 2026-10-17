/*
 * The Vesper studio (spec §6.1): the editor served at /admin. One bundle for
 * every storage mode; the page that mounts it passes the manifest, the back
 * end and the site's custom widgets.
 *
 * The stylesheet is a separate export: import '@vesper/admin/studio.css'.
 */
export { mountStudio } from './mount.tsx';
export { createLocalApi, ApiError, STUDIO_HEADER, type StudioApi } from './app/api.ts';
export type { StudioOptions, WidgetProps, WidgetComponent, WidgetLoader } from './types.ts';
