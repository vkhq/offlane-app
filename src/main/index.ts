import path from 'node:path';

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  shell,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  systemPreferences,
} from 'electron';
import started from 'electron-squirrel-startup';
import { execFileSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';

import { brand, displayName } from '../shared/brand';
import { contentSecurityPolicy } from '../shared/csp';

import { IPC } from '../shared/ipc';
import type { JobStatus, SessionStatus } from '../shared/types';
import { DownloadManager } from './downloads/manager';
import { resolveBinaries, resolveFfmpeg } from './engine/binaries';
import { setDemo } from './engine/demo';
import { ExternalTools } from './engine/external';
import { registerIpc } from './ipc';
import { Player } from './player';
import { useMocks } from './mocks';
import { fitPicture, previewFile } from './preview';
import { refreshThumbnails } from './thumbnails';
import { StorageInventory } from './storage/inventory';
import { SessionStore } from './storage/sessions';
import { SettingsStore } from './storage/settings';
import { ToolQueue } from './tools/queue';
import { Recordings } from './tools/recordings';
import { loadHandlers, loadRequirements } from './tools/registry';
import { currentTarget } from './toolkits/catalog';
import { FEED } from './toolkits/feed';
import { Toolkits } from './toolkits/service';
import {
  migrateLegacyFfmpeg,
  ToolkitStore,
  vendorToolkits,
} from './toolkits/store';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Two instances would run two download queues over the same files.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Toolkits are named for the computer they run on, as in vendor/.
const target = currentTarget();
const userData = app.getPath('userData');

/**
 * The native programs tools use aren't part of the app: they come in
 * toolkits, downloaded on demand into <userData>/toolkits (see
 * ./toolkits). A development build starts like a production one, with no
 * toolkit until it is installed, so the install prompts can be tried as a
 * user meets them. OFFLANE_USE_VENDOR=1 counts vendor/<os>-<arch>/bin, from
 * `npm run fetch-binaries`, as installed instead, so the tests need no
 * downloads.
 */
/**
 * The app icon in development, where Electron would show its own. Packaged
 * builds carry the icon from assets/brand (see forge.config.mts).
 */
const devIcon = app.isPackaged
  ? undefined
  : path.join(
      app.getAppPath(),
      'assets',
      'brand',
      process.platform === 'darwin'
        ? 'icon-macos.png'
        : process.platform === 'win32'
          ? 'icon.ico'
          : 'icon.png',
    );

const useVendor = !app.isPackaged && process.env.OFFLANE_USE_VENDOR === '1';
const vendorBin = path.join(app.getAppPath(), 'vendor', target, 'bin');
const toolkitStore = new ToolkitStore(
  path.join(userData, 'toolkits'),
  useVendor ? vendorToolkits(vendorBin) : {},
);
// yt-dlp was once in a Downloader toolkit. The app no longer ships or
// downloads it, so a copy it downloaded earlier goes.
for (const leftover of ['downloader', '.resume-downloader']) {
  rmSync(path.join(toolkitStore.root, leftover), {
    recursive: true,
    force: true,
  });
}
// A GPL FFmpeg installed before toolkits existed becomes the Media toolkit.
migrateLegacyFfmpeg(path.join(userData, 'ffmpeg'), toolkitStore);
const toolkits = new Toolkits({ store: toolkitStore, target, feed: FEED });
// Installs the app quit in the middle of start again, as downloads do.
void toolkits.resumeInterrupted();

// Demo links (https://demo.test/…) run predefined flows offline; see
// ./engine/demo.ts. Development builds only.
setDemo(!app.isPackaged);

// Offline test mode (see ./mocks.ts); development builds only.
const mocksDir = app.isPackaged ? undefined : process.env.OFFLANE_MOCKS;
if (mocksDir) useMocks(mocksDir);

// yt-dlp as the person installed it, and whether Download Video
// is on (see ./engine/external.ts). The offline tests' fake yt-dlp, or with
// OFFLANE_USE_VENDOR a development checkout's, is found first.
const externalTools = new ExternalTools({
  file: path.join(userData, 'external-tools.json'),
  firstDirs: [
    ...(mocksDir ? [mocksDir] : []),
    ...(useVendor ? [path.join(vendorBin, 'yt-dlp'), vendorBin] : []),
  ],
});
void externalTools.scan();

const getBinaries = () => resolveBinaries(toolkitStore, externalTools);

const settings = new SettingsStore(
  path.join(userData, 'settings.json'),
  app.getPath('downloads'),
);
const manager = new DownloadManager({
  getBinaries,
  getSettings: () => settings.get(),
  workDir: path.join(userData, 'downloads'),
});

// Every other tool's jobs, run by the handlers in src/tools.
const tools = new ToolQueue({
  handlers: loadHandlers(),
  getFfmpeg: () => resolveFfmpeg(toolkitStore),
  requirements: loadRequirements(),
  assertToolkits: (ids) => toolkits.assertInstalled(ids),
  getOutputDir: () => settings.get().downloadDir,
  // Finished runs, still listed after a restart, as downloads are.
  file: path.join(userData, 'tools', 'jobs.json'),
});

// Tool sessions, listed in History and opened again from there.
const sessions = new SessionStore(path.join(userData, 'sessions.db'));

// Plays finished downloads in the app, rewrapping or re-encoding what
// Chromium can't play as it is.
const ffmpegTools = () => {
  const found = resolveFfmpeg(toolkitStore);
  return found ? { ffmpeg: found.ffmpeg, ffprobe: found.ffprobe } : null;
};

const player = new Player({
  getFfmpeg: ffmpegTools,
  cacheDir: path.join(userData, 'playback'),
  onProgress: (progress) =>
    mainWindow?.webContents.send(IPC.playbackProgress, progress),
});

let mainWindow: BrowserWindow | null = null;

// Every change to a toolkit (progress, install, removal) reaches the page.
toolkits.on('changed', (list) =>
  mainWindow?.webContents.send(IPC.toolkitsChanged, list),
);
externalTools.on('changed', (status) =>
  mainWindow?.webContents.send(IPC.externalToolsChanged, status),
);

// A packaged build has no server, and a page loaded from file:// cannot put its
// routes in the URL (they would be other files) or come back to one on reload.
// So it is served over app:// instead, from the renderer build, with every
// path that is not a file answered by the page, as the dev server does.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  // Finished downloads for the in-app player (see ./player.ts); stream lets
  // <video> buffer and seek.
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, stream: true },
  },
]);

