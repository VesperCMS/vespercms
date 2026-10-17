import {
  decodeData,
  deepEqual,
  encodeValue,
  lineEndings,
  type CollectionManifest,
  type DataObject,
  type DataValue,
  type EntryDocument,
  type FieldIssue,
  type FieldModel,
  type SaveRequest,
} from '@vesper/core';
import {
  Button,
  Dialog,
  Disclosure,
  ErrorSummary,
  InlineStatus,
  Link,
  Menu,
  TextArea,
  type MenuItem,
} from '@vesper/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../app/context.tsx';
import { formatRelative } from '../app/format.ts';
import { useLoad } from '../app/load.ts';
import { hrefFor, navigate, setLeaveGuard } from '../app/router.ts';
import { Screen } from '../app/Screen.tsx';
import { arrangeFields } from '../editor/arrange.ts';
import { EditorContext, useEditor, type EditorState } from '../editor/context.tsx';
import { Field } from '../editor/Field.tsx';
import {
  fieldId,
  getIn,
  initialValues,
  keyOf,
  pathKey,
  setIn,
  type ValuePath,
} from '../editor/values.ts';
import { builtinWidget } from '../widgets/registry.ts';
import { inputClass } from '../widgets/basic.tsx';

/**
 * Opens an entry (or starts a new one when `id` is null) and hands it to the
 * form. A reload after a conflict remounts the form with the new version.
 */
export function EntryEditor({
  collection,
  id,
}: {
  collection: CollectionManifest;
  id: string | null;
}) {
  const { api } = useStudio();
  const [load, reload] = useLoad<EntryDocument | null>(
    () => (id === null ? Promise.resolve(null) : api.readEntry(collection.name, id)),
    id ?? '',
  );

  if (load.state === 'loading') {
    return (
      <Screen title="Loading…">
        <p className="text-content-muted">Opening the entry…</p>
      </Screen>
    );
  }
  if (load.state === 'failed') {
    return (
      <Screen title="Couldn’t open this entry">
        <p className="mb-4">{load.message}</p>
        <Link href={hrefFor({ screen: 'list', collection: collection.name })}>
          Back to {collection.label}
        </Link>
      </Screen>
    );
  }
  return (
    <EntryForm
      key={load.value?.version ?? 'new'}
      collection={collection}
      doc={load.value}
      onReload={reload}
    />
  );
}

type Saved = { values: DataObject; body: string; raw: string };
type Notice =
  | { kind: 'saved'; at: Date; reformatted: boolean }
  | { kind: 'conflict' | 'error'; text: string }
  | null;

