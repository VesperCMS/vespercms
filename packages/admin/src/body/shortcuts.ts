/**
 * A keyboard shortcut as people read it ("Ctrl+B", "⌘B") and as
 * `aria-keyshortcuts` writes it ("Control+B", "Meta+B"). `Mod` is Command on
 * a Mac and Control elsewhere, as in Tiptap's own keymaps.
 */
export type Shortcut = { text: string; aria: string };

export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

type Modifier = 'Mod' | 'Alt' | 'Shift';

export function shortcut(...keys: [...Modifier[], string]): Shortcut {
  const key = keys.at(-1) ?? '';
  const modifiers = keys.slice(0, -1) as Modifier[];
  if (isMac) {
    const symbols: Record<Modifier, string> = { Alt: '⌥', Shift: '⇧', Mod: '⌘' };
    // Apple's order: Option, Shift, Command, then the key.
    const order = (['Alt', 'Shift', 'Mod'] as const).filter((m) => modifiers.includes(m));
    return {
      text: `${order.map((m) => symbols[m]).join('')}${key}`,
      aria: [...order.map((m) => (m === 'Mod' ? 'Meta' : m)), key].join('+'),
    };
  }
  const named = modifiers.map((m) => (m === 'Mod' ? 'Ctrl' : m));
  return {
    text: [...named, key].join('+'),
    aria: [...modifiers.map((m) => (m === 'Mod' ? 'Control' : m)), key].join('+'),
  };
}
