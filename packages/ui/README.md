# @vespercms/ui

Vesper's design tokens and, from Phase 2, its accessible component kit: Button, IconButton, Link, TextField, TextArea, Select, Combobox, Checkbox, Switch, RadioGroup, Dialog, Drawer, Menu, Disclosure, Table, InlineStatus, ErrorSummary, a Toolbar with ToggleButton and ToolButton for the body editor, and, from Phase 2.6, Tree, SuggestField and FileButton (spec §10.5). Since the studio design pass, also Icon and Tooltip. Screens compose these and nothing else.

**Status:** Phase 2, v1 of the kit. The kit is built on React Aria Components (DECISIONS.md). The package stays private: `@vespercms/admin` compiles it into the studio bundle, and nothing else uses it yet.

| Group | Components |
|---|---|
| Actions | `Button` (primary, secondary, quiet, danger), `IconButton` (close, more or drag only, always with a label), `Link`, `FileButton` (opens the system file picker). `Button`, `ButtonLink`, `Link` and `FileButton` take an `icon`, drawn before the words |
| Text inputs | `TextField`, `TextArea`: visible label, "(required)" in words, help and error text linked with aria-describedby |
| Choices | `Select`, `Combobox` (an option's `prefix`, such as an icon, sits before its words in the list and, once chosen, in the field; it's hidden from assistive tech), `MultiCombobox` (tags and multi-references, with named remove buttons), `SuggestField` (a text field that suggests values: the link picker), `Checkbox`, `Switch` (state also in words), `RadioGroup` |
| Overlays | `Dialog` (focus trap, Escape, focus returns to the trigger; `size="wide"` for work on an image; scrolls inside itself on a short screen), `Drawer`, `Menu` (the "…" menu), `Disclosure` |
| Outlines | `Tree`: React Aria's single-column treegrid. Arrow keys move and expand, Home/End jump, typing finds a row, rows hold buttons, and `useDragAndDrop` adds drag and drop with its keyboard mode. The expand toggle is a named button outside the Tab order (DECISIONS.md). |
| Data and feedback | `Table` (rows can be links), `InlineStatus` (status in words; its dot pulses while `busy`), `StatusPill` (a status word on its colour: `live`, `scheduled` or `neutral`), `ErrorSummary` (takes focus, links to fields; `focusKey` moves focus only on a new failed save, never while errors update as people type) |
| Toolbars | `Toolbar` (one Tab stop, arrow keys inside), `ToggleButton` (pressed shown as a fill and semibold text, and announced as pressed), `ToolButton`. A tool given `icon`, `label` and `shortcut` instead of children is icon-only: the label is its accessible name, and a `Tooltip` shows the label and shortcut on hover and keyboard focus, with the shortcut in `aria-keyshortcuts` |
| Icons | `Icon`: a [Lucide](https://lucide.dev) icon by name from the kit's set (`ICONS`), or a drawing from the manifest (`node`, a collection's icon or an icon field's), always `aria-hidden`. A manifest drawing keeps only Lucide's shapes and geometry attributes. `TextField`'s `icon` and `Menu` items' `icon` use it too |
| Tooltips | `Tooltip`: React Aria's, for icon-only tools. It closes when the page scrolls |


Each component has axe and keyboard tests in `src/components/ui.test.tsx`. `@vespercms/admin`'s `src/budget.test.ts` checks the kit's and the studio's source against the §10.4 design budget. Colour contrast is checked separately, on the tokens.

## Tokens

```css
@import 'tailwindcss';
@import '@vespercms/ui/tokens.css';
```

The values are the Pine direction of Vesper's design system (DECISIONS.md, "Studio design"): warm sand neutrals and a pine-teal accent, fixed for every site. The token file enforces the spec §10.4 design budget:

- **Tailwind's defaults are reset.** The default palette, type scale, font weights, radii, shadows and animations are set to `initial`, so only the declared tokens can be used.
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

  Two status hues, `live` and `scheduled`, each with its `-subtle` fill, colour only a `StatusPill`'s word; the word still says it (DECISIONS.md, "Status words have colour").
- **Type:** Figtree (self-hosted by `@vespercms/admin`) over the system stack, in two weights, `normal` and `semibold`, and one scale: `text-title`, `text-heading-1` to `-3`, `text-body`, `text-label`, `text-small`, `text-caption`. Code, slugs and URLs use the system monospace stack.
- **Radii:** `rounded-sm` (6px), `-md` (10px), `-lg` (16px) and `-full`.
- **Depth:** `shadow-overlay` on overlays, plus four named effects in their named places (DECISIONS.md, "Four named glows"): `shadow-glow-accent` (the primary button), `shadow-glow-selected` (the current item), the focus halo (`ring-6 ring-(color:--glow-focus)`) and `shadow-glass-edge`. Glass utilities for what floats: `glass-bar` (the top bar, 88%), `glass-raised` (overlays, 93%) and `scrim`, each with solid fallbacks; and `afterglow` for welcoming screens.
- **Theming:** every colour is a `light-dark()` pair, and so is every glow, so `color-scheme` (set through `html[data-theme]`, or the OS) selects the palette.

## Contrast check

```bash
npm run a11y:contrast
```

`scripts/a11y-contrast.mjs` parses this file directly. It fails if:

- a listed foreground/background pair misses WCAG 2.1 contrast in either theme (4.5:1 for text, 3:1 for UI and focus). Text on glass is composited over black and over white with the fill `tokens.css` sets, and text on the afterglow at its brightest;
- a token is outside the budget allowlist;
- a token isn't covered by any pair;
- a value isn't a plain `light-dark(oklch(…), oklch(…))`.

Adding a token means adding it to the allowlist and adding the pairs it appears in.
