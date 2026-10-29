import type { CollectionManifest, EntrySummary } from '@vespercms/core';
import {
  ButtonLink,
  Link,
  Menu,
  TextField,
  Tree,
  useDragAndDrop,
  type TreeNode,
} from '@vespercms/ui';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { SortDescriptor } from 'react-aria-components';
import type { StudioApi } from '../app/api.ts';
import { useStudio } from '../app/context.tsx';
import { entriesRewritten, onEntriesChanged } from '../app/entries-changed.ts';
import { formatRelative } from '../app/format.ts';
import { hasUnsavedChanges, hrefFor, navigate } from '../app/router.ts';
import { collectionIcon } from '../app/collection-icon.ts';
import { PaneFrame, useLeadHeading } from '../app/Screen.tsx';
import { entryShownTo, mayCreateIn } from '../cloud/access.ts';
import { useDrafts } from '../cloud/editor.tsx';
import { hasUpcoming, rowData, siteZone } from '../schedule/times.ts';
import { compareBy, defaultSort, formatListValue, labelFor, TITLE_KEYS } from './EntryList.tsx';
import {
  StateWords,
  entryState,
  isNewInDraft,
  kindText,
  stateText,
  type EntryState,
} from './status.tsx';

/*
 * A flat collection's list as a pane (DECISIONS.md, "The studio is panes,
 * full width"), with the list screen's tools: search, the status filter,
 * sorting, the collection's list fields under each title, and New entry.
 * The same pane stays beside the entries it opens. What was searched,
 * filtered and sorted, and where it was scrolled, are kept here for the
 * visit, so the list is as it was when it's drawn again.
 *
 * A collection with `orderBy` is listed in its order, and while it's shown
 * that way, whole, its rows drag to a new place (or move with Alt+Up and
 * Alt+Down, or the row's menu), which writes the order numbers
 * (DECISIONS.md, "Flat collections are put in order by a number").
 */

/** A row on the move, as its own type: a Markdown field would take plain text. */
const ENTRY_TYPE = 'application/x-vesper-entry';

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
  /** The line under the title, in words: list fields, state, when it was edited. */
  meta: string;
  /** The same line in parts, so the state's word can take its colour. */
  fields: string[];
  state: EntryState | null;
  after: string[];
  /** The entry open beside the list. */
  current: boolean;
  children: Row[];
};

