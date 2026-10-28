import { Combobox, Icon, type Option } from '@vespercms/ui';
import { useMemo } from 'react';
import { useStudio } from '../app/context.tsx';
import type { WidgetProps } from '../types.ts';

/**
 * An icon field (`fields.icon`): a searchable list of the names it offers,
 * each with its icon before it, and the chosen one's icon in the field. The
 * drawings come from the manifest, which holds only the icons the site's
 * fields offer, so the studio carries no icon set of its own. The file
 * stores the name.
 */
export function IconWidget({
  value,
  onChange,
  field,
  id,
  describedBy,
  invalid,
  disabled,
}: WidgetProps<string>) {
  const { manifest } = useStudio();
  const options = useMemo(() => {
    const drawings = manifest.icons ?? {};
    return (field.constraints?.options ?? []).map((option): Option => {
      const node = Object.hasOwn(drawings, option.value) ? drawings[option.value] : undefined;
      // A name Lucide doesn't have is listed by name, in line with the rest.
      return { ...option, prefix: node ? <Icon node={node} /> : <span className="block size-5" /> };
    });
  }, [field, manifest.icons]);
  return (
    <Combobox
      id={id}
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy}
      options={options}
      value={typeof value === 'string' ? value : null}
      onChange={(next) => {
        onChange(next ?? undefined);
      }}
      placeholder="Search icons"
      isRequired={field.required}
      isInvalid={invalid}
      isDisabled={disabled}
    />
  );
}
