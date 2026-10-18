import { entryPath } from './pattern.ts';

/*
 * Page trees (spec §6.15.2, §6.15.3). For a `tree: true` collection the
 * folder is the hierarchy: `academics/nursing/index.md` is the section page
 * of `academics/nursing`, and its folder's other files are its children.
 * Files have no order, so a folder may carry an `_order.yaml` listing its
 * children by slug. Listed children come first, in that order; the rest
 * follow by title.
 *
 * The same code builds the studio's outline and the site's `getTree()`, so
 * the two always agree.
 */

/** An entry as the tree needs it. `entry` is carried through untouched (Astro's entry on the site). */
export type TreeInput<E = unknown> = {
  id: string;
  title: string;
  url?: string | null;
  entry?: E;
};

export type PageNode<E = unknown> = {
  /** The page's path in the collection: `academics/nursing`, or '' for the collection's root page. */
  path: string;
  /** The last segment of the path (what `_order.yaml` lists). */
  slug: string;
  /** The entry's title, or the folder's name for a folder with no section page. */
  title: string;
  /** The entry ID, when the folder or file has a page. */
  id?: string;
  entry?: E;
  /** The page's URL, or null for a folder with no section page (or a collection without a URL). */
  url: string | null;
  /** 0 for the root page, 1 for top-level pages, 2 under them, and so on. */
  depth: number;
  children: PageNode<E>[];
};

/** Each folder's `_order.yaml`, keyed by the folder's path in the tree ('' for the top level). */
export type FolderOrders = Readonly<Record<string, readonly string[]>>;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Builds a collection's tree. Returns its top level: the root page (a
 * top-level `index`) first unless `_order.yaml` places it, then the
 * top-level pages and folders in order.
 */
export function buildTree<E>(
  entries: readonly TreeInput<E>[],
  orders: FolderOrders = {},
): PageNode<E>[] {
  const nodes = new Map<string, PageNode<E>>();
  const node = (path: string): PageNode<E> => {
    let found = nodes.get(path);
    if (!found) {
      const slug = path.slice(path.lastIndexOf('/') + 1);
      found = {
        path,
        slug,
        title: folderTitle(slug),
        url: null,
        depth: path === '' ? 0 : path.split('/').length,
        children: [],
      };
      nodes.set(path, found);
      if (path !== '') {
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
        if (parent !== null) node(parent).children.push(found);
      }
    }
    return found;
  };

  for (const input of entries) {
    const target = node(entryPath(input.id));
    target.id = input.id;
    target.title = input.title;
    target.url = input.url ?? null;
    if (input.entry !== undefined) target.entry = input.entry;
  }

  const top = [...nodes.values()].filter((n) => n.depth === 1);
  const root = nodes.get('');
  const ordered = orderNodes(root ? [root, ...top] : top, orders[''], true);
  for (const n of nodes.values()) {
    if (n.children.length > 0) n.children = orderNodes(n.children, orders[n.path], false);
  }
  return ordered;
}

/**
 * Listed slugs first, in the file's order; then everything else by title
 * (and slug, for equal titles). The root page, unless listed, goes first.
 */
export function orderNodes<E>(
  nodes: readonly PageNode<E>[],
  order: readonly string[] | undefined,
  rootFirst = false,
): PageNode<E>[] {
  const position = new Map((order ?? []).map((slug, i) => [slug, i]));
  const rank = (n: PageNode<E>) =>
    n.path === '' ? (position.get('index') ?? (rootFirst ? -1 : Infinity)) : position.get(n.slug);
  return [...nodes].sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    if (x !== undefined && y !== undefined) return x - y;
    if (x !== undefined) return -1;
    if (y !== undefined) return 1;
    return collator.compare(a.title, b.title) || collator.compare(a.slug, b.slug);
  });
}

/** Every node in the tree, depth first, in order. */
export function flattenTree<E>(tree: readonly PageNode<E>[]): PageNode<E>[] {
  return tree.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** The node at a path ('' is the root page), or null. */
export function findNode<E>(tree: readonly PageNode<E>[], path: string): PageNode<E> | null {
  return flattenTree(tree).find((n) => n.path === path) ?? null;
}

/** A page's children, in order. Empty for a leaf page or an unknown ID. */
export function childrenOf<E>(tree: readonly PageNode<E>[], id: string): PageNode<E>[] {
  const path = entryPath(id);
  if (path === '') return tree.filter((n) => n.path !== '');
  return findNode(tree, path)?.children ?? [];
}

export type Crumb = { title: string; url: string | null; id?: string };

/**
 * The trail from the root page to an entry, both included: Home, then each
 * ancestor folder (with no URL when it has no section page), then the
 * entry itself. An entry that isn't in the tree gets an empty trail.
 */
export function breadcrumbsOf<E>(tree: readonly PageNode<E>[], id: string): Crumb[] {
  const path = entryPath(id);
  const target = findNode(tree, path);
  if (!target) return [];
  const crumbs: Crumb[] = [];
  const root = tree.find((n) => n.path === '');
  if (root && path !== '') crumbs.push(crumbOf(root));
  const segments = path === '' ? [] : path.split('/');
  for (let depth = 1; depth < segments.length; depth++) {
    const ancestor = findNode(tree, segments.slice(0, depth).join('/'));
    if (ancestor) crumbs.push(crumbOf(ancestor));
  }
  crumbs.push(crumbOf(target));
  return crumbs;
}

function crumbOf(node: PageNode): Crumb {
  return { title: node.title, url: node.url, ...(node.id !== undefined ? { id: node.id } : {}) };
}

/** How deep a path sits: 1 for a top-level page, 0 for the root. */
export function pathDepth(path: string): number {
  return path === '' ? 0 : path.split('/').length;
}

/** A folder's name as a title: `general-studies` → "General studies". */
export function folderTitle(slug: string): string {
  const words = slug.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return slug;
  const text = words.join(' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
