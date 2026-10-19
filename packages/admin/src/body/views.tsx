import {
  NodeViewContent,
  NodeViewWrapper,
  useEditorState,
  type ReactNodeViewProps,
} from '@tiptap/react';
import type { BodyIssue } from '@vesper/core';
import { Button, cx } from '@vesper/ui';
import { useId } from 'react';
import { fallbackLabel } from './catalog.ts';
import { chipInfo, tagValues } from './chips.ts';
import { sourceLabel } from './document.ts';
import { summaryOf, useBlockIssues, useBodyUi } from './ui.ts';

/*
 * How blocks look in the writing view (spec §6.5.1): a tag with content is
 * a labelled frame, one without is a compact card, an inline tag is a chip,
 * and anything the editor can't show is a protected block. Each frame and
 * card is a group named after its tag, with a real Settings button, and
 * shows its own validation messages in words.
 *
 * Buttons inside the text stay out of the Tab order (69 chips must never be
 * 69 Tab stops), except the Settings button of the frame the cursor is in,
 * so Tab from inside a frame reaches it. Everything they do is also on the
 * keyboard: select a block and press Enter.
 */

/** A selected block shows a focus outline, but only while the text has focus. */
const SELECTED = cx(
  'in-[.ProseMirror-focused]:outline-2 in-[.ProseMirror-focused]:outline-solid in-[.ProseMirror-focused]:outline-offset-2 in-[.ProseMirror-focused]:outline-focus',
  'in-[.ProseMirror-focused]:ring-6 in-[.ProseMirror-focused]:ring-(color:--glow-focus)',
);

function Issues({ id, issues }: { id: string; issues: readonly BodyIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul id={id} className="mt-2 flex flex-col gap-1 text-small">
      {issues.map((issue) => (
        <li
          key={`${String(issue.line)}${issue.message}`}
          className={issue.level === 'error' ? 'text-danger' : 'text-content-muted'}
        >
          {issue.level === 'error' ? issue.message : `Note: ${issue.message}`}
        </li>
      ))}
    </ul>
  );
}

function headerText(label: string, summary: string): string {
  return summary ? `${label} · ${summary}` : label;
}

/** A tag with editable content: the header, then the content, inside a hairline frame. */
export function ContainerView({ node, getPos, selected, editor }: ReactNodeViewProps) {
  const ui = useBodyUi();
  const headerId = useId();
  const issuesId = useId();
  const syntax = node.attrs.syntax as 'markdoc' | 'mdx';
  const name = String(node.attrs.name);
  const open = String(node.attrs.open);
  const close = String(node.attrs.close);
  const kind = ui.catalog.find(syntax, name);
  const label = kind?.label ?? fallbackLabel(syntax, name);
  const summary =
    kind?.builtin === 'if'
      ? `shown when ${conditionOf(open)}`
      : summaryOf(kind, tagValues(syntax, open).values);
  // The attributes only: what's inside is checked as part of the whole body.
  const issues = useBlockIssues(syntax === 'mdx' ? `${open}\n\n${close}` : `${open}\n${close}`);
  // Tab from inside this frame reaches its Settings button, and no other frame's.
  const inside = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const pos = getPos();
      if (typeof pos !== 'number') return false;
      const { from, to } = e.state.selection;
      return from > pos && to < pos + node.nodeSize;
    },
  });
  return (
    <NodeViewWrapper
      as="div"
      role="group"
      aria-labelledby={headerId}
      aria-describedby={issues.length > 0 ? issuesId : undefined}
      className={cx(
        'my-3 rounded-md border border-border p-3',
        issues.some((i) => i.level === 'error') && 'border-danger',
        selected && SELECTED,
      )}
    >
      <div contentEditable={false} className="mb-2 flex items-center justify-between gap-2">
        <p id={headerId} className="text-label text-content-muted">
          {headerText(label, summary)}
        </p>
        <SettingsButton label={label} getPos={getPos} inTabOrder={inside} />
      </div>
      <NodeViewContent className="vesper-container-content" />
      <div contentEditable={false}>
        <Issues id={issuesId} issues={issues} />
      </div>
    </NodeViewWrapper>
  );
}

function SettingsButton({
  label,
  getPos,
  inTabOrder,
}: {
  label: string;
  getPos: () => number | undefined;
  inTabOrder: boolean;
}) {
  const ui = useBodyUi();
  return (
    <Button
      variant="quiet"
      excludeFromTabOrder={!inTabOrder}
      aria-label={`Settings for ${label}`}
      isDisabled={ui.disabled}
      onPress={() => {
        const pos = getPos();
        if (typeof pos === 'number') ui.openSettings(pos);
      }}
      className="min-h-8 px-2 text-small"
    >
      Settings
    </Button>
  );
}

