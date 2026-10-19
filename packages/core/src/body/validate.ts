import Markdoc, { type Config } from '@markdoc/markdoc';
import type { FieldModel } from '../field-model.ts';
import type { MarkdocTagManifest } from '../markdoc/types.ts';
import { humanize } from '../schema/humanize.ts';
import type { FieldIssue } from '../studio/protocol.ts';
import { jsxTagLayout } from './jsx-tag.ts';
import { parseMarkdoc } from './markdoc.ts';
import { mdastBlocks } from './mdast.ts';
import type { BodyBlock, MarkdocParseOptions } from './types.ts';

/*
 * Body validation (spec §6.5.1, "Validation"). An issue blocks saving when
 * the site's build would fail on it, exactly as @astrojs/markdoc decides:
 * Markdoc errors at `error` or `critical` level, except undefined variables
 * (Astro ignores them, because pages can pass variables in) and Markdoc's own
 * partial check (Astro resolves partial files itself, and fails when one is
 * missing, which is checked here instead). Unknown tags and functions fail
 * the build too, but they block only with `siteConfig`: the browser's config
 * is rebuilt from the manifest and may know less than the build does (an
 * `extends` it couldn't read), so there they warn. MDX components' props are
 * checked with their own Zod schema.
 */

export type BodyIssue = {
  /** 1-based line in the body. */
  line: number;
  /** `error` blocks saving; `warning` is shown only. */
  level: 'error' | 'warning';
  /** A plain-language message that names the block. */
  message: string;
  /** Markdoc's error id, `partial-missing`, or `props` for an MDX component. */
  code: string;
  /** The tag or component the issue is about. */
  name?: string;
  /** The attribute or prop at fault, so a settings form can show the message under it. */
  attribute?: string;
};

export type MarkdocValidateOptions = {
  config: Config;
  parse?: MarkdocParseOptions;
  /** The manifest's tags, for friendly names in messages. */
  tags?: readonly MarkdocTagManifest[];
  /** Whether a partial's `file`, as written in this entry, exists. Unchecked when absent. */
  partialExists?: (file: string) => boolean;
  /**
   * The config is the site's own, merged as @astrojs/markdoc merges it (the
   * dev API's), so unknown tags and functions block as the build would.
   */
  siteConfig?: boolean;
};

type Node = {
  type: string;
  tag?: string;
  lines: number[];
  attributes: Record<string, unknown>;
  children: Node[];
};

const UNKNOWN = new Set(['tag-undefined', 'function-undefined']);
/** Untransformed HTML and comment nodes: Astro turns them into its own tags before validating. */
const ASTRO_HANDLES = new Set(['html_block', 'html_inline', 'comment']);

