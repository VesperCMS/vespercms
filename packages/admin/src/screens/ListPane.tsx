import type { CollectionManifest, EntrySummary } from '@vesper/core';
import { ButtonLink, Link, Menu, TextField, Tree, type TreeNode } from '@vesper/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SortDescriptor } from 'react-aria-components';
import type { StudioApi } from '../app/api.ts';
import { useStudio } from '../app/context.tsx';
import { onEntriesChanged } from '../app/entries-changed.ts';
import { formatRelative } from '../app/format.ts';
import { hrefFor, navigate } from '../app/router.ts';
import { collectionIcon } from '../app/collection-icon.ts';
import { PaneFrame, useLeadHeading } from '../app/Screen.tsx';
import { entryShownTo, mayCreateIn } from '../cloud/access.ts';
import { hasUpcoming, rowData, scheduleWords, siteZone } from '../schedule/times.ts';
import {
  compareBy,
  defaultSort,
  formatListValue,
  labelFor,
  statusText,
  TITLE_KEYS,
} from './EntryList.tsx';

/*
 * A flat collection's list as a pane (DECISIONS.md, "The studio is panes,
 * full width"), with the list screen's tools: search, the status filter,
 * sorting, the collection's list fields under each title, and New entry.
 * The same pane stays beside the entries it opens. What was searched,
 * filtered and sorted, and where it was scrolled, are kept here for the
 * visit, so the list is as it was when it's drawn again.
 */

type Filter = 'all' | 'drafts' | 'attention' | 'scheduled';
type Memory = { query: string; filter: Filter; sort: string | null; scrollTop: number };

// Kept per studio, so a fresh sign-in starts afresh.
const memories = new WeakMap<StudioApi, Map<string, Memory>>();
const lists = new WeakMap<StudioApi, Map<string, EntrySummary[]>>();

function memoryOf(api: StudioApi, collection: string): Memory {
  let byCollection = memories.get(api);
  if (!byCollection) {
    byCollection = new Map();
    memories.set(api, byCollection);
  }
  let memory = byCollection.get(collection);
  if (!memory) {
    memory = { query: '', filter: 'all', sort: null, scrollTop: 0 };
    byCollection.set(collection, memory);
  }
  return memory;
}

function remember(api: StudioApi, collection: string, patch: Partial<Memory>): void {
  Object.assign(memoryOf(api, collection), patch);
}

function cacheOf(api: StudioApi): Map<string, EntrySummary[]> {
  let cache = lists.get(api);
  if (!cache) {
    cache = new Map();
    lists.set(api, cache);
  }
  return cache;
}

type Row = TreeNode & {
  title: string;
  entryId: string;
  meta: string;
  /** The entry open beside the list. */
  current: boolean;
  children: Row[];
};

/** The ways to sort: title, last edit, and each of the collection's list fields. */
function sortOptions(collection: CollectionManifest): { id: string; label: string }[] {
  const fields = (collection.presentation.listFields ?? []).filter((key) => !TITLE_KEYS.has(key));
  return [
    { id: 'title', label: 'Title' },
    { id: 'updatedAt', label: 'Last edited' },
    ...fields.map((key) => ({ id: `field:${key}`, label: labelFor(collection, key) })),
  ];
}

/** Dates and edits newest first; everything else A to Z. */
function descriptorOf(collection: CollectionManifest, column: string): SortDescriptor {
  const dated =
    column === 'updatedAt' ||
    collection.fields?.some(
      (f) => `field:${String(f.path[0])}` === column && f.path.length === 1 && f.kind === 'date',
    );
  return { column, direction: dated ? 'descending' : 'ascending' };
}

