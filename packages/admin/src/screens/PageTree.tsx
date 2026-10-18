import type { CollectionManifest, MoveResult, PageTreeNode, Position } from '@vesper/core';
import {
  Button,
  ButtonLink,
  Combobox,
  Dialog,
  Menu,
  TextField,
  Tree,
  useDragAndDrop,
  type Key,
  type MenuItem,
  type Option,
} from '@vesper/ui';
import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import { useStudio } from '../app/context.tsx';
import { useLoad } from '../app/load.ts';
import { hrefFor, navigate } from '../app/router.ts';
import { Screen } from '../app/Screen.tsx';

/*
 * The outline of a tree collection (spec §6.15.2), in place of the flat
 * entry list. One row per page: its title, its address in muted text, its
 * status in words. Calm by default: collapsed beyond the first level.
 *
 * Every action is in the row's "…" menu, and the keyboard reaches all of
 * them: arrows move and expand, Enter opens a page, Alt+↑/↓ move it among
 * its siblings. Dragging is offered and never required. Each move is
 * announced politely ("Nursing moved under Academics, position 1 of 3").
 */

/** A node as the outline shows it: keyed by its path in the tree, with its entry ID apart. */
type Row = Omit<PageTreeNode, 'id' | 'children'> & {
  id: string;
  entryId?: string;
  children: Row[];
};

type Moving = { row: Row; parent: string };

const TOP = '/';

