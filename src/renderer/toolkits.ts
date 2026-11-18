import { useSyncExternalStore } from 'react';

import {
  type ToolkitId,
  type ToolkitStatus,
  missingToolkits,
} from '../shared/toolkits';
import { liveStore } from './liveStore';
import type { Tool } from './toolkit/types';

// Every toolkit's status, kept in step with the main process: what is
// installed, what is offered, and how each install is going. Tool pages,
// Home, the sidebar, quick search, Settings and the first-launch screen all
// read it from here.

const store = liveStore<ToolkitStatus[] | null>(null, (set) => {
  window.toolkits.onChanged(set);
  void window.toolkits.list().then(set);
});

/** Every toolkit, or null until the first answer arrives. */
export const useToolkits = () =>
  useSyncExternalStore(store.subscribe, store.get);

/** One toolkit's status, or null until known. */
export const useToolkit = (id: ToolkitId) =>
  useToolkits()?.find((toolkit) => toolkit.id === id) ?? null;

/**
 * The toolkits a tool requires that aren't installed: empty when it is
 * ready to use. Null until the statuses arrive, so a page doesn't flash a
 * prompt for a toolkit that turns out to be there.
 */
export function useMissingToolkits(
  tool: Pick<Tool, 'requires'> | undefined,
): ToolkitStatus[] | null {
  const list = useToolkits();
  if (!tool?.requires?.length) return [];
  return list && missingToolkits(tool.requires, list);
}

/** "Needs the Media toolkit", for tooltips and quiet labels. */
export const needsText = (missing: readonly ToolkitStatus[]) =>
  missing.length === 0
    ? ''
    : `Needs the ${missing.map((toolkit) => toolkit.name).join(' and ')} toolkit${missing.length > 1 ? 's' : ''}`;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Installs (or updates, or switches the variant of) a toolkit. Resolves
 * with an error message, or null on success or cancel: progress and errors
 * also arrive in the toolkit's status, which every view shows.
 */
export async function installToolkit(
  id: ToolkitId,
  variant?: string,
): Promise<string | null> {
  try {
    store.set(await window.toolkits.install(id, variant));
    return null;
  } catch (error) {
    // Canceling isn't a failure worth showing.
    return /canceled/i.test(errorText(error)) ? null : errorText(error);
  }
}

export async function removeToolkit(id: ToolkitId): Promise<string | null> {
  try {
    store.set(await window.toolkits.remove(id));
    return null;
  } catch (error) {
    return errorText(error);
  }
}

export const cancelToolkit = (id: ToolkitId) => void window.toolkits.cancel(id);

export async function checkToolkitUpdates(): Promise<string | null> {
  try {
    store.set(await window.toolkits.checkForUpdates());
    return null;
  } catch (error) {
    return errorText(error);
  }
}
