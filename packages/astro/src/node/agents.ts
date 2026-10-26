import {
  fieldChildren,
  type CollectionManifest,
  type FieldModel,
  type Manifest,
  type MarkdocAttributeManifest,
  type MarkdocTagManifest,
} from '@vesper/core';

/*
 * Instructions for coding agents, generated from the manifest: the rules that
 * keep the studio, the build and people's history intact, then this site's
 * own collections, fields, URLs and Markdoc tags. The same manifest builds
 * the studio, so the agent and the editor see one schema.
 *
 * The guide goes between markers in the site's AGENTS.md (Codex, Cursor,
 * Copilot and others read that file; Claude Code reads it through an
 * `@AGENTS.md` line in CLAUDE.md), so the rest of the file stays the site
 * owner's. It's deterministic, so `vesper agents --check` can fail CI when
 * the schema has moved on.
 */

export const AGENTS_START = '<!-- vesper:agents:start -->';
export const AGENTS_END = '<!-- vesper:agents:end -->';

const FORMAT_NAMES: Record<string, string> = {
  md: 'Markdown',
  mdx: 'MDX',
  mdoc: 'Markdoc',
  markdown: 'Markdown',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
};

const NODE_NAMES: Record<string, string> = {
  paragraph: 'paragraphs',
  list: 'lists',
  item: 'list items',
  fence: 'code blocks',
  heading: 'headings',
  table: 'tables',
  image: 'images',
  blockquote: 'quotes',
  tag: 'tags',
  inline: 'text',
};

const READ_ONLY: Record<NonNullable<CollectionManifest['readOnlyReason']>, string> = {
  'custom-loader':
    'it uses a loader other than glob() or file(), so Vesper doesn’t know where its entries live',
  'unsupported-format': 'Vesper can’t write its format without changing the file',
  'config-error': 'its config couldn’t be read when this was generated',
};

