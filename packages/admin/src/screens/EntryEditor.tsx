import {
  DEFAULT_URL_SETTINGS,
  type A11yNote,
  decodeData,
  deepEqual,
  encodeValue,
  entryPath as treePathOf,
  entryUrlKey,
  formatUrl,
  lineEndings,
  scheduleTime,
  type BodyFormat,
  type BodyIssue,
  type CollectionManifest,
  type DataObject,
  type DataValue,
  type EntryDocument,
  type FieldIssue,
  type FieldModel,
  type Manifest,
  type Draft,
  type PageTreeNode,
  type Review,
  type SaveRequest,
} from '@vespercms/core';
import {
  Button,
  Dialog,
  ErrorSummary,
  IconButton,
  InlineStatus,
  Link,
  Menu,
  Tabs,
  TextArea,
  TextField,
  type MenuItem,
} from '@vespercms/ui';
import {
  Fragment,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '../app/api.ts';
import { useStudio } from '../app/context.tsx';
import { formatCount, formatRelative } from '../app/format.ts';
import { useLoad } from '../app/load.ts';
import { usePane } from '../app/pane-context.ts';
import { entriesChanged, onEntriesRewritten } from '../app/entries-changed.ts';
import { hasUnsavedChanges, hrefFor, navigate, setLeaveGuard } from '../app/router.ts';
import { Screen, useMeasure } from '../app/Screen.tsx';
import { arrangeFields } from '../editor/arrange.ts';
import { copiedValues } from '../editor/copy.ts';
import { EditorContext, useEditor, type EditorState } from '../editor/context.tsx';
import { Field } from '../editor/Field.tsx';
import { focusWhenShown, REVEAL_EVENT } from '../editor/reveal.ts';
import { issuePlace, issueTarget } from '../editor/target.ts';
import {
  fieldId,
  getIn,
  initialValues,
  keyOf,
  pathKey,
  setIn,
  type ValuePath,
} from '../editor/values.ts';
import type { BodyChecks } from '../body/checks.ts';
import type { BodyApi } from '../body/BodyEditor.tsx';
import { isMac } from '../body/shortcuts.ts';
import { useNow } from '../schedule/now.ts';
import { ScheduleDialog } from '../schedule/ScheduleDialog.tsx';
import { ScheduleSummary } from '../schedule/ScheduleSummary.tsx';
import { holdUntil } from '../schedule/cloud.ts';
import { scheduleKeys, siteZone, timesOf, withTimes } from '../schedule/times.ts';
import { StateWords, entryState, isNewInDraft } from './status.tsx';
import { useEntryNotes } from '../a11y/useNotes.ts';
import {
  ConflictCompare,
  DeployLine,
  RequestReviewDialog,
  keptChanges,
  keptKey,
  useEntryDraft,
} from '../cloud/editor.tsx';
import { NotesDrawer, notesCount, type NoteGroup } from '../a11y/NotesDrawer.tsx';

// Tiptap and the Markdown tooling are most of the studio's weight, and only
// entries with a body need them: they load the first time one is opened.
const BodyEditor = lazy(() =>
  import('../body/BodyEditor.tsx').then((module) => ({ default: module.BodyEditor })),
);

/**
 * Opens an entry (or starts a new one when `id` is null) and hands it to the
 * form. A reload after a conflict remounts the form with the new version.
 * With `copy`, the entry is the original of a new one (Duplicate).
 */
export function EntryEditor({
  collection,
  id,
  parent,
  copy = false,
}: {
  collection: CollectionManifest;
  id: string | null;
  /** New pages in a tree collection: the parent page's path (spec §6.15.2). */
  parent?: string;
  copy?: boolean;
}) {
  const { api } = useStudio();
  const [load, reload] = useLoad<EntryDocument | null>(
    () => (id === null ? Promise.resolve(null) : api.readEntry(collection.name, id)),
    id ?? '',
  );
  // A move in the list beside it can write this entry's order number. Read
  // it again, or the next save would find a version it didn't start from.
  useEffect(
    () =>
      onEntriesRewritten(collection.name, (ids) => {
        if (id !== null && ids.includes(id) && !hasUnsavedChanges()) reload();
      }),
    [collection.name, id, reload],
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
        <Link icon="back" href={hrefFor({ screen: 'list', collection: collection.name })}>
          Back to {collection.label}
        </Link>
      </Screen>
    );
  }
  if (copy && load.value?.status !== 'editable') {
    return (
      <Screen title="This entry can’t be duplicated">
        <p className="mb-4">
          {load.value?.message ?? 'Only entries the studio can edit as fields can be duplicated.'}
        </p>
        <Link icon="back" href={hrefFor({ screen: 'list', collection: collection.name })}>
          Back to {collection.label}
        </Link>
      </Screen>
    );
  }
  // A copy in a tree goes beside its original, under the same parent page.
  const copyParent =
    copy && load.value && collection.presentation.tree ? parentPath(treePathOf(load.value.id)) : '';
  return (
    <EntryForm
      key={load.value?.version ?? 'new'}
      collection={collection}
      doc={load.value}
      copy={copy}
      onReload={reload}
      {...(parent !== undefined ? { parent } : copyParent ? { parent: copyParent } : {})}
    />
  );
}

type Saved = { values: DataObject; body: string; raw: string };
type Notice =
  | { kind: 'saved'; at: Date; reformatted: boolean }
  | { kind: 'conflict' | 'error' | 'expired'; text: string }
  | null;
/** What happened when the entry's draft was published, or sent for review (the cloud). */
type CloudNotice =
  | { kind: 'published'; commit: string }
  | { kind: 'conflict'; path: string; published: string | null }
  | { kind: 'refused' | 'kept' | 'nothing' | 'review-requested' | 'held'; text: string }
  | null;

