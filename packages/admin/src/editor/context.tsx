import type { A11yNote, CollectionManifest, DataObject, DataValue } from '@vesper/core';
import { createContext, useContext } from 'react';
import type { ValuePath } from './values.ts';

/** What every field in the open entry shares. */
export type EditorState = {
  collection: CollectionManifest;
  values: DataObject;
  setValue: (path: ValuePath, value: DataValue) => void;
  /** Validation messages by `pathKey`, from the last save. */
  issues: ReadonlyMap<string, readonly string[]>;
  /** Accessibility notes by `pathKey` of the field they're shown under (spec §6.18). */
  notes?: ReadonlyMap<string, readonly A11yNote[]>;
  disabled: boolean;
  /** The entry hasn't been saved yet. */
  isNew: boolean;
  /** The entry's file, site-relative; for a new entry, where it will most likely be saved. */
  entryPath: string;
  /** The open entry's ID (`null` until a new entry is saved). */
  entryId: string | null;
  /** Prefix for field ids in a form that isn't the entry's own (a block's settings). */
  idPrefix?: string;
};

export const EditorContext = createContext<EditorState | null>(null);

export function useEditor(): EditorState {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useEditor() must be used inside an entry editor.');
  return editor;
}
