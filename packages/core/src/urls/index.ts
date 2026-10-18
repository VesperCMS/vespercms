/*
 * `@vesper/core/urls`: URL patterns, page trees, redirects and host rules
 * (spec §6.15). Plain functions with no parser dependencies, so a site's own
 * pages can import them through `vesper:content` without pulling in
 * Markdoc, YAML or the rest of the core.
 */
export {
  DEFAULT_URL_SETTINGS,
  RESERVED_PATHS,
  SLUG_PATTERN,
  dateParts,
  entryPath,
  entryUrlKey,
  expandUrlPattern,
  formatUrl,
  isReservedPath,
  parseSiteUrl,
  reshapeUrl,
  urlKey,
  type BuildFormat,
  type SiteUrl,
  type TrailingSlash,
  type UrlEntry,
  type UrlPattern,
  type UrlSettings,
} from './pattern.ts';
export {
  breadcrumbsOf,
  buildTree,
  childrenOf,
  findNode,
  flattenTree,
  folderTitle,
  orderNodes,
  pathDepth,
  type Crumb,
  type FolderOrders,
  type PageNode,
  type TreeInput,
} from './tree.ts';
