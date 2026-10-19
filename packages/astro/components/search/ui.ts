import { fill, stringsFor, type SearchStrings } from './strings.ts';

/*
 * `<Search>`'s behaviour (spec §6.19), on Pagefind's JS API with no
 * framework (DECISIONS.md, "Site search is Vesper's own UI on Pagefind's JS API"). Pagefind's
 * Component UI fell short of the spec's criteria: its modal never announced
 * counts, and most results were hidden from screen readers until scrolled
 * to. So:
 * - the dialog is a native <dialog> opened with showModal(), and its live
 *   region sits inside it, where the modal doesn't make it inert;
 * - results are a plain list of links, every one real, ten at a time;
 * - the count is announced once typing pauses, never on every key;
 * - the shortcut is Ctrl/⌘+K, which has a modifier, so WCAG 2.1.4 doesn't
 *   ask for a way to turn it off.
 */

type SortField = { key: string; label: string; kind: 'date' | 'number' | 'string' };

type Config = {
  /** Pagefind's bundle: `<base>_vesper/search/`. */
  bundle: string;
  /** The `/search` page's URL. */
  page: string;
  strings: Record<string, Record<string, string>>;
  /** Sort fields by Section (the collection's label). */
  sort: Record<string, SortField[]>;
  shortcut: boolean;
};

type Counts = Record<string, Record<string, number>>;
type ResultData = { url: string; excerpt: string; meta: Record<string, string | undefined> };
type Result = { id: string; data: () => Promise<ResultData> };
type Response = {
  results: Result[];
  filters: Counts;
  totalFilters?: Counts;
  unfilteredResultCount?: number;
};
type Pagefind = {
  options: (options: Record<string, unknown>) => Promise<void>;
  init: () => Promise<void>;
  filters: () => Promise<Counts>;
  search: (
    term: string | null,
    options?: { filters?: Record<string, unknown>; sort?: Record<string, string> },
  ) => Promise<Response>;
};

const PAGE_SIZE = 10;
/** How long typing must pause before a search runs and its count is announced. */
const PAUSE = 300;
const SECTION = 'Section';

let pagefind: Promise<Pagefind> | null = null;

