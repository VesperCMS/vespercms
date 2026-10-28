import {
  calendarDate,
  decodeValue,
  encodeValue,
  parseRedirectsCsv,
  redirectKey,
  type CsvImport,
  type PageLink,
  type RedirectsDocument,
  type RedirectStatus,
} from '@vespercms/core';
import {
  Button,
  Dialog,
  FileButton,
  Menu,
  RadioGroup,
  SuggestField,
  Table,
  TextField,
  type TableColumn,
} from '@vespercms/ui';
import { useMemo, useState } from 'react';
import { useStudio } from '../app/context.tsx';
import { useLoad } from '../app/load.ts';
import { Screen } from '../app/Screen.tsx';

/*
 * The Redirects screen (spec §6.15.5), behind the top bar's Site menu. Moves
 * add redirects on their own; this is for the rest: short links, and
 * bringing an old WordPress or Drupal site over from a CSV export. Every
 * save goes through the same cleanup as the build (chains collapsed, loops
 * and redirects onto real pages removed).
 */

type Row = {
  id: string;
  index: number;
  from: string;
  to: string;
  status: RedirectStatus;
  reason: string;
  at: Date | null;
};

type Editing = { index: number | null; from: string; to: string; permanent: boolean };

const COLUMNS: TableColumn[] = [
  { id: 'from', label: 'Old address', isRowHeader: true },
  { id: 'to', label: 'Goes to' },
  { id: 'kind', label: 'Kind' },
  { id: 'reason', label: 'Why' },
  { id: 'at', label: 'Added' },
  { id: 'actions', label: 'Actions' },
];

