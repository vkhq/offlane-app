// Runs tools' handlers: one job per input file or link (or one for all of
// them, for a tool that combines its inputs), a few at a time.
// Each job gets a context with what it needs (its input, its checked option
// values, FFmpeg, a place for its output and a way to report progress), so a
// handler is only the work itself. A job that fails or is cancelled has its
// unfinished outputs deleted.
//
// No Electron import, so it can be driven by plain Node in tests.
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  type OptionValues,
  type Options,
  type ToolJob,
  isShown,
  parseValues,
} from '../../shared/tools';
import { validateUrl } from '../engine/args';
import { run } from '../engine/runner';
import { isFile } from '../files';
import type { ToolkitId } from '../../shared/toolkits';
import type { ResolvedFfmpeg } from '../engine/binaries';
import { ToolkitMissingError } from '../toolkits/store';

export type HandlerContext<V> = {
  /** An absolute file path, or an http(s) link: the first of `inputs`. */
  input: string;
  /** Every input of this job, in the order given: just `input`, unless the
   *  handler `combines` its inputs. */
  inputs: string[];
  values: V;
  /** Aborted when the job is cancelled; pass it to `run`. */
  signal: AbortSignal;
  /** Reports 0–100, or null while it cannot tell. */
  progress: (percent: number | null) => void;
  /**
   * A new path in the output folder, named after the input with `suffix`
   * and the extension `ext`, never one that exists. It counts as the job's
   * output once the job succeeds, and is deleted if it does not.
   */
  outputPath: (suffix: string, ext: string) => string;
  /** The FFmpeg in use; throws if there is none. */
  ffmpeg: () => { ffmpeg: string; ffprobe: string };
  /** Runs a program with an argv array, never a shell (engine/runner.ts). */
  run: typeof run;
};

/** A tool's back end: its handler.ts exports one as its default. */
export type ToolHandler<O extends Options = Options> = {
  /** The tool's options.ts, which the page's values are checked against. */
  options: O;
  /** What the tool works on. Files by default. */
  accepts?: 'files' | 'links' | 'both';
  /** Takes all its inputs in one job, in order (as Merge does), instead of
   *  one job each. */
  combines?: boolean;
  run: (context: HandlerContext<OptionValues<O>>) => Promise<void>;
};

export type QueueDeps = {
  handlers: Map<string, ToolHandler>;
  getFfmpeg: () => ResolvedFfmpeg | null;
  /** The toolkits each tool needs, from its manifest's `requires`. */
  requirements?: Map<string, readonly ToolkitId[]>;
  /** Throws ToolkitMissingError for the first of `ids` not installed. */
  assertToolkits?: (ids: readonly ToolkitId[]) => void;
  /** Where outputs are saved: the app's save folder. */
  getOutputDir: () => string;
  /** How many jobs run at once. */
  concurrency?: number;
};

type Entry = {
  job: ToolJob;
  /** The full paths or links, which the page never sees. */
  inputs: string[];
  handler: ToolHandler;
  values: OptionValues<Options>;
  controller: AbortController;
  /** Full paths of what it wrote, or is writing. */
  outputs: string[];
};

