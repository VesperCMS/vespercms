import type { A11yNote } from '@vesper/core';
import { Icon } from '@vesper/ui';

/** A note's words: what it's about, the problem, and why it matters (spec §6.18). */
export function NoteText({ note }: { note: A11yNote }) {
  return (
    <>
      {note.subject ? `${note.subject}: ` : ''}
      {note.message} <span className="text-content-muted">{note.why}</span>
    </>
  );
}

/**
 * Accessibility notes under the field they're about. Text, never a coloured
 * badge (spec §10.4): the small warning mark is the only colour, and the
 * words say what it is. The list is part of the control's description.
 */
export function FieldNotes({ id, notes }: { id: string; notes: readonly A11yNote[] }) {
  return (
    <ul id={id} className="m-0 flex list-none flex-col gap-1 p-0">
      {notes.map((note, index) => (
        <li key={`${note.rule}:${String(index)}`} className="flex gap-2 text-small text-content">
          <Icon name="warning" size={16} className="mt-0.5 text-warning" />
          <span>
            <span className="font-semibold">Accessibility note: </span>
            <NoteText note={note} />
          </span>
        </li>
      ))}
    </ul>
  );
}
