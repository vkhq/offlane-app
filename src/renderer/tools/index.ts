import { type LazyExoticComponent, lazy } from 'react';

import { groups } from '../../tools/groups';
import type { Options } from '../../shared/tools';
import type { StandardTool, StandardToolPage } from '../toolkit/standardTool';
import type { Tool, ToolGroup, ToolManifest, ToolPage } from '../toolkit/types';

export type { Tool, ToolGroup } from '../toolkit/types';

// Every tool is a folder, src/tools/<group>/<id>/, found here by the bundler:
// adding a tool is adding its folder. Manifests load now, as the sidebar,
// Home and search list them; each page loads the first time it is opened.
const manifests = require.context(
  '../../tools',
  true,
  /^\.\/[^/]+\/[^/]+\/manifest\.ts$/,
);
const pages = require.context(
  '../../tools',
  true,
  /^\.\/[^/]+\/[^/]+\/page\.tsx$/,
  'lazy',
);

const pageKey = (tool: Tool) => `./${tool.group}/${tool.id}/page.tsx`;

/**
 * The tools whose folders are well formed. One that is not is left out with
 * an error in the console, so a mistake in one tool never stops the others.
 */
function discover(): Tool[] {
  const found: Tool[] = [];
  for (const key of manifests.keys()) {
    const [, group, folder] = key.split('/');
    const problem = (message: string) =>
      console.error(`Tool ${key.slice(2)} is left out: ${message}`);
    const manifest = manifests<{ default?: ToolManifest }>(key).default;
    if (!manifest) {
      problem('its manifest has no default export (see defineTool).');
      continue;
    }
    const tool = { ...manifest, group };
    if (manifest.id !== folder) {
      problem(`its id "${manifest.id}" should be its folder's name.`);
    } else if (!groups.some((known) => known.id === group)) {
      problem(`"${group}" is not a group listed in src/tools/groups.ts.`);
    } else if (!pages.keys().includes(pageKey(tool))) {
      problem('it has no page.tsx.');
    } else if (found.some((other) => other.id === tool.id)) {
      problem(`another group already has a tool "${tool.id}".`);
    } else {
      found.push(tool);
    }
  }
  return found;
}

const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name);
const found = discover();

/**
 * The groups in display order, each with its tools in alphabetical order. The
 * sidebar, quick search and Home page all list tools from here. Every tool
 * gets its own route at `/<id>`.
 */
export const toolGroups: ToolGroup[] = groups.map((group) => ({
  ...group,
  tools: found.filter((tool) => tool.group === group.id).sort(byName),
}));

export const tools: Tool[] = toolGroups.flatMap((group) => group.tools);

/** The tools offered first: in the sidebar's Pinned list. */
export const featuredTools = tools.filter((tool) => tool.featured);

type PageModule = { default: ToolPage };

/** Pages already loaded, so they can show without waiting. */
const ready = new Map<string, ToolPage>();
/** Pages first shown before they had loaded; each keeps its stand-in. */
const waiting = new Map<string, LazyExoticComponent<ToolPage>>();

const load = (tool: Tool) =>
  pages<Promise<PageModule>>(pageKey(tool)).then((module) => {
    ready.set(tool.id, module.default);
    return module;
  });

/**
 * The tool's page. One already loaded shows at once; otherwise a stand-in
 * loads it and shows it when it arrives. A tool always gets the same one, so
 * its page never remounts when its code arrives.
 */
export function pageOf(tool: Tool): ToolPage {
  const pending = waiting.get(tool.id);
  if (pending) return pending;
  const page = ready.get(tool.id);
  if (page) return page;
  const stand = lazy(() => load(tool));
  waiting.set(tool.id, stand);
  return stand;
}

/**
 * The form of a standard tool (its input, options and action), loading its
 * page if need be; null for a tool with a page of its own.
 */
export const configOf = (tool: Tool): Promise<StandardTool<Options> | null> =>
  load(tool).then(
    (module) => (module.default as Partial<StandardToolPage>).config ?? null,
  );

/**
 * Loads every tool's page in the background, a few at a time, once the
 * window is idle, so a tool opens at once even the first time. Starting up
 * still loads only the manifests.
 */
export function preloadPages() {
  const queue = tools.filter((tool) => !ready.has(tool.id));
  const next = (): Promise<void> | undefined => {
    const tool = queue.shift();
    return tool && load(tool).then(next, next);
  };
  const start = () => {
    for (let lane = 0; lane < 4; lane += 1) void next();
  };
  if ('requestIdleCallback' in window) requestIdleCallback(start);
  else setTimeout(start, 500);
}
