import { useEffect, useRef, type ReactNode } from 'react';
import {
  Button as RACButton,
  Separator,
  ToggleButton as RACToggleButton,
  Toolbar as RACToolbar,
  type ButtonProps as RACButtonProps,
  type ToggleButtonProps as RACToggleButtonProps,
} from 'react-aria-components';
import { Icon, type IconName } from './Icon.tsx';
import { Tooltip } from './overlays.tsx';
import { colorTransition, cx, focusRing } from './shared.tsx';

export type ToolbarProps = {
  /** Accessible name, e.g. "Formatting". */
  label: string;
  children: ReactNode;
  className?: string;
};

/**
 * A row of related controls (the body editor's formatting buttons). It's one
 * Tab stop; the arrow keys move between its buttons (the WAI-ARIA toolbar
 * pattern, from React Aria).
 */
export function Toolbar({ label, children, className }: ToolbarProps) {
  return (
    <RACToolbar aria-label={label} className={cx('flex flex-wrap items-center gap-1', className)}>
      {children}
    </RACToolbar>
  );
}

const toolClass = cx(
  'inline-flex min-h-8 min-w-8 items-center justify-center rounded-sm border border-transparent px-2 text-small font-semibold text-content',
  'data-[hovered]:bg-surface-sunken data-[disabled]:opacity-50',
  colorTransition,
  focusRing,
);

/** A hairline between groups of tools. */
export function ToolbarSeparator() {
  return (
    <Separator orientation="vertical" className="mx-1 h-5 self-center border-l border-border" />
  );
}

/**
 * A tool shows its words, or (the body's formatting tools, spec §10.4 as
 * amended) an icon alone, named by `label`, with a tooltip that also shows
 * its keyboard shortcut.
 */
export type ToolContent =
  | { children: ReactNode; icon?: never; label?: never; shortcut?: never }
  | {
      icon: IconName;
      /** The accessible name, and the tooltip's words. */
      label: string;
      /** The shortcut as people read it ("Ctrl+B") and as `aria-keyshortcuts` writes it ("Control+B"). */
      shortcut?: { text: string; aria: string };
      children?: never;
    };

/** The tool's insides and the props that name it. */
function toolParts(content: ToolContent) {
  if (!content.icon) return { inside: content.children, named: {}, tooltip: null };
  return {
    inside: <Icon name={content.icon} size={18} />,
    named: { 'aria-label': content.label },
    tooltip: content.shortcut ? `${content.label} · ${content.shortcut.text}` : content.label,
  };
}

const iconTool = 'size-8 px-0';

/** React Aria's buttons don't pass `aria-keyshortcuts` through, so it's set on the element. */
function useKeyShortcuts(shortcut: ToolContent['shortcut']) {
  const ref = useRef<HTMLButtonElement>(null);
  const keys = shortcut?.aria;
  useEffect(() => {
    if (keys) ref.current?.setAttribute('aria-keyshortcuts', keys);
    else ref.current?.removeAttribute('aria-keyshortcuts');
  }, [keys]);
  return ref;
}

export type ToggleButtonProps = Omit<RACToggleButtonProps, 'className' | 'children'> &
  ToolContent & { className?: string };

/** On or off, announced as pressed or not; the pressed state is a fill, not colour alone. */
export function ToggleButton({
  children,
  icon,
  label,
  shortcut,
  className,
  ...props
}: ToggleButtonProps) {
  const { inside, named, tooltip } = toolParts({ children, icon, label, shortcut } as ToolContent);
  const ref = useKeyShortcuts(shortcut);
  const button = (
    <RACToggleButton
      {...props}
      {...named}
      ref={ref}
      className={cx(
        toolClass,
        tooltip !== null && iconTool,
        'data-[selected]:bg-accent-subtle data-[selected]:text-accent',
        className,
      )}
    >
      {inside}
    </RACToggleButton>
  );
  return tooltip === null ? button : <Tooltip text={tooltip}>{button}</Tooltip>;
}

export type ToolButtonProps = Omit<RACButtonProps, 'className' | 'children'> &
  ToolContent & {
    className?: string;
    /**
     * The caret is inside what the action edits (a link): drawn as a chosen
     * toggle is, so it lights up as Bullets does in a list. It stays an
     * action, not a toggle, so nothing says "pressed"; the label says it
     * ("Edit link").
     */
    isActive?: boolean;
  };

/** A plain action inside a toolbar ("Image", "Link"). */
export function ToolButton({
  children,
  icon,
  label,
  shortcut,
  className,
  isActive = false,
  ...props
}: ToolButtonProps) {
  const { inside, named, tooltip } = toolParts({ children, icon, label, shortcut } as ToolContent);
  const ref = useKeyShortcuts(shortcut);
  const button = (
    <RACButton
      {...props}
      {...named}
      ref={ref}
      className={cx(
        toolClass,
        tooltip !== null && iconTool,
        isActive && 'bg-accent-subtle text-accent',
        className,
      )}
    >
      {inside}
    </RACButton>
  );
  return tooltip === null ? button : <Tooltip text={tooltip}>{button}</Tooltip>;
}
