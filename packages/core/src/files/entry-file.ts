import type { DataObject, DataValue } from './equal.ts';
import { SerializationError } from './errors.ts';
import { splitFrontmatter, withBody, withRaw, type SplitFile } from './frontmatter.ts';
import { decodeUtf8, encodeUtf8, lineEndings } from './text.ts';
import { readYaml, type SourceOnlyReason } from './yaml/read.ts';
import { writeYaml } from './yaml/write.ts';

/** Why a file can't be edited at all, not even as raw text. */
export type ReadOnlyReason =
  /** Not valid UTF-8. Decoding would replace bytes and corrupt it on save. */
  | 'not-utf8'
  /** TOML (`+++`) frontmatter. No formatting-preserving TOML editor exists yet (v1). */
  | 'toml';

export type EntryFile =
  | {
      status: 'editable';
      /** Frontmatter values, read exactly as Astro reads them. `{}` when there is no frontmatter. */
      data: DataObject;
      /** Everything after the frontmatter, as Astro's `body` (it starts with the line break after `---`). */
      body: string;
      split: SplitFile;
    }
  | {
      status: 'source-only';
      reason: SourceOnlyReason;
      message: string;
      /** Best-effort values for display only. */
      data: DataValue;
      body: string;
      split: SplitFile;
    }
  | { status: 'read-only'; reason: ReadOnlyReason; message: string };

/** Reads a Markdown, MDX or Markdoc entry. Never throws for content problems; it reports them. */
export function readEntryFile(bytes: Uint8Array): EntryFile {
  const text = decodeUtf8(bytes);
  if (text === null) {
    return {
      status: 'read-only',
      reason: 'not-utf8',
      message: "This file isn't UTF-8 text, so it can't be edited safely.",
    };
  }
  const split = splitFrontmatter(text);
  if (split.format === 'toml') {
    return {
      status: 'read-only',
      reason: 'toml',
      message: 'TOML frontmatter can be read but not edited yet.',
    };
  }
  if (split.format === null) return { status: 'editable', data: {}, body: split.body, split };
  const read = readYaml(split.raw);
  if (!read.editable) {
    return {
      status: 'source-only',
      reason: read.reason,
      message: read.message,
      data: read.value,
      body: split.body,
      split,
    };
  }
  return { status: 'editable', data: read.value as DataObject, body: split.body, split };
}

export type EntryChange = {
  /** The complete new frontmatter values. Omit to leave the frontmatter untouched. */
  data?: DataObject;
  /** The complete new body. Omit to leave the body untouched. */
  body?: string;
};

export type FileWriteResult = { bytes: Uint8Array; changed: boolean; reformatted: boolean };

/**
 * Writes changes into an entry file. Frontmatter and body are independent:
 * changing one never touches the other's bytes, and an unchanged save
 * returns the input bytes exactly.
 */
export function writeEntryFile(bytes: Uint8Array, change: EntryChange): FileWriteResult {
  const entry = readEntryFile(bytes);
  if (entry.status === 'read-only') throw new SerializationError('unsupported', entry.message);

  let text = joinSplit(entry.split);
  let changed = false;
  let reformatted = false;

  if (change.body !== undefined && change.body !== entry.body) {
    text = withBody(splitFrontmatter(text), change.body);
    changed = true;
  }

  if (change.data !== undefined) {
    if (entry.status === 'source-only') throw new SerializationError('source-only', entry.message);
    const split = splitFrontmatter(text);
    if (split.format === null) {
      if (Object.keys(change.data).length > 0) {
        text = addFrontmatter(text, change.data);
        changed = true;
      }
    } else {
      const result = writeYaml(split.raw, change.data);
      if (result.changed) {
        text = withRaw(split, result.text);
        changed = true;
        reformatted = result.reformatted;
      }
    }
  }

  return { bytes: changed ? encodeUtf8(text) : bytes, changed, reformatted };
}

function joinSplit(split: SplitFile): string {
  return split.prefix + split.open + split.raw + split.close + split.body;
}

/** Puts a new frontmatter block at the top of a file that had none, after any BOM. */
function addFrontmatter(text: string, data: DataObject): string {
  const eol = lineEndings(text).dominant;
  const raw = writeYaml(eol, data).text;
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const rest = text.slice(bom.length);
  return `${bom}---${raw}---${eol}${rest}`;
}
