import type { ReactNode } from 'react';
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
  type Key,
} from 'react-aria-components';
import { IconButton } from './Button.tsx';
import { cx, focusRing } from './shared.tsx';

const overlay = 'fixed inset-0 z-50 bg-content/30 data-[entering]:animate-none';

export type DialogProps = {
  title: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Dialogs that confirm something destructive should not close when the backdrop is clicked. */
  isDismissable?: boolean;
  /** `alertdialog` for confirmations, so screen readers announce them as such. */
  role?: 'dialog' | 'alertdialog';
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
}: DialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      className={cx(overlay, 'flex items-center justify-center p-4')}
    >
      <Modal className="w-full max-w-lg rounded-lg border border-border bg-surface-raised shadow-overlay">
        <RACDialog role={role} className="flex flex-col gap-4 p-6 outline-none">
          {({ close }) => (
            <>
              <div className="flex items-start justify-between gap-4">
                <Heading slot="title" className="text-lg font-semibold text-content">
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
      <Modal className="fixed inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-surface-raised shadow-overlay">
        <RACDialog className="flex h-full flex-col outline-none">
          {({ close }) => (
            <>
              <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
                <Heading slot="title" className="text-lg font-semibold text-content">
                  {title}
                </Heading>
                <IconButton icon="close" label="Close" onPress={close} />
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {typeof children === 'function' ? children(close) : children}
              </div>
            </>
          )}
        </RACDialog>
      </Modal>
    </ModalOverlay>
  );
}

export type MenuItem = { id: string; label: string; isDanger?: boolean; isDisabled?: boolean };

export type MenuProps = {
  /** Accessible name of the "…" trigger, e.g. "More actions for Harbor at dawn". */
  label: string;
  items: MenuItem[];
  onAction: (id: string) => void;
  /** A text trigger instead of the "…" icon. */
  triggerText?: string;
};

/** The "…" menu (spec §10.3): everything that isn't the one primary action. */
export function Menu({ label, items, onAction, triggerText }: MenuProps) {
  return (
    <MenuTrigger>
      {triggerText ? (
        <RACButton
          className={cx(
            'inline-flex min-h-10 items-center gap-1 rounded-md px-3 text-base text-content data-[hovered]:bg-surface-sunken',
            focusRing,
          )}
        >
          {triggerText}
          <span aria-hidden="true">▾</span>
        </RACButton>
      ) : (
        <IconButton icon="more" label={label} />
      )}
      <Popover
        placement="bottom end"
        className="min-w-48 rounded-md border border-border bg-surface-raised p-1 shadow-overlay"
      >
        <RACMenu
          aria-label={label}
          items={items}
          onAction={(key: Key) => {
            onAction(String(key));
          }}
          disabledKeys={items.filter((item) => item.isDisabled).map((item) => item.id)}
          className="outline-none"
        >
          {(item) => (
            <RACMenuItem
              id={item.id}
              textValue={item.label}
              className={cx(
                'cursor-default rounded-sm px-3 py-2 text-base outline-none data-[focused]:bg-accent-subtle data-[disabled]:opacity-50',
                item.isDanger ? 'text-danger' : 'text-content',
              )}
            >
              {item.label}
            </RACMenuItem>
          )}
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

/** A collapsible section: "Details", "More options", "Focal point & crops" (spec §10.2 principle 5). */
export function Disclosure({ title, children, level = 2, ...props }: DisclosureProps) {
  return (
    <RACDisclosure {...props} className="group border-t border-border">
      <Heading level={level} className="m-0">
        <RACButton
          slot="trigger"
          className={cx(
            'flex w-full items-center justify-between gap-2 py-3 text-left text-base font-semibold text-content',
            focusRing,
          )}
        >
          {title}
          <span aria-hidden="true" className="text-content-muted group-data-[expanded]:rotate-180">
            ▾
          </span>
        </RACButton>
      </Heading>
      <DisclosurePanel className="pb-4">{children}</DisclosurePanel>
    </RACDisclosure>
  );
}