export function PageTree({ collection }: { collection: CollectionManifest }) {
  const { api } = useStudio();
  const [load, reload] = useLoad(() => api.pageTree(collection.name), collection.name);
  const [expanded, setExpanded] = useState<Set<Key>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const rows = useMemo(() => (load.state === 'ready' ? toRows(load.value.nodes) : []), [load]);
  const byPath = useMemo(() => new Map(flatten(rows).map((row) => [row.path, row])), [rows]);
  const byKey = useMemo(() => new Map(flatten(rows).map((row) => [row.id, row])), [rows]);
  const maxDepth = load.state === 'ready' ? load.value.maxDepth : undefined;
  const editable = collection.editable;

  const announce = (text: string) => {
    // A repeated message must still be read out: clear, then set.
    setAnnouncement('');
    window.setTimeout(() => {
      setAnnouncement(text);
    }, 50);
  };

  const reorder = useCallback(
    async (row: Row, move: { direction: 'up' | 'down' } | { index: number }) => {
      setProblem(null);
      const result = await api.reorderPage({
        collection: collection.name,
        path: row.path,
        ...move,
      });
      if (!result.ok) {
        setProblem(result.message);
        announce(result.message);
        return;
      }
      const how = 'direction' in move ? ` ${move.direction}` : '';
      announce(`${row.title} moved${how}, position ${positionText(result.position)}.`);
      reload();
    },
    [api, collection.name, reload],
  );

  const createSection = async (row: Row) => {
    setProblem(null);
    const result = await api.createSection(collection.name, row.path);
    if (result.ok) navigate({ screen: 'edit', collection: collection.name, id: result.id });
    else setProblem('message' in result ? result.message : 'The section page couldn’t be created.');
  };

  const onMenu = (row: Row, action: string) => {
    if (action === 'open' && row.entryId !== undefined) {
      navigate({ screen: 'edit', collection: collection.name, id: row.entryId });
    } else if (action === 'child') {
      navigate({ screen: 'new', collection: collection.name, parent: row.path });
    } else if (action === 'move') {
      setMoving({ row, parent: parentOf(row.path) });
    } else if (action === 'up' || action === 'down') {
      void reorder(row, { direction: action });
    } else if (action === 'section') {
      void createSection(row);
    } else if (action === 'delete') {
      setDeleting(row);
    }
  };

  const onRowKeyDown = (row: Row, event: KeyboardEvent<HTMLDivElement>) => {
    // Shift+F10 or the menu key opens the row's "…" menu, as a context menu would.
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement)
        .querySelector<HTMLButtonElement>(
          `button[aria-label="More actions for ${CSS.escape(row.title)}"]`,
        )
        ?.click();
      return;
    }
    if (!editable || !event.altKey || row.path === '') return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      void reorder(row, { direction: event.key === 'ArrowUp' ? 'up' : 'down' });
    }
  };

  // Drag and drop, on top of the menu: between siblings reorders, onto a page moves under it.
  // A move to another parent opens the same dialog as "Move to…", so its effects are confirmed.
  const { dragAndDropHooks } = useDragAndDrop<Row>({
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    onMove: (event) => {
      // A drop onto a page is onItemDrop's: it moves the page under that one.
      if (event.target.dropPosition === 'on') return;
      const row = byKey.get(String([...event.keys][0]));
      const target = byKey.get(String(event.target.key));
      if (!row || !target) return;
      if (row.path === '') {
        announce('The home page always comes first.');
        return;
      }
      const parent = parentOf(target.path);
      if (parent !== parentOf(row.path)) {
        setMoving({ row, parent });
        return;
      }
      const siblings = siblingsOf(row, rows, byPath);
      const from = siblings.indexOf(row);
      const slot = siblings.indexOf(target) + (event.target.dropPosition === 'after' ? 1 : 0);
      const to = slot > from ? slot - 1 : slot;
      if (from === -1 || to === from) return;
      void reorder(row, { index: to });
    },
    onItemDrop: (event) => {
      const target = byKey.get(String(event.target.key));
      const item = event.items[0];
      if (!target || item?.kind !== 'text') return;
      void item.getText('text/plain').then((key) => {
        const row = byKey.get(key);
        if (row && row !== target && row.path !== '') setMoving({ row, parent: target.path });
      });
    },
  });

  return (
    <Screen title={collection.label} afterglow={load.state === 'ready' && rows.length === 0}>
      {!editable && (
        <p className="mb-6 max-w-2xl text-content-muted">
          {collection.label} can be read here but not edited.
        </p>
      )}
      {load.state === 'failed' && (
        <p role="alert" className="mb-6 text-danger">
          Couldn’t load the pages: {load.message}
        </p>
      )}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <p className="max-w-2xl text-content-muted">
          Pages are listed as they nest on the site. Each page’s “…” menu adds a page under it,
          moves it or changes its order. From a page, the right arrow or Shift+F10 reaches its menu,
          and Alt+↑ and Alt+↓ move it.
        </p>
        {editable && (
          // The screen's one primary action.
          <ButtonLink
            variant="primary"
            icon="add"
            href={hrefFor({ screen: 'new', collection: collection.name })}
            className="ml-auto"
          >
            New page
          </ButtonLink>
        )}
      </div>
      {problem && (
        <p role="alert" className="mb-4 text-danger">
          {problem}
        </p>
      )}
      {load.state === 'loading' ? (
        <p className="text-small text-content-muted">Loading pages…</p>
      ) : (
        <Tree<Row>
          label={collection.label}
          items={rows}
          textValue={(row) => row.title}
          expandedKeys={expanded}
          onExpandedChange={setExpanded}
          onAction={(row) => {
            if (row.entryId !== undefined) onMenu(row, 'open');
          }}
          onRowKeyDown={onRowKeyDown}
          {...(editable ? { dragAndDropHooks } : {})}
          emptyState="No pages yet."
          renderRow={(row) => (
            <>
              <span className="min-w-0 flex-1 px-1">
                <span className="block truncate font-semibold text-content">{row.title}</span>
                <span className="block truncate font-mono text-caption text-content-muted">
                  {row.url ?? `${row.path}/`}
                </span>
              </span>
              <span className="shrink-0 text-small text-content-muted">{statusOf(row)}</span>
              <Menu
                label={`More actions for ${row.title}`}
                items={menuItems(row, rows, byPath, { editable, maxDepth })}
                onAction={(action) => {
                  onMenu(row, action);
                }}
              />
            </>
          )}
        />
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {moving && (
        <MoveDialog
          collection={collection}
          row={moving.row}
          rows={rows}
          initialParent={moving.parent}
          onClose={() => {
            setMoving(null);
          }}
          onMoved={(result) => {
            setMoving(null);
            if (!result.ok) return;
            const where = result.parent ? `under ${result.parent}` : 'to the top level';
            announce(`${result.title} moved ${where}, position ${positionText(result.position)}.`);
            setExpanded((keys) => new Set([...keys, ...ancestorsOf(result.path)]));
            reload();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          collection={collection}
          row={deleting}
          onClose={() => {
            setDeleting(null);
          }}
          onDeleted={() => {
            announce(`${deleting.title} deleted.`);
            setDeleting(null);
            reload();
          }}
        />
      )}
    </Screen>
  );
}

function MoveDialog({
  collection,
  row,
  rows,
  initialParent,
  onClose,
  onMoved,
}: {
  collection: CollectionManifest;
  row: Row;
  rows: Row[];
  initialParent: string;
  onClose: () => void;
  onMoved: (result: MoveResult) => void;
}) {
  const { api } = useStudio();
  const [parent, setParent] = useState(initialParent === '' ? TOP : initialParent);
  const [slug, setSlug] = useState(row.slug);
  const [plan, setPlan] = useState<Extract<MoveResult, { ok: true }> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options: Option[] = [
    { value: TOP, label: 'Top level' },
    ...flatten(rows)
      .filter((r) => r.path !== '' && r.path !== row.path && !r.path.startsWith(`${row.path}/`))
      .map((r) => ({ value: r.path, label: `${'— '.repeat(Math.max(0, r.depth - 1))}${r.title}` })),
  ];
  const request = {
    collection: collection.name,
    path: row.path,
    parent: parent === TOP ? '' : parent,
    slug,
  };

  const review = async () => {
    setProblem(null);
    setBusy(true);
    try {
      const result = await api.movePage(request, { dryRun: true });
      if (result.ok) setPlan(result);
      else setProblem(result.message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const result = await api.movePage(request);
      if (result.ok) onMoved(result);
      else {
        setPlan(null);
        setProblem(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={plan ? `Move “${row.title}”?` : `Move “${row.title}”`}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      role={plan ? 'alertdialog' : 'dialog'}
    >
      {plan ? (
        <>
          <p>{planText(plan)}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onPress={() => {
                setPlan(null);
              }}
            >
              Back
            </Button>
            <Button variant="primary" onPress={() => void confirm()} isPending={busy}>
              Move
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void review();
          }}
        >
          <Combobox
            label="Put it under"
            description="Search by title. Choose Top level to make it a top-level page."
            options={options}
            value={parent}
            onChange={(value) => {
              setParent(value ?? TOP);
            }}
          />
          <TextField
            label="Address"
            description={`The last part of the page’s address: lower-case letters, numbers and dashes.`}
            value={slug}
            onChange={setSlug}
          />
          {problem && (
            <p role="alert" className="text-danger">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button onPress={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" isPending={busy}>
              Review move
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function DeleteDialog({
  collection,
  row,
  onClose,
  onDeleted,
}: {
  collection: CollectionManifest;
  row: Row;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { api } = useStudio();
  const [problem, setProblem] = useState<string | null>(null);
  const remove = async () => {
    const result = await api.deleteEntry(collection.name, row.entryId ?? '', row.version ?? '');
    if (result.ok) onDeleted();
    else setProblem('message' in result ? result.message : 'The page couldn’t be deleted.');
  };
  const under = flatten(row.children).filter((r) => r.entryId !== undefined).length;
  return (
    <Dialog
      title={`Delete “${row.title}”?`}
      role="alertdialog"
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <p>
        This deletes {row.file ?? 'the page'}.
        {under > 0
          ? ` The ${String(under)} ${under === 1 ? 'page' : 'pages'} under it stay, in a folder with no section page.`
          : ''}{' '}
        In local mode the file is removed from disk; git can bring it back.
      </p>
      {problem && (
        <p role="alert" className="text-danger">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onPress={onClose}>Cancel</Button>
        <Button variant="danger" onPress={() => void remove()}>
          Delete
        </Button>
      </div>
    </Dialog>
  );
}

/** The confirmation's words (spec §6.15.4): what moves, what changes with it. */
export function planText(plan: Extract<MoveResult, { ok: true }>): string {
  const others = plan.pages - (plan.id !== undefined ? 1 : 0);
  const what =
    others > 0
      ? `“${plan.title}” and its ${String(others)} ${others === 1 ? 'page' : 'pages'}`
      : `“${plan.title}”`;
  const where = plan.parent ? `under “${plan.parent}”` : 'to the top level';
  const address = plan.to ? ` Its address becomes ${plan.to}.` : '';
  const links =
    plan.links > 0
      ? ` ${String(plan.links)} ${plan.links === 1 ? 'link' : 'links'} on other pages will be updated.`
      : '';
  const visitors =
    plan.redirects > 0 ? ' Visitors to the old addresses will be sent to the new ones.' : '';
  return `This moves ${what} ${where}.${address}${links}${visitors}`;
}

function menuItems(
  row: Row,
  rows: Row[],
  byPath: Map<string, Row>,
  options: { editable: boolean; maxDepth: number | undefined },
): MenuItem[] {
  const items: MenuItem[] = [];
  if (row.entryId !== undefined) items.push({ id: 'open', label: 'Open', icon: 'open' });
  if (!options.editable) return items;
  const siblings = siblingsOf(row, rows, byPath);
  const index = siblings.indexOf(row);
  const canHaveChild = options.maxDepth === undefined || row.depth < options.maxDepth;
  if (row.path !== '' && canHaveChild)
    items.push({ id: 'child', label: 'Add child page', icon: 'add-child' });
  if (row.entryId === undefined)
    items.push({ id: 'section', label: 'Create section page', icon: 'add-child' });
  if (row.path !== '') {
    items.push({ id: 'move', label: 'Move to…', icon: 'move-to' });
    items.push({ id: 'up', label: 'Move up', icon: 'move-up', isDisabled: index <= 0 });
    items.push({
      id: 'down',
      label: 'Move down',
      icon: 'move-down',
      isDisabled: index === siblings.length - 1,
    });
  }
  if (row.entryId !== undefined && row.path !== '') {
    items.push({ id: 'delete', label: 'Delete…', icon: 'delete', isDanger: true });
  }
  return items;
}

function statusOf(row: Row): string {
  if (row.entryId === undefined) return 'No section page';
  if (row.status === 'read-only') return 'Read only';
  if (row.status === 'source-only') return 'Edit as YAML';
  return row.draft ? 'Draft' : '';
}

function toRows(nodes: PageTreeNode[]): Row[] {
  return nodes.map(({ id, children, ...node }) => ({
    ...node,
    id: node.path || '(home)',
    ...(id !== undefined ? { entryId: id } : {}),
    children: toRows(children),
  }));
}

function siblingsOf(row: Row, rows: Row[], byPath: Map<string, Row>): Row[] {
  const parent = parentOf(row.path);
  return parent === '' ? rows.filter((r) => r.path !== '') : (byPath.get(parent)?.children ?? []);
}

function flatten(rows: Row[]): Row[] {
  return rows.flatMap((row) => [row, ...flatten(row.children)]);
}

function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

function positionText(position: Position): string {
  return `${String(position.index)} of ${String(position.of)}`;
}
