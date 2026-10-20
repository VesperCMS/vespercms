import {
  DEFAULT_URL_SETTINGS,
  type A11yNote,
  decodeData,
  deepEqual,
  encodeValue,
  entryUrlKey,
  formatUrl,
  lineEndings,
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
} from '@vesper/core';
import {
  Button,
  Dialog,
  Disclosure,
  Drawer,
  ErrorSummary,
  InlineStatus,
  Link,
  Menu,
  TextArea,
  type MenuItem,
} from '@vesper/ui';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../app/api.ts';
import { useStudio } from '../app/context.tsx';
import { formatCount, formatRelative } from '../app/format.ts';
import { useLoad } from '../app/load.ts';
import { useMediaQuery, WIDE_EDITOR } from '../app/media.ts';
import { hrefFor, navigate, setLeaveGuard } from '../app/router.ts';
import { Screen } from '../app/Screen.tsx';
import { arrangeFields } from '../editor/arrange.ts';
import { EditorContext, useEditor, type EditorState } from '../editor/context.tsx';
import { Field } from '../editor/Field.tsx';
import { issueTarget } from '../editor/target.ts';
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
 */
export function EntryEditor({
  collection,
  id,
  parent,
}: {
  collection: CollectionManifest;
  id: string | null;
  /** New pages in a tree collection: the parent page's path (spec §6.15.2). */
  parent?: string;
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
        <Link icon="back" href={hrefFor({ screen: 'list', collection: collection.name })}>
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
      {...(parent !== undefined ? { parent } : {})}
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
  | { kind: 'refused' | 'kept' | 'nothing' | 'review-requested'; text: string }
  | null;

function EntryForm({
  collection,
  doc,
  onReload,
  parent,
}: {
  collection: CollectionManifest;
  doc: EntryDocument | null;
  onReload: () => void;
  parent?: string;
}) {
  const { api, siteUrl, manifest, loadMdxProps, account, cloud } = useStudio();
  // GitHub mode publishes on save: the button and its words say so (spec §6.8).
  const publishes = api.publishesOnSave();
  const isNew = doc === null;
  const status = doc?.status ?? 'editable';
  /** The entry's file: known once it's saved, guessed for a new one. */
  const [savedPath, setSavedPath] = useState<string | null>(doc?.path ?? null);
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
      values: doc ? decodeData(doc.data) : initialValues(collection.fields),
      body: (doc?.body ?? '').slice(bodyPrefix.length).replace(/\r\n/g, '\n'),
      raw: (doc?.rawFrontmatter ?? '').replace(/^\r?\n/, ''),
    }),
    [doc, collection.fields, bodyPrefix.length],
  );

  // Changes kept across a sign-in that expired mid-edit, put back once.
  const [kept] = useState(() => takeKept(collection.name, doc?.id ?? null));
  const [values, setValues] = useState<DataObject>(kept?.values ?? initial.values);
  const [body, setBody] = useState(kept?.body ?? initial.body);
  const [raw, setRaw] = useState(kept?.raw ?? initial.raw);
  const [saved, setSaved] = useState<Saved>(initial);
  const [version, setVersion] = useState<string | null>(doc?.version ?? null);
  const [entryId, setEntryId] = useState<string | null>(doc?.id ?? null);
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
  /** The last draft save was refused by the entry's own checks: the status says so, quietly. */
  const [draftBlocked, setDraftBlocked] = useState(false);
  /** The cloud couldn't be reached: changes are kept on this device, and saving tries again. */
  const [offline, setOffline] = useState(false);
  const [retries, setRetries] = useState(0);
  const [restored, setRestored] = useState(false);
  /**
   * Details (spec §10.3): a drawer from the top bar on a wide screen, the
   * closing section of the column on a narrow one. One state for both, so
   * resizing keeps it open or closed.
   */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const wide = useMediaQuery(WIDE_EDITOR);
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
        label: target.label,
        focusId: target.focusId,
        top: String(note.target.path[0] ?? ''),
      };
    },
    [collection.fields],
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
      const place = placeOf(note);
      if (arranged.details.some((field) => keyOf(field) === place.top)) setDetailsOpen(true);
      focusWhenShown(place.focusId);
    },
    [placeOf, arranged.details],
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
    async ({ pastGate = false, auto = false }: { pastGate?: boolean; auto?: boolean } = {}) => {
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
          : { data: encodeValue(values) }),
        ...(isContent && (bodyChanged || isNew)
          ? { body: bodyPrefix + (bodyEol === '\r\n' ? body.replace(/\n/g, '\r\n') : body) }
          : {}),
        ...(isNew && parent !== undefined ? { parent } : {}),
      };
      try {
        const result = await api.saveEntry(request);
        setOffline(false);
        if (result.ok) {
          const snapshot = { values, body, raw };
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
          // In the column, Details opens to show its errors. The drawer doesn't:
          // it would take focus from the summary, whose links open it instead.
          const detailKeys = new Set(arranged.details.map(keyOf));
          if (!wide && result.issues.some((issue) => detailKeys.has(String(issue.path[0]))))
            setDetailsOpen(true);
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
          keep(collection.name, entryId, { values, body, raw });
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
      arranged.details,
      wide,
      checks,
      parent,
      blockOn,
      recheck,
      account,
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
  const keptAt = cloud
    ? keptKey(cloud.client.settings.project, collection.name, doc?.id ?? null)
    : null;
  useEffect(() => {
    if (!keptAt) return;
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
  }, [keptAt, dirty, values, body, raw]);
  useEffect(() => {
    if (!keptAt || kept) return;
    let live = true;
    void keptChanges()
      .get(keptAt)
      .then((found) => {
        if (!live || !found) return;
        setValues(decodeData(found.values));
        setBody(found.body);
        setRaw(found.raw);
        setRestored(true);
      });
    return () => {
      live = false;
    };
    // Once, when the entry opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptAt]);

  /** Publishes the entry's draft, saving it first (spec §7.4). The publish gate applies here. */
  const publishDraft = async () => {
    if (!cloud || publishing) return;
    setCloudNotice(null);
    if (blockOn.size > 0 && (await recheck()).some((note) => blockOn.has(note.rule))) {
      setGateRefused(true);
      setRefusals((n) => n + 1);
      return;
    }
    if ((dirtyRef.current || isNew) && !(await save())) return;
    setPublishing(true);
    try {
      await cloud.drafts.refresh();
      const path = pathRef.current ?? filePath;
      const draft = cloud.drafts.draftOf(path);
      if (!draft) {
        setCloudNotice({ kind: 'nothing', text: 'There’s nothing new to publish.' });
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

  const viewUrl =
    !isNew && entryId && siteUrl !== undefined
      ? pageUrl(collection, entryId, saved.values, manifest)
      : null;
  const menuItems: MenuItem[] = [
    ...(viewUrl ? [{ id: 'view', label: 'View on site', icon: 'view-on-site' as const }] : []),
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

  const statusLine = [draft ? 'Draft' : '', statusText].filter(Boolean).join(' · ');
  const hasDetails = !sourceOnly && arranged.details.length > 0;
  const detailKeys = new Set(arranged.details.map(keyOf));
  const detailProblems = issues.filter((issue) => detailKeys.has(String(issue.path[0]))).length;
  const bar = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-4">
      <Link icon="back" href={back.href} className="text-small">
        {back.label}
      </Link>
      {/* On a narrow screen the title field is just below, so the bar leaves it out. */}
      <span className="hidden min-w-0 flex-1 truncate font-semibold text-content sm:block">
        {titleText}
      </span>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:gap-x-4">
        <InlineStatus dot={statusLine !== ''}>{statusLine}</InlineStatus>
        {notes.length > 0 && (
          // Outside the live status, so typing doesn't announce every change in the count.
          <Button
            variant="quiet"
            onPress={() => {
              setNotesOpen(true);
            }}
          >
            {notesCount(notes.length, blocking.length)}
          </Button>
        )}
        {hasDetails && wide && (
          // The problem count is words, so the drawer's errors are known before it opens.
          <Button
            variant="quiet"
            icon="details"
            onPress={() => {
              setDetailsOpen(true);
            }}
          >
            {detailProblems > 0
              ? `Details (${formatCount(detailProblems, 'problem', 'problems')})`
              : 'Details'}
          </Button>
        )}
        <div className="flex items-center gap-2">
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
          {menuItems.length > 0 && (
            <Menu
              label={`More actions for ${titleText}`}
              items={menuItems}
              onAction={(action) => {
                if (action === 'view' && viewUrl) window.open(viewUrl, '_blank', 'noopener');
                if (action === 'delete') setConfirmDelete(true);
                if (action === 'discard') setConfirmDiscard(true);
              }}
            />
          )}
        </div>
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

  return (
    <Screen title={titleText} hideTitle={Boolean(arranged.title) && !sourceOnly} bar={bar} column>
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
              // A field in the closed drawer isn't on the page until the drawer opens.
              if (hasDetails && !document.getElementById(fieldId)) setDetailsOpen(true);
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
              />
            </Suspense>
          )}

          {hasDetails && !wide && (
            <Disclosure title="Details" isExpanded={detailsOpen} onExpandedChange={setDetailsOpen}>
              <div className="flex flex-col gap-6 pt-2 pl-6">
                {arranged.details.map((field) => (
                  <Field key={keyOf(field)} field={field} path={[keyOf(field)]} />
                ))}
              </div>
            </Disclosure>
          )}
        </div>

        {hasDetails && wide && (
          <Drawer title="Details" isOpen={detailsOpen} onOpenChange={setDetailsOpen}>
            <div className="flex flex-col gap-6 pt-2">
              {arranged.details.map((field) => (
                <Field key={keyOf(field)} field={field} path={[keyOf(field)]} />
              ))}
            </div>
          </Drawer>
        )}
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
        notice?.kind === 'review-requested') && (
        <p className="text-small text-content-muted">{notice.text}</p>
      )}
    </>
  );
}

const SAVE_ID = 'entry-save';

/**
 * Focuses an element as soon as it's on screen (a field inside Details
 * renders once Details opens), and scrolls it into view.
 */
function focusWhenShown(id: string, tries = 20): void {
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ block: 'center' });
    element.focus();
  } else if (tries > 0) {
    setTimeout(() => {
      focusWhenShown(id, tries - 1);
    }, 25);
  }
}

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
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small font-semibold text-content-muted">
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
        className="w-full rounded-md border border-transparent bg-transparent px-0 py-1 text-title text-content outline-none placeholder:text-content-muted focus-visible:border-border-strong focus-visible:px-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:ring-6 focus-visible:ring-(color:--glow-focus) aria-[invalid=true]:border-danger aria-[invalid=true]:px-2"
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
