import {
  Input,
  TextArea as RACTextArea,
  TextField as RACTextField,
  type TextFieldProps as RACTextFieldProps,
} from 'react-aria-components';
import { cx, fieldControl, FieldHelp, FieldLabel, type FieldTextProps } from './shared.tsx';

export type TextFieldProps = Omit<RACTextFieldProps, 'className' | 'children'> &
  FieldTextProps & {
    placeholder?: string;
    className?: string;
    inputClassName?: string;
  };

/**
 * A labelled single-line input. Help and error text are linked through
 * aria-describedby, and aria-invalid is set when the field is invalid
 * (spec §6.3.2). The placeholder is never the label.
 */
export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  className,
  inputClassName,
  ...props
}: TextFieldProps) {
  return (
    <RACTextField {...props} className={cx('flex flex-col gap-2', className)}>
      <FieldLabel label={label} isRequired={props.isRequired} />
      <Input placeholder={placeholder} className={cx(fieldControl, inputClassName)} />
      <FieldHelp description={description} errorMessage={errorMessage} />
    </RACTextField>
  );
}

export type TextAreaProps = TextFieldProps & { rows?: number };

export function TextArea({
  label,
  description,
  errorMessage,
  placeholder,
  rows = 4,
  className,
  inputClassName,
  ...props
}: TextAreaProps) {
  return (
    <RACTextField {...props} className={cx('flex flex-col gap-2', className)}>
      <FieldLabel label={label} isRequired={props.isRequired} />
      <RACTextArea
        rows={rows}
        placeholder={placeholder}
        className={cx(fieldControl, 'min-h-24 resize-y', inputClassName)}
      />

      <FieldHelp description={description} errorMessage={errorMessage} />
    </RACTextField>
  );
}
