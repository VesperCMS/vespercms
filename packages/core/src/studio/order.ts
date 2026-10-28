/*
 * A flat collection put in order by a number field (vesper.config.ts's
 * `orderBy`): how the studio sorts it, and which numbers a drag writes.
 *
 * A drag writes as few numbers as it can, usually only the moved entry's,
 * halfway between its new neighbours. Editors choose these numbers by hand
 * too (thosegeeks.com's last service is 420, to stay last whatever's added),
 * so renumbering the whole collection on every move would throw their
 * choices away and rewrite every file. Only when the neighbours leave no
 * room, or share a number, do the entries from there down move up one.
 */

/** One entry, as ordering sees it. */
export type OrderedEntry = { id: string; title: string; value: number | undefined };

/** The room left before and after the first and last entries. */
const STEP = 10;

/** Lowest number first, then those without one; ties by title, as the studio lists them. */
export function compareOrder(a: OrderedEntry, b: OrderedEntry): number {
  if (a.value !== b.value) {
    if (a.value === undefined) return 1;
    if (b.value === undefined) return -1;
    return a.value - b.value;
  }
  return a.title.localeCompare(b.title);
}

/** The number in a field, if it holds one. */
export function orderValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export type OrderPlan = {
  /** The moved entry's place in the new order, from 0. */
  index: number;
  /** Every entry, in the new order. */
  order: OrderedEntry[];
  /** The numbers to write, by entry. Empty when the entry is already there. */
  changes: { id: string; value: number }[];
};

/**
 * Puts `id` right after `after` (first when `after` is null). `null` when
 * either isn't among the entries: the list was out of date.
 */
export function placeAfter(
  entries: readonly OrderedEntry[],
  id: string,
  after: string | null,
): OrderPlan | null {
  const sorted = [...entries].sort(compareOrder);
  const moving = sorted.find((entry) => entry.id === id);
  if (!moving || after === id) return null;
  const rest = sorted.filter((entry) => entry !== moving);
  const anchor = after === null ? -1 : rest.findIndex((entry) => entry.id === after);
  if (after !== null && anchor === -1) return null;
  const index = anchor + 1;
  const order = [...rest.slice(0, index), moving, ...rest.slice(index)];
  if (sorted.indexOf(moving) === index) return { index, order, changes: [] };

  const value = between(order[index - 1], order[index + 1], index);
  const changes = value === undefined ? cascade(order, moving) : [{ id: moving.id, value }];
  const written = new Map(changes.map((change) => [change.id, change.value]));
  return {
    index,
    order: order.map((entry) =>
      written.has(entry.id) ? { ...entry, value: written.get(entry.id) } : entry,
    ),
    changes,
  };
}

/** A whole number strictly between the neighbours' numbers, if there's room for one. */
function between(
  before: OrderedEntry | undefined,
  next: OrderedEntry | undefined,
  index: number,
): number | undefined {
  const low = before?.value;
  const high = next?.value;
  // After an entry with no number: those come last, so it would need one too.
  if (index > 0 && low === undefined) return undefined;
  if (high === undefined) return low === undefined ? STEP : Math.floor(low) + STEP;
  if (low === undefined) {
    // First: room below the next one, without going under 0 if it isn't.
    if (high - STEP >= 0 || high < 0) return Math.ceil(high) - STEP;
    const half = Math.floor((high - 1) / 2);
    return half >= 0 && half < high ? half : undefined;
  }
  const middle = Math.floor((low + high) / 2);
  return middle > low && middle < high ? middle : undefined;
}

/**
 * No room: from the top, each entry that isn't above the one before it
 * (the moved one, a tie, one with no number) takes the next whole number,
 * until past the moved entry the order holds by itself again.
 */
function cascade(order: readonly OrderedEntry[], moving: OrderedEntry): OrderPlan['changes'] {
  const changes: OrderPlan['changes'] = [];
  let last: number | undefined;
  let passed = false;
  for (const entry of order) {
    const own = entry === moving ? undefined : entry.value;
    if (passed && (own === undefined || (last !== undefined && own > last))) break;
    let value = own;
    if (value === undefined || (last !== undefined && value <= last)) {
      value = last === undefined ? 0 : Math.floor(last) + 1;
      changes.push({ id: entry.id, value });
    }
    last = value;
    if (entry === moving) passed = true;
  }
  return changes;
}
