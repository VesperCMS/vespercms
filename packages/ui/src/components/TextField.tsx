import {
  Input,
  TextArea as RACTextArea,
  TextField as RACTextField,
  type TextFieldProps as RACTextFieldProps,
} from 'react-aria-components';
import { Icon, type IconName } from './Icon.tsx';
import { cx, fieldControl, FieldHelp, FieldLabel, type FieldTextProps } from './shared.tsx';

export type TextFieldProps = Omit<RACTextFieldProps, 'className' | 'children'> &
  FieldTextProps & {
    placeholder?: string;
    className?: string;
    inputClassName?: string;
    /** An icon inside the field, before the text: a search field's magnifier. */
    icon?: IconName;
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
  icon,
  ...props
}: TextFieldProps) {
  const input = (
    <Input
      placeholder={placeholder}
      className={cx(fieldControl, icon && 'pl-10', inputClassName)}
    />
  );
  return (
    <RACTextField {...props} className={cx('flex flex-col gap-2', className)}>
      <FieldLabel label={label} isRequired={props.isRequired} />
      {icon ? (
        <div className="relative">
          <Icon
            name={icon}
            size={18}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-content-muted"
          />
          {input}
        </div>
      ) : (
        input
      )}
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
