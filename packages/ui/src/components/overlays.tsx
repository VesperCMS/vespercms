import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  Button as RACButton,
  Collection,
  Dialog as RACDialog,
  Disclosure as RACDisclosure,
  DisclosurePanel,
  Header,
  Heading,
  Menu as RACMenu,
  MenuItem as RACMenuItem,
  MenuSection,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  SubmenuTrigger,
  Text,
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
  /** A line under the name, read as the item's description ("Questions and answers"). */
  description?: string;
  /**
   * A submenu: the item opens these instead of acting (→ opens, ← closes).
   * Their ids reach the menu's `onAction` like any other item's.
   */
  items?: MenuItem[];
};

export type MenuChoice = {
  /** The group's name, shown above its options ("Appearance"). */
  title: string;
  options: { id: string; label: string }[];
  selected: string;
  onChange: (id: string) => void;
  /**
   * Once the menu has closed after an option was chosen (the current one
   * included), with focus back on its button: where focus goes next. The
   * body's Text style sends it back to the text.
   */
  onClosed?: () => void;
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
  /** A picture before a text trigger's words, in the icon's place: the user menu's `Avatar`. */
  triggerPicture?: ReactNode;
  /** The caller's own trigger, such as the kit's `Button` ("Add section"), instead of either of the menu's. */
  trigger?: ReactNode;
  /**
   * Shown at the top of the open menu, above its items: who is signed in.
   * Hidden from screen readers, since the trigger's name says the same.
   */
  header?: ReactNode;
  /** One choice among options, as a group of its own before the items (the user menu's Appearance). */
  choice?: MenuChoice;
  /** Open it from elsewhere: Shift+F10 on a list item's row opens that item's "…" menu. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
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

const menuItemClass = cx(
  'flex min-h-9 cursor-default items-center rounded-md px-3 text-body outline-none',
  'data-[focused]:bg-accent-subtle data-[disabled]:opacity-50',
  // The ring too, inside the item, so keyboard focus never rests on a fill alone.
  'data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-focus',
);

/** A hairline above an item, drawn so it isn't a stop. */
const hairlineAbove =
  "relative mt-2 before:pointer-events-none before:absolute before:inset-x-2 before:-top-1 before:border-t before:border-border before:content-['']";

function renderItem(
  items: MenuItem[],
  item: MenuItem,
  afterChoice: boolean,
  onAction: (id: string) => void,
) {
  const index = items.indexOf(item);
  // Destructive items go last, after a hairline; so does the first item after a choice.
  const afterHairline =
    (item.isDanger === true && index > 0 && !items[index - 1]?.isDanger) ||
    (afterChoice && index === 0);
  const sub = item.items;
  const entry = (
    <RACMenuItem
      // A submenu's own item takes its id from the collection, through SubmenuTrigger.
      {...(sub ? {} : { id: item.id })}
      textValue={item.label}
      className={cx(
        menuItemClass,
        item.isDanger ? 'text-danger' : 'text-content',
        item.isCurrent && 'bg-accent-subtle shadow-glow-selected',
        afterHairline && hairlineAbove,
      )}
    >
      {item.icon && (
        <Icon
          {...(typeof item.icon === 'string' ? { name: item.icon } : { node: item.icon })}
          size={18}
          className={cx('mr-2', !item.isDanger && 'text-content-muted')}
        />
      )}
      {item.description ? (
        <span className="flex min-w-0 flex-col py-1">
          <Text slot="label">{item.label}</Text>
          <Text slot="description" className="text-small text-content-muted">
            {item.description}
          </Text>
        </span>
      ) : (
        item.label
      )}
      {/* It points the way the submenu opens; turned once, never animated. */}
      {item.items && <Chevron className="ml-auto -rotate-90 pl-2" />}
    </RACMenuItem>
  );
  if (!sub) return entry;
  return (
    <SubmenuTrigger>
      {entry}
      <Popover offset={-4} className={cx('max-w-sm min-w-56', popoverClass)}>
        <RACMenu
          aria-label={item.label}
          onAction={(key: Key) => {
            onAction(String(key));
          }}
          items={sub}
          disabledKeys={sub.filter((one) => one.isDisabled).map((one) => one.id)}
          className="outline-none"
        >
          {(one) => renderItem(sub, one, false, onAction)}
        </RACMenu>
      </Popover>
    </SubmenuTrigger>
  );
}

type MenuGroup = { id: 'choice'; choice: MenuChoice } | { id: 'items'; items: MenuItem[] };

/** The "…" menu (spec §10.3): everything that isn't the one primary action. */
export function Menu({
  label,
  items,
  onAction,
  triggerText,
  triggerIcon,
  triggerPicture,
  trigger,
  header,
  choice,
  isOpen,
  onOpenChange,
}: MenuProps) {
  const choiceIds = new Set(choice?.options.map((option) => option.id));
  const anchor = useRef<HTMLSpanElement>(null);
  // An action runs once the menu has closed, with focus back on the menu's
  // button, so a dialog it opens gives focus back there when it closes.
  // Run at once, the dialog took the chosen item, gone with the menu, as the
  // place to return to; React Aria puts focus back only a frame later, and
  // the page outside an open menu can't take it.
  const [shown, setShown] = useState(false);
  const chosen = useRef<string | null>(null);
  const act = (id: string) => {
    chosen.current = id;
  };
  useEffect(() => {
    const id = chosen.current;
    if (shown || id === null) return;
    chosen.current = null;
    anchor.current?.querySelector<HTMLElement>('button')?.focus();
    if (choiceIds.has(id)) choice?.onClosed?.();
    else onAction(id);
  });
  const groups: MenuGroup[] = choice
    ? [{ id: 'choice', choice }, ...(items.length > 0 ? [{ id: 'items' as const, items }] : [])]
    : [];
  return (
    <MenuTrigger
      {...(isOpen !== undefined ? { isOpen } : {})}
      onOpenChange={(open) => {
        setShown(open);
        onOpenChange?.(open);
      }}
    >
      <span ref={anchor} className="contents">
        {trigger ??
          (triggerText ? (
            <RACButton
              className={cx(
                'inline-flex min-h-10 min-w-0 items-center gap-1 rounded-md border border-transparent px-3 text-body text-content data-[hovered]:bg-surface-sunken',
                colorTransition,
                focusRing,
              )}
            >
              {triggerPicture ? (
                <span className="mr-1 flex">{triggerPicture}</span>
              ) : (
                triggerIcon && <Icon name={triggerIcon} size={18} />
              )}
              <span className="min-w-0 truncate">{triggerText}</span>
              <Chevron />
            </RACButton>
          ) : (
            <IconButton icon="more" label={label} />
          ))}
      </span>
      {/* A caller's button sits at the start of its row ("Add section"); the "…" at the end. */}
      <Popover
        placement={trigger ? 'bottom start' : 'bottom end'}
        className={cx('min-w-56', popoverClass)}
      >
        {header && (
          <div aria-hidden="true" className="mb-1 border-b border-border px-3 pt-2 pb-3">
            {header}
          </div>
        )}
        {choice ? (
          <RACMenu
            aria-label={label}
            onAction={(key: Key) => {
              // Choosing an option is a selection, made at once; only its `onClosed` waits.
              act(String(key));
            }}
            items={groups}
            disabledKeys={items.filter((item) => item.isDisabled).map((item) => item.id)}
            className="outline-none"
          >
            {(group) =>
              group.id === 'choice' ? (
                <MenuSection
                  id="choice"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[group.choice.selected]}
                  onSelectionChange={(keys) => {
                    if (keys === 'all') return;
                    const [key] = [...keys];
                    if (key !== undefined) group.choice.onChange(String(key));
                  }}
                >
                  <Header className="px-3 pt-1 pb-1 text-small text-content-muted">
                    {group.choice.title}
                  </Header>
                  <Collection items={group.choice.options}>
                    {(option) => (
                      <RACMenuItem
                        id={option.id}
                        textValue={option.label}
                        className={cx(menuItemClass, 'gap-2 text-content')}
                      >
                        {({ isSelected }) => (
                          <>
                            <Icon
                              name="check"
                              size={18}
                              className={cx('text-accent', !isSelected && 'invisible')}
                            />
                            {option.label}
                          </>
                        )}
                      </RACMenuItem>
                    )}
                  </Collection>
                </MenuSection>
              ) : (
                <MenuSection id="items" aria-label={label} items={group.items}>
                  {(item) => renderItem(group.items, item, true, act)}
                </MenuSection>
              )
            }
          </RACMenu>
        ) : (
          <RACMenu
            aria-label={label}
            onAction={(key: Key) => {
              act(String(key));
            }}
            items={items}
            disabledKeys={items.filter((item) => item.isDisabled).map((item) => item.id)}
            className="outline-none"
          >
            {/*
             * Rendered from `items`, not as static children: opened from the
             * keyboard, React Aria then focuses the first item itself.
             */}
            {(item) => renderItem(items, item, false, act)}
          </RACMenu>
        )}
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