function EntryForm({
  collection,
  doc,
  copy,
  onReload,
  parent,
}: {
  collection: CollectionManifest;
  /** The entry, or a copy's original. */
  doc: EntryDocument | null;
  /** A new entry that starts as a copy of `doc` (Duplicate, spec §10.3). */
  copy: boolean;
  onReload: () => void;
  parent?: string;
}) {
  const { api, siteUrl, manifest, loadMdxProps, account, cloud } = useStudio();
  // GitHub mode publishes on save: the button and its words say so (spec §6.8).
  const publishes = api.publishesOnSave();
  /** The entry being edited: none yet for a new one, a copy included. */
  const entry = copy ? null : doc;
  const isNew = entry === null;
  const status = doc?.status ?? 'editable';
  /** The entry's file: known once it's saved, guessed for a new one. */
  const [savedPath, setSavedPath] = useState<string | null>(entry?.path ?? null);
  const pathRef = useRef(savedPath);
  const filePath = savedPath ?? likelyPath(collection, parent);
  // In the cloud, the member's grants decide what they may change (spec §7.5).
  const access = cloud ? cloud.access(filePath) : null;
  const editable = collection.editable && status !== 'read-only' && (access?.edit ?? true);
  const sourceOnly = status === 'source-only';
  const isContent = collection.entryKind === 'content';

  // The body starts with the line break after the closing `---` (Astro's
  // `body`), usually followed by a blank line. The textarea shows the text
  // without those leading line breaks, and saves add them back.
  const bodyPrefix = /^(?:\r?\n)+/.exec(doc?.body ?? '')?.[0] ?? '';
  const bodyEol = lineEndings(doc?.body ?? '').dominant;
  const initial = useMemo<Saved>(
    () => ({
      values: doc
        ? copy
          ? copiedValues(collection, decodeData(doc.data))
          : decodeData(doc.data)
        : initialValues(collection.fields),
      body: (doc?.body ?? '').slice(bodyPrefix.length).replace(/\r\n/g, '\n'),
      raw: (doc?.rawFrontmatter ?? '').replace(/^\r?\n/, ''),
    }),
    [doc, copy, collection, bodyPrefix.length],
  );

  /** Where unsaved changes are kept: by entry, with a copy apart from its original and from new entries. */
  const keptId = copy && doc ? `${doc.id}\ncopy` : (entry?.id ?? null);
  // Changes kept across a sign-in that expired mid-edit, put back once.
  const [kept] = useState(() => takeKept(collection.name, keptId));
  const [values, setValues] = useState<DataObject>(kept?.values ?? initial.values);
  const [body, setBody] = useState(kept?.body ?? initial.body);
  const [raw, setRaw] = useState(kept?.raw ?? initial.raw);
  const [saved, setSaved] = useState<Saved>(initial);
  const [version, setVersion] = useState<string | null>(entry?.version ?? null);
  const [entryId, setEntryId] = useState<string | null>(entry?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The cloud (spec §7.4): drafts save themselves, and Publish or Request review sends them on.
  const { draft: entryDraft, review } = useEntryDraft(filePath);
  const [cloudNotice, setCloudNotice] = useState<CloudNotice>(null);
  const [publishing, setPublishing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDiscardChanges, setConfirmDiscardChanges] = useState(false);
  /** Bumped by Discard changes, so the fields and body are drawn again from the saved values. */
  const [drawn, setDrawn] = useState(0);
  /** The last draft save was refused by the entry's own checks: the status says so, quietly. */
  const [draftBlocked, setDraftBlocked] = useState(false);
  /** The cloud couldn't be reached: changes are kept on this device, and saving tries again. */
  const [offline, setOffline] = useState(false);
  const [retries, setRetries] = useState(0);
  const [restored, setRestored] = useState(false);
  /** The tab shown: Content (`main`), Details, or one the collection declares. */
  const [tab, setTab] = useState('main');
  // Among panes, the list is beside the entry already, so the bar needs no way back to it.
  const pane = usePane();
  /** Each successful save glows Save once (glow-accent). */
  const [savedPulse, setSavedPulse] = useState(0);

  const dirty =
    !deepEqual(values, saved.values) || body !== saved.body || (sourceOnly && raw !== saved.raw);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const arranged = useMemo(() => arrangeFields(collection), [collection]);
  // As local mode has always had it; the cloud's draft lookups use `filePath`.
  // A copy's relative paths start from its original's file, and saving
  // rewrites them if the copy lands in another folder.
  const entryPath = doc?.path ?? likelyPath(collection);
  const format = bodyFormat(doc, collection);

  // The body is checked as the site's build would check it (spec §6.5.1):
  // live, a moment after typing stops, and again on save. Problems show on
  // their blocks as they appear, and in the summary once a save is refused.
  const [partials, setPartials] = useState<string[] | null>(null);
  useEffect(() => {
    if (!isContent || format !== 'mdoc') return;
    let live = true;
    api.listPartials().then(
      (files) => {
        if (live) setPartials(files);
      },
      () => {
        // Without the list, partial files simply aren't checked here; the dev API still checks on save.
      },
    );
    return () => {
      live = false;
    };
  }, [api, isContent, format]);
  // Markdoc, micromark and Zod load with the checks, on first use, like the body editor.
  const checks = useMemo(() => {
    let loaded: Promise<BodyChecks> | null = null;
    return {
      validate: async (text: string) => {
        loaded ??= import('../body/checks.ts').then((module) =>
          module.bodyChecks({ manifest, format, loadMdxProps, partials, entryPath }),
        );
        return (await loaded).validate(text);
      },
    };
  }, [manifest, format, loadMdxProps, partials, entryPath]);
  const [bodyIssues, setBodyIssues] = useState<BodyIssue[]>([]);
  const [refusals, setRefusals] = useState(0);
  /** The last save was refused by the publish gate alone. */
  const [gateRefused, setGateRefused] = useState(false);
  useEffect(() => {
    if (!isContent) return;
    let live = true;
    const timer = setTimeout(() => {
      void checks.validate(body).then((found) => {
        if (live) setBodyIssues(found);
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [body, checks, isContent]);
  const bodyErrors = bodyIssues.filter((issue) => issue.level === 'error');
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

  // Accessibility notes (spec §6.18): field notes go under their field, the
  // body's under the body.
  const fileUrl = useCallback((path: string) => api.fileUrl(path), [api]);
  const found = useEntryNotes({
    manifest,
    collection,
    values,
    body: isContent && !sourceOnly ? body : undefined,
    format,
    entryPath,
    fileUrl,
  });
  const { notes, recheck } = found;
  // The publish gate (spec §6.18): notes on these rules refuse a save.
  const blockOn = useMemo(
    () => new Set<string>(manifest.site.a11y?.blockPublishOn ?? []),
    [manifest.site.a11y],
  );
  const blocking = useMemo(() => notes.filter((n) => blockOn.has(n.rule)), [notes, blockOn]);
  const bodyNotes = useMemo(() => notes.filter((n) => n.target.kind === 'body'), [notes]);
  const noteMap = useMemo(() => {
    const map = new Map<string, A11yNote[]>();
    for (const note of notes) {
      if (note.target.kind !== 'field') continue;
      const key = pathKey(issueTarget(collection.fields ?? [], note.target.path).path);
      map.set(key, [...(map.get(key) ?? []), note]);
    }
    return map;
  }, [notes, collection.fields]);
  const bodyApi = useRef<BodyApi | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  /** A note whose field gets focus once the drawer has closed. */
  const [goTo, setGoTo] = useState<A11yNote | null>(null);

  /** Where a note is shown: its field's focus target and name, or the body. */
  const placeOf = useCallback(
    (note: A11yNote) => {
      if (note.target.kind === 'body')
        return { key: 'body', label: 'Body', focusId: 'entry-body', top: '' };
      const target = issueTarget(collection.fields ?? [], note.target.path);
      return {
        key: pathKey(target.path) || 'entry',
        label: issuePlace(collection.fields ?? [], note.target.path, values),
        focusId: target.focusId,
        top: String(note.target.path[0] ?? ''),
      };
    },
    [collection.fields, values],
  );
  // Grouped under each field in the order the form shows them: title, main fields, body, Details.
  const noteGroups = useMemo<NoteGroup[]>(() => {
    const order = [
      ...(arranged.title ? [keyOf(arranged.title)] : []),
      ...arranged.main.map(keyOf),
      '',
      ...arranged.details.map(keyOf),
    ];
    const groups = new Map<string, NoteGroup & { rank: number }>();
    for (const note of notes) {
      const place = placeOf(note);
      const group = groups.get(place.key) ?? {
        key: place.key,
        label: place.label,
        notes: [],
        rank: order.indexOf(place.top),
      };
      group.notes.push(note);
      groups.set(place.key, group);
    }
    return [...groups.values()].sort((a, b) => a.rank - b.rank);
  }, [notes, placeOf, arranged]);

  const goToNote = useCallback(
    (note: A11yNote) => {
      if (note.target.kind === 'body') {
        bodyApi.current?.reveal(note);
        return;
      }
      // A field on another tab, or in a closed item, is shown first (editor/reveal.ts).
      focusWhenShown(placeOf(note).focusId);
    },
    [placeOf],
  );
  // Once the drawer has closed. React Aria gives focus back to the count
  // only if focus fell to the page, so moving it first wins.
  useEffect(() => {
    if (notesOpen || !goTo) return;
    const timer = setTimeout(() => {
      goToNote(goTo);
      setGoTo(null);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [notesOpen, goTo, goToNote]);

  const setValue = useCallback((path: ValuePath, value: DataValue) => {
    setValues((current) => setIn(current, path, value));
  }, []);
  const editor = useMemo<EditorState>(
    () => ({
      collection,
      values,
      setValue,
      issues: issueMap,
      notes: noteMap,
      disabled: !editable || sourceOnly,
      isNew,
      entryId,
      entryPath,
    }),
    [
      collection,
      values,
      setValue,
      issueMap,
      noteMap,
      editable,
      sourceOnly,
      isNew,
      entryId,
      entryPath,
    ],
  );

  /**
   * Saves the entry, and says whether it was. In the cloud a save is a
   * draft: `auto` is the save a moment after typing stops, which is quiet
   * about problems (the status names them) and tries again while the cloud
   * can't be reached.
   */
  const save = useCallback(
    async ({
      pastGate = false,
      auto = false,
      override,
    }: {
      pastGate?: boolean;
      auto?: boolean;
      /** Values to save in place of the form's, set in the same step (a schedule's times). */
      override?: DataObject;
    } = {}) => {
      const current = override ?? values;
      if (!editable || saving) return false;
      setSaving(true);
      if (!auto) setNotice(null);
      // The publish gate, on the values as they are now (spec §6.18). Where Save
      // only writes the file on this computer, "Save anyway" goes past it
      // (DECISIONS.md, "The publish gate refuses a save"). A cloud draft isn't
      // published, so the gate waits for Publish.
      if (
        !cloud &&
        !pastGate &&
        blockOn.size > 0 &&
        (await recheck()).some((note) => blockOn.has(note.rule))
      ) {
        setGateRefused(true);
        setRefusals((n) => n + 1);
        setSaving(false);
        return false;
      }
      setGateRefused(false);
      const bodyChanged = body !== saved.body;
      // A body the site couldn't be built with isn't saved (spec §6.5.1).
      if (isContent && (bodyChanged || isNew)) {
        const found = await checks.validate(body);
        setBodyIssues(found);
        if (found.some((issue) => issue.level === 'error')) {
          if (auto) setDraftBlocked(true);
          else setRefusals((n) => n + 1);
          setSaving(false);
          return false;
        }
      }
      const request: SaveRequest = {
        collection: collection.name,
        id: entryId ?? '',
        version,
        ...(sourceOnly
          ? { rawFrontmatter: `\n${raw.endsWith('\n') ? raw : `${raw}\n`}` }
          : { data: encodeValue(current) }),
        ...(isContent && (bodyChanged || isNew)
          ? { body: bodyPrefix + (bodyEol === '\r\n' ? body.replace(/\n/g, '\r\n') : body) }
          : {}),
        ...(isNew && parent !== undefined ? { parent } : {}),
        ...(copy && doc && version === null ? { copyOf: { id: doc.id } } : {}),
      };
      try {
        const result = await api.saveEntry(request);
        setOffline(false);
        if (result.ok) {
          const snapshot = { values: current, body, raw };
          setSaved(snapshot);
          dirtyRef.current = false;
          setVersion(result.version);
          setEntryId(result.id);
          setSavedPath(result.path);
          pathRef.current = result.path;
          setIssues([]);
          setRefusals(0);
          setDraftBlocked(false);
          setRetries(0);
          setNotice({ kind: 'saved', at: new Date(), reformatted: result.reformatted });
          // The list beside the editor shows the new title or status.
          entriesChanged(collection.name);
          if (!auto) setSavedPulse((n) => n + 1);
          // "Save anyway" goes with the summary, so focus moves to Save.
          if (pastGate) focusWhenShown(SAVE_ID);
          if (isNew || result.id !== entryId) {
            navigate(
              { screen: 'edit', collection: collection.name, id: result.id },
              { replace: true },
            );
          }
        } else if (result.reason === 'invalid' && auto) {
          // A draft is a file the site could build: until it is, it stays on this device.
          setDraftBlocked(true);
        } else if (result.reason === 'invalid') {
          setIssues(result.issues);
          // The dev API checks the body again with the site's real config.
          if (result.bodyIssues) setBodyIssues(result.bodyIssues);
          setRefusals((n) => n + 1);
        } else {
          setNotice({ kind: result.reason, text: result.message });
        }
        return result.ok;
      } catch (error) {
        if (cloud && error instanceof ApiError && error.status === 0) {
          // The cloud can't be reached: the changes are kept on this device, and saving tries again.
          setOffline(true);
          setRetries((n) => n + 1);
          if (!auto) setNotice({ kind: 'error', text: error.message });
        } else if (error instanceof ApiError && error.status === 401 && account) {
          // Kept for after the sign-in redirect, which would otherwise lose them.
          keep(collection.name, entryId ?? keptId, { values: current, body, raw });
          setNotice({ kind: 'expired', text: error.message });
        } else {
          setNotice({
            kind: 'error',
            text: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    [
      cloud,
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
      checks,
      parent,
      blockOn,
      recheck,
      account,
      copy,
      doc,
      keptId,
    ],
  );

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

  // The cloud: a draft saves itself a moment after typing stops (spec §7.4).
  // A new entry waits for its first save by hand, since its file name comes
  // from the title, and a half-typed title would make a poor one. While the
  // cloud can't be reached, saving tries again, waiting longer each time.
  useEffect(() => {
    if (!cloud || isNew || !editable || !dirty || saving) return;
    const wait = offline ? Math.min(60_000, 5_000 * 2 ** Math.max(0, retries - 1)) : 1_000;
    const timer = setTimeout(() => void save({ auto: true }), wait);
    return () => {
      clearTimeout(timer);
    };
  }, [cloud, isNew, editable, dirty, saving, save, offline, retries]);

  // Unsaved changes are kept on this device as they're typed (spec §6.9), and
  // put back if the page reloads before they reach the cloud.
  const keptAt = cloud ? keptKey(cloud.client.settings.project, collection.name, keptId) : null;
  // Until the kept copy has been looked for, nothing is written or cleared:
  // the editor opens clean, and clearing then would lose what it's about to restore.
  const [keptChecked, setKeptChecked] = useState(false);
  useEffect(() => {
    if (!keptAt || !keptChecked) return;
    if (!dirty) {
      void keptChanges().delete(keptAt);
      return;
    }
    const timer = setTimeout(() => {
      void keptChanges().put(keptAt, { values: encodeValue(values), body, raw });
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [keptAt, keptChecked, dirty, values, body, raw]);
  useEffect(() => {
    if (!keptAt) return;
    let live = true;
    void keptChanges()
      .get(keptAt)
      .then((found) => {
        if (!live) return;
        if (found && !kept) {
          setValues(decodeData(found.values));
          setBody(found.body);
          setRaw(found.raw);
          setRestored(true);
        }
        setKeptChecked(true);
      });
    return () => {
      live = false;
    };
    // Once, when the entry opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptAt]);

  /**
   * Puts the entry back as it was last saved, without leaving it. The fields
   * and body are drawn again: the body and Markdown editors read their text
   * only when they're made. A copy kept on this device goes too.
   */
  const discardChanges = () => {
    setConfirmDiscardChanges(false);
    setValues(saved.values);
    setBody(saved.body);
    setRaw(saved.raw);
    setIssues([]);
    setNotice(null);
    setGateRefused(false);
    setDrawn((n) => n + 1);
    if (keptAt) void keptChanges().delete(keptAt);
  };

  /** Publishes the entry's draft, saving it first (spec §7.4). The publish gate applies here. */
  const publishDraft = async (override?: DataObject) => {
    if (!cloud || publishing) return;
    setCloudNotice(null);
    if (blockOn.size > 0 && (await recheck()).some((note) => blockOn.has(note.rule))) {
      setGateRefused(true);
      setRefusals((n) => n + 1);
      return;
    }
    if ((dirtyRef.current || isNew || override) && !(await save(override ? { override } : {})))
      return;
    setPublishing(true);
    try {
      await cloud.drafts.refresh();
      const path = pathRef.current ?? filePath;
      const draft = cloud.drafts.draftOf(path);
      if (!draft) {
        setCloudNotice({ kind: 'nothing', text: 'There’s nothing new to publish.' });
        return;
      }
      // A site that holds scheduled drafts keeps this one until its time (spec §6.17).
      const until = holdUntil(
        cloud.drafts.get().schedule,
        timesOf(collection, override ?? values).publishAt,
      );
      if (until) {
        const held = await cloud.drafts.hold([draft.id], until);
        setCloudNotice(
          held.ok
            ? {
                kind: 'held',
                text: `Scheduled. Vesper keeps it as a draft until ${scheduleTime(until, siteZone(manifest).zone, new Date())}, then publishes it.`,
              }
            : { kind: 'refused', text: held.message },
        );
        return;
      }
      const result = await cloud.drafts.publish([draft.id]);
      if (result.ok) setCloudNotice({ kind: 'published', commit: result.commit });
      else if (result.reason === 'conflict') {
        const conflict = result.conflicts.find((c) => c.path === path) ?? result.conflicts[0];
        setCloudNotice({
          kind: 'conflict',
          path: conflict?.path ?? path,
          published: conflict?.actual ?? null,
        });
      } else setCloudNotice({ kind: 'refused', text: result.message });
    } catch (error) {
      setCloudNotice({
        kind: 'refused',
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPublishing(false);
    }
  };

  /** Saves the draft, then asks for review: for those who edit but don't publish (spec §7.4). */
  const startReview = async () => {
    if (!cloud) return;
    setCloudNotice(null);
    if ((dirtyRef.current || isNew) && !(await save())) return;
    setReviewOpen(true);
  };
  const sendForReview = async (note: string) => {
    if (!cloud) return;
    try {
      await cloud.drafts.refresh();
      const draft = cloud.drafts.draftOf(pathRef.current ?? filePath);
      if (!draft) {
        setCloudNotice({ kind: 'nothing', text: 'There’s nothing new to review.' });
        return;
      }
      await cloud.drafts.requestReview([draft.id], note);
      setCloudNotice({
        kind: 'review-requested',
        text: 'Sent for review. An approver will publish it or ask for changes.',
      });
    } catch (error) {
      setCloudNotice({
        kind: 'refused',
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setReviewOpen(false);
    }
  };
  const discardDraft = async () => {
    setConfirmDiscard(false);
    if (!cloud || !entryDraft) return;
    await cloud.drafts.discard(entryDraft.id);
    dirtyRef.current = false;
    if (keptAt) await keptChanges().delete(keptAt);
    onReload();
  };

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

  // A function-form URL runs only where vesper.config.ts is loaded: in the
  // browser in GitHub mode and the cloud, in the dev API in local mode. The
  // site's page list has every entry's address worked out either way.
  const functionUrl = useFunctionUrl(collection, isNew ? null : entryId, version);
  const viewUrl =
    !isNew && entryId && siteUrl !== undefined
      ? typeof collection.presentation.url === 'string'
        ? pageUrl(collection, entryId, saved.values, manifest)
        : functionUrl
      : null;
  const editingLink = !isNew && entryId ? editingLinkOf(collection.name, entryId) : null;
  /** A link to copy that the clipboard refused: shown, selected, to copy by hand. */
  const [copyByHand, setCopyByHand] = useState<{ label: string; text: string } | null>(null);
  /** "Link copied" stands in the status for a few seconds after a copy. */
  const [linkCopied, setLinkCopied] = useState(0);
  useEffect(() => {
    if (linkCopied === 0) return;
    const timer = setTimeout(() => {
      setLinkCopied(0);
    }, 4000);
    return () => {
      clearTimeout(timer);
    };
  }, [linkCopied]);
  const copyLink = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setLinkCopied((n) => n + 1);
    } catch {
      // No clipboard over plain http, or permission refused.
      setCopyByHand({ label, text });
    }
  };
  const now = useNow();
  // A published entry whose time to go live is still to come: in the cloud it
  // can go back to a draft (call 9). With no draft there's no Publish ▾, so it's here.
  const publishPending =
    Boolean(cloud) &&
    !isNew &&
    !entryDraft &&
    editable &&
    access?.publish === true &&
    collection.presentation.schedule !== undefined &&
    (timesOf(collection, saved.values).publishAt?.getTime() ?? 0) > now.getTime();
  const menuItems: MenuItem[] = [
    ...(publishPending
      ? [{ id: 'cancel-publish', label: 'Cancel schedule', icon: 'unschedule' as const }]
      : []),
    ...(viewUrl
      ? [
          { id: 'view', label: 'View on site', icon: 'view-on-site' as const },
          { id: 'copy-page', label: 'Copy page address', icon: 'link' as const },
        ]
      : []),
    ...(editingLink
      ? [{ id: 'copy-link', label: 'Copy editing link', icon: 'link' as const }]
      : []),
    ...(!isNew && entryId && editable && status === 'editable' && !collection.presentation.singleton
      ? [{ id: 'duplicate', label: 'Duplicate', icon: 'duplicate' as const }]
      : []),
    ...(dirty && editable
      ? [
          {
            id: 'discard-changes',
            label: 'Discard changes…',
            isDanger: true,
            icon: 'discard-changes' as const,
          },
        ]
      : []),
    ...(cloud && entryDraft && editable
      ? [{ id: 'discard', label: 'Discard draft…', isDanger: true, icon: 'delete' as const }]
      : []),
    ...(!isNew && editable && !collection.presentation.singleton
      ? [{ id: 'delete', label: 'Delete…', isDanger: true, icon: 'delete' as const }]
      : []),
  ];

  const statusText = cloud
    ? cloudStatus({
        saving,
        publishing,
        offline,
        dirty,
        draftBlocked,
        isNew,
        draft: entryDraft,
        reviewState: review?.state,
        published: cloudNotice?.kind === 'published',
      })
    : saving
      ? publishes
        ? 'Publishing…'
        : 'Saving…'
      : dirty
        ? 'Unsaved changes'
        : notice?.kind === 'saved'
          ? `${publishes ? 'Published' : 'Saved'} ${formatRelative(notice.at.toISOString())}`
          : isNew
            ? 'Not saved yet'
            : '';
  const draft = values.draft === true;
  const back = collection.presentation.singleton
    ? { href: hrefFor({ screen: 'home' }), label: 'Content' }
    : { href: hrefFor({ screen: 'list', collection: collection.name }), label: collection.label };

  // Scheduling (spec §6.17): the schedule's words in the bar, Publish ▾ and the schedule in Details.
  const schedule = collection.presentation.schedule;
  const { zone } = siteZone(manifest);
  const savedTimes = schedule ? timesOf(collection, saved.values) : {};
  const later = (date: Date | undefined) => date !== undefined && date.getTime() > now.getTime();
  /** Live already, so Schedule… sets only when it comes down (call 8). */
  const live = !isNew && !later(savedTimes.publishAt);
  const nowLabel = publishes ? 'Publish now' : 'Make it live now';
  /** Sets the values and saves them, or publishes them where saves are drafts. */
  const saveWith = async (next: DataObject) => {
    setValues(next);
    if (cloud) await publishDraft(next);
    else await save({ override: next });
  };
  const withoutPublishTime = () => {
    const { publishAt: _gone, ...rest } = timesOf(collection, values);
    return withTimes(collection, values, rest);
  };
  // Publish ▾'s menu, for whoever presses the primary button to publish (or save).
  const scheduleItems: MenuItem[] =
    schedule && editable && (!cloud || access?.publish)
      ? [
          ...(!live || schedule.unpublish
            ? [{ id: 'schedule', label: 'Schedule…', icon: 'schedule' as const }]
            : []),
          ...(later(savedTimes.publishAt)
            ? [{ id: 'now', label: nowLabel, icon: 'publish-now' as const }]
            : []),
          // Without the cloud, a publish time stays until it's rescheduled: there's no draft to go back to (call 9).
          ...(live && later(savedTimes.unpublishAt)
            ? [{ id: 'cancel', label: 'Cancel schedule', icon: 'unschedule' as const }]
            : []),
          // In the cloud, a held draft stops waiting; a published entry's is in the "…" menu.
          ...(cloud && !isNew && !live && entryDraft?.held
            ? [{ id: 'cancel-publish', label: 'Cancel schedule', icon: 'unschedule' as const }]
            : []),
        ]
      : [];
  const cancelPublish = async () => {
    if (!cloud) return;
    setCloudNotice(null);
    try {
      if (entryDraft?.held) {
        await cloud.drafts.release(entryDraft.held.event);
        setCloudNotice({ kind: 'kept', text: 'It’s no longer scheduled, and stays a draft.' });
        return;
      }
      const result = await cloud.drafts.backToDraft(pathRef.current ?? filePath, {
        summary: `Take “${titleText}” off the schedule in ${collection.label}`,
        trailers: { 'Vesper-Collection': collection.name },
      });
      setCloudNotice(
        result.ok
          ? { kind: 'kept', text: 'It’s off the schedule, and back to a draft.' }
          : { kind: 'refused', text: result.message },
      );
    } catch (error) {
      setCloudNotice({
        kind: 'refused',
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const [scheduling, setScheduling] = useState<'publish' | 'set' | null>(null);
  const scheduleMenu =
    scheduleItems.length > 0 ? (
      <Menu
        label="More ways to publish"
        trigger={<IconButton icon="chevron" label="More ways to publish" />}
        items={scheduleItems}
        onAction={(action) => {
          if (action === 'schedule') setScheduling('publish');
          if (action === 'now') void saveWith(withoutPublishTime());
          if (action === 'cancel') {
            const { publishAt } = timesOf(collection, values);
            void saveWith(withTimes(collection, values, publishAt ? { publishAt } : {}));
          }
          if (action === 'cancel-publish') void cancelPublish();
        }}
      />
    ) : null;
  /** The schedule's fields give way to its summary, where the first of them would be. */
  const scheduledKeys = new Set(scheduleKeys(collection));
  const fieldsOf = (fields: FieldModel[]) => {
    let summarized = false;
    return fields.flatMap((field) => {
      if (!scheduledKeys.has(keyOf(field))) {
        return [<Field key={keyOf(field)} field={field} path={[keyOf(field)]} />];
      }
      if (summarized) return [];
      summarized = true;
      return [
        <ScheduleSummary
          key="schedule"
          collection={collection}
          values={values}
          zone={zone}
          onChange={() => {
            setScheduling('set');
          }}
        />,
      ];
    });
  };

  // What the entry is, its word coloured, then how its changes stand: never
  // empty, so the way back (or the title) above it always sits in the same place.
  const state =
    linkCopied > 0 || (isNew && !draft)
      ? null
      : entryState(
          collection,
          {
            draft,
            times: isNew ? null : saved.values,
            newDraft: isNewInDraft(entryDraft ? [entryDraft] : [], filePath),
          },
          { zone, cloud: Boolean(cloud), now },
        );
  const statusLine =
    linkCopied > 0 ? 'Link copied' : statusText || (editable ? 'No changes' : 'Read only');
  // Content, the collection's own tabs, then Details; no tab list when Content is all there is.
  const panels = sourceOnly
    ? []
    : [
        { id: 'main', label: 'Content', fields: arranged.main },
        ...arranged.tabs,
        ...(arranged.details.length > 0
          ? [{ id: 'details', label: 'Details', fields: arranged.details }]
          : []),
      ];
  const tabbed = panels.length > 1;
  const shownTab = panels.some((panel) => panel.id === tab) ? tab : 'main';
  /** A tab's name, with its problems in words so they're known before it's chosen. */
  const tabLabel = (panel: { label: string; fields: FieldModel[] }) => {
    const keys = new Set(panel.fields.map(keyOf));
    const count = issues.filter((issue) => keys.has(String(issue.path[0]))).length;
    return count > 0
      ? `${panel.label} (${formatCount(count, 'problem', 'problems')})`
      : panel.label;
  };
  /*
   * The bar keeps one height and one row whatever the status says (spec
   * §10.3). The status has a line of its own, under the way back (one screen
   * at a time) or the title (among panes), never empty, and cut short rather
   * than wrapped. The buttons never wrap or shift.
   */
  const [barRef, barWidth] = useMeasure('width', Number.POSITIVE_INFINITY);
  // The notes' count takes a button's room; where the bar has none, it's the "…" menu's first item.
  // A width of 0 is a bar not laid out (jsdom), so nothing is known about its room.
  const notesInMenu = notes.length > 0 && (!pane || (barWidth > 0 && barWidth < NOTES_ROOM));
  const moreItems: MenuItem[] = notesInMenu
    ? [
        {
          id: 'notes',
          label: notesCount(notes.length, blocking.length),
          icon: 'accessibility' as const,
        },
        ...menuItems,
      ]
    : menuItems;
  const bar = (
    <div ref={barRef} className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col">
        {!pane && (
          <Link icon="back" href={back.href} className="min-w-0 self-start text-small">
            <span className="min-w-0 truncate">{back.label}</span>
          </Link>
        )}
        {/* Among panes, the title field is the pane's heading; with no field, the heading shows. */}
        {pane && Boolean(arranged.title) && !sourceOnly && (
          <span className="truncate font-semibold text-content">{titleText}</span>
        )}
        <InlineStatus dot busy={saving || publishing} className="h-5 min-w-0">
          <span className="min-w-0 truncate">
            <StateWords state={state} />
            {state ? ' · ' : ''}
            <span>{statusLine}</span>
          </span>
        </InlineStatus>
      </div>
      {notes.length > 0 && !notesInMenu && (
        // Outside the live status, so typing doesn't announce every change in the count.
        <Button
          variant="quiet"
          onPress={() => {
            setNotesOpen(true);
          }}
          className="shrink-0"
        >
          {notesCount(notes.length, blocking.length)}
        </Button>
      )}
      <div className="flex shrink-0 items-center gap-2">
        {editable && !cloud && (
          <Button
            id={SAVE_ID}
            variant="primary"
            onPress={() => void save()}
            isPending={saving}
            pulse={savedPulse}
          >
            {publishes ? 'Publish' : 'Save'}
          </Button>
        )}
        {editable && !cloud && scheduleMenu}
        {/* The cloud: a new entry's first save is by hand; after that drafts save themselves. */}
        {editable && cloud && isNew && (
          <Button onPress={() => void save()} isPending={saving}>
            Save draft
          </Button>
        )}
        {editable && cloud && (dirty || isNew || entryDraft) && !review && (
          <Button
            id={SAVE_ID}
            variant="primary"
            onPress={() => void (access?.publish ? publishDraft() : startReview())}
            isPending={publishing}
            pulse={savedPulse}
          >
            {access?.publish ? 'Publish' : 'Request review'}
          </Button>
        )}
        {editable && cloud && (dirty || isNew || entryDraft) && !review && scheduleMenu}
        {moreItems.length > 0 && (
          <Menu
            label={`More actions for ${titleText}`}
            items={moreItems}
            onAction={(action) => {
              if (action === 'notes') setNotesOpen(true);
              if (action === 'view' && viewUrl) window.open(viewUrl, '_blank', 'noopener');
              if (action === 'copy-page' && viewUrl) {
                void copyLink('Page address', pageAddress(viewUrl, manifest));
              }
              if (action === 'copy-link' && editingLink) {
                void copyLink('Editing link', editingLink);
              }
              if (action === 'duplicate' && entryId) {
                navigate({ screen: 'copy', collection: collection.name, id: entryId });
              }
              if (action === 'delete') setConfirmDelete(true);
              if (action === 'discard') setConfirmDiscard(true);
              if (action === 'discard-changes') setConfirmDiscardChanges(true);
              if (action === 'cancel-publish') void cancelPublish();
            }}
          />
        )}
      </div>
    </div>
  );

  const errors = [
    ...targets.map(({ issue, target }) => ({
      fieldId: target.focusId,
      message: `${target.label}: ${issue.message}`,
    })),
    // Body problems join the summary once a save is refused, and update as they're fixed.
    ...(refusals > 0
      ? bodyErrors.map((issue) => ({
          fieldId: 'entry-body',
          message: `Body, line ${String(issue.line)}: ${issue.message}`,
        }))
      : []),
    // So do notes the site's publish gate blocks on.
    ...(refusals > 0
      ? blocking.map((note) => {
          const place = placeOf(note);
          return {
            fieldId: place.focusId,
            message: `${place.label}, accessibility: ${note.subject ? `${note.subject}: ` : ''}${note.message}`,
          };
        })
      : []),
  ];

  const bodyEditor = isContent ? (
    <Suspense
      fallback={
        <p role="status" className="text-small text-content-muted">
          Loading the body editor…
        </p>
      }
    >
      <BodyEditor
        value={body}
        onChange={setBody}
        format={format}
        partials={partials}
        issues={bodyIssues}
        notes={bodyNotes}
        apiRef={bodyApi}
        disabled={!editable}
        entryPath={entryPath}
        imageFolder={`${manifest.site.srcDir}/assets/${collection.name}`}
        headingStart={collection.presentation.headingStart ?? 2}
      />
    </Suspense>
  ) : null;

  // A copy's heading says what it is until it's saved (the title field below already says " (copy)").
  const heading =
    copy && doc
      ? `${collection.presentation.tree ? 'New page' : 'New entry'}, a copy of ${titleOf(decodeData(doc.data), arranged.title) || doc.id}`
      : titleText;
  return (
    <Screen title={heading} hideTitle={Boolean(arranged.title) && !sourceOnly} bar={bar} column>
      <EditorContext.Provider value={editor}>
        <div className="mx-auto flex max-w-editor flex-col gap-6">
          {doc?.message && (
            <p className="rounded-md border border-warning bg-surface-raised p-4">{doc.message}</p>
          )}
          {notice?.kind === 'conflict' && (
            <div role="alert" className="rounded-md border border-danger bg-surface-raised p-4">
              <p className="mb-3">{notice.text}</p>
              <Button onPress={onReload}>Reload this entry</Button>
            </div>
          )}
          {notice?.kind === 'error' && (
            <p role="alert" className="rounded-md border border-danger bg-surface-raised p-4">
              {publishes ? 'Nothing was published.' : 'Nothing was saved.'} {notice.text}
            </p>
          )}
          {notice?.kind === 'expired' && account && (
            <div role="alert" className="rounded-md border border-danger bg-surface-raised p-4">
              <p className="mb-3">{notice.text} Your changes are kept.</p>
              <Button
                onPress={() => {
                  dirtyRef.current = false;
                  account.signInAgain();
                }}
              >
                Sign in again
              </Button>
            </div>
          )}
          {kept && dirty && !notice && (
            <p className="text-small text-content-muted">
              Your unsaved changes were kept while you signed in again.
            </p>
          )}
          {cloud && (
            <CloudNotices
              notice={cloudNotice}
              restored={restored && dirty}
              offline={offline}
              canEdit={editable}
              review={review}
              onKeep={async () => {
                if (!entryDraft || cloudNotice?.kind !== 'conflict') return;
                await cloud.drafts.keepMine(entryDraft.id, [cloudNotice.path]);
                setCloudNotice({
                  kind: 'kept',
                  text: 'Your draft is kept, now based on the published version. Publish it when you’re ready.',
                });
              }}
              onDiscard={() => void discardDraft()}
              draft={entryDraft}
            />
          )}
          {notice?.kind === 'saved' && publishes && (
            <p className="text-small text-content-muted">
              Published. It will be live after the site is next built.
            </p>
          )}
          {notice?.kind === 'saved' && notice.reformatted && (
            <p className="text-small text-content-muted">
              Saved. This file uses YAML features Vesper can’t edit in place, so its frontmatter was
              rewritten in a standard layout.
            </p>
          )}
          <ErrorSummary
            title={publishes ? 'The entry wasn’t published' : 'The entry wasn’t saved'}
            errors={errors}
            focusKey={refusals}
            onGo={(fieldId) => {
              // A field on another tab is shown first (editor/reveal.ts).
              focusWhenShown(fieldId);
            }}
          />
          {gateRefused && blocking.length > 0 && !api.publishesOnSave() && !cloud && (
            <div className="flex flex-col items-start gap-3">
              <p>
                This site doesn’t publish an entry with these notes. Saving here only changes the
                file on this computer, so you can save anyway and fix them before it’s published.
              </p>
              <Button onPress={() => void save({ pastGate: true })}>Save anyway</Button>
            </div>
          )}
          {isNew && parent !== undefined && <ParentNote collection={collection} parent={parent} />}

          {/* Drawn again from the saved values by Discard changes. */}
          <Fragment key={drawn}>
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
              arranged.title && <TitleField field={arranged.title} />
            )}

            {tabbed ? (
              // Going to a field on another tab (the error summary, Go to field) chooses that tab first.
              <TabsRevealing onReveal={setTab}>
                <Tabs
                  label={titleText}
                  selected={shownTab}
                  onSelectedChange={setTab}
                  tabs={panels.map((panel) => ({
                    id: panel.id,
                    label: tabLabel(panel),
                    children: (
                      <>
                        {fieldsOf(panel.fields)}
                        {panel.id === 'main' && bodyEditor}
                      </>
                    ),
                  }))}
                />
              </TabsRevealing>
            ) : (
              <>
                {!sourceOnly && fieldsOf(arranged.main)}
                {bodyEditor}
              </>
            )}
          </Fragment>
        </div>
      </EditorContext.Provider>

      <NotesDrawer
        isOpen={notesOpen}
        onOpenChange={setNotesOpen}
        groups={noteGroups}
        isBlocking={(note) => blockOn.has(note.rule)}
        onGo={(note) => {
          setGoTo(note);
          setNotesOpen(false);
        }}
      />

      {schedule && scheduling && (
        <ScheduleDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setScheduling(null);
          }}
          collection={collection}
          initial={timesOf(collection, values)}
          live={live}
          purpose={scheduling}
          nowLabel={nowLabel}
          onSubmit={(times) => {
            const next = withTimes(collection, values, times);
            if (scheduling === 'publish') void saveWith(next);
            else setValues(next);
          }}
          onNow={() => void saveWith(withoutPublishTime())}
        />
      )}
      <Dialog
        title={`Copy the ${copyByHand?.label.toLowerCase() ?? 'link'}`}
        isOpen={copyByHand !== null}
        onOpenChange={(open) => {
          if (!open) setCopyByHand(null);
        }}
      >
        {(close) => (
          <CopyByHand
            label={copyByHand?.label ?? 'Link'}
            text={copyByHand?.text ?? ''}
            onDone={close}
          />
        )}
      </Dialog>
      <Dialog
        title={`Delete “${titleText}”?`}
        role="alertdialog"
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
      >
        <p className="mb-6">
          {cloud
            ? `This deletes ${doc?.path ?? 'the file'} in a draft. It leaves the site when the draft is published.`
            : `This deletes ${doc?.path ?? 'the file'}. In local mode the file is removed from disk; git can bring it back.`}
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
      <Dialog
        title="Discard your changes?"
        role="alertdialog"
        isOpen={confirmDiscardChanges}
        onOpenChange={setConfirmDiscardChanges}
      >
        <p className="mb-6">
          {isNew
            ? 'The new entry goes back to how it started, and nothing is saved.'
            : cloud
              ? 'The changes since its draft was last saved are thrown away, and the entry goes back to that draft.'
              : publishes
                ? 'The changes since it was last published are thrown away, and the entry goes back to that version.'
                : 'The changes since it was last saved are thrown away, and the entry goes back to that version.'}
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            onPress={() => {
              setConfirmDiscardChanges(false);
            }}
          >
            Keep editing
          </Button>
          <Button variant="danger" onPress={discardChanges}>
            Discard changes
          </Button>
        </div>
      </Dialog>
      {cloud && (
        <>
          <Dialog
            title="Discard this draft?"
            role="alertdialog"
            isOpen={confirmDiscard}
            onOpenChange={setConfirmDiscard}
          >
            <p className="mb-6">
              The changes that haven’t been published are thrown away, and the entry goes back to
              the published version.
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                onPress={() => {
                  setConfirmDiscard(false);
                }}
              >
                Keep the draft
              </Button>
              <Button variant="danger" onPress={() => void discardDraft()}>
                Discard draft
              </Button>
            </div>
          </Dialog>
          <RequestReviewDialog
            isOpen={reviewOpen}
            onOpenChange={setReviewOpen}
            onSend={sendForReview}
          />
        </>
      )}
    </Screen>
  );
}

/** A link the clipboard refused, focused and selected so the shortcut copies it at once. */
function CopyByHand({ label, text, onDone }: { label: string; text: string; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // Before React Aria's dialog effect, which then finds focus inside and
  // leaves it, as the crop dialog does.
  useLayoutEffect(() => {
    const input = box.current?.querySelector('input');
    input?.focus();
    input?.select();
  }, []);
  return (
    <div ref={box} className="flex flex-col gap-6">
      <TextField
        label={label}
        description={`Press ${isMac ? '⌘C' : 'Ctrl+C'} to copy.`}
        value={text}
        isReadOnly
        onFocus={(event) => {
          event.target.select();
        }}
        inputClassName="font-mono"
      />
      <div className="flex justify-end">
        <Button onPress={onDone}>Done</Button>
      </div>
    </div>
  );
}

/** The editor's status in the cloud, in words (spec §10.4: status is text). */
function cloudStatus(state: {
  saving: boolean;
  publishing: boolean;
  offline: boolean;
  dirty: boolean;
  draftBlocked: boolean;
  isNew: boolean;
  draft: Draft | undefined;
  reviewState: Review['state'] | undefined;
  published: boolean;
}): string {
  if (state.publishing) return 'Publishing…';
  if (state.saving) return 'Saving draft…';
  if (state.offline) return 'Can’t reach Vesper. Kept on this device';
  if (state.dirty && state.draftBlocked) return 'Not saved yet: some fields need attention';
  if (state.dirty) return state.isNew ? 'Not saved yet' : 'Unsaved changes';
  if (state.reviewState === 'open') return 'Waiting for review';
  if (state.reviewState === 'changes-requested') return 'Changes requested';
  if (state.draft) return `Draft saved ${formatRelative(state.draft.updatedAt)}`;
  if (state.published) return 'Published';
  return state.isNew ? 'Not saved yet' : '';
}

/** What happened with the entry's draft, under the bar (the cloud). */
function CloudNotices({
  notice,
  restored,
  offline,
  canEdit,
  review,
  draft,
  onKeep,
  onDiscard,
}: {
  notice: CloudNotice;
  restored: boolean;
  offline: boolean;
  canEdit: boolean;
  review: Review | undefined;
  draft: Draft | undefined;
  onKeep: () => Promise<void>;
  onDiscard: () => void;
}) {
  const asked = review?.state === 'changes-requested' ? review.comments.at(-1) : undefined;
  return (
    <>
      {!canEdit && (
        <p className="text-small text-content-muted">You can view this entry, not change it.</p>
      )}
      {restored && (
        <p className="text-small text-content-muted">
          Your unsaved changes were kept on this device, and are back.
        </p>
      )}
      {offline && (
        <p className="text-small text-content-muted">
          Vesper can’t be reached. Your changes are kept on this device, and they’ll be saved when
          it’s back.
        </p>
      )}
      {asked && (
        <div className="rounded-md border border-warning bg-surface-raised p-4">
          <p className="m-0">
            {asked.by.name} asked for changes: {asked.body}
          </p>
        </div>
      )}
      {notice?.kind === 'published' && <DeployLine commit={notice.commit} />}
      {notice?.kind === 'conflict' && draft && (
        <ConflictCompare
          path={notice.path}
          draft={draft}
          publishedVersion={notice.published}
          onKeep={() => void onKeep()}
          onDiscard={onDiscard}
        />
      )}
      {notice?.kind === 'refused' && (
        <p role="alert" className="rounded-md border border-danger bg-surface-raised p-4">
          Nothing was published. {notice.text}
        </p>
      )}
      {(notice?.kind === 'kept' ||
        notice?.kind === 'nothing' ||
        notice?.kind === 'review-requested' ||
        notice?.kind === 'held') && <p className="text-small text-content-muted">{notice.text}</p>}
    </>
  );
}

const SAVE_ID = 'entry-save';
/** The bar's least width, in pixels, with room for the notes' count as a button (36rem). */
const NOTES_ROOM = 576;

/** Where a new page will go in the tree: under its parent, named by title. */
function ParentNote({ collection, parent }: { collection: CollectionManifest; parent: string }) {
  const { api } = useStudio();
  const [load] = useLoad(() => api.pageTree(collection.name), `${collection.name}:${parent}`);
  const find = (nodes: PageTreeNode[]): PageTreeNode | undefined => {
    for (const node of nodes) {
      if (node.path === parent) return node;
      const found = find(node.children);
      if (found) return found;
    }
    return undefined;
  };
  const title = load.state === 'ready' ? find(load.value.nodes)?.title : undefined;
  return (
    <p className="text-content-muted">
      This page will go under “{title ?? parent}”. Its address comes from its title.
    </p>
  );
}

/** The title field, styled as the document's heading (spec §10.3). */
function TitleField({ field }: { field: FieldModel }) {
  const editor = useEditor();
  const path = [keyOf(field)];
  const id = fieldId(path);
  const errors = editor.issues.get(pathKey(path)) ?? [];
  const value = getIn(editor.values, path);
  const text = typeof value === 'string' ? value : '';
  // A title wraps rather than being cut off mid-word with no sign there's
  // more: a one-line box at title size showed "…and who it'" of a 59-character
  // title in a 718px column. The box grows with its text and with the pane.
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const fit = () => {
      element.style.height = 'auto';
      element.style.height = `${String(element.scrollHeight)}px`;
    };
    fit();
    // The width it wraps at, never its own height, which fitting changes.
    const frame = element.parentElement;
    if (!frame || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, [text]);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small font-semibold text-content-muted">
        {field.label}
        {!field.required && (
          <>
            {' '}
            <span className="font-normal">(optional)</span>
          </>
        )}
      </label>
      <textarea
        ref={area}
        id={id}
        rows={1}
        value={text}
        onKeyDown={(event) => {
          // Still one line of text: Enter adds no line break.
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
        }}
        onChange={(event) => {
          // A pasted line break becomes a space, as a one-line box would have it.
          const next = event.target.value.replace(/[^\S\r\n]*[\r\n]+[^\S\r\n]*/g, ' ');
          editor.setValue(path, next === '' && !field.required ? undefined : next);
        }}
        aria-invalid={errors.length > 0 || undefined}
        aria-required={field.required || undefined}
        aria-describedby={errors.length > 0 ? `${id}-error` : undefined}
        disabled={editor.disabled || field.readOnly === true}
        placeholder={field.placeholder ?? 'Untitled'}
        className="block w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-0 py-1 text-title text-content outline-none placeholder:text-content-muted focus-visible:border-border-strong focus-visible:px-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:ring-6 focus-visible:ring-(color:--glow-focus) aria-[invalid=true]:border-danger aria-[invalid=true]:px-2"
      />
      {errors.length > 0 && (
        <p id={`${id}-error`} className="text-small text-danger">
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
 * The entry's page on the site, from the collection's URL pattern (spec
 * §6.15.1), written as the site writes it: base, trailing slash and all. A
 * function-form pattern runs only where vesper.config.ts is loaded, so
 * those entries have no "View on site" here.
 */
function pageUrl(
  collection: CollectionManifest,
  id: string,
  data: DataObject,
  manifest: Manifest,
): string | null {
  const pattern = collection.presentation.url;
  if (typeof pattern !== 'string') return null;
  const settings = manifest.site.urls ?? {
    ...DEFAULT_URL_SETTINGS,
    ...(manifest.site.timeZone ? { timeZone: manifest.site.timeZone } : {}),
  };
  const key = entryUrlKey(pattern, { id, collection: collection.name, data }, settings);
  return key === null ? null : formatUrl(key, settings);
}

/**
 * A function-form URL's page address, from the site's page list (spec
 * §6.15.1), looked up again after each save. Null for a string pattern,
 * which the editor works out itself, and while the list loads.
 */
function useFunctionUrl(
  collection: CollectionManifest,
  id: string | null,
  version: string | null,
): string | null {
  const { api } = useStudio();
  const wanted = typeof collection.presentation.url === 'object' && id !== null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    api.listPages().then(
      (pages) => {
        if (!live) return;
        setUrl(pages.find((p) => p.collection === collection.name && p.id === id)?.url ?? null);
      },
      () => {
        // Without the list there's no address to show; the rest of the editor works as usual.
      },
    );
    return () => {
      live = false;
    };
  }, [api, wanted, collection.name, id, version]);
  return wanted ? url : null;
}

/**
 * The page's full address, to paste anywhere: on Astro's `site` when the
 * site sets one, so a link copied in local mode is the live one, and on
 * the studio's own origin otherwise.
 */
function pageAddress(url: string, manifest: Manifest): string {
  const site = manifest.site.urls?.site;
  const origin = site ? new URL(site).origin : window.location.origin;
  return new URL(url, origin).href;
}

/** The studio's address for an entry, which survives a reload on any host (hash routing). */
function editingLinkOf(collection: string, id: string): string {
  return new URL(hrefFor({ screen: 'edit', collection, id }), window.location.href).href;
}

/** A tree path's parent ('' for the top level). */
function parentPath(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/**
 * Where a new entry will most likely be saved, so uploads can be referenced
 * relative to it before it exists: the collection's folder, or its file.
 */
function likelyPath(collection: CollectionManifest, parent?: string): string {
  const { source } = collection;
  if (source.loader === 'file') return source.path;
  if (source.loader === 'glob') {
    // A new page in a tree goes in its parent's folder (spec §6.15.2), which a folder grant can cover.
    const folder = [source.base === '.' ? '' : source.base, parent ?? ''].filter(Boolean).join('/');
    return `${folder ? `${folder}/` : ''}new-entry.${source.formats[0] ?? 'md'}`;
  }
  return 'new-entry.md';
}

/** The body's syntax: the file's own, or for a new entry the collection's first content format. */
function bodyFormat(doc: EntryDocument | null, collection: CollectionManifest): BodyFormat {
  if (doc && (doc.format === 'md' || doc.format === 'mdx' || doc.format === 'mdoc'))
    return doc.format;
  const formats = collection.source.loader === 'glob' ? collection.source.formats : [];
  const first = formats.find((f) => f === 'md' || f === 'markdown' || f === 'mdx' || f === 'mdoc');
  return first === 'mdx' ? 'mdx' : first === 'mdoc' ? 'mdoc' : 'md';
}

const KEPT_KEY = 'vesper.kept';

type Kept = { values: DataObject; body: string; raw: string };

/** Keeps an entry's unsaved changes in this tab while the editor signs in again. */
function keep(collection: string, id: string | null, changes: Kept): void {
  try {
    sessionStorage.setItem(
      KEPT_KEY,
      JSON.stringify({ collection, id, ...changes, values: encodeValue(changes.values) }),
    );
  } catch {
    // Without sessionStorage they can't be kept; the notice still explains.
  }
}

/** The kept changes for this entry, if any, removed as they're taken. */
function takeKept(collection: string, id: string | null): Kept | null {
  try {
    const raw = sessionStorage.getItem(KEPT_KEY);
    if (!raw) return null;
    const found = JSON.parse(raw) as Omit<Kept, 'values'> & {
      collection: string;
      id: string | null;
      values: Parameters<typeof decodeData>[0];
    };
    if (found.collection !== collection || found.id !== id) return null;
    sessionStorage.removeItem(KEPT_KEY);
    return { values: decodeData(found.values), body: found.body, raw: found.raw };
  } catch {
    return null;
  }
}

/** Chooses the tab that holds a field going to be focused (editor/reveal.ts). */
function TabsRevealing({
  onReveal,
  children,
}: {
  onReveal: (tab: string) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reveal = (event: Event) => {
      const tab = (event.target as Element).closest('[data-tab]')?.getAttribute('data-tab');
      if (tab) onReveal(tab);
    };
    element.addEventListener(REVEAL_EVENT, reveal);
    return () => {
      element.removeEventListener(REVEAL_EVENT, reveal);
    };
  }, [onReveal]);
  return <div ref={ref}>{children}</div>;
}
