// The boundary between the renderer and the main process. Every handler:
//   1. answers only our own page (a page that navigated elsewhere gets
//      nothing);
//   2. validates its arguments, treating the renderer as untrusted input,
//      so markup in a video title can never become yt-dlp options;
//   3. answers with an { ok, value | error } envelope.
import { cleanDownloadRequest } from './downloads/requests';
import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  shell,
} from 'electron';

import { existsSync, statSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { gifDelays } from '../shared/gif';
import { IPC, type IpcResult } from '../shared/ipc';
import { isStorageItemId, type StorageItemId } from '../shared/storage';
import { isToolkitId, type ToolkitId } from '../shared/toolkits';
import type {
  FilePreview,
  SessionMeta,
  SessionStatus,
  Settings,
} from '../shared/types';
import type { DownloadManager } from './downloads/manager';
import type { ExternalTools } from './engine/external';
import type { Player } from './player';
import type { StorageInventory } from './storage/inventory';
import type { SessionStore } from './storage/sessions';
import { installedBrowsers } from './engine/browsers';
import { ProbeError } from './engine/probe';
import { fetchThumbnail } from './engine/thumbnail';
import { frameAt, waveform } from './media';
import { resolveOutputs } from './tools/outputs';
import type { SettingsStore } from './storage/settings';
import type { ToolQueue } from './tools/queue';
import type { Recordings } from './tools/recordings';
import type { Toolkits } from './toolkits/service';
import { ToolkitMissingError } from './toolkits/store';

export type IpcDeps = {
  manager: DownloadManager;
  /** Plays finished downloads in the app (see player.ts). */
  player: Player;
  /** Tool sessions, for History (see storage/sessions.ts). */
  sessions: SessionStore;
  /** A file's picture and length, for History (see preview.ts). */
  previewFile: (file: string) => Promise<FilePreview>;
  /** The app's ffmpeg, for an editor's frames and waveform, or null. */
  ffmpeg: () => string | null;
  /** Every other tool's jobs (see src/tools). */
  tools: ToolQueue;
  /** Recordings made in the page, until a tool runs on them. */
  recordings: Recordings;
  settings: SettingsStore;
  /** Installs, updates and removes toolkits (see toolkits/service.ts). */
  toolkits: Toolkits;
  /** yt-dlp as the person installed it (engine/external.ts). */
  externalTools: ExternalTools;
  /** What the app keeps on disk, for Settings › Storage. */
  storage: StorageInventory;
  /** Where tools' previews are written, each deleted once it is read. */
  previewDir: string;
  /** URL prefix our page is loaded from. */
  appOrigin: string;
  getMainWindow: () => BrowserWindow | null;
};

const isString = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length <= max;

const assertToolkit = (value: unknown): ToolkitId => {
  if (!isToolkitId(value)) throw new Error('Unknown toolkit');
  return value;
};

const assertStorageItem = (value: unknown): StorageItemId => {
  if (!isStorageItemId(value)) throw new Error('Unknown storage item');
  return value;
};

const assertId = (value: unknown): string => {
  if (!isString(value, 64) || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error('Invalid job id');
  }
  return value;
};

export function registerIpc(deps: IpcDeps): void {
  const { manager, settings } = deps;

  /** Registers a handler behind the sender check and the envelope. */
  function handle<A extends unknown[], R>(
    channel: string,
    fn: (...args: A) => R | Promise<R>,
  ) {
    ipcMain.handle(
      channel,
      async (
        event: IpcMainInvokeEvent,
        ...args: unknown[]
      ): Promise<IpcResult<Awaited<R>>> => {
        if (!(event.senderFrame?.url ?? '').startsWith(deps.appOrigin)) {
          return { ok: false, error: { message: 'Forbidden' } };
        }
        try {
          return { ok: true, value: await fn(...(args as A)) };
        } catch (error) {
          if (error instanceof ProbeError) {
            const { message, category, action, toolkit } = error.jobError;
            return { ok: false, error: { message, category, action, toolkit } };
          }
          if (error instanceof ToolkitMissingError) {
            return {
              ok: false,
              error: {
                message: error.message,
                category: 'toolkit_missing',
                action: 'install_toolkit',
                toolkit: error.toolkit,
              },
            };
          }
          return {
            ok: false,
            error: {
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      },
    );
  }

  handle(IPC.probe, (url: unknown) => {
    if (!isString(url)) throw new Error('Invalid URL');
    return manager.probe(url);
  });

  handle(IPC.enqueue, (requests: unknown) => {
    // Nothing is queued while Download Video is off or yt-dlp is gone.
    deps.externalTools.forJob();
    if (
      !Array.isArray(requests) ||
      requests.length === 0 ||
      requests.length > 1000
    ) {
      throw new Error('Nothing to download');
    }
    const clean = requests.map(cleanDownloadRequest);
    return manager.enqueue(clean);
  });

  handle(IPC.listJobs, () => manager.list());
  handle(IPC.cancel, (id: unknown) => manager.cancel(assertId(id)));
  handle(IPC.pause, (id: unknown) => manager.pause(assertId(id)));
  handle(IPC.resume, (id: unknown) => manager.resume(assertId(id)));
  handle(IPC.retry, (id: unknown) => manager.retry(assertId(id)));
  handle(IPC.remove, (id: unknown) => manager.remove(assertId(id)));

  handle(IPC.revealFile, (id: unknown) => {
    // The path comes from our own job record, never from the renderer.
    const job = manager.get(assertId(id));
    if (job?.outputPath) shell.showItemInFolder(job.outputPath);
  });

  // A picture for a download's card when the lookup gave none (a playlist's
  // videos): the site's thumbnail, known once the download has looked its
  // video up, fetched and inlined here (the page may only show inline
  // images); else, once saved, a frame of the file. Each is fetched once.
  const thumbnails = new Map<string, Promise<string | null>>();
  const frames = new Map<string, Promise<string | null>>();
  handle(IPC.entryThumbnail, (token: unknown, index: unknown) => {
    if (!isString(token, 64) || typeof index !== 'number') return null;
    return manager.entryThumbnail(token, index);
  });
  /** A video's own picture from the site it came from, fetched once. */
  const siteThumbnail = (url: string) => {
    let image = thumbnails.get(url);
    if (!image) {
      image = fetchThumbnail(url, settings.get().proxy).catch(() => null);
      thumbnails.set(url, image);
    }
    return image;
  };
  /**
   * The site's picture for a file, if it was downloaded, or made by a tool
   * (or several, one after another) from a file that was: so a muted or
   * compressed download shows the video's own thumbnail, not a frame.
   */
  const sourceThumbnail = async (
    file: string,
    depth = 0,
  ): Promise<string | null> => {
    const download = manager
      .list()
      .find((job) => job.status === 'completed' && job.outputPath === file);
    if (download?.thumbnail) return siteThumbnail(download.thumbnail);
    const input = deps.tools.inputOf(file);
    return input && depth < 10 ? sourceThumbnail(input, depth + 1) : null;
  };
  handle(IPC.downloadPreview, async (id: unknown) => {
    const job = manager.get(assertId(id));
    if (!job) return null;
    if (job.thumbnail) {
      const found = await siteThumbnail(job.thumbnail);
      if (found) return found;
    }
    const file = job.status === 'completed' ? job.outputPath : undefined;
    if (!file || !existsSync(file)) return null;
    let frame = frames.get(file);
    if (!frame) {
      frame = deps
        .previewFile(file)
        .then((preview) => preview.thumbnail)
        .catch(() => null);
      frames.set(file, frame);
    }
    return frame;
  });

  handle(IPC.openFile, async (id: unknown) => {
    // As above: only a path from our own job record is ever opened.
    const job = manager.get(assertId(id));
    if (!job?.outputPath) return;
    const error = await shell.openPath(job.outputPath);
    if (error) throw new Error(error);
  });

  handle(IPC.preparePlayback, (id: unknown, track: unknown) => {
    const job = manager.get(assertId(id));
    if (job?.status !== 'completed' || !job.outputPath) {
      throw new Error('This download has not finished.');
    }
    if (!existsSync(job.outputPath)) {
      throw new Error('The file is no longer where it was saved.');
    }
    // The audio was saved chosen language first, then the original.
    return deps.player.prepare(
      job.id,
      job.outputPath,
      typeof track === 'number' && Number.isInteger(track) && track >= 0
        ? track
        : 0,
      {
        languages: [job.audioLanguage, job.originalLanguage],
        original: job.originalLanguage,
      },
    );
  });
  handle(IPC.cancelPlayback, (id: unknown) => deps.player.cancel(assertId(id)));

  handle(IPC.copyDebugInfo, (id: unknown) =>
    clipboard.writeText(manager.debugInfo(assertId(id))),
  );

  handle(IPC.getSettings, () => settings.get());
  handle(IPC.browsers, () => installedBrowsers());
  handle(IPC.openPrivacySettings, async () => {
    if (process.platform !== 'darwin') return;
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );
  });
  handle(IPC.updateSettings, (patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) {
      throw new Error('Invalid settings');
    }
    // The folder changes only through chooseDownloadDir's native dialog.
    const { downloadDir: _, ...rest } = patch as Partial<Settings>;
    return settings.update(rest);
  });
  handle(IPC.chooseDownloadDir, async () => {
    const window = deps.getMainWindow();
    const options: Electron.OpenDialogOptions = {
      defaultPath: settings.get().downloadDir,
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const dir = result.canceled ? null : (result.filePaths[0] ?? null);
    if (dir) settings.update({ downloadDir: dir });
    return dir;
  });

  const isStrings = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.length <= 1000 &&
    value.every((item) => isString(item));

  handle(IPC.toolsConnected, () => deps.tools.connected());
  handle(IPC.toolsRun, (toolId: unknown, request: unknown) => {
    const {
      files: given,
      links,
      outputs,
      values,
      attachments: attached = {},
    } = (request ?? {}) as Record<string, unknown>;
    if (
      !isString(toolId, 128) ||
      !Array.isArray(given) ||
      !isStrings(links) ||
      typeof attached !== 'object' ||
      attached === null ||
      Array.isArray(attached)
    ) {
      throw new Error('Invalid request');
    }
    // Each file is a path from the preload, or a saved session file's
    // token, whose path comes from our own records; order is kept.
    const pathOf = (file: unknown) => {
      if (isString(file)) return file;
      const token = (file as { token?: unknown } | null)?.token;
      const found = isString(token, 64) ? deps.sessions.filePath(token) : null;
      if (!found) throw new Error('A saved file is no longer known.');
      return found;
    };
    const files = given.map(pathOf);
    if (files.length > 1000) throw new Error('Invalid request');
    // The file chosen for each file option, the same way.
    const entries = Object.entries(attached);
    if (entries.length > 20 || !entries.every(([key]) => isString(key, 128))) {
      throw new Error('Invalid request');
    }
    const attachments = Object.fromEntries(
      entries.map(([key, file]) => [key, pathOf(file)]),
    );
    // Earlier outputs, as in a chain of steps, come as references to the
    // jobs that wrote them; their paths come from our own records.
    const earlier = resolveOutputs(outputs, {
      toolOutputs: (id) => deps.tools.outputsOf(id),
      download: (id) => manager.get(id),
    });
    // The queue checks each file exists and each link is http(s), and
    // checks the values against the tool's own options.
    return deps.tools.run(toolId, {
      files: [...files, ...earlier],
      links,
      values,
      attachments,
    });
  });
  handle(IPC.toolsList, () => deps.tools.list());

  // Sessions: saved from the page, listed and opened again from History.
  const sessionsChanged = () =>
    deps.getMainWindow()?.webContents.send(IPC.sessionsChanged, null);
  handle(IPC.sessionsSave, (input: unknown) => {
    const { id, toolId, title, summary, meta, state } = (input ?? {}) as Record<
      string,
      unknown
    >;
    if (
      !isString(id, 64) ||
      !/^[0-9a-f-]{36}$/i.test(id) ||
      !isString(toolId, 128) ||
      !isString(title, 100_000) ||
      !isString(summary, 100_000) ||
      typeof state !== 'string' ||
      state.length > 8 * 1024 * 1024
    ) {
      throw new Error('Invalid session');
    }
    const saved = deps.sessions.save({
      id,
      toolId,
      title: title.slice(0, 500),
      summary: summary.slice(0, 500),
      meta: checkMeta(meta),
      state,
    });
    sessionsChanged();
    return saved;
  });
  handle(IPC.sessionsList, () => deps.sessions.list());
  handle(IPC.sessionsGet, (id: unknown) => deps.sessions.get(assertId(id)));
  handle(IPC.sessionsRemove, (id: unknown) => {
    deps.sessions.remove(assertId(id));
    sessionsChanged();
  });
  handle(IPC.sessionsClear, () => {
    deps.sessions.clear();
    sessionsChanged();
  });
  handle(IPC.sessionsAddFile, (filePath: unknown, file: unknown) => {
    const { name, size, type } = (file ?? {}) as Record<string, unknown>;
    if (
      !isString(filePath) ||
      !path.isAbsolute(filePath) ||
      !isString(name, 1024) ||
      typeof size !== 'number' ||
      !isString(type, 256)
    ) {
      throw new Error('Invalid file');
    }
    return deps.sessions.addFile(filePath, { name, size, type });
  });
  // Made once per file, and kept with it; asked again while it is being
  // made, it answers both at once.
  const previews = new Map<string, Promise<FilePreview>>();
  handle(IPC.sessionsPreview, (token: unknown) => {
    const none = { thumbnail: null, duration: null };
    const file = isString(token, 64) ? deps.sessions.filePath(token) : null;
    if (!file || typeof token !== 'string') return none;
    const kept = deps.sessions.preview(token);
    if (kept) return kept;
    let pending = previews.get(token);
    if (!pending) {
      pending = deps
        .previewFile(file)
        .then((preview) => {
          deps.sessions.setPreview(token, preview);
          return preview;
        })
        .finally(() => previews.delete(token));
      previews.set(token, pending);
    }
    return pending;
  });
  // An editor's file (see media.ts): one the user added, by its token, or
  // an earlier output, by its job; its path comes from our own records.
  const mediaOf = (raw: unknown): { id: string; file: string } => {
    const ref = (raw ?? {}) as { source?: unknown; token?: unknown };
    let id: string;
    let file: string | null;
    if (ref.source === 'file') {
      if (!isString(ref.token, 64)) throw new Error('Invalid request');
      id = `file-${ref.token}`;
      file = deps.sessions.filePath(ref.token);
    } else {
      const output = raw as { jobId: string; index: number };
      [file] = resolveOutputs([raw], {
        toolOutputs: (jobId) => deps.tools.outputsOf(jobId),
        download: (jobId) => manager.get(jobId),
      });
      id = output.index ? `${output.jobId}-${output.index}` : output.jobId;
    }
    if (!file || !existsSync(file)) {
      throw new Error('That file is no longer available.');
    }
    return { id, file };
  };
  const ffmpegOrFail = () => {
    const ffmpeg = deps.ffmpeg();
    if (!ffmpeg) throw new Error('FFmpeg isn’t installed yet.');
    return ffmpeg;
  };
  handle(IPC.mediaPlay, (ref: unknown) => {
    const { id, file } = mediaOf(ref);
    return deps.player.prepare(id, file);
  });
  handle(IPC.mediaCancelPlay, (ref: unknown) =>
    deps.player.cancel(mediaOf(ref).id),
  );
  handle(IPC.mediaFrame, (ref: unknown, seconds: unknown, height: unknown) => {
    const { file } = mediaOf(ref);
    if (
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      typeof height !== 'number' ||
      !(height >= 16 && height <= 720)
    ) {
      throw new Error('Invalid request');
    }
    return frameAt(ffmpegOrFail(), file, seconds, height);
  });
  // Read once per file and length: it reads the whole of its sound.
  const waveforms = new Map<string, Promise<number[] | null>>();
  handle(IPC.mediaWaveform, (ref: unknown, count: unknown) => {
    const { file } = mediaOf(ref);
    if (
      !Number.isInteger(count) ||
      (count as number) < 1 ||
      (count as number) > 2000
    ) {
      throw new Error('Invalid request');
    }
    const key = `${file}:${count}`;
    let found = waveforms.get(key);
    if (!found) {
      found = waveform(ffmpegOrFail(), file, count as number);
      found.catch(() => waveforms.delete(key));
      waveforms.set(key, found);
    }
    return found;
  });
  handle(IPC.toolsSaveRecording, (data: unknown, type: unknown) => {
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data instanceof Uint8Array
          ? data
          : null;
    if (!bytes || !isString(type, 128)) throw new Error('Invalid recording');
    const saved = deps.recordings.save(bytes, type);
    // Registered like a dropped file, so `run` takes it by its token.
    return deps.sessions.addFile(saved.path, {
      name: saved.name,
      size: bytes.byteLength,
      type: saved.type,
    });
  });
  handle(IPC.toolsCancel, (id: unknown) => deps.tools.cancel(assertId(id)));
  handle(IPC.toolsRemove, (id: unknown) => deps.tools.remove(assertId(id)));
  handle(IPC.toolsReveal, (id: unknown) => {
    // The path comes from the queue's own record, never from the renderer.
    const [output] = deps.tools.outputsOf(assertId(id));
    if (output) shell.showItemInFolder(output);
  });
  // A frame of a finished output, for its card: made once per file.
  const outputPreviews = new Map<string, Promise<FilePreview>>();
  handle(IPC.toolsPreview, (id: unknown) => {
    const [output] = deps.tools.outputsOf(assertId(id));
    if (!output || !existsSync(output)) {
      return { thumbnail: null, duration: null };
    }
    let preview = outputPreviews.get(output);
    if (!preview) {
      // The picture of the video it came from, if that was downloaded;
      // else a frame of its own. Its length is always its own.
      preview = Promise.all([
        deps
          .previewFile(output)
          .catch(() => ({ thumbnail: null, duration: null })),
        sourceThumbnail(output).catch(() => null),
      ]).then(async ([own, source]) => {
        // A GIF: its frames, and its length from their delays (FFmpeg
        // reads it as a still picture).
        const gif =
          path.extname(output).toLowerCase() === '.gif'
            ? await readFile(output)
                .then((bytes) => gifDelays(bytes))
                .catch(() => null)
            : null;
        return {
          thumbnail: source ?? own.thumbnail,
          duration: gif
            ? gif.reduce((total, delay) => total + delay, 0) / 1000
            : own.duration,
          ...(gif && { frames: gif.length }),
        };
      });
      outputPreviews.set(output, preview);
    }
    return preview;
  });
  handle(IPC.toolsOpen, async (id: unknown) => {
    const [output] = deps.tools.outputsOf(assertId(id));
    if (!output) return;
    const error = await shell.openPath(output);
    if (error) throw new Error(error);
  });
  // A tool's output plays in the same player as a download, by the job's
  // id (both are random UUIDs, so they never clash).
  handle(IPC.toolsPreparePlayback, (id: unknown, track: unknown) => {
    const jobId = assertId(id);
    const [output] = deps.tools.outputsOf(jobId);
    if (!output) throw new Error('This file is not ready yet.');
    if (!existsSync(output)) {
      throw new Error('The file is no longer where it was saved.');
    }
    return deps.player.prepare(
      jobId,
      output,
      typeof track === 'number' && Number.isInteger(track) && track >= 0
        ? track
        : 0,
    );
  });
  handle(IPC.toolsCancelPlayback, (id: unknown) =>
    deps.player.cancel(assertId(id)),
  );

  // Previews: a tool run on an editor's file without a job (see
  // ToolQueue.preview), its file handed back as bytes and then deleted.
  // One at a time per id: a new one with the same id stops the last.
  const previewRuns = new Map<string, AbortController>();
  handle(
    IPC.toolsMakePreview,
    async (id: unknown, toolId: unknown, ref: unknown, values: unknown) => {
      const previewId = assertId(id);
      if (!isString(toolId, 128)) throw new Error('Invalid request');
      const { file } = mediaOf(ref);
      previewRuns.get(previewId)?.abort();
      const controller = new AbortController();
      previewRuns.set(previewId, controller);
      try {
        const { output, note } = await deps.tools.preview(
          toolId,
          { file, values },
          {
            dir: deps.previewDir,
            signal: controller.signal,
            onProgress: (percent) =>
              deps.getMainWindow()?.webContents.send(IPC.toolPreviewProgress, {
                id: previewId,
                percent,
              }),
          },
        );
        try {
          const bytes = await readFile(output);
          return {
            bytes: new Uint8Array(bytes),
            size: bytes.byteLength,
            ...(note && { note }),
          };
        } finally {
          await rm(output, { force: true });
        }
      } finally {
        if (previewRuns.get(previewId) === controller) {
          previewRuns.delete(previewId);
        }
      }
    },
  );
  handle(IPC.toolsCancelPreview, (id: unknown) => {
    previewRuns.get(assertId(id))?.abort();
  });
  // A finished GIF, for the app's GIF player, which draws its frames
  // itself; the path comes from the queue's own record.
  handle(IPC.toolsGifBytes, async (id: unknown) => {
    const [output] = deps.tools.outputsOf(assertId(id));
    if (!output || path.extname(output).toLowerCase() !== '.gif') {
      throw new Error('This isn’t a GIF.');
    }
    if (!existsSync(output)) {
      throw new Error('The file is no longer where it was saved.');
    }
    if (statSync(output).size > 1024 * 1024 * 1024) {
      throw new Error('This GIF is too large to play in the app.');
    }
    return new Uint8Array(await readFile(output));
  });

  // Toolkits: the page names one by id, and a variant from its offers;
  // where it is downloaded from is the catalog's business, never the page's.
  const { toolkits } = deps;
  handle(IPC.toolkitsList, () => toolkits.list());
  handle(IPC.toolkitsInstall, async (id: unknown, variant: unknown) => {
    if (variant !== undefined && !isString(variant, 64)) {
      throw new Error('Unknown variant');
    }
    await toolkits.install(assertToolkit(id), variant);
    return toolkits.list();
  });
  handle(IPC.toolkitsCancel, (id: unknown) =>
    toolkits.cancel(assertToolkit(id)),
  );
  handle(IPC.toolkitsRemove, async (id: unknown) => {
    await toolkits.remove(assertToolkit(id));
    return toolkits.list();
  });
  // Storage: the page names an item; which files that is, and how they are
  // cleared, is decided here.
  const { storage } = deps;
  handle(IPC.storageReport, () => storage.report());
  handle(IPC.storageClear, async (id: unknown) => {
    await storage.clear(assertStorageItem(id));
    return storage.report();
  });
  handle(IPC.storageReveal, async (id: unknown) => {
    const target = await storage.revealPath(assertStorageItem(id));
    if (!target) return;
    // A folder opens; a file is shown selected in its folder.
    if (statSync(target).isDirectory()) await shell.openPath(target);
    else shell.showItemInFolder(target);
  });
  handle(IPC.storageEraseAll, async () => {
    await storage.eraseAll();
    return storage.report();
  });

  handle(IPC.toolkitsCheckUpdates, async () => {
    await toolkits.checkForUpdates();
    return toolkits.list();
  });

  // Programs the person installed: the page never names a path; a chosen
  // yt-dlp comes from the system's own file dialog.
  const { externalTools } = deps;
  handle(IPC.externalToolsStatus, () => externalTools.status());
  handle(IPC.externalToolsRescan, () => externalTools.scan());
  handle(IPC.externalToolsChoose, async () => {
    const win = deps.getMainWindow();
    const options = {
      title: 'Choose yt-dlp',
      buttonLabel: 'Use This yt-dlp',
      properties: ['openFile' as const],
      ...(process.platform === 'win32'
        ? { filters: [{ name: 'Programs', extensions: ['exe'] }] }
        : {}),
    };
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return externalTools.status();
    return externalTools.choose(file);
  });
  handle(IPC.externalToolsForget, () => externalTools.forgetChosen());
  handle(IPC.externalToolsSetEnabled, (id: unknown, on: unknown) => {
    if (id !== 'ytdlp' || typeof on !== 'boolean') {
      throw new Error('Unknown program');
    }
    return externalTools.setEnabled(id, on);
  });
}

const statuses = new Set<SessionStatus>([
  'draft',
  'running',
  'paused',
  'done',
  'failed',
  'cancelled',
]);

/** A session's meta from the page, keeping only what is well formed. */
function checkMeta(value: unknown): SessionMeta {
  const input = (value ?? {}) as Record<string, unknown>;
  const meta: SessionMeta = {};
  const { thumbnail, duration, aspect, jobs, doing, done, playlist } = input;
  if (
    isString(thumbnail, 512 * 1024) &&
    /^data:image\/(jpeg|png|webp);base64,/.test(thumbnail)
  ) {
    meta.thumbnail = thumbnail;
  }
  if (typeof duration === 'number' && Number.isFinite(duration)) {
    meta.duration = Math.max(0, duration);
  }
  if (typeof aspect === 'number' && aspect > 0.1 && aspect < 10) {
    meta.aspect = aspect;
  }
  if (jobs && typeof jobs === 'object') {
    const entries = Object.entries(jobs as Record<string, unknown>)
      .filter(
        (entry): entry is [string, SessionStatus] =>
          entry[0].length <= 64 && statuses.has(entry[1] as SessionStatus),
      )
      .slice(0, 1000);
    meta.jobs = Object.fromEntries(entries);
  }
  if (isString(doing, 64)) meta.doing = doing;
  if (isString(done, 64)) meta.done = done;
  if (Number.isInteger(playlist) && (playlist as number) > 0) {
    meta.playlist = playlist as number;
  }
  return meta;
}
