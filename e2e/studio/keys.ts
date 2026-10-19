/*
 * Keys whose meaning depends on the platform the browser runs on. Chromium
 * on a Mac follows macOS: Home and End scroll without moving the caret,
 * Control+A goes to the line's start, and select all, cut, paste and save
 * are on Command. Off a Mac these are the keys an editor presses there.
 * The check matches the one Playwright uses to resolve `ControlOrMeta`.
 *
 * A Mac's line keys here are Control+A and Control+E, macOS's own text
 * bindings, which Tiptap's Mac keymap turns into selectTextblockStart and
 * End. ⌘← and ⌘→ go to the visual line's ends instead; markdoc.spec.ts
 * presses them, and ⇧⌘← and ⇧⌘→, beside chips in tests of their own.
 */
const mac = process.platform === 'darwin';

export const keys = {
  /** The caret to the start of its line. */
  lineStart: mac ? 'Control+a' : 'Home',
  /** The caret to the end of its line. */
  lineEnd: mac ? 'Control+e' : 'End',
  /** The caret to the end of the whole text. */
  textEnd: mac ? 'Meta+ArrowDown' : 'Control+End',
  selectAll: 'ControlOrMeta+a',
  cut: 'ControlOrMeta+x',
  paste: 'ControlOrMeta+v',
  save: 'ControlOrMeta+s',
} as const;