const rendererDir = path.join(__dirname, '..', 'renderer');

async function serveRenderer(request: Request) {
  const file = path.join(
    rendererDir,
    decodeURIComponent(new URL(request.url).pathname),
  );
  const isFile =
    file.startsWith(rendererDir + path.sep) &&
    !!statSync(file, { throwIfNoEntry: false })?.isFile();
  const served = isFile
    ? file
    : path.join(rendererDir, 'main_window', 'index.html');
  const response = await net.fetch(pathToFileURL(served).toString());
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', contentSecurityPolicy);
  return new Response(response.body, { status: response.status, headers });
}

// The page's address: the dev server's, or app:// when built (Forge's entry
// is then a file:// one). Routes go after it, without the index.html.
const pageUrl = MAIN_WINDOW_WEBPACK_ENTRY.startsWith('file:')
  ? 'app://bundle/main_window/'
  : MAIN_WINDOW_WEBPACK_ENTRY.replace(/index\.html$/, '');
// What every URL the page has starts with: Home's is just this, and the other
// routes go after it with a slash.
const pageOrigin = pageUrl.replace(/\/$/, '');

// The app is light only, so the window's material, its native menus and its
// controls stay light even when macOS is in Dark Mode.
nativeTheme.themeSource = 'light';

/**
 * Tests can run the app out of sight: no window on screen and no Dock
 * icon, the page still drawing and running at full speed so they can drive
 * it. Development builds only, when OFFLANE_HIDDEN is 1.
 */
const hidden = !app.isPackaged && process.env.OFFLANE_HIDDEN === '1';

/**
 * Media permissions: our page may use the microphone (Record Audio) and
 * nothing else, never the camera; and on macOS only once the person has
 * let Offlane use it, asked the first time. Every other permission keeps
 * Electron's default.
 */