export function ListPane({
  collection,
  currentId,
}: {
  collection: CollectionManifest;
  /** The entry open beside the list, or null. */
  currentId: string | null;
}) {
  const { api, cloud, manifest } = useStudio();
  const { zone } = siteZone(manifest);
  const memory = memoryOf(api, collection.name);
  const heading = useRef<HTMLHeadingElement>(null);
  useLeadHeading(collection.label, heading);
  const [entries, setEntries] = useState<EntrySummary[] | null>(
    () => cacheOf(api).get(collection.name) ?? null,
  );
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState(memory.query);
  const [filter, setFilter] = useState<Filter>(memory.filter);
  const [sort, setSort] = useState(memory.sort ?? String(defaultSort(collection).column));
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const read = () => {
      api.listEntries(collection.name).then(
        (value) => {
          cacheOf(api).set(collection.name, value);
          if (live) {
            setEntries(value);
            setFailed(false);
          }
        },
        () => {
          if (live) setFailed(true);
        },
      );
    };
    read();
    const stop = onEntriesChanged(collection.name, read);
    return () => {
      live = false;
      stop();
    };
  }, [api, collection.name]);

  // In the cloud, only what the member may edit, as the list screen shows (spec §7.5).
  const visible = useMemo(
    () => (entries ?? []).filter((entry) => entryShownTo(cloud, entry.path)),
    [entries, cloud],
  );
  const hasDrafts = visible.some((entry) => entry.draft);
  const needsAttention = visible.some((entry) => entry.status !== 'editable');
  const hasScheduled = visible.some((entry) => hasUpcoming(entry.schedule));

  // Fresh rows when the open entry changes: the tree reuses a row whose item is the same object.
  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();
    const listKeys = (collection.presentation.listFields ?? []).filter(
      (key) => !TITLE_KEYS.has(key),
    );
    return visible
      .filter(
        (entry) =>
          (needle === '' ||
            entry.title.toLowerCase().includes(needle) ||
            entry.id.toLowerCase().includes(needle)) &&
          (filter === 'all' ||
            (filter === 'drafts' && entry.draft === true) ||
            (filter === 'attention' && entry.status !== 'editable') ||
            (filter === 'scheduled' && hasUpcoming(entry.schedule))),
      )
      .sort(compareBy(descriptorOf(collection, sort)))
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        entryId: entry.id,
        meta: [
          ...listKeys.map((key) => formatListValue(entry.fields[key])),
          statusText(
            entry,
            scheduleWords(
              collection.presentation.schedule,
              rowData(collection.presentation.schedule, entry.schedule),
              zone,
            ),
          ),
          entry.updatedAt ? `edited ${formatRelative(entry.updatedAt)}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        current: entry.id === currentId,
        children: [],
      }));
  }, [visible, query, filter, sort, collection, currentId, zone]);

  // Back where it was scrolled, before the pane is painted.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = memory.scrollTop;
  }, [memory]);
  useEffect(() => {
    remember(api, collection.name, { query, filter, sort });
  }, [api, collection.name, query, filter, sort]);

  const options = sortOptions(collection);
  const filters = [
    { id: 'all', label: 'All entries' },
    ...(hasDrafts ? [{ id: 'drafts', label: 'Drafts' }] : []),
    ...(needsAttention ? [{ id: 'attention', label: 'Needs a developer' }] : []),
    ...(hasScheduled ? [{ id: 'scheduled', label: 'Scheduled' }] : []),
  ];
  const newEntry =
    collection.editable && mayCreateIn(cloud, collection)
      ? hrefFor({ screen: 'new', collection: collection.name })
      : null;

  return (
    <PaneFrame
      title={collection.label}
      headingRef={heading}
      icon={collectionIcon(collection)}
      actions={
        newEntry && (
          <ButtonLink variant="quiet" icon="add" href={newEntry}>
            New entry
          </ButtonLink>
        )
      }
      scrollRef={scroller}
      onScroll={(event) => {
        remember(api, collection.name, { scrollTop: event.currentTarget.scrollTop });
      }}
      // The list's tools stay in the header as the list scrolls beneath it.
      toolbar={
        <div className="flex flex-col gap-2 px-4 pt-1 pb-2">
          <TextField label="Search" type="search" icon="search" value={query} onChange={setQuery} />
          <div className="-ml-3 flex flex-wrap items-center gap-1">
            <Menu
              label="Sort"
              triggerText={`Sort: ${options.find((o) => o.id === sort)?.label ?? 'Title'}`}
              choice={{
                title: 'Sort by',
                options,
                selected: sort,
                onChange: setSort,
              }}
              items={[]}
              onAction={() => undefined}
            />
            {filters.length > 1 && (
              <Menu
                label="Show"
                triggerText={`Show: ${filters.find((f) => f.id === filter)?.label ?? 'All entries'}`}
                choice={{
                  title: 'Show',
                  options: filters,
                  selected: filter,
                  onChange: (id) => {
                    setFilter(id as Filter);
                  },
                }}
                items={[]}
                onAction={() => undefined}
              />
            )}
          </div>
          {filter === 'scheduled' && (
            <Link href={hrefFor({ screen: 'scheduled' })} className="text-small">
              Everything scheduled on the site
            </Link>
          )}
        </div>
      }
    >
      <div className="pt-2 pb-3">
        {failed && !entries ? (
          <p role="alert" className="px-4 text-small text-danger">
            Couldn’t load {collection.label.toLowerCase()}.
          </p>
        ) : !entries ? (
          <p className="px-4 text-small text-content-muted">Loading…</p>
        ) : (
          <Tree<Row>
            label={collection.label}
            items={rows}
            // Rows run edge to edge, with the pane's padding inside them.
            inset={4}
            // A row's name is this text, so it carries what the row shows: the title first, for type-ahead.
            textValue={(row) =>
              [row.title, row.meta, row.current ? 'open now' : ''].filter(Boolean).join(', ')
            }
            onAction={(row) => {
              navigate({ screen: 'edit', collection: collection.name, id: row.entryId });
            }}
            currentKey={currentId}
            emptyState={visible.length === 0 ? 'No entries yet.' : 'Nothing matches.'}
            renderRow={(row) => (
              <span className="min-w-0 flex-1 px-2 py-1">
                <span className="block truncate text-small font-semibold text-content">
                  {row.title}
                </span>
                {row.meta && (
                  <span className="block truncate text-caption text-content-muted">{row.meta}</span>
                )}
              </span>
            )}
          />
        )}
      </div>
      {/* Only while the list is narrowed: beside an entry, a count on every load would be noise. */}
      <p className="sr-only" role="status">
        {entries && (query.trim() !== '' || filter !== 'all')
          ? `${String(rows.length)} of ${String(visible.length)} entries shown.`
          : ''}
      </p>
    </PaneFrame>
  );
}
