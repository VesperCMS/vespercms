import { useEffect, useRef, type ReactNode } from 'react';
import {
  Cell,
  Column,
  Row,
  Table as RACTable,
  TableBody,
  TableHeader,
  type SortDescriptor,
} from 'react-aria-components';
import { colorTransition, cx, focusRing } from './shared.tsx';

export type TableColumn = {
  id: string;
  label: string;
  isRowHeader?: boolean;
  allowsSorting?: boolean;
};

export type TableProps<T extends { id: string }> = {
  /** Accessible name, e.g. "Blog posts". */
  label: string;
  columns: TableColumn[];
  rows: T[];
  renderCell: (row: T, columnId: string) => ReactNode;
  sort?: SortDescriptor;
  onSortChange?: (sort: SortDescriptor) => void;
  emptyState?: ReactNode;
  /** Makes each row a link: Enter or a click opens it. */
  rowHref?: (row: T) => string;
};

/**
 * A simple table: no zebra striping, hairline rows, sortable by clicking
 * column headers (spec §10.3). It is keyboard-navigable by row.
 */
export function Table<T extends { id: string }>({
  label,
  columns,
  rows,
  renderCell,
  sort,
  onSortChange,
  emptyState,
  rowHref,
}: TableProps<T>) {
  return (
    // A table wider than a narrow screen scrolls inside itself, never the page
    // (WCAG 1.4.10 lets a data table keep its two dimensions).
    <div className="overflow-x-auto">
      <RACTable
        aria-label={label}
        {...(sort ? { sortDescriptor: sort } : {})}
        {...(onSortChange ? { onSortChange } : {})}
        className="w-full border-separate border-spacing-0 text-left text-body"
      >
        <TableHeader>
          {columns.map((column) => (
            <Column
              key={column.id}
              id={column.id}
              isRowHeader={column.isRowHeader ?? false}
              allowsSorting={column.allowsSorting ?? false}
              className={cx(
                'bg-surface-sunken px-3 py-2 text-label text-content-muted first:rounded-l-md last:rounded-r-md',
                'data-[allows-sorting]:cursor-pointer',
                focusRing,
              )}
            >
              {({ sortDirection }) => (
                <span className="inline-flex items-center gap-1">
                  {column.label}
                  {sortDirection && (
                    <span aria-hidden="true">{sortDirection === 'ascending' ? '↑' : '↓'}</span>
                  )}
                </span>
              )}
            </Column>
          ))}
        </TableHeader>
        <TableBody
          items={rows}
          renderEmptyState={() => (
            <p className="px-3 py-6 text-content-muted">{emptyState ?? 'Nothing here yet.'}</p>
          )}
        >
          {(row) => (
            <Row
              id={row.id}
              {...(rowHref ? { href: rowHref(row) } : {})}
              className={cx(
                'data-[hovered]:bg-accent-subtle data-[href]:cursor-pointer',
                colorTransition,
                'outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-focus',
              )}
            >
              {columns.map((column) => (
                <Cell
                  key={column.id}
                  className={cx(
                    'border-b border-border px-3 py-3 align-top',
                    'outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-focus',
                  )}
                >
                  {renderCell(row, column.id)}
                </Cell>
              ))}
            </Row>
          )}
        </TableBody>
      </RACTable>
    </div>
  );
}

export type InlineStatusProps = {
  children: ReactNode;
  /** One small neutral dot before the text, never a coloured badge (spec §10.4). */
  dot?: boolean;
  /** Announce changes politely to screen readers (autosave status, spec §10.2 principle 6). */
  live?: boolean;
  /** `error` turns the words and the dot `danger`; the words still say what happened. */
  tone?: 'neutral' | 'error';
  className?: string;
};

/** Status as words: "Draft · saved just now". */
export function InlineStatus({
  children,
  dot = false,
  live = true,
  tone = 'neutral',
  className,
}: InlineStatusProps) {
  return (
    <p
      role={live ? 'status' : undefined}
      className={cx(
        'inline-flex items-center gap-2 text-small',
        tone === 'error' ? 'text-danger' : 'text-content-muted',
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cx(
            'size-2 shrink-0 rounded-full',
            tone === 'error' ? 'bg-danger' : 'bg-content-muted',
          )}
        />
      )}
      {children}
    </p>
  );
}

export type ErrorSummaryItem = { fieldId: string; message: string };

export type ErrorSummaryProps = {
  title?: string;
  errors: ErrorSummaryItem[];
  /** Move focus to the summary when it appears (after a failed save or submit). */
  focusOnMount?: boolean;
  /**
   * Focus moves again whenever this changes (a new failed save). Defaults to
   * the number of errors; set it when errors also update as people type, so
   * fixing one never pulls focus away from what they're doing.
   */
  focusKey?: string | number;
  /**
   * Takes a link to its field, for fields that aren't always on the page (one
   * in a closed drawer). By default the link focuses the element with that id.
   */
  onGo?: (fieldId: string) => void;
};

/**
 * A list of every error, each a link to its field. It takes focus when it
 * appears, so keyboard and screen-reader users land on it (spec §6.13, §10.6).
 */
export function ErrorSummary({
  title = 'There is a problem',
  errors,
  focusOnMount = true,
  focusKey,
  onGo,
}: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const trigger = focusKey ?? errors.length;
  const hasErrors = errors.length > 0;
  useEffect(() => {
    if (focusOnMount && hasErrors) ref.current?.focus();
    // Only a new trigger moves focus, never an error being fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOnMount, trigger]);
  if (errors.length === 0) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby="vesper-error-summary-title"
      className="rounded-md border border-danger bg-surface p-4 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <h2 id="vesper-error-summary-title" className="text-heading-3 text-content">
        {title}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-danger">
        {errors.map((error, index) => (
          <li key={`${error.fieldId}:${String(index)}`}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
                if (onGo) {
                  event.preventDefault();
                  onGo(error.fieldId);
                  return;
                }
                const target = document.getElementById(error.fieldId);
                if (target) {
                  event.preventDefault();
                  target.focus();
                }
              }}

              className="text-danger underline underline-offset-2"
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
