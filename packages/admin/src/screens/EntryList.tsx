import { decodeValue, humanize, type CollectionManifest, type EntrySummary } from '@vesper/core';
import { ButtonLink, Select, Table, TextField, type TableColumn } from '@vesper/ui';
import { useEffect, useMemo, useState } from 'react';
import type { SortDescriptor } from 'react-aria-components';
import { useStudio } from '../app/context.tsx';
import { entryShownTo, mayCreateIn } from '../cloud/access.ts';
import { formatRelative } from '../app/format.ts';
import { useLoad } from '../app/load.ts';
import { hrefFor, navigate } from '../app/router.ts';
import { collectionIcon } from '../app/collection-icon.ts';
import { Screen } from '../app/Screen.tsx';

type Filter = 'all' | 'drafts' | 'attention';

/**
 * A collection's entries (spec §10.3): one row per entry with its title,
 * the collection's list fields, when it was edited, and its status in
 * words. One search box and one status filter; sort by column header.
 */
export function EntryList({ collection }: { collection: CollectionManifest }) {
  const { api, cloud } = useStudio();
  const [load] = useLoad(() => api.listEntries(collection.name), collection.name);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortDescriptor>(() => defaultSort(collection));
  // In the cloud, only the entries the member can edit (spec §7.5); viewers see all.
  const entries = useMemo(
    () => (load.state === 'ready' ? load.value.filter((e) => entryShownTo(cloud, e.path)) : []),
    [load, cloud],
  );

  // A singleton has no list: open its one entry, or start it.
  const singleton = collection.presentation.singleton === true;
  useEffect(() => {
    if (!singleton || load.state !== 'ready') return;
    const [only] = load.value;
    if (only)
      navigate({ screen: 'edit', collection: collection.name, id: only.id }, { replace: true });
    else if (collection.editable)
      navigate({ screen: 'new', collection: collection.name }, { replace: true });
  }, [singleton, load, collection]);

  const listKeys = (collection.presentation.listFields ?? []).filter((key) => !TITLE_KEYS.has(key));
  const columns: TableColumn[] = [
    { id: 'title', label: 'Title', isRowHeader: true, allowsSorting: true },
    ...listKeys.map((key) => ({
      id: `field:${key}`,
      label: labelFor(collection, key),
      allowsSorting: true,
    })),
    { id: 'updatedAt', label: 'Edited', allowsSorting: true },
    { id: 'status', label: 'Status' },
  ];

  const needsAttention = entries.some((e) => e.status !== 'editable');
  const hasDrafts = entries.some((e) => e.draft);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = entries.filter(
      (entry) =>
        (needle === '' ||
          entry.title.toLowerCase().includes(needle) ||
          entry.id.toLowerCase().includes(needle)) &&
        (filter === 'all' ||
          (filter === 'drafts' && entry.draft === true) ||
          (filter === 'attention' && entry.status !== 'editable')),
    );
    return [...shown].sort(compareBy(sort));
  }, [entries, query, filter, sort]);

  return (
    <Screen
      title={collection.label}
      icon={collectionIcon(collection)}
      afterglow={load.state === 'ready' && entries.length === 0}
    >
      {!collection.editable && (
        <p className="mb-6 max-w-2xl text-content-muted">
          {collection.label} can be read here but not edited.
        </p>
      )}
      {load.state === 'failed' && (
        <p role="alert" className="mb-6 text-danger">
          Couldn’t load entries: {load.message}
        </p>
      )}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <TextField
          label="Search"
          type="search"
          icon="search"
          value={query}
          onChange={setQuery}
          className="w-full max-w-xs"
        />
        {(hasDrafts || needsAttention) && (
          <Select
            label="Show"
            value={filter}
            onChange={(value) => {
              setFilter((value ?? 'all') as Filter);
            }}
            options={[
              { value: 'all', label: 'All entries' },
              ...(hasDrafts ? [{ value: 'drafts', label: 'Drafts' }] : []),
              ...(needsAttention ? [{ value: 'attention', label: 'Needs a developer' }] : []),
            ]}
            className="w-48"
          />
        )}
        {collection.editable && !singleton && mayCreateIn(cloud, collection) && (
          // The screen's one primary action.
          <ButtonLink
            variant="primary"
            icon="add"
            href={hrefFor({ screen: 'new', collection: collection.name })}
            className="ml-auto"
          >
            New entry
          </ButtonLink>
        )}
      </div>
      {load.state === 'loading' ? (
        <p className="text-small text-content-muted">Loading entries…</p>
      ) : (
        <Table
          label={collection.label}
          columns={columns}
          rows={rows}
          sort={sort}
          onSortChange={setSort}
          rowHref={(entry) =>
            hrefFor({ screen: 'edit', collection: collection.name, id: entry.id })
          }
          emptyState={entries.length === 0 ? 'No entries yet.' : 'No entries match.'}
          renderCell={(entry, column) => <Cell entry={entry} column={column} />}
        />
      )}
      <p className="sr-only" role="status">
        {load.state === 'ready'
          ? `${String(rows.length)} of ${String(entries.length)} entries shown.`
          : ''}
      </p>
    </Screen>
  );
}

