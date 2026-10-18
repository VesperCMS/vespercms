import { useMemo, useState, type ReactNode } from 'react';
import {
  Button as RACButton,
  CheckboxButton,
  CheckboxField,
  ComboBox as RACComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  RadioButton,
  RadioField,
  RadioGroup as RACRadioGroup,
  Select as RACSelect,
  SelectValue,
  SwitchButton,
  SwitchField,
  Tag,
  TagGroup,
  TagList,
  type CheckboxFieldProps,
  type Key,
  type SwitchFieldProps,
} from 'react-aria-components';
import { Icon } from './Button.tsx';
import {
  cx,
  fieldControl,
  FieldHelp,
  FieldLabel,
  focusRing,
  type FieldTextProps,
} from './shared.tsx';

export type Option = {
  value: string;
  label: string;
  /** Decorative content before the label, such as a colour swatch. Hidden from assistive tech. */
  prefix?: ReactNode;
};

const listBoxItem = cx(
  'cursor-default rounded-sm px-3 py-2 text-base text-content outline-none',
  'data-[focused]:bg-accent-subtle data-[selected]:font-semibold',
);
const popover =
  'min-w-[var(--trigger-width)] rounded-md border border-border bg-surface-raised p-1 shadow-overlay';

type ChoiceProps = FieldTextProps & {
  options: Option[];
  isDisabled?: boolean;
  isInvalid?: boolean;
  className?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  id?: string;
};

export type SelectProps = ChoiceProps & {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
};

