import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import type { StudioOptions } from './types.ts';

/** Renders the studio into `element`. Returns a function that unmounts it. */
export function mountStudio(element: Element, options: StudioOptions): () => void {
  const root = createRoot(element);
  root.render(
    <StrictMode>
      <App {...options} />
    </StrictMode>,
  );
  return () => {
    root.unmount();
  };
}
