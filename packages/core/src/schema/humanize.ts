const ACRONYMS = new Set([
  'id',
  'url',
  'uri',
  'seo',
  'og',
  'faq',
  'pdf',
  'api',
  'html',
  'css',
  'rss',
  'cta',
  'utm',
  'iso',
]);

/**
 * Turns a schema key into a sentence-case label: `publishedAt` → "Published
 * at", `hero_image` → "Hero image", `seoTitle` → "SEO title". Used only when
 * a field has no `meta.label`.
 */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return key;
  return words
    .map((word, i) => {
      if (ACRONYMS.has(word)) return word.toUpperCase();
      return i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(' ');
}
