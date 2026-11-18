// The download queue. One yt-dlp process per job, started by this manager,
// which gives:
//   • a global concurrency cap and a per-site cap (avoids rate-limit bans)
//   • pause/resume: stop the process, keep the .part files, restart later
//   • automatic retries with backoff for transient errors
//   • a queue that survives restarts
//   • playlists as one job per item, never one giant yt-dlp run
//
// No Electron import, so the integration tests can drive it with plain Node.
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  type DownloadRequest,
  type Job,
  type JobError,
  type JobStatus,
  type ProbeResult,
  isQualityPreset,
  type Settings,
} from '../../shared/types';
import { buildDownloadArgs, validateUrl } from '../engine/args';
import { checkBrowserAccess } from '../engine/browsers';
import type { Binaries } from '../engine/binaries';
import { isDemo, runDemo } from '../engine/demo';
import { classifyError, engineStartError } from '../engine/errors';
import { probe, ProbeError, type ProbeOutcome } from '../engine/probe';
import { fetchThumbnail } from '../engine/thumbnail';
import { parseLine, ProgressTracker } from '../engine/progress';
import { run, type RunOptions } from '../engine/runner';
import { exeName } from '../files';
import { videoAspect } from '../preview';
import { JsonFile } from '../storage/json-file';

/** Saved info JSON holds signed media URLs that expire within hours. */
const probeMaxAge = 30 * 60 * 1000;
const maxAutoRetries = 3;
/** Minimum gap between progress events per job. */
const progressEmitMs = 250;

const activeStatuses: JobStatus[] = ['probing', 'downloading', 'processing'];
const isActive = (status: JobStatus) => activeStatuses.includes(status);

/** Why a running process was stopped; decides what happens once it exits. */
type StopReason = 'cancel' | 'pause' | 'shutdown';

type Running = {
  controller: AbortController;
  reason: StopReason | null;
  done: Promise<void>;
};

export type ManagerDeps = {
  /** Called at the start of every job, so a new FFmpeg is picked up. */
  getBinaries: () => Binaries;
  getSettings: () => Settings;
  /** Root for per-job temp folders, saved probe JSON and jobs.json. */
  workDir: string;
};

/** Groups jobs by site: "www.youtube.com" and "m.youtube.com" → "youtube.com". */
export function siteOf(url: string): string {
  try {
    const parts = new URL(url).hostname.toLowerCase().split('.');
    // Three labels for "example.co.uk"-style domains, else two. A
    // heuristic; a public-suffix list would be exact.
    const keep =
      parts.length > 2 &&
      parts[parts.length - 2].length <= 3 &&
      parts[parts.length - 1].length === 2
        ? 3
        : 2;
    return parts.slice(-keep).join('.');
  } catch {
    return url;
  }
}

