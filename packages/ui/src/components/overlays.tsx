import type { ReactElement, ReactNode } from 'react';
import {
  Button as RACButton,
  Dialog as RACDialog,
  Disclosure as RACDisclosure,
  DisclosurePanel,
  Heading,
  Menu as RACMenu,
  MenuItem as RACMenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Tooltip as RACTooltip,
  TooltipTrigger,
  type Key,
} from 'react-aria-components';
import { IconButton } from './Button.tsx';
import { Icon, type IconName, type IconNode } from './Icon.tsx';
import { colorTransition, cx, focusRing } from './shared.tsx';

/** The modal scrim: the page stays present, blurred, beneath a dialog or drawer. */
const overlay = 'scrim fixed inset-0 z-50 data-[entering]:animate-none';

/** What floats is glass (DECISIONS.md, "Four named glows, and glass on what floats"). */
export const glassOverlay = 'glass-raised shadow-glass-overlay';

/** The open list of a menu, select or combobox. */
export const popoverClass = cx('rounded-lg p-1', glassOverlay);

export type DialogProps = {
  title: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Dialogs that confirm something destructive should not close when the backdrop is clicked. */
  isDismissable?: boolean;
  /** `alertdialog` for confirmations, so screen readers announce them as such. */
  role?: 'dialog' | 'alertdialog';
  /** `wide` for work on an image, such as cropping. Still fits a 320px screen. */
  size?: 'default' | 'wide';
};

/**
 * A modal dialog: focus moves in, Tab stays inside, Escape closes, and focus
 * returns to whatever opened it. Shadows only on overlays (spec §10.2).
 */
export function Dialog({
  title,
  isOpen,
  onOpenChange,
  children,
  isDismissable = true,
  role = 'dialog',
  size = 'default',
}: DialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      className={cx(overlay, 'flex items-center justify-center p-4')}
    >
      <Modal
        className={cx(
          'max-h-full w-full overflow-y-auto rounded-lg',
          glassOverlay,
          size === 'wide' ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <RACDialog role={role} className="flex flex-col gap-4 p-6 outline-none">
          {({ close }) => (
            <>
              <div className="flex items-start justify-between gap-4">
                <Heading slot="title" className="text-heading-2 text-content">
                  {title}
                </Heading>
                <IconButton icon="close" label="Close" onPress={close} className="-mr-2 -mt-2" />
              </div>
              {typeof children === 'function' ? children(close) : children}
            </>
          )}
        </RACDialog>
      </Modal>
    </ModalOverlay>
  );
}

export type DrawerProps = Omit<DialogProps, 'role' | 'isDismissable'>;

/** A side panel for secondary content (the editor's Details on wide screens, spec §10.3). Never permanently open. */
export function Drawer({ title, isOpen, onOpenChange, children }: DrawerProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className={overlay}>
      <Modal
        className={cx(
          'fixed inset-y-0 right-0 flex w-full max-w-drawer flex-col rounded-l-lg',
          glassOverlay,
        )}
      >
        <RACDialog className="flex h-full flex-col outline-none">
          {({ close }) => (
            <>
              <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
                <Heading slot="title" className="text-heading-2 text-content">
                  {title}
                </Heading>
                <IconButton icon="close" label="Close" onPress={close} className="-mr-2" />
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                {typeof children === 'function' ? children(close) : children}
              </div>
            </>
          )}
        </RACDialog>
      </Modal>
    </ModalOverlay>
  );
}

export type MenuItem = {
  id: string;
  label: string;
  isDanger?: boolean;
  isDisabled?: boolean;
  /** Where the person is now (the Content menu's open collection): accent-subtle and its halo. */
  isCurrent?: boolean;
  /** An icon before the words: one of the studio's, or a drawing (a collection's icon). */
  icon?: IconName | IconNode;
};

export type MenuProps = {
  /** Accessible name of the "…" trigger, e.g. "More actions for Harbor at dawn". */
  label: string;
  items: MenuItem[];
  onAction: (id: string) => void;
  /** A text trigger instead of the "…" icon. */
  triggerText?: string;
  /** An icon before a text trigger's words ("+ Insert"). */
  triggerIcon?: IconName;
};

/** The 16px chevron beside a text trigger. It points down; a disclosure turns it. */
export function Chevron({ className }: { className?: string }) {
  return <Icon name="chevron" size={16} className={cx('text-content-muted', className)} />;
}