/** A tag or component without editable content. */
export function CardView({ node, getPos, selected }: ReactNodeViewProps) {
  const ui = useBodyUi();
  const headerId = useId();
  const issuesId = useId();
  const syntax = node.attrs.syntax as 'markdoc' | 'mdx';
  const name = String(node.attrs.name);
  const source = String(node.attrs.source);
  const kind = ui.catalog.find(syntax, name);
  const label = kind?.label ?? fallbackLabel(syntax, name);
  const summary =
    kind?.builtin === 'else'
      ? conditionOf(source)
      : kind?.builtin === 'if'
        ? ''
        : summaryOf(kind, tagValues(syntax, source).values);
  const issues = useBlockIssues(source);
  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      role="group"
      aria-labelledby={headerId}
      aria-describedby={issues.length > 0 ? issuesId : undefined}
      className={cx(
        // The page's own surface, a step back from the writing surface around it.
        'my-3 rounded-md border border-border bg-surface p-3',
        issues.some((i) => i.level === 'error') && 'border-danger',
        selected && SELECTED,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p id={headerId} className="text-label text-content">
          {headerText(label, summary)}
        </p>
        <SettingsButton label={label} getPos={getPos} inTabOrder={false} />
      </div>
      <Issues id={issuesId} issues={issues} />
    </NodeViewWrapper>
  );
}

/** The condition of `{% if … %}` or `{% else … /%}`, as written. */
function conditionOf(tag: string): string {
  return tag
    .replace(/^\{%\s*(if|else)\b/, '')
    .replace(/\/?%\}$/, '')
    .trim();
}

/** An inline chip. Tags and components show their friendly name and text; the rest show their source. */
export function InlineView({ node, selected }: ReactNodeViewProps) {
  const ui = useBodyUi();
  const source = String(node.attrs.source);
  const info = chipInfo(source);
  const kind = info.name ? ui.catalog.find(info.syntax, info.name) : undefined;
  const isTag = info.kind === 'tag' || info.kind === 'component';
  // Only a tag can be checked on its own; a variable or an annotation needs
  // the text around it, so the whole body's check covers those.
  const issues = useBlockIssues(isTag ? source : '').filter((issue) => issue.level === 'error');
  const known = kind && isTag;
  const text = known
    ? headerText(
        kind.label,
        plainInner(info.inner) || summaryOf(kind, tagValues(info.syntax, info.open ?? '').values),
      )
    : source.length > 80
      ? `${source.slice(0, 77)}…`
      : source;
  return (
    <NodeViewWrapper
      as="span"
      // No contentEditable={false}: ProseMirror sets it on the node view's own
      // element, which keeps the caret out. A second one in here looks to
      // ProseMirror like a widget to step over, and ⌘← or ⌘→ next to a chip
      // at either end of a line then does nothing (DECISIONS.md).
      className={cx(
        'mx-0.5 rounded-sm border border-border-strong bg-surface-sunken px-1 py-0.5 text-small',
        !known && 'font-mono',
        issues.length > 0 && 'border-danger',
        selected && SELECTED,
      )}
    >
      {text}
      {issues.length > 0 && (
        <span className="text-danger"> ({issues.map((i) => i.message).join(' ')})</span>
      )}
    </NodeViewWrapper>
  );
}

/** An inline tag's content, when it's plain text. */
function plainInner(inner: string | undefined): string {
  if (!inner || /[{<*_`[\]\\]/.test(inner)) return '';
  return inner;
}

/** A protected block: named, shown as source, editable as raw text. */
export function SourceView({ node, getPos, selected }: ReactNodeViewProps) {
  const ui = useBodyUi();
  const text = String(node.attrs.text ?? '');
  const lines = text.split('\n');
  const label = sourceLabel(String(node.attrs.blockType ?? ''));
  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      className={cx(
        'my-3 rounded-md border border-dashed border-border-strong bg-surface-sunken p-3',
        selected && SELECTED,
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-label text-content-muted">{label}, kept as written.</p>
        <Button
          variant="quiet"
          excludeFromTabOrder
          aria-label={`Edit as text: ${label}`}
          isDisabled={ui.disabled}
          onPress={() => {
            const pos = getPos();
            if (typeof pos === 'number') ui.openSettings(pos);
          }}
          className="min-h-8 px-2 text-small"
        >
          Edit as text
        </Button>
      </div>
      <pre className="overflow-x-auto font-mono text-small whitespace-pre-wrap text-content">
        {lines.slice(0, 6).join('\n')}
        {lines.length > 6 ? `\n… ${String(lines.length - 6)} more lines` : ''}
      </pre>
    </NodeViewWrapper>
  );
}