export function validateMarkdocBody(body: string, options: MarkdocValidateOptions): BodyIssue[] {
  let ast: Node;
  try {
    ast = parseMarkdoc(body, options.parse) as unknown as Node;
  } catch (error) {
    return [
      {
        line: 1,
        level: 'error',
        code: 'parse-error',
        message: `The body can’t be read as Markdoc: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
  const tags = new Map((options.tags ?? []).map((tag) => [tag.name, tag]));
  const warnOnly = options.siteConfig ? new Set<string>() : UNKNOWN;
  const nodes = [...walk(ast)];
  const issues: BodyIssue[] = [];

  for (const { lines, type, error } of Markdoc.validate(ast as never, options.config)) {
    if (error.id === 'variable-undefined') continue;
    if (error.id === 'attribute-value-invalid' && /^Partial .+ not found/.test(error.message)) {
      continue;
    }
    if (error.id === 'node-undefined' && ASTRO_HANDLES.has(type)) continue;
    const nested = /^Can't nest '([^']+)'/.exec(error.message)?.[1];
    if (error.id === 'child-invalid' && nested && ASTRO_HANDLES.has(nested)) continue;
    const blocking =
      (error.level === 'error' || error.level === 'critical') && !warnOnly.has(error.id);
    if (!blocking && error.level !== 'warning' && !warnOnly.has(error.id)) continue;
    const node = nodeFor(nodes, type, lines, error.message);
    const name = node?.tag;
    issues.push({
      line: (lines[0] ?? 0) + 1,
      level: blocking ? 'error' : 'warning',
      code: error.id,
      message: plainMessage(
        error.id,
        error.message,
        name,
        name ? tags.get(name) : undefined,
        blocking,
      ),
      ...(name ? { name } : {}),
      ...(error.id.startsWith('attribute-') && attributeOf(error.message)
        ? { attribute: attributeOf(error.message) }
        : {}),
    });
  }

  const registered = (options.config.partials ?? {}) as Record<string, unknown>;
  if (options.partialExists) {
    for (const node of nodes) {
      if (node.type !== 'tag' || node.tag !== 'partial') continue;
      const file = node.attributes.file;
      if (typeof file !== 'string' || file in registered || options.partialExists(file)) continue;
      issues.push({
        line: (node.lines[0] ?? 0) + 1,
        level: 'error',
        code: 'partial-missing',
        name: 'partial',
        message: `Partial: the file “${file}” doesn’t exist, so the site can’t be built. Choose another file.`,
      });
    }
  }
  return dedupe(issues);
}

/**
 * A partial's `file`, as @astrojs/markdoc resolves it from an entry, as a
 * site-relative path: relative to the entry's folder (with or without
 * `./`), or from the site root with a leading `/`. Null when it climbs out.
 */
export function resolvePartial(entryPath: string, file: string): string | null {
  const base = file.startsWith('/') ? [] : entryPath.split('/').slice(0, -1);
  const out = [...base];
  for (const segment of file.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(segment);
  }
  return out.join('/');
}

/** `partialExists` for an entry, given every file a partial could be. */
export function partialChecker(
  entryPath: string,
  files: Iterable<string>,
): (file: string) => boolean {
  const known = new Set(files);
  return (file) => {
    const path = resolvePartial(entryPath, file);
    return path !== null && known.has(path);
  };
}

function* walk(node: Node): Generator<Node> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

/** The node an error is about: same type and lines, preferring a tag the message's attribute belongs to. */
function nodeFor(
  nodes: readonly Node[],
  type: string,
  lines: number[],
  message: string,
): Node | undefined {
  const key = JSON.stringify(lines);
  const candidates = nodes.filter((n) => n.type === type && JSON.stringify(n.lines) === key);
  const attribute = /'([^']+)'/.exec(message)?.[1];
  const named = /tag: '([^']+)'|^'([^']+)' tag/.exec(message);
  const tagName = named?.[1] ?? named?.[2];
  return (
    candidates.find((n) => tagName !== undefined && n.tag === tagName) ??
    candidates.find((n) => attribute !== undefined && attribute in n.attributes) ??
    candidates[0]
  );
}

function plainMessage(
  id: string,
  message: string,
  name: string | undefined,
  tag: MarkdocTagManifest | undefined,
  blocking: boolean,
): string {
  const label = tag?.label ?? (name ? humanize(name) : 'This block');
  const attribute = /'([^']+)'/.exec(message)?.[1];
  const field = tag?.fields.find((f) => f.path[0] === attribute);
  const setting = field?.label ?? (attribute ? humanize(attribute) : 'A setting');
  switch (id) {
    case 'attribute-missing-required':
      return `${label}: ${setting} is required.`;
    case 'attribute-value-invalid': {
      const options = field?.constraints?.options;
      return options
        ? `${label}: ${setting} must be one of ${list(options.map((o) => o.label))}.`
        : `${label}: ${setting} isn’t in the form the site expects.`;
    }
    case 'attribute-type-invalid':
      return `${label}: ${setting} must be ${typeWords(field, message)}.`;
    case 'attribute-undefined':
      return `${label}: “${attribute ?? ''}” isn’t one of its settings. Remove it, or ask a developer to add it.`;
    case 'tag-undefined':
      return blocking
        ? `The site doesn’t define a “${attribute ?? name ?? ''}” tag, so the site can’t be built. Remove it, or ask a developer to add it to markdoc.config.`
        : `The site doesn’t define a “${attribute ?? name ?? ''}” tag, so it may not show on the page. A developer can add it to markdoc.config.`;
    case 'tag-placement-invalid':
      return tag?.inline
        ? `${label} goes inside a line of text, not on a line of its own.`
        : `${label} goes on a line of its own, not inside text.`;
    case 'tag-selfclosing-has-children':
      return `${label} can’t hold content.`;
    case 'child-invalid':
      return `${label} can’t hold this kind of content, so the site may leave it out.`;
    case 'missing-closing':
      return `${label} is missing its closing tag.`;
    case 'missing-opening':
      return `A closing tag has no opening tag to match.`;
    default:
      return `${label}: ${message}`;
  }
}

function typeWords(field: FieldModel | undefined, message: string): string {
  const kind = field?.kind;
  if (kind === 'number' || /'Number'/.test(message)) return 'a number';
  if (kind === 'boolean' || /'Boolean'/.test(message)) return 'yes or no';
  if (/'Array'/.test(message)) return 'a list';
  if (/'Object'/.test(message)) return 'a group of values';
  return 'text';
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1) ?? ''}`;
}

function dedupe(issues: BodyIssue[]): BodyIssue[] {
  const seen = new Set<string>();
  return issues
    .filter((issue) => {
      const key = `${String(issue.line)}|${issue.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.line - b.line);
}

/** A declared component's label and fields, plus a check of its props with the real schema. */
export type MdxComponentCheck = {
  label: string;
  fields: readonly FieldModel[] | null;
  validate: (props: Record<string, unknown>) => FieldIssue[] | Promise<FieldIssue[]>;
};

/**
 * Checks every declared component in an MDX body with its props schema.
 * Undeclared components aren't checked (MDX itself reports what it can't
 * compile). A component whose props hold code is checked on the props the
 * studio can read, skipping the rest.
 */
export async function validateMdxBody(
  body: string,
  components: ReadonlyMap<string, MdxComponentCheck>,
): Promise<BodyIssue[]> {
  const issues: BodyIssue[] = [];
  const lineOf = (offset: number) => body.slice(0, offset).split('\n').length;
  const visit = async (blocks: readonly BodyBlock[]) => {
    for (const block of blocks) {
      const elements: { start: number; end: number; name: string }[] = [];
      if (block.tag?.syntax === 'mdx')
        elements.push({ start: block.start, end: block.end, name: block.tag.name });
      for (const chip of block.chips ?? []) {
        if (chip.kind === 'component' && chip.name)
          elements.push({ start: chip.start, end: chip.end, name: chip.name });
      }
      for (const element of elements) {
        const check = components.get(element.name);
        if (!check) continue;
        const layout = jsxTagLayout(body.slice(element.start, element.end));
        if (!layout) continue;
        const props: Record<string, unknown> = {};
        const unreadable = new Set<string>();
        for (const attribute of layout.attributes) {
          if (attribute.readable) props[attribute.name] = attribute.value;
          else if (attribute.name) unreadable.add(attribute.name);
        }
        if (layout.attributes.some((a) => a.kind === 'spread')) continue;
        for (const issue of await check.validate(props)) {
          const key = String(issue.path[0] ?? '');
          if (unreadable.has(key)) continue;
          const field = check.fields?.find((f) => f.path[0] === key);
          const setting = field?.label ?? (key ? humanize(key) : '');
          issues.push({
            line: lineOf(element.start),
            level: 'error',
            code: 'props',
            name: element.name,
            ...(key ? { attribute: key } : {}),
            message: setting
              ? `${check.label}: ${setting}: ${issue.message}`
              : `${check.label}: ${issue.message}`,
          });
        }
      }
      if (block.tag?.children) await visit(block.tag.children);
    }
  };
  await visit(mdastBlocks(body, true));
  return dedupe(issues);
}

/** The attribute a Markdoc message names in quotes, as in "Missing required attribute: 'title'". */
function attributeOf(message: string): string | undefined {
  return /'([^']+)'/.exec(message)?.[1];
}