const TITLE_KEYS = new Set(['title', 'name', 'heading', 'label']);

function Cell({ entry, column }: { entry: EntrySummary; column: string }) {
  if (column === 'title') {
    return (
      <span className="font-semibold text-content">
        {entry.title}
        {entry.title !== entry.id && (
          <span className="block font-mono text-caption font-normal text-content-muted">
            {entry.id}
          </span>
        )}
      </span>
    );
  }
  if (column === 'updatedAt') {
    return (
      <span className="text-content-muted">
        {entry.updatedAt ? formatRelative(entry.updatedAt) : ''}
      </span>
    );
  }
  if (column === 'status') return <span className="text-content-muted">{statusText(entry)}</span>;
  return <span>{formatListValue(entry.fields[column.slice('field:'.length)])}</span>;
}

export function statusText(entry: Pick<EntrySummary, 'status' | 'draft'>): string {
  if (entry.status === 'read-only') return 'Read only';
  if (entry.status === 'source-only') return 'Edit as YAML';
  return entry.draft ? 'Draft' : '';
}

/** A list field's value as short text. Dates at midnight UTC are calendar dates. */
export function formatListValue(encoded: unknown): string {
  const value = decodeValue(encoded);
  if (value instanceof Date) {
    const dateOnly = value.getUTCHours() === 0 && value.getUTCMinutes() === 0;
    return value.toLocaleDateString(undefined, {
      dateStyle: 'medium',
      ...(dateOnly ? { timeZone: 'UTC' } : {}),
    } as Intl.DateTimeFormatOptions);
  }
  if (Array.isArray(value)) return value.map((v) => formatListValue(v)).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '…';
  return String(value);
}

function labelFor(collection: CollectionManifest, key: string): string {
  return (
    collection.fields?.find((f) => f.path.length === 1 && f.path[0] === key)?.label ?? humanize(key)
  );
}

function defaultSort(collection: CollectionManifest): SortDescriptor {
  const dateKey = (collection.presentation.listFields ?? []).find((key) =>
    collection.fields?.some((f) => f.path[0] === key && f.path.length === 1 && f.kind === 'date'),
  );
  return dateKey
    ? { column: `field:${dateKey}`, direction: 'descending' }
    : { column: 'title', direction: 'ascending' };
}

function sortValue(entry: EntrySummary, column: string): string | number {
  if (column === 'title') return entry.title.toLowerCase();
  if (column === 'updatedAt') return entry.updatedAt ?? '';
  const value = decodeValue(entry.fields[column.slice('field:'.length)]);
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return formatListValue(entry.fields[column.slice('field:'.length)]).toLowerCase();
}

function compareBy(sort: SortDescriptor) {
  const column = String(sort.column);
  const direction = sort.direction === 'descending' ? -1 : 1;
  return (a: EntrySummary, b: EntrySummary) => {
    const x = sortValue(a, column);
    const y = sortValue(b, column);
    if (x === y) return a.title.localeCompare(b.title);
    return (x < y ? -1 : 1) * direction;
  };
}
