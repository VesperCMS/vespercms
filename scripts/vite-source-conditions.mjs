// Vite config fragment that resolves workspace packages to their TypeScript
// source through the "@vesper/source" export condition. Shared by the root
// Vitest config and the playground's Astro config. Node gets the same
// condition from the repo's .npmrc.
//
// It's a plugin rather than plain `resolve.conditions`, because Astro loads
// content.config.ts in its own Vite environments (`astro` in dev and sync,
// `prerender` in builds), which top-level and `ssr` settings never reach.
// `configEnvironment` adds the condition to every environment, whatever its
// name.
import { defaultClientConditions, defaultServerConditions } from 'vite';

export const SOURCE_CONDITION = '@vesper/source';

/** @returns {import('vite').Plugin} */
export function sourceConditionsPlugin() {
  return {
    name: 'vesper:source-conditions',
    configEnvironment(name, config) {
      const consumer = config.consumer ?? (name === 'client' ? 'client' : 'server');
      config.resolve ??= {};
      const base =
        config.resolve.conditions ??
        (consumer === 'client' ? defaultClientConditions : defaultServerConditions);
      config.resolve.conditions = [SOURCE_CONDITION, ...base.filter((c) => c !== SOURCE_CONDITION)];
      if (consumer === 'server') {
        const external = config.resolve.externalConditions ?? [];
        config.resolve.externalConditions = [
          SOURCE_CONDITION,
          ...external.filter((c) => c !== SOURCE_CONDITION),
        ];
      }
    },
  };
}

/** @returns {import('vite').UserConfig} */
export function sourceConditions() {
  return { plugins: [sourceConditionsPlugin()] };
}
