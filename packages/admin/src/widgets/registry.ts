import type { FieldKind, FieldModel } from '@vesper/core';
import type { ComponentType } from 'react';
import type { ValuePath } from '../editor/values.ts';
import type { WidgetProps } from '../types.ts';
import {
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
} from './basic.tsx';
import { GeoWidget } from './geo.tsx';
import { GroupWidget, RepeaterWidget } from './group.tsx';
import { FileWidget, ImageWidget } from './image.tsx';
import { ReferencesWidget, ReferenceWidget } from './reference.tsx';
import { LazyMarkdownWidget } from './markdown-lazy.tsx';
import { ColorWidget, DateTimeWidget, SlugWidget, UrlWidget } from './special.tsx';

// Built-ins receive values of every shape; the registry can't be narrower.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BuiltinWidgetProps = WidgetProps<any> & { path: ValuePath };

export type BuiltinWidget = {
  component: ComponentType<BuiltinWidgetProps>;
  /**
   * Renders as a fieldset whose legend is the label (objects, lists, radio
   * groups); `'boxed'` also draws a hairline around it (an image, a map).
   */
  group?: true | 'boxed';
  /** Renders each child (or item) as its own field, so their errors show there. */
  rendersChildren?: true;
  /**
   * At the form's first level it's a section: a hairline above, its own
   * heading, more space (DECISIONS.md, "Top-level groups are sections").
   * Deeper, an object is set off by an indent guide instead of a frame.
   */
  section?: true;
  /** Ids of controls it renders for some of its children, as suffixes of its own id (`alt` → `-alt`). */
  childControls?: Readonly<Record<string, string>>;
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
  group: { component: GroupWidget, group: true, rendersChildren: true, section: true },
  repeater: { component: RepeaterWidget, group: true, rendersChildren: true, section: true },
  raw: { component: RawWidget },
  markdown: { component: LazyMarkdownWidget },
  slug: { component: SlugWidget },
  color: { component: ColorWidget },
  geo: { component: GeoWidget, group: 'boxed' },
  reference: { component: ReferenceWidget },
  references: { component: ReferencesWidget, group: true },
  image: { component: ImageWidget, group: 'boxed', childControls: { alt: '-alt' } },
  file: { component: FileWidget, group: true },
};

const BY_KIND: Partial<Record<FieldKind, string>> = {
  string: 'text',
  number: 'number',
  boolean: 'switch',
  date: 'date',
  enum: 'select',
  object: 'group',
  array: 'repeater',
  reference: 'reference',
  image: 'image',
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
