import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Browser APIs jsdom lacks that React Aria's overlays and collections touch.
// Only applied in tests that opt into `// @vitest-environment jsdom`. The DOM
// types claim these always exist, so presence is checked explicitly.
if (typeof window !== 'undefined') {
  const missing = (owner: object, name: string) =>
    !(name in owner) || (owner as Record<string, unknown>)[name] === undefined;

  if (missing(globalThis, 'ResizeObserver')) {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserverStub {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
  }
  if (missing(window, 'matchMedia')) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
  if (missing(Element.prototype, 'scrollIntoView')) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined,
    });
  }
}

export {};

// React Aria's live announcer appends its regions to <body> and keeps them,
// outside any React root. Clear the page after each DOM test (after the test
// file's own cleanup), so one test's announcements can't trip axe in the next.
if (typeof document !== 'undefined') {
  afterEach(() => {
    document.body.innerHTML = '';
  });
}
