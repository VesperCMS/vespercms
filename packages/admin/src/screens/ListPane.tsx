import type { CollectionManifest, EntrySummary, PageTree, PageTreeNode } from '@vesper/core';
import { ButtonLink, cx, Link, TextField, Tree, type Key, type TreeNode } from '@vesper/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StudioApi } from '../app/api.ts';
import { useStudio } from '../app/context.tsx';
import { formatRelative } from '../app/format.ts';
import { hrefFor, navigate } from '../app/router.ts';
import { entryShownTo, mayCreateIn } from '../cloud/access.ts';
import { statusText } from './EntryList.tsx';

/*
 * The collection's list beside the editor on wide screens (DECISIONS.md,
 * "The entry list sits beside the editor on wide screens"). Each entry is a
 * screen of its own, so the pane is drawn afresh with each one; what it
 * holds, what was searched and where it was scrolled are kept here for the
 * visit, so moving between entries leaves the list as it was.
 */

type Memory = { query: string; scrollTop: number; expanded: Set<Key> };
type Listed = { kind: 'flat'; entries: EntrySummary[] } | { kind: 'tree'; tree: PageTree };

const memories = new Map<string, Memory>();
const lists = new WeakMap<StudioApi, Map<string, Listed>>();
const listeners = new Set<(collection: string) => void>();

/** After a save: the pane reads its collection again, for a new title or status. */
export function entriesChanged(collection: string): void {
  for (const listener of listeners) listener(collection);
}

function memoryOf(collection: string): Memory {
  let memory = memories.get(collection);
  if (!memory) {
    memory = { query: '', scrollTop: 0, expanded: new Set() };
    memories.set(collection, memory);
  }
  return memory;
}

function remember(collection: string, patch: Partial<Memory>): void {
  Object.assign(memoryOf(collection), patch);
}

function cacheOf(api: StudioApi): Map<string, Listed> {
  let cache = lists.get(api);
  if (!cache) {
    cache = new Map();
    lists.set(api, cache);
  }
  return cache;
}

type Row = TreeNode & {
  title: string;
  entryId: string | undefined;
  meta: string;
  children: Row[];
};

function flatRows(entries: EntrySummary[]): Row[] {
  return [...entries]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      entryId: entry.id,
      meta: [statusText(entry), entry.updatedAt ? `edited ${formatRelative(entry.updatedAt)}` : '']
        .filter(Boolean)
        .join(' · '),
      children: [],
    }));
}

function treeRows(nodes: PageTreeNode[]): Row[] {
  return nodes.map((node) => ({
    id: node.path || '/',
    title: node.title,
    entryId: node.id,
    meta: node.draft ? 'Draft' : '',
    children: treeRows(node.children),
  }));
}

/** Rows whose title matches, with the folders that lead to them. */
function matching(rows: Row[], needle: string): Row[] {
  if (!needle) return rows;
  return rows.flatMap((row) => {
    const children = matching(row.children, needle);
    return row.title.toLowerCase().includes(needle) || children.length > 0
      ? [{ ...row, children }]
      : [];
  });
}

/** The folders holding the entry, so it's in view when the pane opens. */
function pathTo(rows: Row[], entryId: string): Key[] | null {
  for (const row of rows) {
    if (row.entryId === entryId) return [];
    const below = pathTo(row.children, entryId);
    if (below) return [row.id, ...below];
  }
  return null;
}