/** The ways to sort: the collection's order, title, last edit, and each of its list fields. */
function sortOptions(collection: CollectionManifest): { id: string; label: string }[] {
  const { orderBy } = collection.presentation;
  const fields = (collection.presentation.listFields ?? []).filter(
    (key) => !TITLE_KEYS.has(key) && key !== orderBy,
  );
  return [
    ...(orderBy ? [{ id: `field:${orderBy}`, label: labelFor(collection, orderBy) }] : []),
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
  const { drafts } = useDrafts();
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
      .map((entry) => {
        const fields = listKeys.map((key) => formatListValue(entry.fields[key])).filter(Boolean);
        const state = entryState(
          collection,
          {
            draft: entry.draft === true,
            times: rowData(collection.presentation.schedule, entry.schedule),
            newDraft: isNewInDraft(drafts, entry.path),
          },
          { zone, cloud: Boolean(cloud) },
        );
        const after = [
          kindText(entry.status),
          entry.updatedAt ? `edited ${formatRelative(entry.updatedAt)}` : '',
        ].filter(Boolean);
        return {
          id: entry.id,
          title: entry.title,
          entryId: entry.id,
          meta: [...fields, stateText(state), ...after].filter(Boolean).join(' · '),
          fields,
          state,
          after,
          current: entry.id === currentId,
          children: [],
        };
      });
  }, [visible, query, filter, sort, collection, currentId, zone, drafts, cloud]);

  // In order, whole and editable: then rows move. Searching, filtering or another sort
  // would leave neighbours out of sight, and a member who can't see every entry can't
  // place one among them.
  const orderBy = collection.presentation.orderBy;
  const ordering =
    orderBy !== undefined &&
    sort === `field:${orderBy}` &&
    query.trim() === '' &&
    filter === 'all' &&
    collection.editable &&
    entries !== null &&
    visible.length === entries.length;
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const announce = (text: string) => {
    // A repeated message must still be read out: clear, then set.
    setAnnouncement('');
    window.setTimeout(() => {
      setAnnouncement(text);
    }, 50);
  };

  const move = useCallback(
    async (row: Row, after: string | null, how: string) => {
      setProblem(null);
      // A move can write the open entry's number, and its unsaved edits would then conflict.
      if (hasUnsavedChanges()) {
        const message = 'Save the open entry first, then put entries in order.';
        setProblem(message);
        announce(message);
        return;
      }
      const result = await api.reorderEntry({
        collection: collection.name,
        id: row.entryId,
        after,
      });
      if (!result.ok) {
        setProblem(result.message);
        announce(result.message);
        return;
      }
      const { index, of } = result.position;
      announce(`${row.title} moved${how}, position ${String(index)} of ${String(of)}.`);
      if (result.changed.length > 0) entriesRewritten(collection.name, result.changed);
    },
    [api, collection.name],
  );

  const step = (row: Row, direction: 'up' | 'down') => {
    const index = rows.findIndex((r) => r.id === row.id);
    if (direction === 'up') {
      if (index <= 0) announce(`${row.title} is already first.`);
      else void move(row, rows[index - 2]?.entryId ?? null, ' up');
    } else if (index === -1 || index >= rows.length - 1) {
      announce(`${row.title} is already last.`);
    } else {
      void move(row, rows[index + 1]?.entryId ?? null, ' down');
    }
  };

  const onRowKeyDown = (row: Row, event: KeyboardEvent<HTMLDivElement>) => {
    if (!ordering || !event.altKey) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      step(row, event.key === 'ArrowUp' ? 'up' : 'down');
    }
  };

  // Always given to the tree and switched with `isDisabled`: it calls the hooks only
  // when it has them, so taking them away mid-render would break the order of its hooks.
  const { dragAndDropHooks } = useDragAndDrop<Row>({
    isDisabled: !ordering,
    acceptedDragTypes: [ENTRY_TYPE],
    getItems: (keys) => [...keys].map((key) => ({ [ENTRY_TYPE]: String(key) })),
    // Between rows only: a flat list has nothing to drop a row into.
    getDropOperation: (target) =>
      target.type === 'item' && target.dropPosition === 'on' ? 'cancel' : 'move',
    onMove: (event) => {
      const row = rows.find((r) => r.id === String([...event.keys][0]));
      const at = rows.findIndex((r) => r.id === String(event.target.key));
      if (!row || at === -1 || event.target.dropPosition === 'on') return;
      const after =
        event.target.dropPosition === 'after' ? rows[at]?.entryId : rows[at - 1]?.entryId;
      if (after === row.entryId || (after === undefined && rows[0] === row)) return;
      void move(row, after ?? null, '');
    },
  });

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
          {problem && (
            <p role="alert" className="text-small text-danger">
              {problem}
            </p>
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
            onRowKeyDown={onRowKeyDown}
            {...(orderBy ? { dragAndDropHooks } : {})}
            renderRow={(row) => (
              <>
                <span className="min-w-0 flex-1 px-2 py-1">
                  <span className="block truncate text-small font-semibold text-content">
                    {row.title}
                  </span>
                  {row.meta && (
                    <span className="block truncate text-caption text-content-muted">
                      {row.fields.join(' · ')}
                      {row.fields.length > 0 && row.state ? ' · ' : ''}
                      <StateWords state={row.state} />
                      {(row.fields.length > 0 || row.state) && row.after.length > 0 ? ' · ' : ''}
                      {row.after.join(' · ')}
                    </span>
                  )}
                </span>
                {ordering && (
                  <Menu
                    label={`More actions for ${row.title}`}
                    items={[
                      { id: 'up', label: 'Move up', icon: 'move-up', isDisabled: rows[0] === row },
                      {
                        id: 'down',
                        label: 'Move down',
                        icon: 'move-down',
                        isDisabled: rows.at(-1) === row,
                      },
                    ]}
                    onAction={(action) => {
                      step(row, action === 'up' ? 'up' : 'down');
                    }}
                  />
                )}
              </>
            )}
          />
        )}
      </div>
      {/* The count only while the list is narrowed: beside an entry, one on every load would be
          noise. Rows move only while it isn't, so a move's news shares the one region. */}
      <p className="sr-only" role="status">
        {entries && (query.trim() !== '' || filter !== 'all')
          ? `${String(rows.length)} of ${String(visible.length)} entries shown.`
          : announcement}
      </p>
    </PaneFrame>
  );
}