function EntryForm({
  collection,
  doc,
  onReload,
}: {
  collection: CollectionManifest;
  doc: EntryDocument | null;
  onReload: () => void;
}) {
  const { api, siteUrl } = useStudio();
  const isNew = doc === null;
  const status = doc?.status ?? 'editable';
  const editable = collection.editable && status !== 'read-only';
  const sourceOnly = status === 'source-only';
  const isContent = collection.entryKind === 'content';

  // The body starts with the line break after the closing `---` (Astro's
  // `body`), usually followed by a blank line. The textarea shows the text
  // without those leading line breaks, and saves add them back.
  const bodyPrefix = /^(?:\r?\n)+/.exec(doc?.body ?? '')?.[0] ?? '';
  const bodyEol = lineEndings(doc?.body ?? '').dominant;
  const initial = useMemo<Saved>(
    () => ({
      values: doc ? decodeData(doc.data) : initialValues(collection.fields),
      body: (doc?.body ?? '').slice(bodyPrefix.length).replace(/\r\n/g, '\n'),
      raw: (doc?.rawFrontmatter ?? '').replace(/^\r?\n/, ''),
    }),
    [doc, collection.fields, bodyPrefix.length],
  );

  const [values, setValues] = useState<DataObject>(initial.values);
  const [body, setBody] = useState(initial.body);
  const [raw, setRaw] = useState(initial.raw);
  const [saved, setSaved] = useState<Saved>(initial);
  const [version, setVersion] = useState<string | null>(doc?.version ?? null);
  const [entryId, setEntryId] = useState<string | null>(doc?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const dirty =
    !deepEqual(values, saved.values) || body !== saved.body || (sourceOnly && raw !== saved.raw);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const arranged = useMemo(() => arrangeFields(collection), [collection]);
  const titleText = titleOf(values, arranged.title) || entryId || 'New entry';

  // Issues are shown under the deepest field that's on screen for them.
  const targets = useMemo(
    () =>
      issues.map((issue) => ({ issue, target: issueTarget(collection.fields ?? [], issue.path) })),
    [issues, collection.fields],
  );
  const issueMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const { issue, target } of targets) {
      const key = pathKey(target.path);
      map.set(key, [...(map.get(key) ?? []), issue.message]);
    }
    return map;
  }, [targets]);

  const setValue = useCallback((path: ValuePath, value: DataValue) => {
    setValues((current) => setIn(current, path, value));
  }, []);
  const editor = useMemo<EditorState>(
    () => ({
      collection,
      values,
      setValue,
      issues: issueMap,
      disabled: !editable || sourceOnly,
      isNew,
      entryId,
    }),
    [collection, values, setValue, issueMap, editable, sourceOnly, isNew, entryId],
  );

  const save = useCallback(async () => {
    if (!editable || saving) return;
    setSaving(true);
    setNotice(null);
    const bodyChanged = body !== saved.body;
    const request: SaveRequest = {
      collection: collection.name,
      id: entryId ?? '',
      version,
      ...(sourceOnly
        ? { rawFrontmatter: `\n${raw.endsWith('\n') ? raw : `${raw}\n`}` }
        : { data: encodeValue(values) }),
      ...(isContent && (bodyChanged || isNew)
        ? { body: bodyPrefix + (bodyEol === '\r\n' ? body.replace(/\n/g, '\r\n') : body) }
        : {}),
    };
    try {
      const result = await api.saveEntry(request);
      if (result.ok) {
        const snapshot = { values, body, raw };
        setSaved(snapshot);
        dirtyRef.current = false;
        setVersion(result.version);
        setEntryId(result.id);
        setIssues([]);
        setNotice({ kind: 'saved', at: new Date(), reformatted: result.reformatted });
        if (isNew || result.id !== entryId) {
          navigate(
            { screen: 'edit', collection: collection.name, id: result.id },
            { replace: true },
          );
        }
      } else if (result.reason === 'invalid') {
        setIssues(result.issues);
        const detailKeys = new Set(arranged.details.map(keyOf));
        if (result.issues.some((issue) => detailKeys.has(String(issue.path[0]))))
          setDetailsOpen(true);
      } else {
        setNotice({ kind: result.reason, text: result.message });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }, [
    editable,
    saving,
    body,
    saved.body,
    collection.name,
    entryId,
    version,
    sourceOnly,
    raw,
    values,
    isContent,
    isNew,
    bodyPrefix,
    bodyEol,
    api,
    arranged.details,
  ]);

  // Ctrl+S / ⌘S saves; unsaved changes are protected from navigation and reloads.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [save]);
  useEffect(() => setLeaveGuard(() => dirtyRef.current), []);

  const deleteEntry = async () => {
    if (!entryId || !version) return;
    const result = await api.deleteEntry(collection.name, entryId, version);
    setConfirmDelete(false);
    if (result.ok) {
      dirtyRef.current = false;
      navigate({ screen: 'list', collection: collection.name }, { replace: true });
    } else {
      setNotice({
        kind: result.reason === 'conflict' ? 'conflict' : 'error',
        text: 'message' in result ? result.message : 'The entry couldn’t be deleted.',
      });
    }
  };

  const viewUrl = !isNew && entryId ? pageUrl(collection, entryId, siteUrl) : null;
  const menuItems: MenuItem[] = [
    ...(viewUrl ? [{ id: 'view', label: 'View on site' }] : []),
    ...(!isNew && editable && !collection.presentation.singleton
      ? [{ id: 'delete', label: 'Delete…', isDanger: true }]
      : []),
  ];

  const statusText = saving
    ? 'Saving…'
    : dirty
      ? 'Unsaved changes'
      : notice?.kind === 'saved'
        ? `Saved ${formatRelative(notice.at.toISOString())}`
        : isNew
          ? 'Not saved yet'
          : '';
  const draft = values.draft === true;
  const back = collection.presentation.singleton
    ? { href: hrefFor({ screen: 'home' }), label: 'Content' }
    : { href: hrefFor({ screen: 'list', collection: collection.name }), label: collection.label };

  const bar = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
      <Link href={back.href}>
        <span aria-hidden="true">← </span>
        {back.label}
      </Link>
      <span className="min-w-0 flex-1 truncate text-content-muted">{titleText}</span>
      <InlineStatus>{[draft ? 'Draft' : '', statusText].filter(Boolean).join(' · ')}</InlineStatus>
      {editable && (
        <Button variant="primary" onPress={() => void save()} isPending={saving}>
          Save
        </Button>
      )}
      {menuItems.length > 0 && (
        <Menu
          label={`More actions for ${titleText}`}
          items={menuItems}
          onAction={(action) => {
            if (action === 'view' && viewUrl) window.open(viewUrl, '_blank', 'noopener');
            if (action === 'delete') setConfirmDelete(true);
          }}
        />
      )}
    </div>
  );

  const errors = targets.map(({ issue, target }) => ({
    fieldId: target.focusId,
    message: `${target.label}: ${issue.message}`,
  }));

  return (
    <Screen title={titleText} hideTitle={Boolean(arranged.title) && !sourceOnly} bar={bar}>
      <EditorContext.Provider value={editor}>
        <div className="mx-auto flex max-w-[720px] flex-col gap-6">
          {doc?.message && (
            <p className="rounded-md border-l-4 border-warning bg-surface-raised p-4">
              {doc.message}
            </p>
          )}
          {notice?.kind === 'conflict' && (
            <div role="alert" className="rounded-md border-l-4 border-danger bg-surface-raised p-4">
              <p className="mb-3">{notice.text}</p>
              <Button onPress={onReload}>Reload this entry</Button>
            </div>
          )}
          {notice?.kind === 'error' && (
            <p role="alert" className="rounded-md border-l-4 border-danger bg-surface-raised p-4">
              Nothing was saved. {notice.text}
            </p>
          )}
          {notice?.kind === 'saved' && notice.reformatted && (
            <p className="text-sm text-content-muted">
              Saved. This file uses YAML features Vesper can’t edit in place, so its frontmatter was
              rewritten in a standard layout.
            </p>
          )}
          <ErrorSummary title="The entry wasn’t saved" errors={errors} />

          {sourceOnly ? (
            <TextArea
              label="Frontmatter (YAML)"
              description="Vesper can’t show this frontmatter as fields, so it’s edited as text. It’s checked against the site’s schema when you save."
              value={raw}
              onChange={setRaw}
              rows={Math.min(24, raw.split('\n').length + 2)}
              isDisabled={!editable}
              className="font-mono"
            />
          ) : (
            <>
              {arranged.title && <TitleField field={arranged.title} />}
              {arranged.main.map((field) => (
                <Field key={keyOf(field)} field={field} path={[keyOf(field)]} />
              ))}
            </>
          )}

          {isContent && (
            <div className="flex flex-col gap-1">
              <label htmlFor="entry-body" className="text-sm font-semibold text-content">
                Body
              </label>
              <textarea
                id="entry-body"
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                }}
                rows={18}
                disabled={!editable}
                className={`${inputClass} resize-y leading-relaxed`}
              />
            </div>
          )}

          {!sourceOnly && arranged.details.length > 0 && (
            <Disclosure title="Details" isExpanded={detailsOpen} onExpandedChange={setDetailsOpen}>
              <div className="flex flex-col gap-6 pt-2">
                {arranged.details.map((field) => (
                  <Field key={keyOf(field)} field={field} path={[keyOf(field)]} />
                ))}
              </div>
            </Disclosure>
          )}
        </div>
      </EditorContext.Provider>

      <Dialog
        title={`Delete “${titleText}”?`}
        role="alertdialog"
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
      >
        <p className="mb-6">
          This deletes {doc?.path ?? 'the file'}. In local mode the file is removed from disk; git
          can bring it back.
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            onPress={() => {
              setConfirmDelete(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="danger" onPress={() => void deleteEntry()}>
            Delete
          </Button>
        </div>
      </Dialog>
    </Screen>
  );
}

/** The title field, styled as the document's heading (spec §10.3). */
function TitleField({ field }: { field: FieldModel }) {
  const editor = useEditor();
  const path = [keyOf(field)];
  const id = fieldId(path);
  const errors = editor.issues.get(pathKey(path)) ?? [];
  const value = getIn(editor.values, path);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-content-muted">
        {field.label}
        {field.required && (
          <>
            {' '}
            <span className="font-normal">(required)</span>
          </>
        )}
      </label>
      <input
        id={id}
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => {
          editor.setValue(
            path,
            event.target.value === '' && !field.required ? undefined : event.target.value,
          );
        }}
        aria-invalid={errors.length > 0 || undefined}
        aria-describedby={errors.length > 0 ? `${id}-error` : undefined}
        disabled={editor.disabled || field.readOnly === true}
        placeholder={field.placeholder ?? 'Untitled'}
        className="w-full rounded-md border border-transparent bg-transparent px-0 py-1 text-3xl font-semibold text-content outline-none placeholder:text-content-muted focus-visible:border-border-strong focus-visible:px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-[invalid=true]:border-danger aria-[invalid=true]:px-2"
      />
      {errors.length > 0 && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {errors.join(' ')}
        </p>
      )}
    </div>
  );
}