export function Redirects() {
  const { api, manifest } = useStudio();
  const [load, reload] = useLoad(() => api.readRedirects(), 'redirects');
  const [pagesLoad] = useLoad(() => api.listPages(), 'pages');
  const [doc, setDoc] = useState<RedirectsDocument | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [importing, setImporting] = useState<{ name: string; parsed: CsvImport } | null>(null);
  const [notice, setNotice] = useState<{ kind: 'done' | 'error'; text: string } | null>(null);

  const current = doc ?? (load.state === 'ready' ? load.value : null);
  const pages = pagesLoad.state === 'ready' ? pagesLoad.value : [];
  const rows = useMemo(() => (current ? toRows(current.redirects) : []), [current]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === ''
      ? rows
      : rows.filter(
          (r) => r.from.toLowerCase().includes(needle) || r.to.toLowerCase().includes(needle),
        );
  }, [rows, query]);

  const today = () => encodeValue(calendarDate(new Date(), manifest.site.timeZone));

  /** Saves a whole new list. Returns the problem in words, or null when it saved. */
  const save = async (redirects: unknown[], done: string): Promise<string | null> => {
    if (!current) return 'The redirects haven’t loaded yet.';
    const result = await api.saveRedirects({ version: current.version, redirects });
    if (!result.ok) {
      if (result.reason === 'conflict') reload();
      return result.message;
    }
    const { ok: _ok, ...next } = result;
    setDoc(next);
    setNotice({ kind: 'done', text: done });
    return null;
  };

  return (
    <Screen title="Redirects">
      <p className="mb-6 max-w-2xl text-content-muted">
        A redirect sends visitors from an old address to a new one. Moving a page adds them for you.
        Add your own for short links, or import a list when you bring an old site over.
      </p>
      {load.state === 'failed' && (
        <p role="alert" className="mb-6 text-danger">
          Couldn’t load the redirects: {load.message}
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
        <FileButton
          icon="import"
          accept={['.csv', 'text/csv', 'text/plain']}
          onSelect={(file) => {
            void file.text().then((text) => {
              setImporting({ name: file.name, parsed: parseRedirectsCsv(text) });
            });
          }}
        >
          Import from CSV…
        </FileButton>
        <Button
          variant="primary"
          icon="add"
          className="ml-auto"
          isDisabled={!current}
          onPress={() => {
            setEditing({ index: null, from: '', to: '', permanent: true });
          }}
        >
          Add redirect
        </Button>
      </div>
      <p role="status" className="mb-4 text-content-muted">
        {notice?.kind === 'done' ? notice.text : ''}
      </p>
      {notice?.kind === 'error' && (
        <p role="alert" className="mb-4 text-danger">
          {notice.text}
        </p>
      )}
      {current && current.warnings.length > 0 && (
        <section aria-labelledby="redirect-warnings" className="mb-6 max-w-2xl">
          <h2 id="redirect-warnings" className="mb-2 text-heading-2">
            Needs a look
          </h2>
          <ul className="list-disc pl-6">
            {current.warnings.map((warning, i) => (
              <li key={`${warning.from}:${String(i)}`}>{warning.message}</li>
            ))}
          </ul>
        </section>
      )}
      {load.state === 'loading' ? (
        <p className="text-small text-content-muted">Loading redirects…</p>
      ) : (
        <Table
          label="Redirects"
          columns={COLUMNS}
          rows={shown}
          emptyState={rows.length === 0 ? 'No redirects yet.' : 'No redirects match.'}
          renderCell={(row, column) => {
            // Addresses are set in mono, the old one as the row's name.
            if (column === 'from')
              return <span className="font-mono text-small font-semibold">{row.from}</span>;
            if (column === 'to') return <span className="font-mono text-small">{row.to}</span>;
            if (column === 'kind') return isPermanent(row.status) ? 'Permanent' : 'Temporary';
            if (column === 'reason')
              return <span className="text-content-muted">{reasonText(row.reason)}</span>;
            if (column === 'at') {
              return (
                <span className="text-content-muted">
                  {row.at
                    ? row.at.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
                    : ''}
                </span>
              );
            }
            return (
              <Menu
                label={`Actions for the redirect from ${row.from}`}
                items={[
                  { id: 'edit', label: 'Edit…', icon: 'edit' },
                  { id: 'delete', label: 'Delete…', isDanger: true, icon: 'delete' },
                ]}
                onAction={(action) => {
                  if (action === 'edit') {
                    setEditing({
                      index: row.index,
                      from: row.from,
                      to: row.to,
                      permanent: isPermanent(row.status),
                    });
                  } else {
                    setDeleting(row);
                  }
                }}
              />
            );
          }}
        />
      )}

      {editing && current && (
        <RedirectDialog
          editing={editing}
          pages={pages}
          onClose={() => {
            setEditing(null);
          }}
          onSave={async (next) => {
            const from = normalizeFrom(next.from);
            const list = [...current.redirects];
            const value = {
              ...(editing.index !== null ? (list[editing.index] as object) : {}),
              from,
              to: next.to.trim(),
              status: next.permanent ? 301 : 302,
              ...(editing.index === null ? { reason: 'manual', at: today() } : {}),
            };
            if (editing.index === null) list.push(value);
            else list[editing.index] = value;
            const problem = await save(
              list,
              editing.index === null
                ? `Added a redirect from ${from}.`
                : `Saved the redirect from ${from}.`,
            );
            if (!problem) setEditing(null);
            return problem;
          }}
        />
      )}

      {deleting && current && (
        <Dialog
          title="Delete this redirect?"
          role="alertdialog"
          isOpen
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        >
          <p>
            Visitors to {deleting.from} will no longer be sent to {deleting.to}. If nothing else is
            at that address, they’ll see the site’s “not found” page.
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              onPress={() => {
                setDeleting(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                const list = current.redirects.filter((_, i) => i !== deleting.index);
                void save(list, `Deleted the redirect from ${deleting.from}.`).then((problem) => {
                  if (problem) setNotice({ kind: 'error', text: problem });
                  setDeleting(null);
                });
              }}
            >
              Delete
            </Button>
          </div>
        </Dialog>
      )}

      {importing && current && (
        <ImportDialog
          name={importing.name}
          parsed={importing.parsed}
          existing={rows}
          onClose={() => {
            setImporting(null);
          }}
          onImport={async () => {
            const list = [...current.redirects];
            const at = today();
            for (const row of importing.parsed.rows) {
              const value = {
                from: row.from,
                to: row.to,
                status: row.status,
                reason: 'import',
                at,
              };
              const index = list.findIndex(
                (item) => redirectKey(String((item as { from?: unknown }).from)) === row.from,
              );
              if (index === -1) list.push(value);
              else list[index] = value;
            }
            const count = importing.parsed.rows.length;
            const problem = await save(
              list,
              `Imported ${String(count)} ${count === 1 ? 'redirect' : 'redirects'}.`,
            );
            if (!problem) setImporting(null);
            return problem;
          }}
        />
      )}
    </Screen>
  );
}

function RedirectDialog({
  editing,
  pages,
  onClose,
  onSave,
}: {
  editing: Editing;
  pages: PageLink[];
  onClose: () => void;
  onSave: (next: Editing) => Promise<string | null>;
}) {
  const [from, setFrom] = useState(editing.from);
  const [to, setTo] = useState(editing.to);
  const [permanent, setPermanent] = useState(editing.permanent);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggestions = useMemo(
    () => pages.map((page) => ({ value: page.url, label: page.title, detail: page.url })),
    [pages],
  );
  return (
    <Dialog
      title={editing.index === null ? 'Add a redirect' : 'Edit redirect'}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const missing =
            from.trim() === ''
              ? 'Enter the old address, like /apply-now.'
              : to.trim() === ''
                ? 'Choose where it goes: a page on this site or a full web address.'
                : null;
          if (missing) {
            setProblem(missing);
            return;
          }
          setBusy(true);
          void onSave({ ...editing, from, to, permanent }).then((result) => {
            setBusy(false);
            setProblem(result);
          });
        }}
      >
        <TextField
          label="Old address"
          description="The path visitors use, like /apply-now."
          value={from}
          onChange={setFrom}
        />
        <SuggestField
          label="Goes to"
          description="Search pages by title, or type a path or a full web address."
          value={to}
          onChange={setTo}
          suggestions={suggestions}
          inputMode="url"
        />
        <RadioGroup
          label="Kind"
          value={permanent ? 'permanent' : 'temporary'}
          onChange={(value) => {
            setPermanent(value === 'permanent');
          }}
          options={[
            { value: 'permanent', label: 'Permanent: the page has moved for good' },
            { value: 'temporary', label: 'Temporary: it will come back' },
          ]}
        />
        {problem && (
          <p role="alert" className="text-danger">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button onPress={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" isPending={busy}>
            {editing.index === null ? 'Add redirect' : 'Save redirect'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportDialog({
  name,
  parsed,
  existing,
  onClose,
  onImport,
}: {
  name: string;
  parsed: CsvImport;
  existing: Row[];
  onClose: () => void;
  onImport: () => Promise<string | null>;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = new Set(existing.map((r) => redirectKey(r.from)));
  const replacing = parsed.rows.filter((r) => known.has(r.from)).length;
  const adding = parsed.rows.length - replacing;
  return (
    <Dialog
      title={`Import ${name}`}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {parsed.rows.length === 0 && parsed.problems.length === 0 ? (
        <p>This file has no rows. Each row needs an old address and a new one.</p>
      ) : (
        <>
          <p>
            {parsed.rows.length === 0
              ? 'None of the rows can be imported.'
              : `${String(adding)} new ${adding === 1 ? 'redirect' : 'redirects'}${replacing > 0 ? `, and ${String(replacing)} that replace ${replacing === 1 ? 'one' : 'ones'} already here` : ''}.`}{' '}
            Chains and loops are tidied up when they’re saved.
          </p>
          {parsed.problems.length > 0 && (
            <section aria-labelledby="import-skipped">
              <h3 id="import-skipped" className="mb-1 text-heading-3">
                {parsed.problems.length === 1
                  ? '1 row is skipped'
                  : `${String(parsed.problems.length)} rows are skipped`}
              </h3>
              <ul className="max-h-48 list-disc overflow-auto pl-6">
                {parsed.problems.map((p) => (
                  <li key={p.line}>
                    Row {p.line}: {p.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {problem && (
        <p role="alert" className="text-danger">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button onPress={onClose}>Cancel</Button>
        {parsed.rows.length > 0 && (
          <Button
            variant="primary"
            isPending={busy}
            onPress={() => {
              setBusy(true);
              void onImport().then((result) => {
                setBusy(false);
                setProblem(result);
              });
            }}
          >
            {`Import ${String(parsed.rows.length)} ${parsed.rows.length === 1 ? 'redirect' : 'redirects'}`}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

function toRows(list: unknown[]): Row[] {
  return list.flatMap((item, index) => {
    const value = decodeValue(item);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    const { from, to, status, reason, at } = value as Record<string, unknown>;
    if (typeof from !== 'string' || typeof to !== 'string') return [];
    return [
      {
        id: `${String(index)}:${from}`,
        index,
        from,
        to,
        status: (typeof status === 'number' ? status : 301) as RedirectStatus,
        reason: typeof reason === 'string' ? reason : '',
        at: at instanceof Date ? at : null,
      },
    ];
  });
}

function isPermanent(status: number): boolean {
  return status === 301 || status === 308;
}

function reasonText(reason: string): string {
  if (reason === 'move') return 'A page moved';
  if (reason === 'manual') return 'Added here';
  if (reason === 'import') return 'Imported';
  return reason;
}

function normalizeFrom(from: string): string {
  const trimmed = from.trim();
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}