function allowMicrophoneOnly() {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, permission, callback, details) => {
      if (permission !== 'media') return callback(true);
      const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
      if (
        !details.requestingUrl.startsWith(pageOrigin) ||
        types.length === 0 ||
        types.some((type) => type !== 'audio')
      ) {
        return callback(false);
      }
      if (
        process.platform !== 'darwin' ||
        systemPreferences.getMediaAccessStatus('microphone') === 'granted'
      ) {
        return callback(true);
      }
      systemPreferences
        .askForMediaAccess('microphone')
        .then(callback, () => callback(false));
    },
  );
}

const createWindow = (): void => {
  // In development (`npm start`) the window opens maximized, filling the
  // screen the pointer is on: created at that size, so it doesn't open small
  // and then grow. A packaged app, and tests' hidden window, open at the
  // fixed size.
  const fill = !app.isPackaged && !hidden;
  const bounds = fill
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    : { width: 1220, height: 800 };

  // Create the browser window.
  mainWindow = new BrowserWindow({
    ...bounds,
    minHeight: 560,
    minWidth: 940,
    // The page has no <title>, so this name stays: Window menu, Mission
    // Control, the Windows taskbar. "Offlane (unofficial build)" unless
    // this is an official build (see shared/brand.ts).
    title: displayName,
    titleBarStyle: 'hiddenInset',
    // macOS takes the Dock icon from the app instead (set when ready).
    ...(devIcon && process.platform !== 'darwin' && { icon: devIcon }),
    // Centres the 14px lights in the 40px tab bar, level with the tabs.
    trafficLightPosition: { x: 20, y: 13 },
    // The sidebar's translucent, blurred material, as in Finder: macOS draws
    // it behind the whole window, and it shows wherever the page leaves its
    // background transparent, which only the sidebar does. Elsewhere there
    // is no such material, so the page paints the sidebar itself.
    ...(process.platform === 'darwin' && {
      vibrancy: 'sidebar' as const,
      visualEffectState: 'followWindow' as const,
      backgroundColor: '#00000000',
    }),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Hidden, it keeps its timers and animation frames running.
      ...(hidden && { backgroundThrottling: false }),
    },
    frame: false,
    ...(hidden && { show: false, paintWhenInitiallyHidden: true }),
  });
  const window = mainWindow;
  if (fill) window.maximize();

  // Cmd+W (Ctrl+W elsewhere) belongs to the page, which closes a tab or, with
  // only the pinned Home tab left, the app; so do Cmd+H, which shows Home,
  // and Cmd+, which shows Settings.
  // Without this the menu's Close Window and Hide shortcuts would take the
  // keys first. Hide stays in the app menu, and Cmd+Option+H still hides the
  // other apps.
  const pageKeys = ['KeyW', 'KeyH', 'Comma'];
  window.webContents.on('before-input-event', (_event, input) => {
    const modifier = process.platform === 'darwin' ? input.meta : input.control;
    window.webContents.setIgnoreMenuShortcuts(
      modifier && !input.shift && !input.alt && pageKeys.includes(input.code),
    );
  });

  // The page never navigates away from the app; web links open in the
  // user's browser instead.
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(pageOrigin)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Web links open in the browser, and email links (About) in the mail app.
    if (/^(https?:\/\/|mailto:)/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.loadURL(pageUrl);
};

// How each run last stood, so its session in History is only updated
// when that changes, not on every tick of progress.
const runStatuses = new Map<string, SessionStatus>();
const recordRun = (id: string, status: SessionStatus) => {
  if (runStatuses.get(id) === status) return;
  runStatuses.set(id, status);
  try {
    if (sessions.setJobStatus(id, status)) {
      mainWindow?.webContents.send(IPC.sessionsChanged, null);
    }
  } catch (error) {
    console.error('[sessions] status update failed:', error);
  }
};

// Download progress goes to the page as it happens.
manager.on('job-updated', (job) => {
  mainWindow?.webContents.send(IPC.jobUpdated, job);
  recordRun(job.id, downloadStatus(job.status));
});
manager.on('job-removed', (id) =>
  mainWindow?.webContents.send(IPC.jobRemoved, id),
);
tools.on('job-updated', (job) => {
  mainWindow?.webContents.send(IPC.toolJobUpdated, job);
  recordRun(
    job.id,
    job.status === 'queued' ? 'running' : (job.status as SessionStatus),
  );
});
tools.on('job-removed', (id) =>
  mainWindow?.webContents.send(IPC.toolJobRemoved, id),
);

