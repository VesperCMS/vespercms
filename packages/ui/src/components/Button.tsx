import type { ReactNode } from 'react';
import {
  Button as RACButton,
  Link as RACLink,
  type ButtonProps as RACButtonProps,
  type LinkProps as RACLinkProps,
} from 'react-aria-components';
import { cx, focusRing } from './shared.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  // At most one primary (accent-filled) button per screen (spec §10.4).
  primary: 'bg-accent text-on-accent data-[hovered]:bg-accent-hover',
  secondary: 'border border-border-strong bg-surface text-content data-[hovered]:bg-surface-sunken',
  quiet: 'text-accent data-[hovered]:bg-accent-subtle',
  danger: 'bg-danger text-on-accent data-[hovered]:opacity-90',
};

export type ButtonProps = Omit<RACButtonProps, 'className' | 'children'> & {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
};

export function Button({ variant = 'secondary', className, children, ...props }: ButtonProps) {
  return (
    <RACButton
      {...props}
      className={cx(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-base font-semibold',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[pending]:cursor-progress',
        focusRing,
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </RACButton>
  );
}

/** The only icons that may stand alone (spec §10.4): close, overflow ("…") and drag handles. */
export type IconName = 'close' | 'more' | 'drag';

const ICONS: Record<IconName, ReactNode> = {
  close: <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />,
  more: (
    <>
      <circle cx="5" cy="10" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="15" cy="10" r="1.5" />
    </>
  ),
  drag: (
    <>
      <circle cx="7" cy="5" r="1.25" />
      <circle cx="13" cy="5" r="1.25" />
      <circle cx="7" cy="10" r="1.25" />
      <circle cx="13" cy="10" r="1.25" />
      <circle cx="7" cy="15" r="1.25" />
      <circle cx="13" cy="15" r="1.25" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  const filled = name !== 'close';
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? undefined : 1.75}
    >
      {ICONS[name]}
    </svg>
  );
}

export type IconButtonProps = Omit<RACButtonProps, 'className' | 'children' | 'aria-label'> & {
  icon: IconName;
  /** The accessible name. Always required: an icon is never a name on its own. */
  label: string;
  className?: string;
};

export function IconButton({ icon, label, className, ...props }: IconButtonProps) {
  return (
    <RACButton
      {...props}
      aria-label={label}
      className={cx(
        'inline-flex size-10 items-center justify-center rounded-md text-content-muted data-[hovered]:bg-surface-sunken',
        'data-[disabled]:opacity-50',
        focusRing,
        className,
      )}
    >
      <Icon name={icon} />
    </RACButton>
  );
}

export type LinkProps = Omit<RACLinkProps, 'className'> & { className?: string };

export function Link({ className, ...props }: LinkProps) {
  return (
    <RACLink
      {...props}
      className={cx(
        'cursor-pointer rounded-sm text-accent underline underline-offset-2 data-[hovered]:text-accent-hover',
        focusRing,
        className,
      )}
    />
  );
}