/** The guide for one site, as Markdown, without the markers. */
export function agentGuide(manifest: Manifest): string {
  const config = manifest.site.contentConfig ?? `${manifest.site.srcDir}/content.config.ts`;
  const collections = manifest.collections;
  const formats = new Set(
    collections.flatMap((c) => (c.source.loader === 'glob' ? c.source.formats : [])),
  );
  const imageFields = collections.some((c) => (c.fields ?? []).some(hasImage));
  const trees = collections.filter((c) => c.presentation.tree);
  const routed = collections.some((c) => c.presentation.url !== undefined);
  const tags = formats.has('mdoc') ? (manifest.markdoc?.tags ?? []) : [];
  const components = formats.has('mdx') ? (manifest.mdx?.components ?? []) : [];

  const out: string[] = [
    '## Content and the Vesper studio',
    '',
    `People edit this site’s content in the Vesper studio at \`/admin\`, and every save is a change to a file in this repository. You can edit the same files. These rules keep the studio, the build and people’s history intact.`,
    '',
    '### Rules',
    '',
    `- **The schema is \`${config}\`.** The studio is built from it; there is no second schema. To add or change a field, edit the Zod schema there, with \`z\` imported from \`astro/zod\`, never \`zod\`. \`vesper.config.ts\` holds only presentation: labels, URLs, icons and widgets.`,
    '- **Change only what you mean to change.** Edit a value in place. Don’t reformat frontmatter or data files, reorder keys, change quoting or indentation, or run a formatter over content: the studio keeps every byte it didn’t edit, and people review content changes as diffs.',
    '- **Write values as the file stores them, not as Zod parses them.** Leave out fields you aren’t setting, even ones with defaults, and keep dates in the form the file already uses.',
    '- **Check your work with `npx astro build`.** It validates every entry against its schema and fails on a body that doesn’t parse. Afterwards `.vesper/a11y-report.json`, when present, lists accessibility issues on the built pages, with the entry each came from.',
  ];

  const blocking = manifest.site.a11y?.blockPublishOn ?? [];
  if (blocking.length > 0) {
    out.push(
      `- **The studio refuses to save an entry with these accessibility issues:** ${blocking.map(code).join(', ')}. Don’t leave them in content you write either.`,
    );
  }

  if (imageFields) {
    const ratios = Object.entries(manifest.site.images?.ratios ?? {});
    out.push(
      '',
      '### Images',
      '',
      'An image field stores an object: `{ src, alt, decorative?, focus?, crops? }`.',
      '',
      '- `src` is the image file’s path relative to the entry’s file, as Astro’s `image()` expects. Put new images beside the collection’s existing ones, or in `src/assets/<collection>/`.',
      '- `alt` is required. Say what the image shows that the text around it doesn’t. For a purely decorative image, write `alt: ""` and `decorative: true`.',
      '- `focus: { x, y }` is the focal point, and `crops: { <ratio>: { x, y, w, h } }` holds crops for named ratios. Every number is from 0 to 1, measured from the top left. Editors set both in the studio; leave them as they are unless asked.',
      '- Never edit the image file to crop or resize it. Crops are cut at build, and the original stays as uploaded.',
    );
    if (ratios.length > 0) {
      out.push(
        `- This site’s ratios (width ÷ height): ${ratios.map(([name, value]) => `${code(name)} ${formatNumber(value)}`).join(', ')}.`,
      );
    }
  }

  if (trees.length > 0) {
    out.push(
      '',
      '### Page trees',
      '',
      `In ${trees.map((c) => code(c.name)).join(' and ')}, the folder is the hierarchy:`,
      '',
      '- `folder/index.md` is the folder’s own page (any of the collection’s formats), and a top-level `index` file is the root page.',
      '- An optional `_order.yaml` in each folder lists its pages’ slugs (file or folder names, without extensions) in menu order. Pages it doesn’t list follow, by title. When you add a page, add its slug where it belongs.',
      '- Moving or renaming a page changes its URL and the URLs of every page under it. Prefer the studio’s Move: it moves the files, updates both `_order.yaml` files, adds a redirect for every old URL and rewrites internal links, as one change. By hand, do all four.',
    );
    for (const tree of trees) {
      if (tree.presentation.maxDepth !== undefined) {
        out.push(
          `- ${code(tree.name)} pages go at most ${String(tree.presentation.maxDepth)} levels deep: a top-level page is level 1, a page in its folder level 2.`,
        );
      }
    }
  }

  if (routed) {
    out.push(
      '',
      '### Redirects',
      '',
      '`vesper.redirects.yaml`, beside `astro.config` (create it when there’s none), lists old addresses and where they went:',
      '',
      '```yaml',
      '- { from: /old-page, to: /new-page, status: 301, reason: manual, at: 2026-01-31 }',
      '```',
      '',
      'Add one whenever a published page’s URL changes. `from` and `to` are paths on the site without a trailing slash; `to` may also be a full URL elsewhere. Every build collapses chains and drops a redirect whose old address is a page again.',
    );
  }

  if (tags.length > 0) {
    out.push(
      '',
      '### Markdoc tags',
      '',
      `Markdoc bodies (\`.mdoc\`) may use these tags from \`markdoc.config.mjs\`. The build fails on an unknown tag or a missing required attribute, and the studio refuses to save one.`,
      '',
    );
    for (const tag of tags) out.push(...markdocTag(tag));
    const extras = markdocExtras(manifest);
    if (extras) out.push('', extras);
  }

  if (components.length > 0) {
    out.push(
      '',
      '### MDX components',
      '',
      'MDX bodies may use these components, which the studio edits as blocks and checks against their props. Anything else in an MDX body (other components, imports, expressions) the studio keeps as source.',
      '',
    );
    for (const component of components) {
      const shape = component.children
        ? `\`<${component.name}>…</${component.name}>\``
        : `\`<${component.name} />\``;
      const where = component.inline
        ? 'inline, inside a line of text'
        : component.children
          ? 'a block with content inside'
          : 'a block';
      out.push(`- ${shape} (${component.label}): ${where}.${sentence(component.description)}`);
      for (const field of component.fields ?? []) out.push(...fieldLines(field, '  '));
    }
  }

  out.push('', '### Collections', '');
  if (routed) {
    out.push(
      'In URL patterns, `:id` is the entry’s ID (its path without the extension), `:path` is the ID without a trailing `/index`, `:slug` is its slug, and `:field` is that field’s value.',
      '',
    );
  }
  for (const collection of collections) out.push(...collectionLines(collection));

  return `${out.join('\n').trimEnd()}\n`;
}

