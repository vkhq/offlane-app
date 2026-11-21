// IPC channel names and the envelope every request answers with. Shared by
// the main process (ipcMain.handle) and the preload (ipcRenderer.invoke).
import type { ToolkitId } from './toolkits';
import type { ErrorAction, ErrorCategory } from './types';

export const IPC = {
  probe: 'dl:probe',
  enqueue: 'dl:enqueue',
  listJobs: 'dl:list-jobs',
  cancel: 'dl:cancel',
  pause: 'dl:pause',
  resume: 'dl:resume',
  retry: 'dl:retry',
  remove: 'dl:remove',
  revealFile: 'dl:reveal-file',
  downloadPreview: 'dl:preview',
  entryThumbnail: 'dl:entry-thumbnail',
  openFile: 'dl:open-file',
  preparePlayback: 'dl:prepare-playback',
  cancelPlayback: 'dl:cancel-playback',
  playbackProgress: 'dl:playback-progress',
  copyDebugInfo: 'dl:copy-debug-info',
  getSettings: 'settings:get',
  browsers: 'settings:browsers',
  openPrivacySettings: 'settings:open-privacy',
  updateSettings: 'settings:update',
  chooseDownloadDir: 'settings:choose-dir',
  toolkitsList: 'toolkits:list',
  toolkitsInstall: 'toolkits:install',
  toolkitsCancel: 'toolkits:cancel',
  toolkitsRemove: 'toolkits:remove',
  toolkitsCheckUpdates: 'toolkits:check-updates',
  externalToolsStatus: 'external:status',
  externalToolsRescan: 'external:rescan',
  externalToolsChoose: 'external:choose',
  externalToolsForget: 'external:forget',
  externalToolsSetEnabled: 'external:set-enabled',
  storageReport: 'storage:report',
  storageClear: 'storage:clear',
  storageReveal: 'storage:reveal',
  storageEraseAll: 'storage:erase-all',
  toolsConnected: 'tools:connected',
  toolsRun: 'tools:run',
  toolsList: 'tools:list',
  toolsCancel: 'tools:cancel',
  toolsRemove: 'tools:remove',
  toolsReveal: 'tools:reveal',
  toolsOpen: 'tools:open',
  toolsPreview: 'tools:preview',
  toolsPreparePlayback: 'tools:prepare-playback',
  toolsCancelPlayback: 'tools:cancel-playback',
  toolsSaveRecording: 'tools:save-recording',
  sessionsSave: 'sessions:save',
  sessionsList: 'sessions:list',
  sessionsGet: 'sessions:get',
  sessionsRemove: 'sessions:remove',
  sessionsClear: 'sessions:clear',
  sessionsAddFile: 'sessions:add-file',
  sessionsPreview: 'sessions:preview',
  // main → renderer events
  jobUpdated: 'dl:job-updated',
  jobRemoved: 'dl:job-removed',
  toolkitsChanged: 'toolkits:changed',
  externalToolsChanged: 'external:changed',
  toolJobUpdated: 'tools:job-updated',
  toolJobRemoved: 'tools:job-removed',
  sessionsChanged: 'sessions:changed',
} as const;

/**
 * Every handler answers with this instead of throwing: Electron flattens
 * errors thrown across IPC into strings and drops custom fields, and the UI
 * needs the category and action to offer the right button.
 */
export type IpcResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        message: string;
        category?: ErrorCategory;
        action?: ErrorAction;
        toolkit?: ToolkitId;
      };
    };
