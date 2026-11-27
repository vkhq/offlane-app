// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
//
// The page gets a fixed set of functions, never ipcRenderer itself, which
// could call any channel.
import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
  webUtils,
} from 'electron';

import type {
  ExternalToolsApi,
  ExternalToolsStatus,
} from '../shared/externalTools';
import { IPC, type IpcResult } from '../shared/ipc';
import type { StorageApi } from '../shared/storage';
import type { ToolkitStatus, ToolkitsApi } from '../shared/toolkits';
import type { PreviewProgress, ToolJob, ToolsApi } from '../shared/tools';
import type {
  DownloaderApi,
  Job,
  PlaybackProgress,
  ProbeResult,
  SavedFile,
  MediaApi,
  SessionsApi,
} from '../shared/types';

type MenuLine = { id: string; label: string; enabled?: boolean } | null;

contextBridge.exposeInMainWorld('app', {
  // The window has macOS's sidebar material behind it (see the main process).
  vibrancy: process.platform === 'darwin',
  quit: () => ipcRenderer.send('quit'),
  setCanvasShown: (shown: boolean) => ipcRenderer.send('canvas-shown', shown),
  userName: (): Promise<string> => ipcRenderer.invoke('user-name'),
  version: (): Promise<string> => ipcRenderer.invoke('app-version'),
  contextMenu: (lines: MenuLine[]): Promise<string | null> =>
    ipcRenderer.invoke('context-menu', lines),
});