/**
 * A tooltip: the words of a control that shows only an icon (the body's
 * formatting tools, spec §10.4 as amended). It appears on hover and on
 * keyboard focus; the control's accessible name carries the same words.
 */
export function Tooltip({ text, children }: { text: string; children: ReactElement }) {
  return (
    <TooltipTrigger delay={400} closeDelay={0}>
      {children}
      <RACTooltip
        offset={6}
        className={cx('rounded-md px-2 py-1 text-small text-content', glassOverlay)}
      >
        {text}
      </RACTooltip>
    </TooltipTrigger>
  );
}

/** The "…" menu (spec §10.3): everything that isn't the one primary action. */
export function Menu({ label, items, onAction, triggerText, triggerIcon }: MenuProps) {
  return (
    <MenuTrigger>
      {triggerText ? (
        <RACButton
          className={cx(
            'inline-flex min-h-10 items-center gap-1 rounded-md border border-transparent px-3 text-body text-content data-[hovered]:bg-surface-sunken',
            colorTransition,
            focusRing,
          )}
        >
          {triggerIcon && <Icon name={triggerIcon} size={18} />}
          {triggerText}
          <Chevron />
        </RACButton>
      ) : (
        <IconButton icon="more" label={label} />
      )}
      <Popover placement="bottom end" className={cx('min-w-56', popoverClass)}>
        <RACMenu
          aria-label={label}
          onAction={(key: Key) => {
            onAction(String(key));
          }}
          items={items}
          disabledKeys={items.filter((item) => item.isDisabled).map((item) => item.id)}
          className="outline-none"
        >
          {/*
           * Rendered from `items`, not as static children: opened from the
           * keyboard, React Aria then focuses the first item itself.
           */}
          {(item) => {
            const index = items.indexOf(item);
            // Destructive items go last, after a hairline (drawn, so it isn't a stop).
            const afterHairline =
              item.isDanger === true && index > 0 && !items[index - 1]?.isDanger;
            return (
              <RACMenuItem
                id={item.id}
                textValue={item.label}
                className={cx(
                  'flex min-h-9 cursor-default items-center rounded-md px-3 text-body outline-none',
                  'data-[focused]:bg-accent-subtle data-[disabled]:opacity-50',
                  // The ring too, inside the item, so keyboard focus never rests on a fill alone.
                  'data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-focus',
                  item.isDanger ? 'text-danger' : 'text-content',
                  item.isCurrent && 'bg-accent-subtle shadow-glow-selected',
                  afterHairline &&
                    "relative mt-2 before:pointer-events-none before:absolute before:inset-x-2 before:-top-1 before:border-t before:border-border before:content-['']",
                )}
              >
                {item.icon && (
                  <Icon
                    {...(typeof item.icon === 'string' ? { name: item.icon } : { node: item.icon })}
                    size={18}
                    className={cx('mr-2', !item.isDanger && 'text-content-muted')}
                  />
                )}
                {item.label}
              </RACMenuItem>
            );
          }}
        </RACMenu>
      </Popover>
    </MenuTrigger>
  );
}

export type DisclosureProps = {
  title: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  isExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Heading level of the trigger, to fit the page outline. */
  level?: 2 | 3 | 4;
};

/**
 * A collapsible section: "Details", "More options", "Focal point & crops"
 * (spec §10.2 principle 5). Hairlines above and below; a run of them shares one.
 */
export function Disclosure({ title, children, level = 2, ...props }: DisclosureProps) {
  return (
    <RACDisclosure
      {...props}
      className="vesper-disclosure group border-y border-border [.vesper-disclosure+&]:border-t-0"
    >
      <Heading level={level} className="m-0">
        <RACButton
          slot="trigger"
          className={cx(
            'flex min-h-12 w-full items-center gap-2 rounded-md text-left text-heading-3 text-content',
            focusRing,
          )}
        >
          {/* Turned at once: a transition here would hold back React Aria's focus moves. */}
          <Chevron className="-rotate-90 group-data-[expanded]:rotate-0" />
          {title}
        </RACButton>
      </Heading>
      {/* Padding inside: a closed panel is `hidden="until-found"`, which keeps its own box. */}
      <DisclosurePanel>
        <div className="pb-6">{children}</div>
      </DisclosurePanel>
    </RACDisclosure>
  );
}