export function Select({
  label,
  description,
  errorMessage,
  options,
  value,
  onChange,
  placeholder,
  className,
  ...props
}: SelectProps) {
  return (
    <RACSelect
      {...props}
      value={value}
      onChange={(key) => {
        onChange(key === null ? null : String(key));
      }}
      placeholder={placeholder ?? 'Choose…'}
      className={cx('flex flex-col gap-1', className)}
    >
      <FieldLabel label={label} isRequired={props.isRequired} />
      <RACButton
        className={cx(fieldControl, 'flex items-center justify-between text-left', focusRing)}
      >
        <SelectValue className="truncate data-[placeholder]:text-content-muted" />
        <span aria-hidden="true">▾</span>
      </RACButton>
      <FieldHelp description={description} errorMessage={errorMessage} />
      <Popover className={popover}>
        <ListBox className="outline-none" items={options}>
          {(option) => (
            <ListBoxItem id={option.value} textValue={option.label} className={listBoxItem}>
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </RACSelect>
  );
}

export type ComboboxProps = ChoiceProps & {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
};

/** Search plus single selection (references). Filters as the person types. */
export function Combobox({
  label,
  description,
  errorMessage,
  options,
  value,
  onChange,
  placeholder,
  className,
  ...props
}: ComboboxProps) {
  return (
    <RACComboBox
      {...props}
      defaultItems={options}
      value={value}
      onChange={(key) => {
        onChange(key === null ? null : String(key));
      }}
      menuTrigger="focus"
      className={cx('flex flex-col gap-1', className)}
    >
      <FieldLabel label={label} isRequired={props.isRequired} />
      <div className="relative">
        <Input placeholder={placeholder} className={cx(fieldControl, 'pr-10')} />
        <RACButton
          aria-label="Show options"
          className={cx('absolute inset-y-0 right-0 px-3 text-content-muted', focusRing)}
        >
          <span aria-hidden="true">▾</span>
        </RACButton>
      </div>
      <FieldHelp description={description} errorMessage={errorMessage} />
      <Popover className={popover}>
        <ListBox className="max-h-72 overflow-auto outline-none">
          {(option: Option) => (
            <ListBoxItem id={option.value} textValue={option.label} className={listBoxItem}>
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </RACComboBox>
  );
}

export type MultiComboboxProps = Omit<ChoiceProps, 'options'> & {
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
  /** Tags: anything typed can be added, not only listed options. */
  allowsCustomValue?: boolean;
  /** What to call a selected item in remove-button names, e.g. "tag". */
  itemName?: string;
};

/**
 * Search plus multiple selection (tags, multi references). Chosen items are
 * a tag list, each with a named remove button. Backspace in the empty search
 * removes the last one.
 */
export function MultiCombobox({
  label,
  description,
  errorMessage,
  options,
  values,
  onChange,
  allowsCustomValue = false,
  itemName = 'item',
  className,
  isDisabled,
  isInvalid,
  ...props
}: MultiComboboxProps) {
  const [input, setInput] = useState('');
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const available = options.filter((o) => !values.includes(o.value));
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '' || values.includes(trimmed)) return;
    if (!allowsCustomValue && !byValue.has(trimmed)) return;
    onChange([...values, trimmed]);
    setInput('');
  };
  const labelOf = (value: string) => byValue.get(value)?.label ?? value;

  return (
    <div
      className={cx('flex flex-col gap-1', className)}
      // React Aria owns the input's key handling, so free-text entry and
      // Backspace-to-remove are caught on the way down. An option highlighted
      // in the list (aria-activedescendant) is left for React Aria to choose.
      onKeyDownCapture={(event) => {
        if (!(event.target instanceof HTMLInputElement)) return;
        // The input's live value: state may lag a keystroke behind.
        const typed = event.target.value;
        if (
          event.key === 'Enter' &&
          allowsCustomValue &&
          typed.trim() !== '' &&
          !event.target.getAttribute('aria-activedescendant')
        ) {
          event.preventDefault();
          event.stopPropagation();
          add(typed);
        }
        if (event.key === 'Backspace' && typed === '' && values.length > 0) {
          onChange(values.slice(0, -1));
        }
      }}
    >
      <RACComboBox
        {...props}
        items={available.filter((o) => o.label.toLowerCase().includes(input.toLowerCase()))}
        inputValue={input}
        onInputChange={setInput}
        value={null}
        onChange={(key: Key | null) => {
          if (key !== null) add(String(key));
        }}
        allowsCustomValue={allowsCustomValue}
        isDisabled={isDisabled}
        isInvalid={isInvalid}
        menuTrigger="focus"
        className="flex flex-col gap-1"
      >
        <FieldLabel label={label} isRequired={props.isRequired} />
        <Input className={fieldControl} />
        <FieldHelp description={description} errorMessage={errorMessage} />
        <Popover className={popover}>
          <ListBox
            className="max-h-72 overflow-auto outline-none"
            renderEmptyState={() => (
              <p className="px-3 py-2 text-content-muted">
                {allowsCustomValue ? 'Press Enter to add it' : 'No matches'}
              </p>
            )}
          >
            {(option: Option) => (
              <ListBoxItem id={option.value} textValue={option.label} className={listBoxItem}>
                {option.label}
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </RACComboBox>
      {values.length > 0 && (
        <TagGroup
          aria-label={typeof label === 'string' ? `Selected ${label.toLowerCase()}` : 'Selected'}
          onRemove={(keys) => {
            onChange(values.filter((v) => !keys.has(v)));
          }}
        >
          <TagList className="flex flex-wrap gap-2">
            {values.map((value) => (
              <Tag
                key={value}
                id={value}
                textValue={labelOf(value)}
                className={cx(
                  'inline-flex items-center gap-1 rounded-md border border-border bg-surface-sunken py-1 pl-2 pr-1 text-sm',
                  focusRing,
                )}
              >
                {labelOf(value)}
                {/* React Aria appends the tag's own text: "Remove tag harbor". */}
                <RACButton
                  slot="remove"
                  aria-label={`Remove ${itemName}`}
                  className={cx('rounded-sm text-content-muted', focusRing)}
                >
                  <Icon name="close" />
                </RACButton>
              </Tag>
            ))}
          </TagList>
        </TagGroup>
      )}
    </div>
  );
}

export type CheckboxProps = Omit<CheckboxFieldProps, 'className' | 'children'> & {
  children: ReactNode;
  className?: string;
};

export function Checkbox({ children, className, ...props }: CheckboxProps) {
  return (
    <CheckboxField {...props} className={className}>
      <CheckboxButton className="group inline-flex items-center gap-2 text-base text-content">
        <span
          aria-hidden="true"
          className={cx(
            'flex size-5 items-center justify-center rounded-sm border border-border-strong bg-surface',
            'group-data-[selected]:border-accent group-data-[selected]:bg-accent group-data-[selected]:text-on-accent',
            'group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-focus',
          )}
        >
          <svg
            viewBox="0 0 16 16"
            className="hidden size-4 group-data-[selected]:block"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 8l3 3 7-7" />
          </svg>
        </span>
        {children}
      </CheckboxButton>
    </CheckboxField>
  );
}

export type SwitchProps = Omit<SwitchFieldProps, 'className' | 'children'> & {
  children: ReactNode;
  className?: string;
};

/** On/off with the state also in words, so it never relies on colour or position alone. */
export function Switch({ children, className, ...props }: SwitchProps) {
  return (
    <SwitchField {...props} className={className}>
      <SwitchButton className="group inline-flex items-center gap-3 text-base text-content">
        <span
          aria-hidden="true"
          className={cx(
            'flex h-6 w-10 items-center rounded-full border border-border-strong bg-surface-sunken p-0.5',
            'group-data-[selected]:border-accent group-data-[selected]:bg-accent',
            'group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-focus',
          )}
        >
          <span className="size-4 rounded-full bg-border-strong transition-transform group-data-[selected]:translate-x-4 group-data-[selected]:bg-on-accent" />
        </span>
        {children}
        <span aria-hidden="true" className="text-sm text-content-muted">
          <span className="group-data-[selected]:hidden">Off</span>
          <span className="hidden group-data-[selected]:inline">On</span>
        </span>
      </SwitchButton>
    </SwitchField>
  );
}

export type RadioGroupProps = ChoiceProps & {
  value: string | null;
  onChange: (value: string) => void;
  orientation?: 'horizontal' | 'vertical';
};

export function RadioGroup({
  label,
  description,
  errorMessage,
  options,
  value,
  onChange,
  className,
  orientation = 'vertical',
  ...props
}: RadioGroupProps) {
  return (
    <RACRadioGroup
      {...props}
      value={value}
      onChange={onChange}
      orientation={orientation}
      className={cx('flex flex-col gap-2', className)}
    >
      {label && (
        <Label className="text-sm font-semibold text-content">
          {label}
          {props.isRequired && (
            <>
              {' '}
              <span className="font-normal text-content-muted">(required)</span>
            </>
          )}
        </Label>
      )}
      <div
        className={cx(
          'flex gap-x-6 gap-y-2',
          orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap',
        )}
      >
        {options.map((option) => (
          <RadioField key={option.value} value={option.value}>
            <RadioButton className="group inline-flex items-center gap-2 text-base text-content">
              <span
                aria-hidden="true"
                className={cx(
                  'flex size-5 items-center justify-center rounded-full border border-border-strong bg-surface',
                  'group-data-[selected]:border-accent',
                  'group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-focus',
                )}
              >
                <span className="hidden size-2.5 rounded-full bg-accent group-data-[selected]:block" />
              </span>
              {option.prefix && <span aria-hidden="true">{option.prefix}</span>}
              {option.label}
            </RadioButton>
          </RadioField>
        ))}
      </div>
      <FieldHelp description={description} errorMessage={errorMessage} />
    </RACRadioGroup>
  );
}

export type Suggestion = {
  /** What choosing it puts in the field (a page's address). */
  value: string;
  /** What it's listed and found by (the page's title). */
  label: string;
  /** A second, muted line (the address itself). */
  detail?: string;
};

export type SuggestFieldProps = FieldTextProps & {
  value: string;
  onChange: (value: string) => void;
  suggestions: Suggestion[];
  placeholder?: string;
  isInvalid?: boolean;
  isDisabled?: boolean;
  className?: string;
  id?: string;
  'aria-describedby'?: string;
  inputMode?: 'url' | 'text';
};

/**
 * A text field that suggests values as you type (React Aria's ComboBox with
 * custom values): the link picker (spec §6.15.6). Typing anything is fine;
 * choosing a suggestion puts its value in the field.
 */
export function SuggestField({
  label,
  description,
  errorMessage,
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  inputMode = 'text',
  ...props
}: SuggestFieldProps) {
  const needle = value.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (needle === ''
        ? suggestions
        : suggestions.filter(
            (s) => s.label.toLowerCase().includes(needle) || s.value.toLowerCase().includes(needle),
          )
      ).slice(0, 50),
    [needle, suggestions],
  );
  return (
    <RACComboBox
      {...props}
      allowsCustomValue
      allowsEmptyCollection
      items={shown}
      inputValue={value}
      onInputChange={onChange}
      menuTrigger="input"
      className={cx('flex flex-col gap-1', className)}
    >
      <FieldLabel label={label} isRequired={false} />
      <Input placeholder={placeholder} inputMode={inputMode} className={fieldControl} />
      <FieldHelp description={description} errorMessage={errorMessage} />
      <Popover className={popover}>
        <ListBox className="max-h-72 overflow-auto outline-none">
          {(item: Suggestion) => (
            <ListBoxItem id={item.value} textValue={item.value} className={listBoxItem}>
              <span className="block">{item.label}</span>
              {item.detail && (
                <span className="block text-sm text-content-muted">{item.detail}</span>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </RACComboBox>
  );
}
