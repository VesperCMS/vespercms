import { parseDocument, stringify } from 'yaml';
import type { DataValue } from '../equal.ts';
import { ASTRO_YAML_OPTIONS } from './read.ts';

/*
 * One value as YAML text, for the studio's raw field (spec §6.3 step 4): a
 * field Vesper can't map to a control is edited as a small YAML snippet,
 * parsed the way Astro parses it.
 */

/** YAML text for one value. `undefined` is empty text. */
export function formatYamlSnippet(value: DataValue): string {
  if (value === undefined) return '';
  const text = stringify(value, { ...ASTRO_YAML_OPTIONS, lineWidth: 0 });
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

export type YamlSnippetParse = { ok: true; value: DataValue } | { ok: false; message: string };

/** Parses YAML text typed into a raw field. Empty text is `undefined` (the key is removed). */
export function parseYamlSnippet(text: string): YamlSnippetParse {
  if (text.trim() === '') return { ok: true, value: undefined };
  const doc = parseDocument(text, ASTRO_YAML_OPTIONS);
  const [error] = doc.errors;
  if (error) {
    const line = error.linePos?.[0]?.line;
    const where = line ? ` (line ${String(line)})` : '';
    return {
      ok: false,
      message: `This isn’t valid YAML${where}: ${error.message.split('\n')[0] ?? ''}`,
    };
  }
  const value = doc.toJS() as DataValue;
  return { ok: true, value };
}