/**
 * The file with the guide between Vesper's markers: replaced in place when
 * the markers are there, added at the end otherwise. Keeps the file's line
 * endings.
 */
export function withAgentGuide(existing: string | null, guide: string): string {
  const notice =
    '<!-- Written by `vesper agents` from this site’s content config. Run it again after changing the schema or vesper.config.ts; anything between these markers is replaced. -->';
  const block = `${AGENTS_START}\n${notice}\n\n${guide.trim()}\n${AGENTS_END}\n`;
  if (!existing) return block;
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const text = eol === '\n' ? block : block.replace(/\n/g, '\r\n');
  const start = existing.indexOf(AGENTS_START);
  const end = start === -1 ? -1 : existing.indexOf(AGENTS_END, start);
  if (start !== -1 && end !== -1) {
    let after = end + AGENTS_END.length;
    if (existing.startsWith(eol, after)) after += eol.length;
    return existing.slice(0, start) + text + existing.slice(after);
  }
  return `${existing.trimEnd()}${eol}${eol}${text}`;
}

function collectionLines(collection: CollectionManifest): string[] {
  const { source, presentation } = collection;
  const lines = [`#### ${collection.label} (${code(collection.name)})`, ''];

  const about: string[] = [];
  if (source.loader === 'glob') {
    const names = [...new Set(source.formats.map((f) => FORMAT_NAMES[f] ?? f))];
    const patterns = (Array.isArray(source.pattern) ? source.pattern : [source.pattern]).map(code);
    const where = `in \`${source.base}/\`, matching ${patterns.join(' or ')}`;
    about.push(
      presentation.singleton
        ? `One entry: a single ${names.join(' or ')} file ${where}.`
        : `${source.formats.map((f) => `${FORMAT_NAMES[f] ?? f} (\`.${f}\`)`).join(' or ') || 'Files'} files ${where}.`,
      collection.entryKind === 'content'
        ? 'Fields go in the frontmatter; the rest of the file is the body.'
        : 'Fields are the file’s top-level keys.',
    );
    if (source.generateId === 'custom') {
      about.push('The site computes entry IDs itself (a custom `generateId`).');
    }
  } else if (source.loader === 'file') {
    about.push(
      `Entries are the items in \`${source.path}\`. Keep the file’s shape: each entry’s ID is its \`id\`, or its key in an object.`,
    );
  } else {
    about.push(`Entries come from ${source.name ? code(source.name) : 'a custom loader'}.`);
  }

  if (!collection.editable) {
    const why = collection.readOnlyReason
      ? READ_ONLY[collection.readOnlyReason]
      : 'Vesper can’t edit it';
    about.push(`The studio shows this collection read only: ${why}.`);
  }

  const url = presentation.url;
  if (typeof url === 'string') {
    about.push(`URL: \`${url}\`${presentation.tree ? ', as a page tree (see Page trees)' : ''}.`);
  } else if (url) {
    about.push('URL: computed by a function in `vesper.config.ts`.');
  }
  if (presentation.search === false) about.push('Left out of site search.');

  lines.push(about.join(' '), '');
  if (collection.fields === null) {
    lines.push(
      'The studio couldn’t read this schema field by field, so it edits each entry’s fields as YAML. Follow the schema in the content config.',
    );
  } else if (collection.fields.length === 0) {
    lines.push('No fields.');
  } else {
    for (const field of collection.fields) lines.push(...fieldLines(field, ''));
  }
  lines.push('');
  return lines;
}

