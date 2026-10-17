export type {
  FieldConstraints,
  FieldKind,
  FieldModel,
  FieldOption,
} from './field-model.ts';

/**
 * Version of the manifest format (spec §6.2). Bump on any breaking change to
 * the manifest's shape: the cloud reads `dist/_vesper/manifest.json` from
 * deployed sites built by older versions.
 */
export const MANIFEST_VERSION = 1;
