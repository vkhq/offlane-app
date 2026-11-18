import { useMemo, useSyncExternalStore } from 'react';

import type {
  ExternalToolId,
  ExternalToolsStatus,
} from '../shared/externalTools';
import { liveStore } from './liveStore';
import type { Tool, ToolGroup } from './toolkit/types';

// Programs the person installed themselves (yt-dlp), as the main
// process found them, and whether the tools they enable are on. A tool
// whose manifest names one in `enabledBy` is hidden from the sidebar, Home
// and quick search until it is turned on in Settings › Toolkits.

const store = liveStore<ExternalToolsStatus | null>(null, (set) => {
  window.externalTools.onChanged(set);
  void window.externalTools.status().then(set);
});

/** What was found, or null until the first answer arrives. */
export const useExternalTools = () =>
  useSyncExternalStore(store.subscribe, store.get);

const enabled = (status: ExternalToolsStatus | null, id: ExternalToolId) =>
  !!status?.[id].enabled;

/** Whether `tool` is listed: always, unless it waits to be turned on. */
export const isToolOn = (
  tool: Pick<Tool, 'enabledBy'>,
  status: ExternalToolsStatus | null,
) => !tool.enabledBy || enabled(status, tool.enabledBy);

/** The tools of `list` that are listed now. */
export function useListedTools<T extends Pick<Tool, 'enabledBy'>>(
  list: T[],
): T[] {
  const status = useExternalTools();
  return useMemo(
    () => list.filter((tool) => isToolOn(tool, status)),
    [list, status],
  );
}

/** The groups with only their listed tools, leaving out any left empty. */
export function useListedGroups(groups: ToolGroup[]): ToolGroup[] {
  const status = useExternalTools();
  return useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          tools: group.tools.filter((tool) => isToolOn(tool, status)),
        }))
        .filter((group) => group.tools.length > 0),
    [groups, status],
  );
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Runs a change and keeps its answer; resolves with an error message, or
 *  null when it worked. */
async function apply(
  change: () => Promise<ExternalToolsStatus>,
): Promise<string | null> {
  try {
    store.set(await change());
    return null;
  } catch (error) {
    return errorText(error);
  }
}

export const rescanExternalTools = () =>
  apply(() => window.externalTools.rescan());
export const chooseYtdlp = () =>
  apply(() => window.externalTools.chooseYtdlp());
export const forgetChosenYtdlp = () =>
  apply(() => window.externalTools.forgetChosenYtdlp());
export const setExternalToolEnabled = (id: ExternalToolId, on: boolean) =>
  apply(() => window.externalTools.setEnabled(id, on));
