import { isToolkitId, type ToolkitId } from '../../shared/toolkits';
import type { ToolHandler } from './queue';

// A tool with a back end has a handler.ts in its folder,
// src/tools/<group>/<id>/handler.ts, found here by the bundler.
const modules = require.context(
  '../../tools',
  true,
  /^\.\/[^/]+\/[^/]+\/handler\.ts$/,
);

/**
 * Every tool's handler, by tool id (its folder's name). One without a default
 * export is left out with an error, so it never stops the others.
 */
export function loadHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  for (const key of modules.keys()) {
    const id = key.split('/')[2];
    const handler = modules<{ default?: ToolHandler }>(key).default;
    if (handler) handlers.set(id, handler);
    else console.error(`Tool ${id} has a handler.ts with no default export.`);
  }
  return handlers;
}

// Each tool's manifest, reduced for the main build to its id and the
// toolkits it requires (scripts/webpack/manifest-requires-loader.cjs).
const manifests = require.context(
  '../../tools',
  true,
  /^\.\/[^/]+\/[^/]+\/manifest\.ts$/,
);

/** The toolkits each tool requires, by tool id. An unknown toolkit id
 *  stops the app in development, so a typo never leaves a tool unchecked. */
export function loadRequirements(): Map<string, readonly ToolkitId[]> {
  const requirements = new Map<string, readonly ToolkitId[]>();
  for (const key of manifests.keys()) {
    const manifest = manifests<{
      default?: { id?: string; requires?: string[] };
    }>(key).default;
    if (!manifest?.id) continue;
    const requires = manifest.requires ?? [];
    const unknown = requires.filter((id) => !isToolkitId(id));
    if (unknown.length > 0) {
      throw new Error(
        `Tool ${manifest.id} requires unknown toolkits: ${unknown.join(', ')}`,
      );
    }
    requirements.set(manifest.id, requires as ToolkitId[]);
  }
  return requirements;
}
