import { Suspense, lazy } from 'react';
import type { WidgetProps } from '../types.ts';

// The compact Markdown editor is built on Tiptap, which loads the first time
// a Markdown field is shown (it shares the chunk with the body editor).
const MarkdownWidget = lazy(() =>
  import('./markdown.tsx').then((module) => ({ default: module.MarkdownWidget })),
);

export function LazyMarkdownWidget(props: WidgetProps<string>) {
  return (
    <Suspense
      fallback={
        <p role="status" className="text-small text-content-muted">
          Loading the editor…
        </p>
      }
    >
      <MarkdownWidget {...props} />
    </Suspense>
  );
}
