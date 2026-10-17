import type { FieldKind, FieldModel } from '@vesper/core';
import type { ComponentType } from 'react';
import type { ValuePath } from '../editor/values.ts';
import type { WidgetProps } from '../types.ts';
import {
  DateTimeWidget,
  DateWidget,
  EmailWidget,
  NumberWidget,
  RadioWidget,
  RawWidget,
  SelectWidget,
  SwitchWidget,
  TagsWidget,
  TextAreaWidget,
  TextWidget,
  UrlWidget,
} from './basic.tsx';
import { GroupWidget, RepeaterWidget } from './group.tsx';

// Built-ins receive values of every shape; the registry can't be narrower.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BuiltinWidgetProps = WidgetProps<any> & { path: ValuePath };

export type BuiltinWidget = {
  component: ComponentType<BuiltinWidgetProps>;
  /**
   * Renders as a fieldset whose legend is the label (objects, lists, radio
   * groups); `'boxed'` also draws a hairline around it.
   */
  group?: true | 'boxed';
};

const BUILTIN: Record<string, BuiltinWidget> = {
  text: { component: TextWidget },
  textarea: { component: TextAreaWidget },
  email: { component: EmailWidget },
  url: { component: UrlWidget },
  number: { component: NumberWidget },
  switch: { component: SwitchWidget },
  date: { component: DateWidget },
  datetime: { component: DateTimeWidget },
  select: { component: SelectWidget },
  radio: { component: RadioWidget, group: true },
  tags: { component: TagsWidget },
  multiselect: { component: TagsWidget },
  group: { component: GroupWidget, group: 'boxed' },
  repeater: { component: RepeaterWidget, group: true },
  raw: { component: RawWidget },
  // Stand-ins until their dedicated controls land (Phase 2, later steps).
  markdown: { component: TextAreaWidget },
  slug: { component: TextWidget },
  color: { component: TextWidget },
  file: { component: TextWidget },
};

const BY_KIND: Partial<Record<FieldKind, string>> = {
  string: 'text',
  number: 'number',
  boolean: 'switch',
  date: 'date',
  enum: 'select',
  object: 'group',
  array: 'repeater',
  // A reference is an entry ID until the reference picker lands.
  reference: 'text',
  image: 'text',
};

/**
 * The built-in control for a field: its resolved widget, else the one its
 * type implies (spec §6.3 step 3), else the raw YAML field (step 4).
 */
export function builtinWidget(field: FieldModel): BuiltinWidget {
  for (const name of [field.widget, field.inferredWidget, BY_KIND[field.kind]]) {
    const widget = name ? BUILTIN[name] : undefined;
    if (widget) return widget;
  }
  return BUILTIN.raw as BuiltinWidget;
}
