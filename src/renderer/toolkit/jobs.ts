import { useSyncExternalStore } from 'react';

import type { ToolJob } from '../../shared/tools';
import { liveStore } from '../liveStore';

// Ids of the tool jobs there are now, and whether the first full list has
// arrived: until then, one not seen yet may simply not have been heard of.
const present = new Set<string>();
let listed = false;

/**
 * Whether tool job `id` is gone: removed from the list (or never kept), as
 * opposed to just started and not yet heard of.
 */
export const isToolJobGone = (id: string) => listed && !present.has(id);

/** Lets the store take in jobs before their events arrive (see below). */
let take: ((list: ToolJob[]) => void) | null = null;

const jobs = liveStore<ToolJob[]>([], (set) => {
  // A plain browser has no bridge, so it has no jobs.
  if (!window.tools) return;
  const byId = new Map<string, ToolJob>();
  const publish = () => {
    present.clear();
    for (const id of byId.keys()) present.add(id);
    // Newest first, as the list shows them.
    set([...byId.values()].sort((a, b) => b.createdAt - a.createdAt));
  };
  window.tools.onJob((job) => {
    byId.set(job.id, job);
    publish();
  });
  window.tools.onJobRemoved((id) => {
    byId.delete(id);
    publish();
  });
  void window.tools.list().then((list) => {
    // An event may have arrived first; it is the fresher copy.
    for (const job of list) if (!byId.has(job.id)) byId.set(job.id, job);
    listed = true;
    publish();
  });
  take = (list) => {
    for (const job of list) if (!byId.has(job.id)) byId.set(job.id, job);
    publish();
  };
});

/** Every job of every tool, newest first. */
export const useAllJobs = () => useSyncExternalStore(jobs.subscribe, jobs.get);

/** The jobs of one tool, newest first. */
export const useToolJobs = (toolId: string) =>
  useAllJobs().filter((job) => job.toolId === toolId);

const connected = liveStore<string[] | null>(null, (set) => {
  // A plain browser has no bridge, so no tool is connected there.
  void (window.tools?.connected() ?? Promise.resolve([])).then(set);
});

/** The ids of the tools that have a back end; null until the main process answers. */
export const useConnectedIds = () =>
  useSyncExternalStore(connected.subscribe, connected.get);

/** Whether the tool has a back end; null until the main process answers. */
export function useConnected(toolId: string) {
  const ids = useConnectedIds();
  return ids === null ? null : ids.includes(toolId);
}

/**
 * Takes in runs just started, as the queue handed them back, so the list
 * knows them before their first event: until then a page would take them
 * for gone (see above).
 */
export function noteToolJobs(list: ToolJob[]) {
  take?.(list);
}
