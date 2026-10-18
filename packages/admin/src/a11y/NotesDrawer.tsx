import type { A11yNote } from '@vesper/core';
import { Button, Drawer, Icon } from '@vesper/ui';
import { NoteText } from './FieldNotes.tsx';

/** The notes about one field (or the body), under its name. */
export type NoteGroup = { key: string; label: string; notes: A11yNote[] };

/** "2 accessibility notes", and how many refuse a save under the site's gate. */
export function notesCount(notes: number, blocking: number): string {
  const text = `${String(notes)} accessibility ${notes === 1 ? 'note' : 'notes'}`;
  if (blocking === 0) return text;
  return `${text}, ${String(blocking)} ${blocking === 1 ? 'blocks' : 'block'} saving`;
}

/**
 * Every accessibility note on the entry (spec §6.18), opened from the count
 * in the top bar: grouped under each field's name in form order, each with
 * why it matters and "Go to field". A modal drawer: focus moves in, Escape
 * closes it, and focus returns to the count.
 */
export function NotesDrawer({
  isOpen,
  onOpenChange,
  groups,
  isBlocking,
  onGo,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly NoteGroup[];
  isBlocking: (note: A11yNote) => boolean;
  /** Closes the drawer and takes focus to the note's field. */
  onGo: (note: A11yNote) => void;
}) {
  return (
    <Drawer title="Accessibility notes" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-6">
        <p className="text-content-muted">
          Automated checks find some problems, not all. Check the page by hand too, with a keyboard
          and a screen reader.
        </p>
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`a11y-group-${group.key}`}>
            <h3 id={`a11y-group-${group.key}`} className="mb-2 text-heading-3 text-content">
              {group.label}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {group.notes.map((note, index) => {
                const id = `a11y-note-${group.key}-${String(index)}`;
                return (
                  <li key={id} className="flex flex-col items-start gap-2">
                    <p id={id} className="m-0 flex gap-2">
                      <Icon name="warning" size={16} className="mt-1 text-warning" />
                      <span>
                        <NoteText note={note} />
                        {isBlocking(note) && (
                          <span className="font-semibold">
                            {' '}
                            This site doesn’t save until it’s fixed.
                          </span>
                        )}
                      </span>
                    </p>
                    <Button
                      aria-describedby={id}
                      onPress={() => {
                        onGo(note);
                      }}
                    >
                      Go to field
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Drawer>
  );
}
