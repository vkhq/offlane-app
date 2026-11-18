// Turns a page's references to earlier outputs ("job X's second file") into
// paths, from the main process's own records. The page never names a path,
// so a step in a chain can only work on files a tool or download wrote.
//
// No Electron import, so it can be driven by plain Node in tests.
import type { Job } from '../../shared/types';
import type { OutputRef } from '../../shared/tools';

export type OutputSources = {
  /** Full paths of a finished tool job's outputs (ToolQueue.outputsOf). */
  toolOutputs: (jobId: string) => string[];
  /** A download job (DownloadManager.get). */
  download: (jobId: string) => Job | undefined;
};

const gone = () => new Error('That file is no longer available.');

/** Checks a page's references, untrusted, and resolves them to paths. */
export function resolveOutputs(raw: unknown, sources: OutputSources): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 1000) {
    throw new Error('Invalid request');
  }
  return raw.map((value: unknown) => {
    const ref = (value ?? {}) as Partial<OutputRef>;
    if (
      (ref.source !== 'tool' && ref.source !== 'download') ||
      typeof ref.jobId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(ref.jobId) ||
      !Number.isInteger(ref.index) ||
      (ref.index as number) < 0
    ) {
      throw new Error('Invalid request');
    }
    if (ref.source === 'tool') {
      const output = sources.toolOutputs(ref.jobId)[ref.index as number];
      if (!output) throw gone();
      return output;
    }
    const job = sources.download(ref.jobId);
    if (job?.status !== 'completed' || !job.outputPath || ref.index !== 0) {
      throw gone();
    }
    return job.outputPath;
  });
}
