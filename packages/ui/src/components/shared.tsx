import type { ReactNode } from 'react';
import { FieldError, Label, Text } from 'react-aria-components';

/** Joins class names, skipping empty ones. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** One focus style everywhere: a 2px ring in the focus token, offset from the control (spec §10.2). */
export const focusRing =
  'outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus';

/** The shared look of a single-line input or a select trigger: a hairline, a sunken fill. */
export const fieldControl = cx(
  'w-full rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-base text-content',
  'outline-none data-[focused]:outline-2 data-[focused]:outline-offset-2 data-[focused]:outline-focus',
  'data-[invalid]:border-danger data-[disabled]:opacity-60',
);

export type FieldTextProps = {
  /** Visible label. Required unless the control is labelled from outside (aria-labelledby). */
  label?: ReactNode;
  /** Help text, linked to the control with aria-describedby. */
  description?: ReactNode;
  /** Error text, shown when the field is invalid and linked with aria-describedby. */
  errorMessage?: ReactNode;
  /** States "(required)" in the label's text; an asterisk alone isn't enough (spec §6.13). */
  isRequired?: boolean;
};

/** Label, help and error for a React Aria field. The label always says "(required)" in words. */
export function FieldLabel({ label, isRequired }: Pick<FieldTextProps, 'label' | 'isRequired'>) {
  if (!label) return null;
  return (
    <Label className="block text-sm font-semibold text-content">
      {label}
      {isRequired && (
        <>
          {' '}
          <span className="font-normal text-content-muted">(required)</span>
        </>
      )}
    </Label>
  );
}

export function FieldHelp({
  description,
  errorMessage,
}: Pick<FieldTextProps, 'description' | 'errorMessage'>) {
  return (
    <>
      {description && (
        <Text slot="description" className="block text-sm text-content-muted">
          {description}
        </Text>
      )}
      <FieldError className="block text-sm text-danger">{errorMessage}</FieldError>
    </>
  );
}