export class DownloadManager extends EventEmitter<{
  'job-updated': [Job];
  'job-removed': [string];
}> {
  private jobs = new Map<string, Job>();
  private running = new Map<string, Running>();
  /** Probe results, keyed by the token the renderer gets back. */
  private probes = new Map<string, ProbeOutcome>();
  /** Saved probe JSON per job. */
  private jobInfo = new Map<string, { path: string; fetchedAt: number }>();
  /** Recent yt-dlp output per job, for "Copy debug info". */
  private logs = new Map<string, string[]>();
  private lastEmit = new Map<string, number>();
  private retryTimer: NodeJS.Timeout | null = null;
  private store: JsonFile<Job[]>;
  private shuttingDown = false;

  constructor(private readonly deps: ManagerDeps) {
    super();
    this.store = new JsonFile(path.join(deps.workDir, 'jobs.json'), 1000);
    for (const job of this.store.read([])) {
      // Jobs running at quit go back in the queue; their .part files are
      // still in the temp folder, so yt-dlp resumes them.
      if (isActive(job.status)) job.status = 'queued';
      delete job.progress;
      this.jobs.set(job.id, job);
    }
  }

  /** Starts any jobs restored from the last session. */
  start(): void {
    // No job knows a lookup saved before this launch (which ones a job uses
    // isn't kept across launches), so the files left from the last session
    // are only taking up space.
    void this.clearProbeCache();
    this.pump();
    void this.fillAspects();
  }

  /**
   * Deletes saved lookups no job is using. Pages holding an older lookup's
   * token still work: their download simply looks the video up again.
   */
  async clearProbeCache(): Promise<void> {
    const inUse = new Set([...this.jobInfo.values()].map((info) => info.path));
    this.probes.clear();
    const files = await fs.readdir(this.probeDir).catch(() => []);
    for (const name of files) {
      const file = path.join(this.probeDir, name);
      if (!inUse.has(file)) await fs.rm(file, { force: true }).catch(() => {});
    }
  }

  /**
   * Cancels every paused or failed download, deleting its partial files,
   * and deletes working folders no job owns any more.
   */
  async discardUnfinished(): Promise<void> {
    for (const job of this.list()) {
      if (
        (job.status === 'paused' || job.status === 'failed') &&
        !this.running.has(job.id)
      ) {
        // Awaited, unlike cancel(), so the space is free when this returns.
        await this.cleanupTemp(job.id);
        this.setStatus(job, 'canceled');
      }
    }
    const dirs = await fs
      .readdir(path.join(this.deps.workDir, 'jobs'))
      .catch(() => []);
    for (const id of dirs) {
      const job = this.jobs.get(id);
      if (!job || job.status === 'completed' || job.status === 'canceled') {
        await fs
          .rm(this.tempDirFor(id), { recursive: true, force: true })
          .catch(() => {});
      }
    }
  }

  /** Takes every finished, failed or cancelled download off the list. */
  clearFinished(): void {
    for (const job of this.list()) {
      if (['completed', 'failed', 'canceled'].includes(job.status)) {
        this.remove(job.id);
      }
    }
  }

  /**
   * The shape of a finished video, for History: an upright reel shows
   * upright there. Undefined for audio, or without ffprobe.
   */
  private async aspectOf(file: string): Promise<number | undefined> {
    let dir: string | null;
    try {
      dir = this.deps.getBinaries().ffmpegDir;
    } catch {
      // Download Video is off, or yt-dlp is gone: the shape can wait.
      return undefined;
    }
    if (!dir) return undefined;
    return videoAspect(path.join(dir, exeName('ffprobe')), file);
  }

  /** Finds the shape of downloads finished before it was recorded. */
  private async fillAspects() {
    for (const job of this.list()) {
      if (job.status !== 'completed' || !job.outputPath) continue;
      if (job.aspect !== undefined || !existsSync(job.outputPath)) continue;
      const aspect = await this.aspectOf(job.outputPath);
      if (aspect === undefined || !this.jobs.has(job.id)) continue;
      job.aspect = aspect;
      this.emitUpdate(job, true);
      this.persist();
    }
  }

  private tempDirFor(id: string) {
    return path.join(this.deps.workDir, 'jobs', id);
  }

  private get probeDir() {
    return path.join(this.deps.workDir, 'probes');
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Fetches metadata, cached under a token so enqueue() can reuse it. */
  async probe(url: string): Promise<ProbeResult & { probeToken: string }> {
    const settings = this.deps.getSettings();
    // A demo link never uses a browser's sign-ins, so it never asks.
    const blocked =
      settings.cookiesBrowser && !isDemo(url)
        ? await checkBrowserAccess(settings.cookiesBrowser)
        : null;
    if (blocked) throw new ProbeError(blocked);
    const outcome = await probe({
      url: validateUrl(url),
      bin: this.deps.getBinaries(),
      settings,
      probeDir: this.probeDir,
    });
    this.probes.set(outcome.token, outcome);
    this.pruneProbes();
    const { result } = outcome;
    // The picture for the page's card.
    const fallback = result.kind === 'video' ? result.thumbnailFallback : null;
    const thumbnailImage =
      (await fetchThumbnail(result.thumbnail, settings.proxy)) ??
      (fallback ? await fetchThumbnail(fallback, settings.proxy) : null);
    return {
      ...result,
      thumbnailImage,
      probeToken: outcome.token,
    };
  }

  /** Adds jobs, validating everything the renderer sent. */
  enqueue(requests: DownloadRequest[]): Job[] {
    const settings = this.deps.getSettings();
    const created: Job[] = [];
    for (const request of requests.slice(0, 1000)) {
      const url = validateUrl(request.url);
      if (!isQualityPreset(request.quality)) {
        throw new Error(`Unknown quality "${request.quality}"`);
      }
      const now = Date.now();
      const job: Job = {
        id: randomUUID(),
        url,
        status: 'queued',
        quality: request.quality,
        subtitles: request.subtitles === true,
        outputDir: request.outputDir || settings.downloadDir,
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        // What a playlist listed for it, until its own lookup says more.
        ...(request.title && { title: request.title }),
        ...(request.thumbnail && { thumbnail: request.thumbnail }),
        ...(request.duration && { duration: request.duration }),
      };

      // Reuse the preview's metadata if this exact item was probed.
      const probed = request.probeToken
        ? this.probes.get(request.probeToken)
        : undefined;
      if (probed?.result.kind === 'video' && probed.infoJsonPath) {
        Object.assign(job, {
          title: probed.result.title,
          thumbnail: probed.result.thumbnail ?? undefined,
          extractor: probed.result.extractor,
          duration: probed.result.duration ?? undefined,
          isLive: probed.result.isLive,
        });
        this.jobInfo.set(job.id, {
          path: probed.infoJsonPath,
          fetchedAt: probed.fetchedAt,
        });
      }
      this.jobs.set(job.id, job);
      created.push(job);
      this.emitUpdate(job, true);
    }
    this.persist();
    this.pump();
    return created;
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const running = this.running.get(id);
    if (running) {
      // The run loop finishes the cleanup.
      running.reason = 'cancel';
      running.controller.abort();
      return;
    }
    if (job.status === 'completed' || job.status === 'canceled') return;
    void this.cleanupTemp(id).then(() => this.setStatus(job, 'canceled'));
  }

  pause(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const running = this.running.get(id);
    if (running) {
      running.reason = 'pause';
      running.controller.abort();
    } else if (job.status === 'queued') {
      this.setStatus(job, 'paused');
    }
  }

  resume(id: string): void {
    const job = this.jobs.get(id);
    if (job?.status !== 'paused') return;
    this.setStatus(job, 'queued');
    this.pump();
  }

  retry(id: string): void {
    const job = this.jobs.get(id);
    if (!job || (job.status !== 'failed' && job.status !== 'canceled')) return;
    job.attempts = 0;
    delete job.error;
    delete job.retryAt;
    this.setStatus(job, 'queued');
    this.pump();
  }

  /** Removes the job from the list. Never deletes a finished download. */
  remove(id: string): void {
    if (this.running.has(id)) this.cancel(id);
    else void this.cleanupTemp(id);
    this.jobs.delete(id);
    this.jobInfo.delete(id);
    this.logs.delete(id);
    this.persist();
    this.emit('job-removed', id);
  }

  /** Enough to diagnose a failure without seeing the user's screen. */
  debugInfo(id: string): string {
    const job = this.jobs.get(id);
    if (!job) return '';
    let engine: string;
    try {
      const bin = this.deps.getBinaries();
      const ffmpeg = bin.ffmpeg
        ? `${bin.ffmpeg.variant} ${bin.ffmpeg.version ?? '?'} at ${bin.ffmpeg.dir}`
        : 'none';
      engine = `yt-dlp at ${bin.ytdlp}, ffmpeg: ${ffmpeg}`;
    } catch (error) {
      engine = String(error);
    }
    return [
      `URL: ${job.url}`,
      `Status: ${job.status}  Quality: ${job.quality}  Attempts: ${job.attempts}`,
      `Extractor: ${job.extractor ?? '?'}`,
      `Engine: ${engine}`,
      `Platform: ${process.platform} ${process.arch}`,
      `Error: ${job.error ? `${job.error.category}: ${job.error.raw}` : 'none'}`,
      '--- yt-dlp log (last lines) ---',
      ...(this.logs.get(id) ?? []),
    ].join('\n');
  }

  /** Whether any job is running, which may be using FFmpeg right now. */
  get busy(): boolean {
    return this.running.size > 0;
  }

  /**
   * Stops every process, keeping .part files so they resume next launch,
   * and saves the queue. Await it before quitting.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    for (const running of this.running.values()) {
      running.reason = 'shutdown';
      running.controller.abort();
    }
    await Promise.race([
      Promise.allSettled([...this.running.values()].map((r) => r.done)),
      // Never hold up quitting for long.
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    this.store.flush();
  }

  /** Starts as many queued jobs as the limits allow. Safe to call any time. */
  private pump(): void {
    if (this.shuttingDown) return;
    const { maxConcurrent, perSiteLimit } = this.deps.getSettings();
    const now = Date.now();

    const perSite = new Map<string, number>();
    for (const id of this.running.keys()) {
      const job = this.jobs.get(id);
      if (!job) continue;
      const site = siteOf(job.url);
      perSite.set(site, (perSite.get(site) ?? 0) + 1);
    }

    let nextRetryAt = Infinity;
    for (const job of this.list()) {
      if (this.running.size >= maxConcurrent) break;
      if (job.status !== 'queued') continue;
      // A paused-then-resumed job can be queued while its last process is
      // still winding down; two processes would fight over one .part file.
      if (this.running.has(job.id)) continue;
      if (job.retryAt && job.retryAt > now) {
        nextRetryAt = Math.min(nextRetryAt, job.retryAt);
        continue;
      }
      const site = siteOf(job.url);
      if ((perSite.get(site) ?? 0) >= perSiteLimit) continue;
      perSite.set(site, (perSite.get(site) ?? 0) + 1);
      this.launch(job);
    }

    // Wake again when the earliest backoff ends.
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (Number.isFinite(nextRetryAt)) {
      this.retryTimer = setTimeout(
        () => this.pump(),
        Math.max(0, nextRetryAt - now) + 50,
      );
    }
  }

  private launch(job: Job): void {
    const running: Running = {
      controller: new AbortController(),
      reason: null,
      done: Promise.resolve(),
    };
    this.running.set(job.id, running);
    running.done = this.execute(job, running)
      .catch((error) => {
        job.error = engineStartError(error);
        this.setStatus(job, 'failed');
      })
      .finally(() => {
        // Only our own entry; a newer run for the same job may exist.
        if (this.running.get(job.id) === running) this.running.delete(job.id);
        this.pump();
      });
  }

  private async execute(job: Job, running: Running): Promise<void> {
    const { signal } = running.controller;
    delete job.error;
    delete job.retryAt;
    // A browser's sign-ins macOS won't let the app read: said plainly,
    // rather than as yt-dlp's "could not find" the cookies.
    const { cookiesBrowser } = this.deps.getSettings();
    const blocked =
      cookiesBrowser && !isDemo(job.url)
        ? await checkBrowserAccess(cookiesBrowser)
        : null;
    if (blocked) return this.fail(job, blocked);
    job.attempts += 1;

    let bin: Binaries;
    try {
      bin = this.deps.getBinaries();
    } catch (error) {
      return this.fail(job, engineStartError(error));
    }
    const settings = this.deps.getSettings();

    // Metadata, unless a fresh probe is at hand.
    let info = this.jobInfo.get(job.id);
    if (
      !info ||
      !existsSync(info.path) ||
      Date.now() - info.fetchedAt > probeMaxAge
    ) {
      this.setStatus(job, 'probing');
      try {
        const outcome = await probe({
          url: job.url,
          bin,
          settings,
          probeDir: this.probeDir,
          signal,
        });
        if (outcome.result.kind === 'playlist') {
          // Added without a preview and turned out to be a playlist: one
          // job per entry instead.
          this.enqueue(
            outcome.result.entries.map((entry) => ({
              url: entry.url,
              quality: job.quality,
              subtitles: job.subtitles,
              outputDir: job.outputDir,
            })),
          );
          this.remove(job.id);
          return;
        }
        const result = outcome.result;
        Object.assign(job, {
          title: result.title,
          thumbnail: result.thumbnail ?? undefined,
          extractor: result.extractor,
          duration: result.duration ?? undefined,
          isLive: result.isLive,
        });
        info = {
          path: outcome.infoJsonPath ?? '',
          fetchedAt: outcome.fetchedAt,
        };
        this.jobInfo.set(job.id, info);
      } catch (error) {
        if (running.reason) return this.afterStop(job, running.reason);
        return this.fail(
          job,
          error instanceof ProbeError
            ? error.jobError
            : engineStartError(error),
        );
      }
    }

    const tempDir = this.tempDirFor(job.id);
    await fs.mkdir(tempDir, { recursive: true });
    // A failure here is reported by yt-dlp as a permission error.
    await fs.mkdir(job.outputDir, { recursive: true }).catch(() => {});

    const args = buildDownloadArgs({
      bin,
      settings,
      quality: job.quality,
      subtitles: job.subtitles,
      outputDir: job.outputDir,
      tempDir,
      source: { infoJsonPath: info.path },
      isLive: job.isLive,
    });

    const tracker = new ProgressTracker(job.isLive === true);
    let outputPath: string | null = null;
    const log: string[] = [];
    const keepLog = (line: string) => {
      log.push(line);
      if (log.length > 80) log.shift();
    };
    this.logs.set(job.id, log);
    this.setStatus(job, 'downloading');

    let result;
    try {
      // A demo link runs its predefined flow instead (see ../engine/demo).
      const runner = isDemo(job.url)
        ? (_: string, demoArgs: string[], opts: RunOptions) =>
            runDemo(job.url, demoArgs, opts, bin.ffmpegDir)
        : run;
      result = await runner(bin.ytdlp, args, {
        signal,
        prependPath: [
          ...(bin.ffmpegDir ? [bin.ffmpegDir] : []),
          ...bin.pathDirs,
        ],
        onStdout: (line) => {
          const parsed = parseLine(line);
          if (parsed.type === 'other') keepLog(line);
          if (parsed.type === 'file') outputPath = parsed.path;
          if (!tracker.feed(parsed)) return;
          job.progress = tracker.snapshot();
          if (tracker.isPostprocessing && job.status !== 'processing') {
            this.setStatus(job, 'processing');
          } else {
            this.emitUpdate(job);
          }
        },
        onStderr: keepLog,
      });
    } catch (error) {
      return this.fail(job, engineStartError(error));
    }

    if (running.reason) return this.afterStop(job, running.reason);

    if (result.code === 0 && outputPath) {
      job.outputPath = outputPath;
      job.progress = { ...tracker.snapshot(), percent: 100 };
      job.fileSize = await sizeOf(outputPath);
      job.aspect = await this.aspectOf(outputPath);
      await this.cleanupTemp(job.id);
      this.setStatus(job, 'completed');
      return;
    }
    this.fail(job, classifyError(result.stderrTail));
  }

  /** What a user's stop means, once the process has exited. */
  private async afterStop(job: Job, reason: StopReason): Promise<void> {
    if (reason === 'pause') {
      // The temp folder stays, so resume continues from the .part file.
      this.setStatus(job, 'paused');
    } else if (reason === 'shutdown') {
      job.status = 'queued';
      this.persist();
    } else if (job.isLive) {
      // Stopping a live stream keeps what was recorded so far.
      await this.finalizeLive(job);
    } else {
      // Cleaned up first, so whoever hears "canceled" finds no files left.
      await this.cleanupTemp(job.id);
      this.setStatus(job, 'canceled');
    }
  }

  /** Retries transient errors after 30, 60 then 120 s; otherwise fails. */
  private fail(job: Job, error: JobError): void {
    job.error = error;
    if (
      error.retryable &&
      job.attempts < maxAutoRetries &&
      !this.shuttingDown
    ) {
      job.retryAt = Date.now() + 30_000 * 2 ** (job.attempts - 1);
      this.setStatus(job, 'queued');
      return;
    }
    this.setStatus(job, 'failed');
  }

  /**
   * Moves a stopped live recording out of the temp folder. With
   * --hls-use-mpegts the .part file is a playable .ts stream already.
   */
  private async finalizeLive(job: Job): Promise<void> {
    const tempDir = this.tempDirFor(job.id);
    const parts = existsSync(tempDir)
      ? readdirSync(tempDir).filter((name) => !name.endsWith('.ytdl'))
      : [];
    const sized = await Promise.all(
      parts.map(async (name) => ({
        name,
        size: (await fs.stat(path.join(tempDir, name))).size,
      })),
    );
    const biggest = sized.sort((a, b) => b.size - a.size)[0];
    if (biggest) {
      const from = path.join(tempDir, biggest.name);
      const target = path.join(
        job.outputDir,
        biggest.name.replace(/\.part$/, ''),
      );
      // A rename fails across drives; copy instead.
      await fs.rename(from, target).catch(() => fs.copyFile(from, target));
      job.outputPath = target;
      job.fileSize = await sizeOf(target);
      job.aspect = await this.aspectOf(target);
      this.setStatus(job, 'completed');
    } else {
      this.setStatus(job, 'canceled');
    }
    await this.cleanupTemp(job.id);
  }

  private async cleanupTemp(id: string): Promise<void> {
    await fs
      .rm(this.tempDirFor(id), { recursive: true, force: true })
      .catch(() => {});
    const info = this.jobInfo.get(id);
    if (info) {
      await fs.rm(info.path, { force: true }).catch(() => {});
      this.jobInfo.delete(id);
    }
  }

  /** Keeps the 50 latest probes, and their files unless a job needs them. */
  private pruneProbes(): void {
    const inUse = new Set([...this.jobInfo.values()].map((info) => info.path));
    const entries = [...this.probes.entries()].sort(
      (a, b) => b[1].fetchedAt - a[1].fetchedAt,
    );
    for (const [token, outcome] of entries.slice(50)) {
      this.probes.delete(token);
      if (outcome.infoJsonPath && !inUse.has(outcome.infoJsonPath)) {
        void fs.rm(outcome.infoJsonPath, { force: true });
      }
    }
  }

  private setStatus(job: Job, status: JobStatus): void {
    job.status = status;
    this.persist();
    this.emitUpdate(job, true);
  }

  /** Emits job-updated, throttled for progress-only changes. */
  private emitUpdate(job: Job, force = false): void {
    // Removed while its process was winding down.
    if (!this.jobs.has(job.id)) return;
    const now = Date.now();
    if (!force && now - (this.lastEmit.get(job.id) ?? 0) < progressEmitMs) {
      return;
    }
    this.lastEmit.set(job.id, now);
    job.updatedAt = now;
    this.emit('job-updated', { ...job });
  }

  private persist(): void {
    // Progress is recomputed on resume, so it isn't saved.
    this.store.write(
      this.list().map((job) => ({ ...job, progress: undefined })),
    );
  }
}

/** A finished file's size in bytes, or undefined if it can't be read. */
function sizeOf(file: string): Promise<number | undefined> {
  return fs.stat(file).then(
    (stat) => stat.size,
    () => undefined,
  );
}
