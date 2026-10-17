# @vesper/ui

Vesper's design tokens and, from Phase 2, its accessible component kit: Button, IconButton, Link, TextField, TextArea, Select, Combobox, Checkbox, Switch, RadioGroup, Dialog, Drawer, Menu, Disclosure, Table, InlineStatus and ErrorSummary (spec §10.5). Screens compose these and nothing else.

**Status:** Phase 0. Only `src/tokens.css` exists. The package is private until the components land.

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