// Everything the app keeps on this computer, for Settings › Storage, and
// how each kind is cleared: always by the part of the app that owns it.
const sendSessionsChanged = () =>
  mainWindow?.webContents.send(IPC.sessionsChanged, null);

/** Finished downloads' files, and what tools saved since launch. */
function savedFiles(): string[] {
  const downloads = manager
    .list()
    .flatMap((job) =>
      job.status === 'completed' && job.outputPath ? [job.outputPath] : [],
    );
  const outputs = tools.list().flatMap((job) => tools.outputsOf(job.id));
  return [...new Set([...downloads, ...outputs])].filter((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

// The packaged app's bundle id (see shared/brand.ts).
const bundleIds = [brand.appBundleId];
const inventory = new StorageInventory({
  userData,
  home: homedir(),
  saveFolder: () => settings.get().downloadDir,
  savedFiles,
  systemFiles:
    process.platform === 'darwin'
      ? [
          ...bundleIds.flatMap((id) => [
            path.join(homedir(), 'Library', 'Preferences', `${id}.plist`),
            path.join(
              homedir(),
              'Library',
              'Saved Application State',
              `${id}.savedState`,
            ),
          ]),
          app.getPath('logs'),
        ]
      : [app.getPath('logs')],
  actions: {
    // The person's own files go to the Trash, never straight to deletion,
    // and their downloads come off the list with them.
    'saved-files': async () => {
      const files = savedFiles();
      for (const file of files) await shell.trashItem(file);
      for (const job of manager.list()) {
        if (job.outputPath && files.includes(job.outputPath)) {
          manager.remove(job.id);
        }
      }
    },
    toolkits: async () => {
      for (const toolkit of toolkits.list()) {
        if (toolkit.installed?.source === 'user') {
          await toolkits.remove(toolkit.id);
        }
      }
    },
    history: () => {
      sessions.clear();
      sendSessionsChanged();
    },
    'download-list': () => manager.clearFinished(),
    'tool-results': () => tools.clearFinished(),
    'unfinished-downloads': () => manager.discardUnfinished(),
    settings: () => {
      settings.reset();
      externalTools.reset();
    },
    lookups: () => manager.clearProbeCache(),
    playback: () => player.clearCache(),
    'web-cache': async () => {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearCodeCaches({});
      await session.defaultSession.clearStorageData({
        storages: ['shadercache', 'cachestorage', 'serviceworkers'],
      });
    },
    electron: () =>
      session.defaultSession.clearStorageData({ storages: ['cookies'] }),
    // Last, as it reloads the window (Erase All runs these in order).
    'page-data': async () => {
      await session.defaultSession.clearStorageData({
        storages: ['localstorage', 'indexdb'],
      });
      // The page still holds what was cleared; it starts afresh.
      mainWindow?.webContents.reload();
    },
  },
});

/** Recordings made in the page, kept in the system's temporary folder
 *  until a tool has run on them (see tools/recordings.ts). */
const recordings = new Recordings(path.join(tmpdir(), 'offlane-recordings'));

/** Tools' previews (see ToolQueue.preview), each deleted once the page has
 *  it; anything left from before is cleared at launch. */
const previewDir = path.join(userData, 'previews');
rmSync(previewDir, { recursive: true, force: true });

registerIpc({
  manager,
  player,
  sessions,
  recordings,
  previewFile: (file) => previewFile(ffmpegTools(), file),
  ffmpeg: () => ffmpegTools()?.ffmpeg ?? null,
  tools,
  settings,
  toolkits,
  externalTools,
  storage: inventory,
  previewDir,
  appOrigin: pageOrigin,
  getMainWindow: () => mainWindow,
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  if (hidden) app.dock?.hide();
  else if (devIcon && process.platform === 'darwin') app.dock?.setIcon(devIcon);
  protocol.handle('app', serveRenderer);
  protocol.handle('media', (request) => player.handle(request));
  void player.clearCache();
  allowMicrophoneOnly();
  createWindow();
  manager.start();
  recordings.sweep();
  // Older sessions' History pictures, made again once at the larger size.
  void refreshThumbnails({
    sessions,
    preview: async (token) => {
      const file = sessions.filePath(token);
      if (!file) return null;
      const made = await previewFile(ffmpegTools(), file);
      sessions.setPreview(token, made);
      return made;
    },
    fit: async (dataUrl) => {
      const tools = ffmpegTools();
      return tools ? fitPicture(tools.ffmpeg, dataUrl) : null;
    },
    changed: () => mainWindow?.webContents.send(IPC.sessionsChanged, null),
  }).catch((error) => console.error('[thumbnails] refresh failed:', error));
  // Newer toolkit builds, when the app has a signed feed of them.
  toolkits
    .checkForUpdates()
    .catch((error) => console.error('[toolkits] update check failed:', error));

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/** Quitting: once before-quit has begun its steps, and once they are
 *  done (see below). */
let quitting = false;
let quitStepsDone = false;

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // Quitting, Electron closes the windows and quits without this event;
  // it comes anyway when the quit began with a SIGTERM (as `npm start`
  // sends to restart the app once main is rebuilt), and Electron then goes
  // no further. Its own steps (see before-quit) are done by then.
  if (quitStepsDone) {
    app.exit(0);
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Downloads stop before the app does: yt-dlp and ffmpeg run in their own
// process group, so they would otherwise keep writing after it's gone.
// Their .part files stay, and the jobs resume on the next launch.
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  // However the steps below go, the app is gone soon after Cmd+Q: never a
  // closed window with the app still in the Dock.
  setTimeout(() => {
    console.error('[quit] still running after 8s; exiting');
    app.exit(0);
  }, 8000);
  // A step that fails is logged, and quitting carries on.
  const step = (name: string, run: () => void) => {
    try {
      run();
    } catch (error) {
      console.error(`[quit] ${name} failed:`, error);
    }
  };
  // Toolkit installs stop, and start again on the next launch.
  step('toolkits', () => toolkits.suspendAll());
  // Tool jobs are cancelled outright; their unfinished outputs are deleted.
  step('tools', () => tools.stopAll());
  void manager
    .shutdown()
    .catch((error) => console.error('[quit] downloads failed:', error))
    .finally(() => {
      step('settings', () => settings.flush());
      step('sessions', () => sessions.close());
      quitStepsDone = true;
      app.quit();
    });
});

// Cmd+W with only the pinned Home tab left quits outright, on macOS too.
ipcMain.on('quit', () => app.quit());

/**
 * The name of the person signed in to this computer, for the sidebar: their
 * full name on macOS (as in System Settings), else their account name.
 */
const userName = (() => {
  try {
    if (process.platform === 'darwin') {
      const full = execFileSync('id', ['-F'], { encoding: 'utf8' }).trim();
      if (full) return full;
    }
  } catch {
    // No full name to be had; the account name will do.
  }
  return userInfo().username;
})();

ipcMain.handle('user-name', () => userName);
ipcMain.handle('app-version', () => app.getVersion());

/** A context menu line from the page: an item, or a divider. */
type MenuLine = { id: string; label: string; enabled?: boolean } | null;

// Shows a native context menu at the pointer and answers with the id of the
// chosen item, or null if it was dismissed.
ipcMain.handle('context-menu', (event, lines: MenuLine[]) => {
  const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  return new Promise<string | null>((resolve) => {
    const template = lines.map(
      (line): MenuItemConstructorOptions =>
        line
          ? {
              label: line.label,
              enabled: line.enabled ?? true,
              click: () => resolve(line.id),
            }
          : { type: 'separator' },
    );
    Menu.buildFromTemplate(template).popup({
      window,
      // Runs as the menu closes, before a chosen item's click; settle on
      // "dismissed" only once that click has had its turn.
      callback: () => setTimeout(() => resolve(null), 0),
    });
  });
});

/** A download's status, as its session in History shows it. */
function downloadStatus(status: JobStatus): SessionStatus {
  if (status === 'completed') return 'done';
  if (status === 'canceled') return 'cancelled';
  if (status === 'paused' || status === 'failed') return status;
  return 'running';
}