export function ListPane({
  collection,
  currentId,
  id,
}: {
  collection: CollectionManifest;
  /** The entry open in the editor, or null for a new one. */
  currentId: string | null;
  id: string;
}) {
  const { api, cloud } = useStudio();
  const memory = memoryOf(collection.name);
  const tree = collection.presentation.tree === true && collection.source.loader === 'glob';
  const [listed, setListed] = useState<Listed | null>(
    () => cacheOf(api).get(collection.name) ?? null,
  );
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState(memory.query);
  const [expanded, setExpanded] = useState<Set<Key>>(() => new Set(memory.expanded));
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const read = () => {
      const loading: Promise<Listed> = tree
        ? api.pageTree(collection.name).then((value) => ({ kind: 'tree', tree: value }))
        : api.listEntries(collection.name).then((value) => ({ kind: 'flat', entries: value }));
      loading.then(
        (value) => {
          cacheOf(api).set(collection.name, value);
          if (live) {
            setListed(value);
            setFailed(false);
          }
        },
        () => {
          if (live) setFailed(true);
        },
      );
    };
    read();
    const onChange = (changed: string) => {
      if (changed === collection.name) read();
    };
    listeners.add(onChange);
    return () => {
      live = false;
      listeners.delete(onChange);
    };
  }, [api, collection.name, tree]);

  const rows = useMemo(() => {
    if (!listed) return [];
    if (listed.kind === 'tree') return treeRows(listed.tree.nodes);
    // In the cloud, only what the member may edit, as the list screen shows (spec §7.5).
    return flatRows(listed.entries.filter((entry) => entryShownTo(cloud, entry.path)));
  }, [listed, cloud]);
  const shown = useMemo(() => matching(rows, query.trim().toLowerCase()), [rows, query]);

  // The open entry's folders are open, so it's in view.
  const [opened, setOpened] = useState<string | null>(null);
  if (currentId !== null && opened !== currentId && rows.length > 0) {
    setOpened(currentId);
    const folders = pathTo(rows, currentId) ?? [];
    if (folders.some((key) => !expanded.has(key))) setExpanded(new Set([...expanded, ...folders]));
  }

  // Back where it was scrolled, before the pane is painted.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = memory.scrollTop;
  }, [memory]);
  useEffect(() => {
    remember(collection.name, { query, expanded });
  }, [collection.name, query, expanded]);

  const newEntry =
    collection.editable && mayCreateIn(cloud, collection)
      ? hrefFor({ screen: 'new', collection: collection.name })
      : null;

  return (
    <nav
      id={id}
      aria-label={collection.label}
      className="sticky top-14 flex max-h-[calc(100dvh_-_var(--spacing)*14)] flex-col gap-3 self-start pt-8 pb-6"
    >
      <Link
        href={hrefFor({ screen: 'list', collection: collection.name })}
        className="text-label text-content"
      >
        {collection.label}
      </Link>
      <TextField label="Search" type="search" icon="search" value={query} onChange={setQuery} />
      <div
        ref={scroller}
        onScroll={(event) => {
          remember(collection.name, { scrollTop: event.currentTarget.scrollTop });
        }}
        className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
      >
        {failed && !listed ? (
          <p role="alert" className="text-small text-danger">
            Couldn’t load {collection.label.toLowerCase()}.
          </p>
        ) : !listed ? (
          <p className="text-small text-content-muted">Loading…</p>
        ) : (
          <Tree<Row>
            label={collection.label}
            items={shown}
            // A row's name is this text, so it carries what the row shows: the title first, for type-ahead.
            textValue={(row) =>
              [
                row.title,
                row.meta,
                row.entryId !== undefined && row.entryId === currentId ? 'open now' : '',
              ]
                .filter(Boolean)
                .join(', ')
            }
            expandedKeys={query ? allKeys(shown) : expanded}
            onExpandedChange={(keys) => {
              if (!query) setExpanded(keys);
            }}
            onAction={(row) => {
              if (row.entryId !== undefined) {
                navigate({ screen: 'edit', collection: collection.name, id: row.entryId });
              }
            }}
            emptyState={rows.length === 0 ? 'No entries yet.' : 'Nothing matches.'}
            renderRow={(row) => {
              const current = row.entryId !== undefined && row.entryId === currentId;
              return (
                <span
                  className={cx(
                    'min-w-0 flex-1 rounded-sm px-2 py-1',
                    current && 'bg-accent-subtle shadow-glow-selected',
                  )}
                >
                  <span className="block truncate text-small font-semibold text-content">
                    {row.title}
                  </span>
                  {row.meta && (
                    <span className="block truncate text-caption text-content-muted">
                      {row.meta}
                    </span>
                  )}
                </span>
              );
            }}
          />
        )}
      </div>
      {newEntry && (
        <div>
          <ButtonLink variant="quiet" icon="add" href={newEntry}>
            {tree ? 'New page' : 'New entry'}
          </ButtonLink>
        </div>
      )}
    </nav>
  );
}

function allKeys(rows: Row[]): Set<Key> {
  const keys = new Set<Key>();
  const walk = (list: Row[]) => {
    for (const row of list) {
      if (row.children.length > 0) keys.add(row.id);
      walk(row.children);
    }
  };
  walk(rows);
  return keys;
}