function titleOf(values: DataObject, title: FieldModel | undefined): string {
  if (!title) return '';
  const value = values[keyOf(title)];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Where an issue is shown: the deepest field on screen along its path. An
 * issue inside a raw field, or in a nested value no control shows, lands on
 * the nearest field that is shown.
 */
function issueTarget(
  fields: readonly FieldModel[],
  path: FieldIssue['path'],
): { path: ValuePath; focusId: string; label: string } {
  let models: readonly FieldModel[] = fields;
  let model: FieldModel | undefined;
  const matched: (string | number)[] = [];
  for (const segment of path) {
    if (typeof segment === 'number') {
      const item = model?.kind === 'array' ? model.children?.[0] : undefined;
      if (!item || !usesChildren(model)) break;
      model = item;
      models = item.children ?? [];
    } else {
      const next = models.find((candidate) => keyOf(candidate) === segment);
      if (!next || (model && !usesChildren(model))) break;
      model = next;
      models = next.children ?? [];
    }
    matched.push(segment);
  }
  if (!model) return { path: [], focusId: 'main', label: 'Entry' };
  const id = fieldId(matched);
  return {
    path: matched,
    focusId: builtinWidget(model).group ? `${id}-label` : id,
    label: model.label,
  };
}

/** Whether a field's widget shows its children as their own fields (groups and repeaters do). */
function usesChildren(field: FieldModel | undefined): boolean {
  if (!field) return true;
  return builtinWidget(field).rendersChildren === true;
}

/** The entry's page on the site, from the collection's URL pattern (spec §6.15.1, basic tokens only). */
function pageUrl(
  collection: CollectionManifest,
  id: string,
  siteUrl: string | undefined,
): string | null {
  const pattern = collection.presentation.url;
  if (typeof pattern !== 'string' || siteUrl === undefined) return null;
  const path = pattern.replace(/:(id|slug|path)\b/g, id).replace(/^\//, '');
  return `${siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`}${path}`;
}