function fieldLines(field: FieldModel, indent: string): string[] {
  const key = field.path.at(-1) ?? '';
  const name = code(key);
  const label = humanEqual(field.label, key) ? '' : ` (${field.label})`;
  const parts = [`${describe(field)}.`];
  const presence = presenceOf(field);
  if (presence) parts.push(presence);
  if (field.readOnly) parts.push('Read only in the studio: leave it as it is.');
  else if (field.hidden) parts.push('Hidden in the studio.');
  const description = clean(field.description);
  if (description) parts.push(description.endsWith('.') ? description : `${description}.`);
  else if (field.search === 'hide') parts.push('`true` keeps the entry out of site search.');
  const lines = [`${indent}- ${name}${label}: ${parts.join(' ')}`];

  if (isImage(field) || field.widget === 'geo') return lines;
  if (field.kind === 'object') {
    for (const child of field.children ?? []) lines.push(...fieldLines(child, `${indent}  `));
  } else if (field.kind === 'union') {
    lines.push(...kindLines(field, `${indent}  `));
  } else if (field.kind === 'array') {
    const item = field.children?.[0];
    if (item?.kind === 'object' && !isImage(item) && item.widget !== 'geo') {
      for (const child of item.children ?? []) lines.push(...fieldLines(child, `${indent}  `));
    } else if (item?.kind === 'union') {
      lines.push(...kindLines(item, `${indent}  `));
    }
  }
  return lines;
}

/** A union's kinds: each one's discriminator value, its name and help, then its own fields. */
function kindLines(field: FieldModel, indent: string): string[] {
  const key = field.discriminator ?? '';
  return (field.variants ?? []).flatMap((variant) => {
    const label = humanEqual(variant.label, variant.value) ? '' : ` (${variant.label})`;
    const about = clean(variant.description);
    const text = about
      ? about.endsWith('.')
        ? about
        : `${about}.`
      : variant.children.length === 0
        ? 'No other fields.'
        : 'Its fields:';
    return [
      `${indent}- ${code(`${key}: ${variant.value}`)}${label}: ${text}`,
      ...variant.children.flatMap((child) => fieldLines(child, `${indent}  `)),
    ];
  });
}