export class ToolQueue extends EventEmitter<{
  'job-updated': [ToolJob];
  'job-removed': [string];
}> {
  private entries = new Map<string, Entry>();
  private running = 0;

  constructor(private deps: QueueDeps) {
    super();
  }

  /** The ids of the tools that have a handler. */
  connected(): string[] {
    return [...this.deps.handlers.keys()];
  }

  list(): ToolJob[] {
    return [...this.entries.values()].map((entry) => entry.job);
  }

  /** Full paths of a finished job's outputs. */
  outputsOf(id: string): string[] {
    const entry = this.entries.get(id);
    return entry?.job.status === 'done' ? entry.outputs : [];
  }

  /**
   * Starts one job per input. Everything is checked first, so a bad input
   * starts nothing: files must exist, links must be http(s), and the tool
   * must take that kind of input. A file option's value is the path of the
   * file sent for it in `attachments` (checked the same way), or '' if none
   * was: never what the page put in `values`.
   */
  run(
    toolId: string,
    request: {
      files: string[];
      links: string[];
      values: unknown;
      attachments?: Record<string, string>;
    },
  ): ToolJob[] {
    const handler = this.deps.handlers.get(toolId);
    if (!handler) throw new Error(`This tool isn't connected yet.`);
    // Checked here as well as on the page, so a page can't skip it.
    this.deps.assertToolkits?.(this.deps.requirements?.get(toolId) ?? []);
    const accepts = handler.accepts ?? 'files';
    if (request.files.length > 0 && accepts === 'links') {
      throw new Error('This tool works on links, not files.');
    }
    if (request.links.length > 0 && accepts === 'files') {
      throw new Error('This tool works on files, not links.');
    }
    const checkFile = (file: string) => {
      if (!path.isAbsolute(file) || !isFile(file)) {
        throw new Error(`Can't read ${path.basename(file) || 'that file'}.`);
      }
      return file;
    };
    const files = request.files.map(checkFile);
    const links = request.links.map(validateUrl);
    const inputs = [...files, ...links];
    if (inputs.length === 0) throw new Error('Nothing to work on.');
    const values = parseValues(handler.options, request.values) as Record<
      string,
      unknown
    >;
    for (const [key, setting] of Object.entries(handler.options)) {
      if (setting.kind !== 'file') continue;
      const attached = request.attachments?.[key];
      values[key] =
        attached && isShown(handler.options, key, values)
          ? checkFile(attached)
          : '';
    }

    const groups = handler.combines ? [inputs] : inputs.map((one) => [one]);
    const jobs = groups.map((group): ToolJob => {
      const names = group.map((input) =>
        files.includes(input) ? path.basename(input) : input,
      );
      const sizes = group.map((input) =>
        files.includes(input) ? sizeOf(input) : undefined,
      );
      const job: ToolJob = {
        id: randomUUID(),
        toolId,
        input:
          names.length > 1
            ? `${names[0]} and ${names.length - 1} more`
            : names[0],
        ...(sizes.every((size) => size !== undefined) && {
          inputSize: sizes.reduce<number>(
            (total, size) => total + (size ?? 0),
            0,
          ),
        }),
        status: 'queued',
        progress: null,
        outputs: [],
        createdAt: Date.now(),
      };
      this.entries.set(job.id, {
        job,
        inputs: group,
        handler,
        values: values as OptionValues<Options>,
        controller: new AbortController(),
        outputs: [],
      });
      this.emit('job-updated', job);
      return job;
    });
    this.pump();
    return jobs;
  }

  cancel(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.job.status === 'queued')
      this.update(entry, { status: 'cancelled' });
    else if (entry.job.status === 'running') entry.controller.abort();
  }

  /** Takes a finished, failed or cancelled job off the list. */
  remove(id: string) {
    const entry = this.entries.get(id);
    if (
      !entry ||
      entry.job.status === 'queued' ||
      entry.job.status === 'running'
    )
      return;
    this.entries.delete(id);
    this.emit('job-removed', id);
  }

  /** Cancels everything, for quitting. */
  stopAll() {
    for (const entry of this.entries.values()) this.cancel(entry.job.id);
  }

  private update(entry: Entry, patch: Partial<ToolJob>) {
    entry.job = { ...entry.job, ...patch };
    this.emit('job-updated', entry.job);
  }

  private pump() {
    const limit = this.deps.concurrency ?? 2;
    for (const entry of this.entries.values()) {
      if (this.running >= limit) return;
      if (entry.job.status !== 'queued') continue;
      this.running += 1;
      void this.start(entry).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async start(entry: Entry) {
    this.update(entry, { status: 'running', progress: null });
    const [input] = entry.inputs;
    const name = baseName(input);
    let lastProgress = 0;
    const context: HandlerContext<OptionValues<Options>> = {
      input,
      inputs: [...entry.inputs],
      values: entry.values,
      signal: entry.controller.signal,
      progress: (percent) => {
        // At most a few updates a second reach the page.
        const now = Date.now();
        if (percent !== null && now - lastProgress < 250) return;
        lastProgress = now;
        this.update(entry, {
          progress:
            percent === null ? null : Math.min(Math.max(percent, 0), 100),
        });
      },
      outputPath: (suffix, ext) => {
        const dir = this.deps.getOutputDir();
        let candidate = path.join(dir, `${name}${suffix}.${ext}`);
        for (
          let n = 2;
          existsSync(candidate) || entry.outputs.includes(candidate);
          n += 1
        ) {
          candidate = path.join(dir, `${name}${suffix} (${n}).${ext}`);
        }
        entry.outputs.push(candidate);
        return candidate;
      },
      ffmpeg: () => {
        const found = this.deps.getFfmpeg();
        if (!found) throw new ToolkitMissingError('media');
        return { ffmpeg: found.ffmpeg, ffprobe: found.ffprobe };
      },
      run,
    };

    try {
      await entry.handler.run(context);
      if (entry.controller.signal.aborted) throw new Error('Cancelled');
      this.update(entry, {
        status: 'done',
        progress: 100,
        outputs: entry.outputs.map((output) => path.basename(output)),
        outputSize: entry.outputs.reduce(
          (total, output) => total + (sizeOf(output) ?? 0),
          0,
        ),
      });
    } catch (error) {
      for (const output of entry.outputs) rmSync(output, { force: true });
      entry.outputs = [];
      if (entry.controller.signal.aborted) {
        this.update(entry, { status: 'cancelled' });
      } else {
        this.update(entry, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/** A file's size in bytes, or undefined if it can't be read. */
function sizeOf(file: string) {
  try {
    return statSync(file).size;
  } catch {
    return undefined;
  }
}

/** The input's name without its folder or extension, for naming outputs. */
function baseName(input: string) {
  if (/^https?:\/\//.test(input)) {
    const last = new URL(input).pathname.split('/').filter(Boolean).pop();
    return last?.replace(/\.[^.]+$/, '') || 'download';
  }
  return path.basename(input, path.extname(input));
}
