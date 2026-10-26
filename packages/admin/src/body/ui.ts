import type { BodyIssue, TableEdit, TableValue } from '@vesper/core';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { BlockKind, Catalog } from './catalog.ts';
import type { BodyChecks } from './checks.ts';
import type { ContainerTypes } from './nodes.ts';

/*
 * What the body editor's node views share: the catalog of blocks, the
 * actions their buttons start, and validation of one block's own text, so
 * each block shows its own messages inline (spec §6.5.1, "Validation").
 */

export type BodyActions = {
  openSettings: (pos: number) => void;
  move: (pos: number, direction: -1 | 1) => void;
  remove: (pos: number) => void;
};

export type BodyUi = BodyActions & {
  catalog: Catalog;
  containers: ContainerTypes;
  disabled: boolean;
  checks: BodyChecks;
  /** Site-relative paths of the files a partial can point at, once loaded. */
  partials: readonly string[] | null;
  entryPath: string;
  /** Says something in the body's polite status ("Row added below row 3."). */
  announce: (message: string) => void;
  /** Whether a table's change would save, through core's writer, against the table it was loaded from. */
  checkTable: (path: string | null, value: TableValue) => TableEdit;
  /** True once, for the table just inserted, so it starts with its first cell being edited. */
  takeNewTable: () => boolean;
};

export const BodyUiContext = createContext<BodyUi | null>(null);

export function useBodyUi(): BodyUi {
  const ui = useContext(BodyUiContext);
  if (!ui) throw new Error('useBodyUi() must be used inside the body editor.');
  return ui;
}

/** One block's issues, from its own text: synchronous for Markdoc, after a tick for MDX. */
export function useBlockIssues(text: string): BodyIssue[] {
  const { checks } = useBodyUi();
  const sync = useMemo(() => checks.validateSync(text), [checks, text]);
  const [async, setAsync] = useState<BodyIssue[]>([]);
  useEffect(() => {
    if (sync !== null) return;
    let live = true;
    void checks.validate(text).then((issues) => {
      if (live) setAsync(issues);
    });
    return () => {
      live = false;
    };
  }, [checks, text, sync]);
  return sync ?? async;
}

/** The header's summary: the summary attribute's value, shown with its option label. */
export function summaryOf(
  kind: BlockKind | undefined,
  values: Readonly<Record<string, unknown>>,
): string {
  if (!kind) return '';
  const name = kind.summary ?? (kind.builtin === 'partial' ? 'file' : undefined);
  if (!name) return '';
  const value = values[name];
  const field = kind.fields.find((f) => f.path[0] === name);
  const fallback = value === undefined ? field?.default : value;
  if (fallback === undefined || fallback === null || fallback === '') return '';
  const option = field?.constraints?.options?.find((o) => o.value === fallback);
  const text =
    option?.label ?? (typeof fallback === 'string' ? fallback : JSON.stringify(fallback));
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