function describe(field: FieldModel): string {
  if (isImage(field)) {
    const ratios = field.widgetOptions?.ratios;
    return Array.isArray(ratios) && ratios.length > 0
      ? `an image (see Images), with crops for ${ratios.map((r) => code(String(r))).join(', ')}`
      : 'an image (see Images)';
  }
  if (field.widget === 'geo') return 'a map location, `{ lat, lng }`';
  const c = field.constraints ?? {};
  switch (field.kind) {
    case 'string': {
      if (field.widget === 'color') return 'a hex colour such as `#1a73e8`';
      if (field.widget === 'slug') return 'a slug: lowercase letters, numbers and hyphens';
      if (field.widget === 'markdown') {
        return field.widgetOptions?.inline === true
          ? 'Markdown on one line (bold, italic, code and links)'
          : 'Markdown (paragraphs, lists, bold, italic, code and links)';
      }
      if (field.widget === 'file') return 'a path to a file';
      if (field.format === 'email') return 'an email address';
      if (field.format === 'url') return 'a full URL';
      let text = 'text';
      if (c.min === 1 && c.max === undefined) text += ', not empty';
      else text += range(c.min, c.max, 'characters');
      if (c.pattern) text += ` matching \`/${c.pattern}/${c.patternFlags ?? ''}\``;
      return text;
    }
    case 'number': {
      const kind = c.integer ? 'a whole number' : 'a number';
      if (c.min !== undefined && c.max !== undefined)
        return `${kind} from ${String(c.min)} to ${String(c.max)}`;
      if (c.min !== undefined)
        return `${kind}, ${c.minInclusive === false ? 'more than' : 'at least'} ${String(c.min)}`;
      if (c.max !== undefined)
        return `${kind}, ${c.maxInclusive === false ? 'less than' : 'at most'} ${String(c.max)}`;
      return kind;
    }
    case 'boolean':
      return '`true` or `false`';
    case 'date':
      return field.widget === 'datetime'
        ? 'a date and time, ISO 8601 with an offset, such as `2026-01-31T09:30:00-05:00`'
        : 'a date, such as `2026-01-31`';
    case 'enum': {
      const options = c.options ?? [];
      return `one of ${options
        .map((o) =>
          humanEqual(o.label, o.value) ? code(o.value) : `${code(o.value)} (${o.label})`,
        )
        .join(', ')}`;
    }
    case 'reference':
      return field.reference
        ? `the ID of an entry in ${code(field.reference.collection)}`
        : 'an entry ID';
    case 'array': {
      const item = field.children?.[0];
      const count = range(c.min, c.max, 'items').replace(/^ of (.*)$/, ' ($1)');
      if (!item) return `a list${count}`;
      if (item.kind === 'object' && !isImage(item) && item.widget !== 'geo') {
        return `a list of objects${count} with the fields below`;
      }
      if (item.kind === 'union') {
        return `a list${count} of objects of the kinds below, each named by its ${code(item.discriminator ?? '')}`;
      }
      return `a list of ${items(item)}${count}`;
    }
    case 'object':
      return 'an object with the fields below';
    case 'union':
      return `an object of one of the kinds below, named by its ${code(field.discriminator ?? '')}`;
    case 'image':
      return 'an image path, relative to the entry’s file';
    case 'unknown':
      return `any value the schema accepts${field.unknownReason ? ` (a Zod ${field.unknownReason})` : ''}; the studio edits it as raw YAML`;
  }
}

function presenceOf(field: FieldModel): string {
  const notes: string[] = [];
  if (field.default !== undefined) notes.push(`Default \`${JSON.stringify(field.default)}\`.`);
  else if (field.required && !field.defaultDynamic) notes.push('Required.');
  else if (!field.defaultDynamic) notes.push('Optional.');
  if (field.nullable) notes.push('May be `null`.');
  return notes.join(' ');
}

function markdocTag(tag: MarkdocTagManifest): string[] {
  const shape = tag.selfClosing
    ? `\`{% ${tag.name} /%}\``
    : `\`{% ${tag.name} %}…{% /${tag.name} %}\``;
  const kind = tag.selfClosing
    ? 'self-closing'
    : tag.inline === true
      ? 'inline, inside a line of text'
      : tag.children
        ? `a block holding ${tag.children.map((c) => NODE_NAMES[c] ?? c).join(', ')}`
        : 'a block';
  const lines = [`- ${shape} (${tag.label}): ${kind}.${sentence(tag.description)}`];
  const hints = new Map(tag.fields.map((f) => [f.path.at(-1), f]));
  for (const attribute of tag.attributes) {
    lines.push(`  - ${attributeLine(attribute, hints.get(attribute.name))}`);
  }
  return lines;
}

function attributeLine(attribute: MarkdocAttributeManifest, hint: FieldModel | undefined): string {
  const name = code(attribute.name);
  const matches = attribute.matches;
  let what: string;
  if (matches && 'values' in matches) {
    const labels = new Map(hint?.constraints?.options?.map((o) => [o.value, o.label]));
    what = `one of ${matches.values
      .map((v) => {
        const label = typeof v === 'string' ? labels.get(v) : undefined;
        return label && !humanEqual(label, String(v))
          ? `${code(String(v))} (${label})`
          : code(String(v));
      })
      .join(', ')}`;
  } else if (matches && 'pattern' in matches) {
    what = `text matching \`/${matches.pattern}/${matches.flags}\``;
  } else if (attribute.customType) {
    what = `a ${attribute.customType} value`;
  } else if (attribute.types.length > 0) {
    what = attribute.types
      .map(
        (t) =>
          ({
            String: 'text',
            Number: 'a number',
            Boolean: '`true` or `false`',
            Array: 'a list',
            Object: 'an object',
          })[t] ?? t,
      )
      .join(' or ');
  } else {
    what = 'any value';
  }
  const presence = attribute.required
    ? 'Required.'
    : attribute.default !== undefined
      ? `Default \`${JSON.stringify(attribute.default)}\`.`
      : 'Optional.';
  const label = hint && !humanEqual(hint.label, attribute.name) ? ` (${hint.label})` : '';
  const description = clean(hint?.description ?? attribute.description);
  return `${name}${label}: ${what}. ${presence}${description ? ` ${description.endsWith('.') ? description : `${description}.`}` : ''}`;
}

