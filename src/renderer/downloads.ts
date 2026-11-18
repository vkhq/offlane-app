import { useSyncExternalStore } from 'react';

import type { Job } from '../shared/types';
import { liveStore } from './liveStore';

// Ids of the downloads there are now, and whether the first full list has
// arrived: until then, one not seen yet may simply not have been heard of.
const present = new Set<string>();
let listed = false;

/**
 * Whether download `id` is gone: removed from the list (or never kept), as
 * opposed to just started and not yet heard of.
 */
export const isDownloadGone = (id: string) => listed && !present.has(id);

/** Lets the store take in jobs before their events arrive (see below). */
let take: ((list: Job[]) => void) | null = null;

const jobs = liveStore<Job[]>([], (set) => {
  const byId = new Map<string, Job>();
  const publish = () => {
    present.clear();
    for (const id of byId.keys()) present.add(id);
    // Newest first, as the list shows them.
    set([...byId.values()].sort((a, b) => b.createdAt - a.createdAt));
  };
  window.downloader.onJobUpdated((job) => {
    byId.set(job.id, job);
    publish();
  });
  window.downloader.onJobRemoved((id) => {
    byId.delete(id);
    publish();
  });
  void window.downloader.listJobs().then((list) => {
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

/** Every download, newest first. */
export const useDownloads = () =>
  useSyncExternalStore(jobs.subscribe, jobs.get);

export function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Takes in downloads just started, as the queue handed them back, so the list
 * knows them before their first event: until then a page would take them
 * for gone (see above).
 */
export function noteDownloads(list: Job[]) {
  take?.(list);
}
