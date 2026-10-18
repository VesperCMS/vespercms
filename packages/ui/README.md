# @vesper/ui

Vesper's design tokens and, from Phase 2, its accessible component kit: Button, IconButton, Link, TextField, TextArea, Select, Combobox, Checkbox, Switch, RadioGroup, Dialog, Drawer, Menu, Disclosure, Table, InlineStatus, ErrorSummary, a Toolbar with ToggleButton and ToolButton for the body editor, and, from Phase 2.6, Tree, SuggestField and FileButton (spec §10.5). Screens compose these and nothing else.

**Status:** Phase 2, v1 of the kit. The kit is built on React Aria Components (DECISIONS.md). The package stays private: `@vesper/admin` compiles it into the studio bundle, and nothing else uses it yet.

| Group | Components |
|---|---|
| Actions | `Button` (primary, secondary, quiet, danger), `IconButton` (close, more or drag only, always with a label), `Link`, `FileButton` (opens the system file picker) |
| Text inputs | `TextField`, `TextArea`: visible label, "(required)" in words, help and error text linked with aria-describedby |
| Choices | `Select`, `Combobox`, `MultiCombobox` (tags and multi-references, with named remove buttons), `SuggestField` (a text field that suggests values: the link picker), `Checkbox`, `Switch` (state also in words), `RadioGroup` |
| Overlays | `Dialog` (focus trap, Escape, focus returns to the trigger), `Drawer`, `Menu` (the "…" menu), `Disclosure` |
| Outlines | `Tree`: React Aria's single-column treegrid. Arrow keys move and expand, Home/End jump, typing finds a row, rows hold buttons, and `useDragAndDrop` adds drag and drop with its keyboard mode. The expand toggle is a named button outside the Tab order (DECISIONS.md). |
| Data and feedback | `Table` (rows can be links), `InlineStatus` (status in words), `ErrorSummary` (takes focus, links to fields; `focusKey` moves focus only on a new failed save, never while errors update as people type) |
| Toolbars | `Toolbar` (one Tab stop, arrow keys inside), `ToggleButton` (pressed shown as a fill and semibold text, and announced as pressed), `ToolButton` |

Each component has axe and keyboard tests in `src/components/ui.test.tsx`. `@vesper/admin`'s `src/budget.test.ts` checks the kit's and the studio's source against the §10.4 design budget. Colour contrast is checked separately, on the tokens.

## Tokens

```css
@import 'tailwindcss';
@import '@vesper/ui/tokens.css';
```

The token file enforces the spec §10.4 design budget:

- **Tailwind's defaults are reset.** The default palette, font weights and shadows are set to `initial`, so only the declared tokens can be used.
- **Neutrals:**
  - `surface`, `surface-raised`, `surface-sunken`
  - `border`, `border-strong`
  - `content`, `content-muted`
  - `on-accent`
- **Exactly five roles:**
  - `accent` (plus `accent-hover`)
  - `accent-subtle`
  - `danger`
  - `focus`
  - `warning`

  There are no status hues: status is text.
- **Two font weights:** `normal` and `semibold`. One shadow, `overlay`, used only on overlays.
- **Theming:** every colour is a `light-dark()` pair, so `color-scheme` (set through `html[data-theme]`, or the OS) selects the palette.

## Contrast check

```bash
npm run a11y:contrast
```

`scripts/a11y-contrast.mjs` parses this file directly. It fails if:

- a listed foreground/background pair misses WCAG 2.1 contrast in either theme (4.5:1 for text, 3:1 for UI and focus);
- a token is outside the budget allowlist;
- a token isn't covered by any pair;
- a value isn't a plain `light-dark(oklch(…), oklch(…))`.

Adding a token means adding it to the allowlist and adding the pairs it appears in.
