/*
 * The little of jsdom the build's accessibility check uses (integration/a11y.ts).
 * jsdom ships no types, and @types/jsdom would be a dependency for two classes.
 */
declare module 'jsdom' {
  import type { Context } from 'node:vm';

  export class VirtualConsole {
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export class JSDOM {
    constructor(
      html: string,
      options?: { url?: string; runScripts?: 'outside-only'; virtualConsole?: VirtualConsole },
    );
    readonly window: {
      document: { elementFromPoint: unknown; elementsFromPoint: unknown };
      close: () => void;
    };
    getInternalVMContext(): Context;
  }
}
