import type { CollectionManifest, DataObject, DataValue } from '@vesper/core';
import { createContext, useContext } from 'react';
import type { ValuePath } from './values.ts';

/** What every field in the open entry shares. */
export type EditorState = {
  collection: CollectionManifest;
  values: DataObject;
  setValue: (path: ValuePath, value: DataValue) => void;
  /** Validation messages by `pathKey`, from the last save. */
  issues: ReadonlyMap<string, readonly string[]>;
  disabled: boolean;
  /** The entry hasn't been saved yet. */
  isNew: boolean;
  /** The open entry's ID (`null` until a new entry is saved). */
  entryId: string | null;
};

export const EditorContext = createContext<EditorState | null>(null);

export function useEditor(): EditorState {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useEditor() must be used inside an entry editor.');
  return editor;
}
