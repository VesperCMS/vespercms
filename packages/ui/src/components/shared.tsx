import type { ReactNode } from 'react';
import { FieldError, Label, Text } from 'react-aria-components';

/** Joins class names, skipping empty ones. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * The focus halo (glow-focus): a soft ring outside the solid focus outline,
 * never in its place. It's Tailwind's ring, so it adds to any shadow the
 * element already has, and forced colours drop it while keeping the outline.
 */
export const focusHalo =
  'data-[focus-visible]:ring-6 data-[focus-visible]:ring-(color:--glow-focus)';

/** One focus style everywhere: a 2px ring in the focus token, offset from the control (spec §10.2), with its halo. */
export const focusRing = cx(
  'outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus',
  focusHalo,
);

/**
 * Hover colours ease in over 120ms; reduced motion removes it (tokens.css).
 * Never the focus ring's colour, nor anything that changes as focus moves:
 * when a screen reader (or code) clicks, React Aria waits for every running
 * transition to end before it moves focus, so a transition there leaves focus
 * on the page in the meantime (DECISIONS.md, "Transitions never touch focus").
 */
export const colorTransition =
  'transition-[color,background-color,border-color] duration-120 ease-out';

/** The shared look of a single-line input or a select trigger: a hairline, a sunken fill. */
export const fieldControl = cx(
  'min-h-10 w-full rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-body text-content',
  'outline-none data-[focused]:outline-2 data-[focused]:outline-solid data-[focused]:outline-offset-2 data-[focused]:outline-focus',
  'data-[focused]:ring-6 data-[focused]:ring-(color:--glow-focus)',
  'data-[invalid]:border-danger data-[disabled]:opacity-60',
);

export type FieldTextProps = {
  /** Visible label. Required unless the control is labelled from outside (aria-labelledby). */
  label?: ReactNode;
  /** Help text, linked to the control with aria-describedby. */
  description?: ReactNode;
  /** Error text, shown when the field is invalid and linked with aria-describedby. */
  errorMessage?: ReactNode;
  /**
   * The control is marked required for assistive technology. The label says
   * nothing: studio labels mark what's optional instead (DECISIONS.md, "The
   * studio marks what's optional").
   */
  isRequired?: boolean;
};

/** Label, help and error for a React Aria field. `isOptional` says "(optional)" in words. */
export function FieldLabel({ label, isOptional }: { label?: ReactNode; isOptional?: boolean }) {
  if (!label) return null;
  return (
    <Label className="block text-label text-content">
      {label}
      {isOptional && <OptionalMark />}
    </Label>
  );
}

/** " (optional)" after a label, in the label's own text. */
export function OptionalMark() {
  return (
    <>
      {' '}
      <span className="font-normal text-content-muted">(optional)</span>
    </>
  );
}

export function FieldHelp({
  description,
  errorMessage,
}: Pick<FieldTextProps, 'description' | 'errorMessage'>) {
  return (
    <>
      {description && (
        <Text slot="description" className="block text-small text-content-muted">
          {description}
        </Text>
      )}
      <FieldError className="block text-small text-danger">{errorMessage}</FieldError>
    </>
  );
}
