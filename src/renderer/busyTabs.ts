// Which open tabs have a tool at work, and how far along it is, for the tab
// bar: a tab's page keeps the runs it started with the tab (`jobs`), and
// any steps chained below it keep theirs (`steps`), for every tool alike.
// Those are looked up among the downloads and the other tools' runs under
// way, so a tab counts as busy from the moment its run starts, whether or
// not it has a session in History.
import { useSyncExternalStore } from 'react';

import { pagePath, pathOf, type Tab } from './components/tabs';
import { useDownloads } from './downloads';
import { onTabStateChange, readTabValue } from './tabState';
import { useAllJobs } from './toolkit/jobs';
import type { Step } from './toolkit/steps';
import { progressive } from './toolkit/verbs';
import { tools } from './tools';

/** A run under way in a tab. */
export type BusyRun = {
  id: string;
  /** Downloads stop through the download queue; the rest, the tool queue. */
  source: 'download' | 'tool';
  /** What it is doing: Downloading, Compressing. */
  verb: string;
  /** What it works on: a video's title, a file's name. */
  name: string;
  /** 0–100, or null while it cannot tell. */
  progress: number | null;
};

/** How a tab's work is going: its runs, and their progress together. */
export type TabWork = {
  runs: BusyRun[];
  /** The runs' average progress, once every one can tell; else null. */
  progress: number | null;
  /** "Compressing · 45%", "Downloading…": for the tab's tooltip. */
  label: string;
};

// Bumped when any tab's page state changes, so the busy tabs are worked
// out again when a run is started or a step is added. Told once things
// settle, never in the middle of a page's render (a page writes its state
// as it renders) and only for the keys that hold runs.
let version = 0;
const subscribe = (notify: () => void) => {
  let queued = false;
  return onTabStateChange((_tab, slot) => {
    if (!/:(jobs|steps)$/.test(slot)) return;
    version += 1;
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      notify();
    });
  });
};

/** The tabs with a tool at work, by tab id. */
export function useBusyTabs(tabs: Tab[]): Map<string, TabWork> {
  useSyncExternalStore(subscribe, () => version);
  const downloads = useDownloads();
  const toolJobs = useAllJobs();
  const busy = new Map<string, TabWork>();

  for (const tab of tabs) {
    const path = pagePath(pathOf(tab));
    const own = readTabValue(tab.id, path, 'jobs');
    const steps = readTabValue(tab.id, path, 'steps') as Step[] | undefined;
    const ids = new Set<string>([
      ...(Array.isArray(own) ? (own as string[]) : []),
      ...(steps ?? []).flatMap((step) => step.jobIds),
    ]);
    if (ids.size === 0) continue;

    const runs: BusyRun[] = [];
    for (const job of downloads) {
      if (!ids.has(job.id)) continue;
      if (['completed', 'failed', 'canceled', 'paused'].includes(job.status)) {
        continue;
      }
      runs.push({
        id: job.id,
        source: 'download',
        verb: 'Downloading',
        name: job.title ?? job.url,
        progress: job.progress?.percent ?? null,
      });
    }
    for (const job of toolJobs) {
      if (!ids.has(job.id)) continue;
      if (job.status !== 'queued' && job.status !== 'running') continue;
      const tool = tools.find((candidate) => candidate.id === job.toolId);
      runs.push({
        id: job.id,
        source: 'tool',
        verb: progressive(tool?.name ?? ''),
        name: job.input,
        progress: job.status === 'running' ? job.progress : null,
      });
    }
    if (runs.length === 0) continue;

    const known = runs.map((run) => run.progress);
    const progress = known.every((value) => value !== null)
      ? (known as number[]).reduce((sum, value) => sum + value, 0) /
        known.length
      : null;
    const verb = runs.every((run) => run.verb === runs[0].verb)
      ? runs[0].verb
      : 'Working';
    busy.set(tab.id, {
      runs,
      progress,
      label:
        progress === null ? `${verb}…` : `${verb} · ${Math.floor(progress)}%`,
    });
  }
  return busy;
}

/** Stops these runs: downloads and other tools' runs alike. */
export async function stopRuns(runs: BusyRun[]) {
  await Promise.allSettled(
    runs.map((run) =>
      run.source === 'download'
        ? window.downloader.cancel(run.id)
        : window.tools.cancel(run.id),
    ),
  );
}