function markdocExtras(manifest: Manifest): string | null {
  const markdoc = manifest.markdoc;
  if (!markdoc) return null;
  const notes: string[] = [];
  const variables = leafPaths(markdoc.variables);
  if (variables.length > 0)
    notes.push(`variables ${variables.map((v) => code(`$${v}`)).join(', ')}`);
  if (markdoc.functions.length > 0)
    notes.push(`functions ${markdoc.functions.map(code).join(', ')}`);
  if (markdoc.partials.length > 0) notes.push(`partials ${markdoc.partials.map(code).join(', ')}`);
  const declared = notes.length > 0 ? ` The config declares ${notes.join('; ')}.` : '';
  return `Variables, conditionals (\`{% if %}\`), functions, partials and annotations are kept exactly as written by the studio; change them by hand only when asked.${declared}`;
}

function leafPaths(tree: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const children = value as Record<string, unknown>;
    return Object.keys(children).length === 0 ? [path] : leafPaths(children, path);
  });
}

function hasImage(field: FieldModel): boolean {
  return isImage(field) || fieldChildren(field).some(hasImage);
}

function isImage(field: FieldModel): boolean {
  return field.widget === 'image' && field.kind === 'object';
}

/** " of 1 to 3 items", " of at least 2", or nothing. `unit` is plural; one of it is singular. */
function range(min: number | undefined, max: number | undefined, unit = ''): string {
  const of = (n: number) => (unit ? ` ${n === 1 ? unit.replace(/s$/, '') : unit}` : '');
  if (min !== undefined && max !== undefined)
    return ` of ${String(min)} to ${String(max)}${of(max)}`;
  if (min !== undefined) return ` of at least ${String(min)}${of(min)}`;
  if (max !== undefined) return ` of at most ${String(max)}${of(max)}`;
  return '';
}

/** A list's items, in the plural: "strings", "IDs of entries in `tags`". */
function items(item: FieldModel): string {
  if (isImage(item)) return 'images (see Images)';
  if (item.widget === 'geo') return 'map locations, `{ lat, lng }`';
  switch (item.kind) {
    case 'string':
      if (item.widget === 'color') return 'hex colours such as `#1a73e8`';
      if (item.widget === 'slug') return 'slugs';
      if (item.widget === 'file') return 'file paths';
      if (item.format === 'email') return 'email addresses';
      if (item.format === 'url') return 'full URLs';
      return 'strings';
    case 'number':
      return item.constraints?.integer ? 'whole numbers' : 'numbers';
    case 'boolean':
      return '`true` or `false` values';
    case 'date':
      return 'dates';
    case 'enum':
      return `values, each ${describe(item)}`;
    case 'reference':
      return item.reference ? `IDs of entries in ${code(item.reference.collection)}` : 'entry IDs';
    case 'array':
      return 'lists';
    case 'image':
      return 'image paths';
    case 'object':
    case 'union':
      return 'objects';
    case 'unknown':
      return 'values the schema accepts, edited as raw YAML in the studio';
  }
}

function humanEqual(label: string, key: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(label) === norm(key);
}

function clean(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function sentence(text: string | undefined): string {
  const t = clean(text);
  return t ? ` ${t.endsWith('.') ? t : `${t}.`}` : '';
}

function code(text: string): string {
  return `\`${text}\``;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}
