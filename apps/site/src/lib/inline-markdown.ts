import { micromark } from 'micromark';

/**
 * One line of Markdown from a `fields.markdown({ inline: true })` field, as
 * HTML without the paragraph around it. micromark escapes raw HTML, so an
 * editor's text can only ever be text, emphasis and links.
 */
export function inlineMarkdown(value: string): string {
  return micromark(value)
    .trim()
    .replace(/^<p>([\s\S]*)<\/p>$/, '$1');
}