/** Invokes a channel and unwraps the { ok, value | error } envelope. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (result.ok) return result.value;
  // Only an Error's message survives the context bridge; a call whose
  // page needs the category or action answers them instead (see probe).
  throw new Error(result.error.message);
}

/** Subscribes to an event from the main process; returns an unsubscribe. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const downloader: DownloaderApi = {
  probe: async (url) => {
    const answer = (await ipcRenderer.invoke(IPC.probe, url)) as IpcResult<
      ProbeResult & { probeToken: string }
    >;
    return answer.ok
      ? { ok: true, result: answer.value }
      : { ok: false, error: answer.error };
  },
  enqueue: (requests) => call(IPC.enqueue, requests),
  listJobs: () => call(IPC.listJobs),
  cancel: (id) => call(IPC.cancel, id),
  pause: (id) => call(IPC.pause, id),
  resume: (id) => call(IPC.resume, id),
  retry: (id) => call(IPC.retry, id),
  remove: (id) => call(IPC.remove, id),
  revealFile: (id) => call(IPC.revealFile, id),
  preview: (id) => call(IPC.downloadPreview, id),
  entryThumbnail: (probeToken, index) =>
    call(IPC.entryThumbnail, probeToken, index),
  openFile: (id) => call(IPC.openFile, id),
  preparePlayback: (id, audioTrack) =>
    call(IPC.preparePlayback, id, audioTrack),
  cancelPlayback: (id) => call(IPC.cancelPlayback, id),
  onPlaybackProgress: (cb) => on<PlaybackProgress>(IPC.playbackProgress, cb),
  copyDebugInfo: (id) => call(IPC.copyDebugInfo, id),
  getSettings: () => call(IPC.getSettings),
  browsers: () => call(IPC.browsers),
  openPrivacySettings: () => call(IPC.openPrivacySettings),
  updateSettings: (patch) => call(IPC.updateSettings, patch),
  chooseDownloadDir: () => call(IPC.chooseDownloadDir),
  onJobUpdated: (cb) => on<Job>(IPC.jobUpdated, cb),
  onJobRemoved: (cb) => on<string>(IPC.jobRemoved, cb),
};

const toolkits: ToolkitsApi = {
  list: () => call(IPC.toolkitsList),
  install: (id, variant) => call(IPC.toolkitsInstall, id, variant),
  cancel: (id) => call(IPC.toolkitsCancel, id),
  remove: (id) => call(IPC.toolkitsRemove, id),
  checkForUpdates: () => call(IPC.toolkitsCheckUpdates),
  onChanged: (cb) => on<ToolkitStatus[]>(IPC.toolkitsChanged, cb),
};

const externalTools: ExternalToolsApi = {
  status: () => call(IPC.externalToolsStatus),
  rescan: () => call(IPC.externalToolsRescan),
  chooseYtdlp: () => call(IPC.externalToolsChoose),
  forgetChosenYtdlp: () => call(IPC.externalToolsForget),
  setEnabled: (id, on) => call(IPC.externalToolsSetEnabled, id, on),
  onChanged: (cb) => on<ExternalToolsStatus>(IPC.externalToolsChanged, cb),
};

const tools: ToolsApi = {
  connected: () => call(IPC.toolsConnected),
  // A page cannot see where a file is on disk; only the preload can, and
  // only for files the user dropped or picked.
  run: (toolId, { files, links, outputs = [], values, attachments = {} }) => {
    // A saved file goes by its token; the main process looks its path up.
    const pathOf = (file: File | SavedFile) =>
      file instanceof File
        ? webUtils.getPathForFile(file)
        : { token: file.token };
    return call(IPC.toolsRun, toolId, {
      files: files.map(pathOf),
      links,
      outputs,
      values,
      attachments: Object.fromEntries(
        Object.entries(attachments).map(([key, file]) => [key, pathOf(file)]),
      ),
    });
  },
  saveRecording: (data, type) => call(IPC.toolsSaveRecording, data, type),
  list: () => call(IPC.toolsList),
  cancel: (id) => call(IPC.toolsCancel, id),
  remove: (id) => call(IPC.toolsRemove, id),
  reveal: (id, index) => call(IPC.toolsReveal, id, index),
  open: (id, index) => call(IPC.toolsOpen, id, index),
  preview: (id) => call(IPC.toolsPreview, id),
  preparePlayback: (id, audioTrack) =>
    call(IPC.toolsPreparePlayback, id, audioTrack),
  cancelPlayback: (id) => call(IPC.toolsCancelPlayback, id),
  // The same channel as downloads': the player reports either by job id.
  onPlaybackProgress: (cb) => on<PlaybackProgress>(IPC.playbackProgress, cb),
  onJob: (cb) => on<ToolJob>(IPC.toolJobUpdated, cb),
  onJobRemoved: (cb) => on<string>(IPC.toolJobRemoved, cb),
  makePreview: (id, toolId, media, values) =>
    call(IPC.toolsMakePreview, id, toolId, media, values),
  cancelPreview: (id) => call(IPC.toolsCancelPreview, id),
  onPreviewProgress: (cb) => on<PreviewProgress>(IPC.toolPreviewProgress, cb),
  gifBytes: (id) => call(IPC.toolsGifBytes, id),
};

// A file an editor shows, named by token or job, never by path.
const media: MediaApi = {
  play: (ref) => call(IPC.mediaPlay, ref),
  cancelPlay: (ref) => call(IPC.mediaCancelPlay, ref),
  frame: (ref, seconds, height) => call(IPC.mediaFrame, ref, seconds, height),
  waveform: (ref, count, track) =>
    call(IPC.mediaWaveform, ref, count, track ?? 0),
  audioTracks: (ref) => call(IPC.mediaAudioTracks, ref),
  audioInfo: (ref) => call(IPC.mediaAudioInfo, ref),
  playTrack: (ref, track) => call(IPC.mediaPlayTrack, ref, track),
};

const sessions: SessionsApi = {
  save: (session) => call(IPC.sessionsSave, session),
  list: () => call(IPC.sessionsList),
  get: (id) => call(IPC.sessionsGet, id),
  remove: (id) => call(IPC.sessionsRemove, id),
  clear: () => call(IPC.sessionsClear),
  preview: (token) => call(IPC.sessionsPreview, token),
  // Only the preload can see where a file is, and only for a real File the
  // user dropped or picked; the page gets back a token, not the path.
  saveFile: (file) => {
    const path = file instanceof File ? webUtils.getPathForFile(file) : '';
    if (!path) return Promise.reject(new Error('Not a file on disk'));
    return call(IPC.sessionsAddFile, path, {
      name: file.name,
      size: file.size,
      type: file.type,
    });
  },
  onChanged: (cb) => on<null>(IPC.sessionsChanged, () => cb()),
};

contextBridge.exposeInMainWorld('downloader', downloader);
contextBridge.exposeInMainWorld('sessions', sessions);
contextBridge.exposeInMainWorld('media', media);
contextBridge.exposeInMainWorld('tools', tools);
contextBridge.exposeInMainWorld('externalTools', externalTools);
const storage: StorageApi = {
  report: () => call(IPC.storageReport),
  clear: (id) => call(IPC.storageClear, id),
  reveal: (id) => call(IPC.storageReveal, id),
  eraseAll: () => call(IPC.storageEraseAll),
};

contextBridge.exposeInMainWorld('toolkits', toolkits);
contextBridge.exposeInMainWorld('storage', storage);