/** Pagefind's script, loaded the first time anyone looks like searching. */
function loadPagefind(bundle: string): Promise<Pagefind> {
  if (!pagefind) {
    pagefind = (import(/* @vite-ignore */ `${bundle}pagefind.js`) as Promise<Pagefind>).then(
      async (module) => {
        await module.options({ excerptLength: 24 });
        await module.init();
        // Searches count results per filter only once the filters are loaded.
        await module.filters();
        return module;
      },
    );
    // A failed load can be tried again on the next search.
    pagefind.catch(() => {
      pagefind = null;
    });
  }
  return pagefind;
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${String(++uid)}`;

class SearchBox {
  readonly root: HTMLElement;
  readonly config: Config;
  readonly strings: SearchStrings;
  readonly lang: string;
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
  readonly status: HTMLElement;
  readonly filtersBox: HTMLElement;
  readonly resultsBox: HTMLElement;
  /** Values checked per filter name. */
  readonly selected = new Map<string, Set<string>>();
  sortValue = '';
  results: Result[] = [];
  shown = 0;
  runs = 0;
  timer: ReturnType<typeof setTimeout> | undefined;
  list: HTMLUListElement | null = null;
  more: HTMLButtonElement | null = null;
  /** The query the filters were last drawn for, and the sort fields offered. */
  filtersQuery: string | null = null;
  sortBox: HTMLElement | null = null;
  sortKey: string | null = null;

  constructor(root: HTMLElement, config: Config) {
    this.root = root;
    this.config = config;
    this.lang = document.documentElement.lang || 'en';
    this.strings = stringsFor(config.strings, this.lang);
    this.form = root.querySelector('form') as HTMLFormElement;
    this.input = root.querySelector('input[type="search"]') as HTMLInputElement;
    this.status = root.querySelector('[data-vesper-search-status]') as HTMLElement;
    this.filtersBox = root.querySelector('[data-vesper-search-filters]') as HTMLElement;
    this.resultsBox = root.querySelector('[data-vesper-search-results]') as HTMLElement;

    // The script takes the form over: without it, the form goes to /search or DuckDuckGo.
    this.form.action = config.page;
    for (const hidden of this.form.querySelectorAll('[data-vesper-search-nojs]')) hidden.remove();
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearTimeout(this.timer);
      void this.run();
    });
    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.run(), PAUSE);
    });
    this.input.addEventListener('focus', () => {
      loadPagefind(config.bundle).catch(() => undefined);
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' && this.links()[0]) {
        event.preventDefault();
        this.links()[0]?.focus();
      }
    });
    this.resultsBox.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const links = this.links();
      const at = links.indexOf(event.target as HTMLAnchorElement);
      if (at === -1) return;
      event.preventDefault();
      const next =
        event.key === 'ArrowDown' ? links[at + 1] : at === 0 ? this.input : links[at - 1];
      next?.focus();
    });
  }

  links(): HTMLAnchorElement[] {
    return [...this.resultsBox.querySelectorAll<HTMLAnchorElement>('a[data-vesper-search-link]')];
  }

  filters(): Record<string, unknown> {
    const filters: Record<string, unknown> = {};
    for (const [name, values] of this.selected)
      if (values.size > 0) filters[name] = { any: [...values] };
    return filters;
  }

  /** Sort fields every chosen section has; none until a section is chosen (Pagefind drops pages without the key). */
  sortFields(): SortField[] {
    const sections = [...(this.selected.get(SECTION) ?? [])];
    if (sections.length === 0) return [];
    const [first, ...rest] = sections.map((section) => this.config.sort[section] ?? []);
    return (first ?? []).filter((field) =>
      rest.every((fields) => fields.some((other) => other.key === field.key)),
    );
  }

  async run(): Promise<void> {
    const run = ++this.runs;
    const query = this.input.value.trim();
    this.updateAddress(query);
    if (query === '') {
      this.results = [];
      this.status.textContent = '';
      this.filtersQuery = null;
      this.sortKey = null;
      this.filtersBox.replaceChildren();
      this.resultsBox.replaceChildren();
      return;
    }
    let found: Response;
    try {
      const engine = await loadPagefind(this.config.bundle);
      const [key, direction] = this.sortValue.split(':');
      found = await engine.search(query, {
        filters: this.filters(),
        ...(key && direction ? { sort: { [key]: direction } } : {}),
      });
    } catch {
      if (run !== this.runs) return;
      this.announce(import.meta.env.DEV ? this.strings.noIndexYet : this.strings.loadError);
      return;
    }
    if (run !== this.runs) return;
    this.results = found.results;
    this.shown = 0;
    this.renderFilters(
      found.totalFilters ?? found.filters,
      query,
      found.unfilteredResultCount ?? found.results.length,
    );
    this.list = document.createElement('ul');
    this.list.className = 'vesper-search-list';
    this.list.setAttribute('aria-label', this.strings.resultsList);
    this.more = null;
    this.resultsBox.replaceChildren(this.list);
    await this.showMore(false);
    if (run !== this.runs) return;
    const count = new Intl.NumberFormat(this.lang).format(this.results.length);
    const text =
      this.results.length === 0
        ? this.strings.noResults
        : this.results.length === 1
          ? this.strings.oneResult
          : this.strings.results;
    this.announce(fill(text, { count, query }));
  }

  /** The inline page keeps the query in its address, so a reload or a shared link searches again. */
  updateAddress(query: string): void {
    if (this.root.dataset.vesperSearch !== 'inline') return;
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    history.replaceState(history.state, '', url);
  }

  /** Sets the status, once. Clearing it first makes a repeated message speak again. */
  announce(text: string): void {
    this.status.textContent = '';
    setTimeout(() => {
      this.status.textContent = text;
    }, 50);
  }

  /** The next ten results. `focus` moves to the first new one ("Show more results"). */
  async showMore(focus: boolean): Promise<void> {
    if (!this.list) return;
    const run = this.runs;
    const next = this.results.slice(this.shown, this.shown + PAGE_SIZE);
    const data = await Promise.all(next.map((result) => result.data()));
    // A newer search has replaced the list meanwhile.
    if (run !== this.runs) return;
    const items = data.map((result) => this.item(result));
    this.list.append(...items);
    this.shown += next.length;
    if (this.shown < this.results.length) {
      if (!this.more) {
        this.more = document.createElement('button');
        this.more.type = 'button';
        this.more.className = 'vesper-search-more';
        this.more.textContent = this.strings.more;
        this.more.addEventListener('click', () => void this.showMore(true));
        this.resultsBox.append(this.more);
      }
    } else {
      this.more?.remove();
      this.more = null;
    }
    if (focus) items[0]?.querySelector('a')?.focus();
  }

  item(result: ResultData): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'vesper-search-result';
    if (result.meta.thumbnail) {
      const image = document.createElement('img');
      image.src = result.meta.thumbnail;
      // Decorative: the title beside it says what the page is.
      image.alt = '';
      image.width = 64;
      image.height = 64;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.className = 'vesper-search-thumbnail';
      li.append(image);
    }
    const text = document.createElement('div');
    const link = document.createElement('a');
    link.href = result.url;
    link.textContent = result.meta.title ?? result.url;
    link.dataset.vesperSearchLink = '';
    link.className = 'vesper-search-link';
    text.append(link);
    if (result.meta.date) {
      const time = document.createElement('time');
      if (result.meta.datetime) time.dateTime = result.meta.datetime;
      time.textContent = result.meta.date;
      time.className = 'vesper-search-date';
      text.append(' ', time);
    }
    const excerpt = document.createElement('p');
    excerpt.className = 'vesper-search-excerpt';
    excerpt.append(...excerptNodes(result.excerpt));
    text.append(excerpt);
    li.append(text);
    return li;
  }

  /**
   * Filters, with each value's count for the query (ignoring the filters
   * themselves, so labels don't change under a checkbox as it's ticked).
   * They're drawn again only for a new query; a ticked box keeps its focus.
   */
  renderFilters(counts: Counts, query: string, total: number): void {
    if (query === this.filtersQuery) {
      this.renderSort();
      return;
    }
    this.filtersQuery = query;
    const names = Object.keys(counts).sort((a, b) => (a === SECTION ? -1 : b === SECTION ? 1 : 0));
    const groups: HTMLElement[] = [];
    for (const name of names) {
      const chosen = this.selected.get(name) ?? new Set<string>();
      const values = Object.entries(counts[name] ?? {}).filter(
        ([value, count]) => count > 0 || chosen.has(value),
      );
      // A value every result has narrows nothing, unless it's ticked and must be unticked.
      const [only] = values;
      if (chosen.size === 0 && (!only || (values.length === 1 && only[1] >= total))) continue;
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'vesper-search-filter';
      const legend = document.createElement('legend');
      legend.textContent = name;
      fieldset.append(legend);
      for (const [value, count] of values) {
        const id = nextId('vesper-search-filter');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.id = id;
        box.checked = chosen.has(value);
        box.addEventListener('change', () => {
          const set = this.selected.get(name) ?? new Set<string>();
          if (box.checked) set.add(value);
          else set.delete(value);
          this.selected.set(name, set);
          if (!this.sortFields().some((field) => this.sortValue.startsWith(`${field.key}:`)))
            this.sortValue = '';
          void this.run();
        });
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = `${value} (${new Intl.NumberFormat(this.lang).format(count)})`;
        const row = document.createElement('div');
        row.className = 'vesper-search-option';
        row.append(box, label);
        fieldset.append(row);
      }
      groups.push(fieldset);
    }
    this.sortBox = document.createElement('div');
    this.sortBox.className = 'vesper-search-sort';
    this.filtersBox.replaceChildren(...groups, this.sortBox);
    this.renderSort();
  }

  /** "Sort", once every chosen section has a field to sort by. */
  renderSort(): void {
    if (!this.sortBox) return;
    const fields = this.sortFields();
    const key = fields.map((field) => field.key).join(',');
    if (key === this.sortKey) return;
    this.sortKey = key;
    this.sortBox.replaceChildren(...(fields.length > 0 ? this.sortControl(fields) : []));
  }

  sortControl(fields: SortField[]): HTMLElement[] {
    const id = nextId('vesper-search-sort');
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = this.strings.sort;
    const select = document.createElement('select');
    select.id = id;
    const option = (value: string, text: string) => {
      const element = document.createElement('option');
      element.value = value;
      element.textContent = text;
      element.selected = value === this.sortValue;
      select.append(element);
    };
    option('', this.strings.bestMatch);
    for (const field of fields) {
      const [down, up] =
        field.kind === 'date'
          ? [this.strings.newest, this.strings.oldest]
          : field.kind === 'number'
            ? [this.strings.highest, this.strings.lowest]
            : [this.strings.zToA, this.strings.aToZ];
      option(`${field.key}:desc`, fill(down, { field: field.label }));
      option(`${field.key}:asc`, fill(up, { field: field.label }));
    }
    select.addEventListener('change', () => {
      this.sortValue = select.value;
      void this.run();
    });
    return [label, select];
  }
}

/**
 * Pagefind's excerpt is HTML with `<mark>` around matches. Only the text and
 * the marks are kept, so nothing else from the index reaches the page.
 */
function excerptNodes(html: string): Node[] {
  const parsed = new DOMParser().parseFromString(`<p>${html}</p>`, 'text/html');
  const nodes: Node[] = [];
  for (const node of parsed.body.firstElementChild?.childNodes ?? []) {
    if (node.nodeName === 'MARK') {
      const mark = document.createElement('mark');
      mark.textContent = node.textContent;
      nodes.push(mark);
    } else {
      nodes.push(document.createTextNode(node.textContent ?? ''));
    }
  }
  return nodes;
}

/** The dialog variant: a button that opens a native modal <dialog>. */
function mountDialog(root: HTMLElement, config: Config, box: SearchBox, first: boolean): void {
  const dialog = root.querySelector('dialog') as HTMLDialogElement;
  const link = root.querySelector<HTMLAnchorElement>('a[data-vesper-search-trigger]');
  if (!link) return;
  // Without JavaScript, the trigger is a link to /search; with it, a button.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = link.className;
  button.innerHTML = link.innerHTML;
  button.dataset.vesperSearchTrigger = '';
  button.setAttribute('aria-haspopup', 'dialog');
  const shortcut = config.shortcut && first;
  if (shortcut) {
    const key = isMac() ? '⌘K' : 'Ctrl+K';
    button.setAttribute('aria-keyshortcuts', isMac() ? 'Meta+K' : 'Control+K');
    const hint = document.createElement('span');
    hint.id = nextId('vesper-search-shortcut');
    hint.className = 'vesper-search-visually-hidden';
    hint.textContent = fill(box.strings.shortcut, { key });
    button.setAttribute('aria-describedby', hint.id);
    root.append(hint);
  }
  link.replaceWith(button);

  const open = () => {
    if (!dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add('vesper-search-open');
    }
    box.input.focus();
    box.input.select();
    loadPagefind(config.bundle).catch(() => undefined);
  };
  const close = () => {
    if (!dialog.open) return;
    dialog.close();
  };
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('vesper-search-open');
    button.focus();
  });
  button.addEventListener('click', open);
  root.querySelector('[data-vesper-search-close]')?.addEventListener('click', close);
  // Escape closes from anywhere, and never clears the field first, as a search field would.
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  // A click on the backdrop closes it too.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  if (shortcut) {
    document.addEventListener('keydown', (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        open();
      }
    });
  }
}

/** Every `<Search>` on the page. */
export function mountSearch(): void {
  let dialogs = 0;
  for (const root of document.querySelectorAll<HTMLElement>('[data-vesper-search]')) {
    if (root.dataset.vesperSearchMounted) continue;
    root.dataset.vesperSearchMounted = '';
    const config = JSON.parse(root.dataset.vesperSearchConfig ?? '{}') as Config;
    const box = new SearchBox(root, config);
    if (root.dataset.vesperSearch === 'dialog') {
      mountDialog(root, config, box, dialogs === 0);
      dialogs++;
    } else {
      const query = new URLSearchParams(window.location.search).get('q');
      if (query) {
        box.input.value = query;
        void box.run();
      }
    }
  }
}
