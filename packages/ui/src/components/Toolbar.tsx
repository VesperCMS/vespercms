import type { ReactNode } from 'react';
import {
  Button as RACButton,
  ToggleButton as RACToggleButton,
  Toolbar as RACToolbar,
  type ButtonProps as RACButtonProps,
  type ToggleButtonProps as RACToggleButtonProps,
} from 'react-aria-components';
import { cx, focusRing } from './shared.tsx';

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
  'inline-flex min-h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm text-content',
  'data-[hovered]:bg-surface-sunken data-[disabled]:opacity-50',
  focusRing,
);

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
        'data-[selected]:bg-accent-subtle data-[selected]:font-semibold',
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
