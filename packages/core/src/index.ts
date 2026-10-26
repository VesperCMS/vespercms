export type {
  Diagnostic,
  DiagnosticLevel,
  FieldConstraints,
  FieldKind,
  FieldModel,
  FieldOption,
  FieldVariant,
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
export { childrenFor, fieldChildren, variantFor } from './schema/variants.ts';

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
  CommitTrailers,
  CommitResult,
  Conflict,
} from './storage/types.ts';
export { MemoryStorage } from './storage/memory.ts';
export { gitBlobSha } from './storage/git-blob-sha.ts';
export { normalizePath, InvalidPathError } from './storage/paths.ts';
export { validateChangeSet, type ValidatedChange } from './storage/validate.ts';

// Widgets: resolution order of spec §6.3.
export {
  resolveWidgets,
  inferWidget,
  BUILTIN_WIDGETS,
  type WidgetDefinition,
  type WidgetCheck,
  type ResolveOptions,
} from './widgets/resolve.ts';

// Collections: which files belong to a collection, and their IDs, as Astro computes them.
export {
  globMatcher,
  defaultEntryId,
  folderKey,
  patternExtensions,
  entryKindOf,
} from './collections/entries.ts';

// Manifest (spec §6.2).
export {
  buildManifest,
  type ManifestInput,
  type CollectionInput,
  type CollectionConfig,
  type ScheduleConfig,
  type LoaderInfo,
} from './manifest/build.ts';
export { canonicalJson, manifestHash } from './manifest/hash.ts';
export type {
  Manifest,
  CollectionManifest,
  CollectionSource,
  CollectionPresentation,
  IconNode,
  FormManifest,
  ReadOnlyCollectionReason,
  SchedulePresentation,
} from './manifest/types.ts';

// Bodies as blocks, for splice-on-save editing (DECISIONS.md, "Studio").
export { parseBody, assembleBody, keepAll } from './body/blocks.ts';
export type {
  BodyFormat,
  BodyBlock,
  BodyItem,
  BodyTag,
  InlineChip,
  MarkdocParseOptions,
  ParseBodyOptions,
  ParsedBody,
} from './body/types.ts';
export { markdocTokenizerOptions, parseMarkdoc } from './body/markdoc.ts';
export {
  markdocTags,
  markdocTagLayout,
  markdocValue,
  markdocOpening,
  markdocClosing,
  editMarkdocTag,
  type MarkdocTagToken,
  type MarkdocTagKind,
  type MarkdocTagLayout,
  type MarkdocAttributeSpan,
} from './body/markdoc-tag.ts';
export {
  jsxTagLayout,
  jsxAttribute,
  jsxOpening,
  jsxClosing,
  editJsxTag,
  readJsLiteral,
  type JsxAttribute,
  type JsxTagLayout,
} from './body/jsx-tag.ts';
export {
  validateMarkdocBody,
  validateMdxBody,
  resolvePartial,
  partialChecker,
  type BodyIssue,
  type MarkdocValidateOptions,
  type MdxComponentCheck,
} from './body/validate.ts';

// Markdoc tags and MDX components in the manifest (spec §6.5.1, §6.5.2).
export { extractMarkdocSchema, type MarkdocConfigLike } from './markdoc/extract.ts';
export { markdocFields } from './markdoc/fields.ts';
export { markdocConfigFromManifest } from './markdoc/config.ts';
export type {
  MarkdocManifest,
  MarkdocTagManifest,
  MarkdocAttributeManifest,
  MarkdocNodeManifest,
  MarkdocMatches,
  MarkdocVariables,
  MarkdocTagHint,
  MdxManifest,
  MdxComponentManifest,
  MdxComponentConfig,
} from './markdoc/types.ts';

// The studio's API contract (spec §6.7).
export {
  encodeValue,
  decodeValue,
  decodeData,
  type EntryStatus,
  type EntryFormat,
  type EntrySummary,
  type CollectionSummary,
  type EntryDocument,
  type SaveRequest,
  type SaveResponse,
  type FieldIssue,
  type MediaItem,
  type UploadResponse,
} from './studio/protocol.ts';

// The studio's content operations over any storage adapter.
export {
  ContentService,
  titleOf,
  slugify,
  expandNewEntryPath,
  type ContentServiceOptions,
  type StoredEntry,
  type TreeHooks,
  type Validator,
  type BodyValidator,
} from './studio/service.ts';
export { issuesFromZod } from './studio/issues.ts';
export { formatYamlSnippet, parseYamlSnippet, type YamlSnippetParse } from './files/yaml/text.ts';
export {
  withOffset,
  offsetOf,
  formatOffset,
  isoWithOffset,
  parseIsoWithOffset,
} from './files/date-offset.ts';
export {
  MediaService,
  MEDIA_TYPES,
  UPLOAD_MAX_BYTES,
  UPLOAD_WARN_BYTES,
  extensionOf,
  isImagePath,
  relativePath,
  dirOf,
  resolveMediaPath,
  mediaReference,
  type MediaServiceOptions,
} from './studio/media.ts';
export type { WidgetProps } from './studio/widget.ts';

// URLs, page trees and redirects (spec §6.15). Also `@vesper/core/urls`, without the parsers.
export * from './urls/index.ts';
export {
  PageService,
  REDIRECTS_FILE,
  ORDER_FILE,
  newRedirectsFile,
  type PageServiceOptions,
  type StaticRoutes,
  type PageLink,
  type PageTree,
  type PageTreeNode,
  type MoveRequest,
  type MoveResult,
  type Position,
  type ReorderRequest,
  type ReorderResult,
  type RedirectsDocument,
  type SaveRedirectsRequest,
  type SaveRedirectsResult,
} from './studio/pages.ts';
export {
  rewriteBody,
  rewriteValues,
  type LinkContext,
  type FilePlace,
  type RewriteCount,
} from './studio/links.ts';

// Aspect ratios, focal points and crops (spec §6.6). Also `@vesper/core/images`.
export * from './images/index.ts';

// Accessibility checks (spec §6.18): layer-1 content rules, shared by every mode.
export * from './a11y/index.ts';

// Scheduling (spec §6.17): the publish window the search index and Phase 4.5's build filtering share.
export { dateOf, isPublished, publishWindow } from './schedule/window.ts';
export { scheduledEvents, type ScheduledEntry, type ScheduledEvent } from './schedule/events.ts';
export {
  fromWallTime,
  isRepeatedTime,
  offsetMinutes,
  resolveTimeZone,
  wallTime,
  zoneName,
} from './schedule/time.ts';
export { scheduleDay, scheduleStatus, scheduleTime } from './schedule/words.ts';

// Site search (spec §6.19): what the build tells Pagefind about each entry's page.
export {
  SECTION_FILTER,
  firstImage,
  searchAnnotations,
  searchSettingsProblems,
  type SearchAnnotationInput,
  type SearchAnnotations,
  type SearchFieldSettings,
} from './search/annotate.ts';
export { isHiddenFromSearch, searchHiddenField } from './search/fields.ts';

// GitHub mode's storage (spec §6.8): the branch through GitHub's API, with `fetch` alone.
export {
  GitHubError,
  GitHubStorage,
  commitMessage,
  parseRepo,
  toBase64,
  type BlobCache,
  type GitHubErrorKind,
  type GitHubStorageOptions,
} from './storage/github.ts';
export { fieldModelIssues } from './studio/field-checks.ts';

// The cloud: grants, DPoP, drafts and the API the studio speaks (spec §6.9, §7).
export * from './cloud/index.ts';
