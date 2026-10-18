import type { ReactNode } from 'react';
import {
  Button as RACButton,
  Separator,
  ToggleButton as RACToggleButton,
  Toolbar as RACToolbar,
  type ButtonProps as RACButtonProps,
  type ToggleButtonProps as RACToggleButtonProps,
} from 'react-aria-components';
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

export type ToggleButtonProps = Omit<RACToggleButtonProps, 'className' | 'children'> & {
  children: ReactNode;
  className?: string;
};

/** On or off, announced as pressed or not; the pressed state is a fill, not colour alone. */
export function ToggleButton({ children, className, ...props }: ToggleButtonProps) {
  return (
    <RACToggleButton
      {...props}
      className={cx(
        toolClass,
        'data-[selected]:bg-accent-subtle data-[selected]:text-accent',
        className,
      )}
    >
      {children}
    </RACToggleButton>
  );
}

export type ToolButtonProps = Omit<RACButtonProps, 'className' | 'children'> & {
  children: ReactNode;
  className?: string;
};

/** A plain action inside a toolbar ("Image", "Link"). */
export function ToolButton({ children, className, ...props }: ToolButtonProps) {
  return (
    <RACButton {...props} className={cx(toolClass, className)}>
      {children}
    </RACButton>
  );
}
