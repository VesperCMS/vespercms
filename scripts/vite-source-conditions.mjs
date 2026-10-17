// Vite config fragment that resolves workspace packages to their TypeScript
// source through the "@vesper/source" export condition. Shared by the root
// Vitest config and the playground's Astro config. Node gets the same
// condition from the repo's .npmrc.
//
// Linked workspace packages aren't externalized by Vite, so Vite's own
// resolver handles them and needs the condition here too.
import { defaultClientConditions, defaultServerConditions } from 'vite';

export const SOURCE_CONDITION = '@vesper/source';

/** @returns {import('vite').UserConfig} */
export function sourceConditions() {
  const client = [SOURCE_CONDITION, ...defaultClientConditions];
  const server = [SOURCE_CONDITION, ...defaultServerConditions];
  return {
    resolve: { conditions: client },
    ssr: { resolve: { conditions: server, externalConditions: [SOURCE_CONDITION] } },
  };
}
