export type {
  Diagnostic,
  DiagnosticLevel,
  FieldConstraints,
  FieldKind,
  FieldModel,
  FieldOption,
} from './field-model.ts';

// Schema introspection: Zod 4 schemas into field models (spec §6.2, §6.3.1).
export {
  walkSchema,
  walkField,
  referenceCollection,
  isZodLike,
  IMAGE_MARKER,
  VESPER_META_KEY,
  type SchemaWalk,
  type ZodLike,
} from './schema/walk.ts';
export { humanize } from './schema/humanize.ts';

/**
 * Version of the manifest format (spec §6.2). Bump on any breaking change to
 * the manifest's shape: the cloud reads `dist/_vesper/manifest.json` from
 * deployed sites built by older versions.
 */
export const MANIFEST_VERSION = 1;

// Files: reading and writing content with round-trip fidelity (spec §6.5).
export type { DataObject, DataValue } from './files/equal.ts';
export { deepEqual, isPlainObject } from './files/equal.ts';
export { SerializationError, type SerializationErrorCode } from './files/errors.ts';
export {
  splitFrontmatter,
  joinFrontmatter,
  type SplitFile,
  type FrontmatterFormat,
} from './files/frontmatter.ts';
export { decodeUtf8, encodeUtf8, lineEndings, type LineEnding } from './files/text.ts';
export {
  diffValues,
  applyPatches,
  getAt,
  type Patch,
  type Path,
  type PathSegment,
} from './files/patch.ts';
export {
  readYaml,
  parseYamlValue,
  ASTRO_YAML_OPTIONS,
  type YamlRead,
  type SourceOnlyReason,
} from './files/yaml/read.ts';
export { writeYaml, type YamlWriteResult } from './files/yaml/write.ts';
export { readJson, writeJson, type JsonRead, type JsonWriteResult } from './files/json/write.ts';
export {
  readEntryFile,
  writeEntryFile,
  type EntryFile,
  type EntryChange,
  type FileWriteResult,
  type ReadOnlyReason,
} from './files/entry-file.ts';
export {
  dataFormatOf,
  readDataFile,
  writeDataFile,
  readCollectionFile,
  writeCollectionEntry,
  type DataFormat,
  type DataFile,
  type CollectionFile,
  type CollectionFileEntry,
} from './files/data-file.ts';

// Storage: one interface for local, GitHub and cloud modes.
export type {
  StorageAdapter,
  StorageEntry,
  StoredFile,
  FileChange,
  ChangeSet,
  CommitResult,
  Conflict,
} from './storage/types.ts';
export { MemoryStorage } from './storage/memory.ts';
export { gitBlobSha } from './storage/git-blob-sha.ts';
export { normalizePath, InvalidPathError } from './storage/paths.ts';
export { validateChangeSet, type ValidatedChange } from './storage/validate.ts';
