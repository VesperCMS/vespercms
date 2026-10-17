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
import { cx, focusRing } from './shared.tsx';

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
    <RACTable
      aria-label={label}
      {...(sort ? { sortDescriptor: sort } : {})}
      {...(onSortChange ? { onSortChange } : {})}
      className="w-full border-collapse text-left text-base"
    >
      <TableHeader className="border-b border-border-strong">
        {columns.map((column) => (
          <Column
            key={column.id}
            id={column.id}
            isRowHeader={column.isRowHeader ?? false}
            allowsSorting={column.allowsSorting ?? false}
            className={cx('px-3 py-2 text-sm font-semibold text-content-muted', focusRing)}
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
              'border-b border-border data-[hovered]:bg-surface-sunken data-[href]:cursor-pointer',
              focusRing,
            )}
          >
            {columns.map((column) => (
              <Cell key={column.id} className={cx('px-3 py-3 align-top', focusRing)}>
                {renderCell(row, column.id)}
              </Cell>
            ))}
          </Row>
        )}
      </TableBody>
    </RACTable>
  );
}

export type InlineStatusProps = {
  children: ReactNode;
  /** One small neutral dot before the text, never a coloured badge (spec §10.4). */
  dot?: boolean;
  /** Announce changes politely to screen readers (autosave status, spec §10.2 principle 6). */
  live?: boolean;
  className?: string;
};

/** Status as words: "Draft · saved just now". */
export function InlineStatus({ children, dot = false, live = true, className }: InlineStatusProps) {
  return (
    <p
      role={live ? 'status' : undefined}
      className={cx('inline-flex items-center gap-2 text-sm text-content-muted', className)}
    >
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-content-muted" />}
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
      className="rounded-md border border-danger bg-surface-raised p-4 outline-none focus-visible:outline-2 focus-visible:outline-focus"
    >
      <h2 id="vesper-error-summary-title" className="text-base font-semibold text-content">
        {title}
      </h2>
      <ul className="mt-2 list-none space-y-1 p-0">
        {errors.map((error, index) => (
          <li key={`${error.fieldId}:${String(index)}`}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
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
