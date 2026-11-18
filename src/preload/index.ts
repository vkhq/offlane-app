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
import type { ToolJob, ToolsApi } from '../shared/tools';
import type {
  DownloaderApi,
  Job,
  PlaybackProgress,
  ProbeResult,
  SessionsApi,
} from '../shared/types';

type MenuLine = { id: string; label: string; enabled?: boolean } | null;

contextBridge.exposeInMainWorld('app', {
  // The window has macOS's sidebar material behind it (see the main process).
  vibrancy: process.platform === 'darwin',
  quit: () => ipcRenderer.send('quit'),
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
  openFile: (id) => call(IPC.openFile, id),
  preparePlayback: (id) => call(IPC.preparePlayback, id),
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
  run: (toolId, { files, links, outputs = [], values }) =>
    call(IPC.toolsRun, toolId, {
      // A saved file goes by its token; the main process looks its path up.
      files: files.map((file) =>
        file instanceof File
          ? webUtils.getPathForFile(file)
          : { token: file.token },
      ),
      links,
      outputs,
      values,
    }),
  list: () => call(IPC.toolsList),
  cancel: (id) => call(IPC.toolsCancel, id),
  remove: (id) => call(IPC.toolsRemove, id),
  reveal: (id) => call(IPC.toolsReveal, id),
  onJob: (cb) => on<ToolJob>(IPC.toolJobUpdated, cb),
  onJobRemoved: (cb) => on<string>(IPC.toolJobRemoved, cb),
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
