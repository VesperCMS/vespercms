/*
 * The words `<Search>` uses, in English. Other languages come from
 * `vesper({ search: { strings: { fr: { … } } } })`, keyed by the page's
 * `<html lang>`, and fall back to these one by one. `{count}`, `{query}`,
 * `{key}` and `{field}` are filled in.
 */
export const SEARCH_STRINGS = {
  /** The button that opens the dialog, and the inline form's submit button. */
  button: 'Search',
  /** The field's label, and the dialog's name. */
  label: 'Search this site',
  close: 'Close',
  shortcut: 'Keyboard shortcut: {key}',
  results: '{count} results for “{query}”',
  oneResult: '1 result for “{query}”',
  noResults: 'No results for “{query}”',
  resultsList: 'Search results',
  more: 'Show more results',
  sort: 'Sort',
  bestMatch: 'Best match',
  newest: '{field}: newest first',
  oldest: '{field}: oldest first',
  lowest: '{field}: lowest first',
  highest: '{field}: highest first',
  aToZ: '{field}: A to Z',
  zToA: '{field}: Z to A',
  /** In `astro dev` before the first build: there's no index to search yet. */
  noIndexYet: 'Search works after astro build.',
  loadError: 'Search couldn’t load. Try again in a moment.',
  pageTitle: 'Search',
  noJs: 'Search needs JavaScript.',
  noJsHome: 'Go to the home page',
  noJsLink: 'Browse the site instead',
  noJsSitemap: 'Site map (XML)',
  noJsDuckDuckGo: 'Without JavaScript, this form searches the site on DuckDuckGo.',
};

export type SearchStrings = typeof SEARCH_STRINGS;

/** The strings for a language: its own where the site gives them, English otherwise. */
export function stringsFor(
  overrides: Readonly<Record<string, Readonly<Record<string, string>>>>,
  lang: string,
): SearchStrings {
  const tag = lang.toLowerCase();
  const own = overrides[tag] ?? overrides[tag.split('-')[0] ?? ''] ?? {};
  const merged: Record<string, string> = { ...SEARCH_STRINGS };
  for (const [key, value] of Object.entries(own)) if (key in merged) merged[key] = value;
  return merged as SearchStrings;
}

/** A string with its `{name}` slots filled. */
export function fill(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);
}
