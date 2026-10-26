import { useEffect, useRef, type ReactNode } from 'react';
import {
  Button as RACButton,
  FileTrigger,
  Link as RACLink,
  type ButtonProps as RACButtonProps,
  type LinkProps as RACLinkProps,
} from 'react-aria-components';
import { Icon, type IconName } from './Icon.tsx';
import { colorTransition, cx, focusRing } from './shared.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  // At most one primary (accent-filled) button per screen (spec §10.4), and
  // the only thing that glows with the accent: on hover and focus, never at
  // rest (DECISIONS.md, "Four named glows").
  primary: cx(
    'border-transparent bg-accent text-on-accent data-[hovered]:bg-accent-hover',
    'data-[hovered]:shadow-glow-accent data-[focus-visible]:shadow-glow-accent',
    // The glow fades in on hover only; on focus it's there at once (see colorTransition).
    // Both timings name their properties: a bare duration animates `all`, and faded the
    // focus ring and the turn from disabled, mid-fade below 4.5:1 (DECISIONS.md).
    colorTransition,
    'data-[hovered]:transition-[background-color,box-shadow] data-[hovered]:duration-180',
  ),
  secondary: cx(
    'border-border-strong bg-surface text-content data-[hovered]:bg-surface-sunken',
    colorTransition,
  ),
  quiet: cx('border-transparent text-accent data-[hovered]:bg-accent-subtle', colorTransition),
  danger: cx(
    'border-transparent bg-danger text-on-accent data-[hovered]:opacity-90',
    colorTransition,
  ),
};

export type ButtonProps = Omit<RACButtonProps, 'className' | 'children'> & {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
  /**
   * The primary button's one glow pulse after its action succeeded (a save).
   * Each new value plays it once; reduced motion drops it.
   */
  pulse?: number;
  /** An icon before the words; never instead of them (spec §10.4). */
  icon?: IconName;
};

// A hairline on every button, transparent but for the secondary's: forced
// colours draw it, so a button whose fill they remove still shows its edge.
// Each variant sets the colour, so two colours never compete for it.
const buttonBase = cx(
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-4 text-label',
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[pending]:cursor-progress',
  focusRing,
);

export function Button({
  variant = 'secondary',
  className,
  children,
  pulse = 0,
  icon,
  ...props
}: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = ref.current;
    if (pulse === 0 || !button) return;
    // Restart the animation, then take it off so hover and focus glow as usual.
    button.classList.remove('animate-glow-pulse');
    // Reading layout in between makes the browser start the animation afresh.
    button.getBoundingClientRect();
    button.classList.add('animate-glow-pulse');
    const done = () => {
      button.classList.remove('animate-glow-pulse');
    };
    button.addEventListener('animationend', done, { once: true });
    return () => {
      button.removeEventListener('animationend', done);
    };
  }, [pulse]);
  return (
    <RACButton {...props} ref={ref} className={cx(buttonBase, VARIANTS[variant], className)}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </RACButton>
  );
}

export type ButtonLinkProps = Omit<RACLinkProps, 'className' | 'children'> & {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
  /** An icon before the words. */
  icon?: IconName;
};

/**
 * A link that looks like a button: a screen's main action when it goes
 * somewhere ("New entry" opens the new entry's screen). It stays a link, so
 * it can open in a new tab and reads as one.
 */
export function ButtonLink({
  variant = 'secondary',
  className,
  children,
  icon,
  ...props
}: ButtonLinkProps) {
  return (
    <RACLink {...props} className={cx(buttonBase, 'no-underline', VARIANTS[variant], className)}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </RACLink>
  );
}

/** Only close, overflow ("…"), drag handles and the outline's toggle may stand alone (spec §10.4). */
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
        'inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-transparent text-content-muted',
        'data-[hovered]:bg-surface-sunken data-[hovered]:text-content data-[disabled]:opacity-50',
        colorTransition,
        focusRing,
        className,
      )}
    >
      <Icon name={icon} />
    </RACButton>
  );
}

export type LinkProps = Omit<RACLinkProps, 'className'> & {
  className?: string;
  /**
   * `inline` (the default): accent and always underlined, so colour is never
   * the only cue. `title`: the name of a row in a list or table, which opens
   * it; it stands alone, so it's set in content colour and semibold, and
   * underlined in the accent on hover.
   */
  variant?: 'inline' | 'title';
  /** An icon before the words: the back link's arrow. */
  icon?: IconName;
};

export function Link({ className, variant = 'inline', icon, children, ...props }: LinkProps) {
  return (
    <RACLink
      {...props}
      className={cx(
        'cursor-pointer rounded-sm underline-offset-2',
        icon && 'inline-flex items-center gap-1',
        variant === 'inline'
          ? 'text-accent underline data-[hovered]:text-accent-hover'
          : 'font-semibold text-content no-underline data-[hovered]:text-accent data-[hovered]:underline',
        colorTransition,
        focusRing,
        className,
      )}
    >
      {(renderProps) => (
        <>
          {icon && <Icon name={icon} size={16} />}
          {typeof children === 'function' ? children(renderProps) : children}
        </>
      )}
    </RACLink>
  );
}

export type FileButtonProps = {
  /** File types the picker offers, e.g. `['.csv', 'text/csv']`. */
  accept: string[];
  onSelect: (file: File) => void;
  children: ReactNode;
  variant?: ButtonVariant;
  icon?: IconName;
};

/** A button that opens the system file picker (React Aria's FileTrigger): one file, of the given types. */
export function FileButton({
  accept,
  onSelect,
  children,
  variant = 'secondary',
  icon,
}: FileButtonProps) {
  return (
    <FileTrigger
      acceptedFileTypes={accept}
      onSelect={(files) => {
        const file = files?.[0];
        if (file) onSelect(file);
      }}
    >
      <Button variant={variant} {...(icon ? { icon } : {})}>
        {children}
      </Button>
    </FileTrigger>
  );
}
