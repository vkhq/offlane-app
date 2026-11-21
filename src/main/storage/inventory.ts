// Everything the app keeps on this computer, measured, for Settings ›
// Storage: the files it saved for the person, its own data (toolkits,
// History, settings), its caches, and what Electron and the system keep for
// it. Anything in the data folder not claimed by a known item is listed
// under Other, so the page always accounts for the whole folder.
//
// Clearing is done by the parts that own each kind of data (the download
// manager, the session store, the toolkit installer, Electron's session),
// passed in as `actions`, so nothing is deleted behind their backs.
//
// No Electron import, so the integration tests can use it with plain Node.
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  StorageGroup,
  StorageItem,
  StorageItemId,
  StorageReport,
} from '../../shared/storage';

type Action = () => Promise<void> | void;

export type InventoryDeps = {
  /** Electron's userData folder: everything the app keeps by itself. */
  userData: string;
  /** The person's home folder, shortened to ~ for display. */
  home: string;
  /** The folder downloads and tool outputs are saved in. */
  saveFolder: () => string;
  /** Files the app saved there that it still knows about. */
  savedFiles: () => string[];
  /** Files the system keeps for the app outside userData (macOS
   *  preferences, saved window state, logs); listed only if they exist. */
  systemFiles: string[];
  /** How each item that can be cleared is cleared. */
  actions: Partial<Record<StorageItemId, Action>>;
};

type Definition = {
  id: StorageItemId;
  group: StorageGroup;
  name: string;
  description: string;
  /** Paths inside userData it is made of. */
  paths: string[];
  clear?: { label: string; confirm: string | null };
  /** Count its files: a number worth seeing (toolkits' files aren't). */
  countFiles?: boolean;
};

// The data folder's contents, by what they are. Names Chromium uses vary a
// little between versions; anything unlisted shows under Other.
const definitions: Definition[] = [
  {
    id: 'toolkits',
    group: 'App Data',
    name: 'Toolkits',
    description:
      'FFmpeg and the other programs tools run on. Removing them stops those tools until they are installed again.',
    paths: ['toolkits'],
    clear: {
      label: 'Remove All…',
      confirm:
        'Every installed toolkit is deleted. Tools that need one ask for it to be downloaded again.',
    },
  },
  {
    id: 'history',
    group: 'App Data',
    name: 'History',
    description:
      'Every tool session History lists, with its thumbnails and options. Your saved files are not touched.',
    paths: [
      'sessions.db',
      'sessions.db-wal',
      'sessions.db-shm',
      'sessions.db-journal',
    ],
    clear: {
      label: 'Clear…',
      confirm: 'History is emptied. This can’t be undone.',
    },
  },
  {
    id: 'download-list',
    group: 'App Data',
    name: 'Download List',
    description:
      'The downloads Download Video lists, finished or not. Clearing takes finished, failed and cancelled ones off it; the files stay.',
    paths: ['downloads/jobs.json', 'downloads/jobs.json.tmp'],
    clear: { label: 'Clear Finished', confirm: null },
  },
  {
    id: 'tool-results',
    group: 'App Data',
    name: 'Tool Results',
    description:
      'The results the tools list under their pages, finished, failed or cancelled, kept across restarts. Clearing takes them off; the files stay.',
    paths: ['tools'],
    clear: { label: 'Clear Finished', confirm: null },
  },
  {
    id: 'unfinished-downloads',
    group: 'App Data',
    name: 'Unfinished Downloads',
    description:
      'The partly downloaded files of paused and failed downloads, kept so they can carry on where they stopped.',
    paths: ['downloads/jobs'],
    countFiles: true,
    clear: {
      label: 'Discard…',
      confirm:
        'Paused and failed downloads are cancelled and their partial files deleted. Downloads under way carry on.',
    },
  },
  {
    id: 'settings',
    group: 'App Data',
    name: 'Settings',
    description:
      'Your preferences: save folder, proxy, speed limit, sign-in browser, and whether Download Video is on.',
    paths: [
      'settings.json',
      'settings.json.tmp',
      'external-tools.json',
      'external-tools.json.tmp',
    ],
    clear: {
      label: 'Reset…',
      confirm: 'Every setting goes back to how it was when the app was new.',
    },
  },
  {
    id: 'lookups',
    group: 'Caches',
    name: 'Video Lookups',
    description:
      'What sites said about the videos you looked up, kept so a download can start without asking again.',
    paths: ['downloads/probes'],
    countFiles: true,
    clear: { label: 'Clear', confirm: null },
  },
  {
    id: 'playback',
    group: 'Caches',
    name: 'Playback Copies',
    description:
      'Copies of downloads rewrapped or converted so the in-app player can play them. Emptied each launch.',
    paths: ['playback'],
    countFiles: true,
    clear: { label: 'Clear', confirm: null },
  },
  {
    id: 'web-cache',
    group: 'Caches',
    name: 'Window Cache',
    description:
      'Compiled scripts, graphics shaders and other files the app’s window keeps to start faster. Some stays in use until the app is relaunched.',
    paths: [
      'Cache',
      'Code Cache',
      'GPUCache',
      'GPUPersistentCache',
      'DawnCache',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'GraphiteDawnCache',
      'Shared Dictionary',
      'blob_storage',
      'VideoDecodeStats',
      'Service Worker',
    ],
    clear: { label: 'Clear', confirm: null },
  },
  {
    id: 'page-data',
    group: 'Caches',
    name: 'Window Storage',
    description:
      'Small things the window remembers: recently used tools, Home’s layout and your open tabs.',
    paths: [
      'Local Storage',
      'Session Storage',
      'WebStorage',
      'IndexedDB',
      'databases',
    ],
    clear: {
      label: 'Clear…',
      confirm:
        'Recently used tools and Home’s layout are forgotten, and the window reloads.',
    },
  },
  {
    id: 'electron',
    group: 'Electron and System',
    name: 'Electron Internals',
    description:
      'Files the app’s Electron runtime keeps for itself: cookies, network state, its own preferences and lock files. Made again at every launch.',
    paths: [
      'Cookies',
      'Cookies-journal',
      'DIPS',
      'DIPS-wal',
      'DIPS-shm',
      'Trust Tokens',
      'Trust Tokens-journal',
      'Network Persistent State',
      'TransportSecurity',
      'Network',
      'Preferences',
      'Local State',
      'declarative_performance_observer.db',
      'declarative_performance_observer.db-journal',
      'shared_proto_db',
      'SingletonCookie',
      'SingletonLock',
      'SingletonSocket',
      'DevToolsActivePort',
      'Crashpad',
      'Partitions',
    ],
    clear: { label: 'Clear Cookies', confirm: null },
  },
];

/** Bytes and file count under `target`; links count as themselves. */
async function measure(
  target: string,
): Promise<{ size: number; files: number }> {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    return { size: 0, files: 0 };
  }
  if (!stat.isDirectory()) return { size: stat.size, files: 1 };
  let size = 0;
  let files = 0;
  const entries = await fs
    .readdir(target, { recursive: true, withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    try {
      size += (await fs.lstat(path.join(entry.parentPath, entry.name))).size;
      files += 1;
    } catch {
      // Gone while counting.
    }
  }
  return { size, files };
}

async function measureAll(targets: string[]) {
  let size = 0;
  let files = 0;
  for (const target of targets) {
    const found = await measure(target);
    size += found.size;
    files += found.files;
  }
  return { size, files };
}

async function exists(target: string) {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/** A child-of-userData path's top-level name: "downloads/jobs" → downloads. */
const top = (relative: string) => relative.split('/')[0];

export class StorageInventory {
  constructor(private readonly deps: InventoryDeps) {}

  /** `~/…` instead of the full home folder, for display. */
  private display(target: string) {
    return target.startsWith(this.deps.home + path.sep)
      ? `~${target.slice(this.deps.home.length)}`
      : target;
  }

  private abs(relative: string) {
    return path.join(this.deps.userData, ...relative.split('/'));
  }

  /** Entries in userData that no item claims, as paths inside it. */
  private async unclaimed(): Promise<string[]> {
    const claimed = new Set(definitions.flatMap((item) => item.paths));
    const tops = new Set([...claimed].map(top));
    const found: string[] = [];
    for (const name of await fs.readdir(this.deps.userData).catch(() => [])) {
      if (!tops.has(name)) {
        found.push(name);
        continue;
      }
      // A claimed folder some of whose contents are claimed separately
      // (downloads/): anything else in it is unclaimed.
      const children = [...claimed].filter((item) =>
        item.startsWith(`${name}/`),
      );
      if (children.length === 0) continue;
      for (const child of await fs.readdir(this.abs(name)).catch(() => [])) {
        if (!claimed.has(`${name}/${child}`)) found.push(`${name}/${child}`);
      }
    }
    return found;
  }

  async report(): Promise<StorageReport> {
    const items: StorageItem[] = [];
    const clearable = (id: StorageItemId) => id in this.deps.actions;

    // The files saved for the person: theirs, so moved to the Trash, never
    // deleted outright.
    const saved = this.deps.savedFiles();
    const savedSize = await measureAll(saved);
    items.push({
      id: 'saved-files',
      group: 'Your Files',
      name: 'Saved Files',
      description:
        'Videos and files the app saved for you that it still lists: finished downloads, and what tools made since the app opened. Moving them to the Trash takes them off the download list too.',
      location: this.display(this.deps.saveFolder()),
      size: savedSize.size,
      files: savedSize.files,
      revealable: true,
      clear:
        clearable('saved-files') && savedSize.files > 0
          ? {
              label: 'Move to Trash…',
              confirm: `${savedSize.files} file${savedSize.files === 1 ? '' : 's'} the app saved go to the Trash, where you can still get them back.`,
            }
          : null,
    });

    for (const definition of definitions) {
      const measured = await measureAll(
        definition.paths.map((p) => this.abs(p)),
      );
      items.push({
        id: definition.id,
        group: definition.group,
        name: definition.name,
        description: definition.description,
        location: this.display(await this.locate(definition)),
        size: measured.size,
        files: definition.countFiles ? measured.files : null,
        revealable: true,
        clear:
          definition.clear && clearable(definition.id)
            ? definition.clear
            : null,
      });
    }

    const other = await this.unclaimed();
    const otherSize = await measureAll(other.map((p) => this.abs(p)));
    if (other.length > 0) {
      items.push({
        id: 'other',
        group: 'Electron and System',
        name: 'Other',
        description: `In the data folder but not recognised: ${other.join(', ')}.`,
        location: this.display(this.deps.userData),
        size: otherSize.size,
        files: otherSize.files,
        revealable: true,
        clear: null,
      });
    }

    const system: string[] = [];
    for (const file of this.deps.systemFiles) {
      if (await exists(file)) system.push(file);
    }
    if (system.length > 0) {
      const systemSize = await measureAll(system);
      items.push({
        id: 'system',
        group: 'Electron and System',
        name: 'Kept by the System',
        description: `Outside the app’s folder, kept for it by the system: ${system
          .map((file) => this.display(file))
          .join(', ')}. The system recreates them while the app runs.`,
        location: this.display(path.dirname(system[0])),
        size: systemSize.size,
        files: systemSize.files,
        revealable: true,
        clear: null,
      });
    }

    return {
      dataFolder: this.display(this.deps.userData),
      total: items.reduce((sum, item) => sum + item.size, 0),
      items,
    };
  }

  /** An item's first file that exists, else its first: where it is. */
  private async locate(definition: Definition) {
    for (const relative of definition.paths) {
      if (await exists(this.abs(relative))) return this.abs(relative);
    }
    return this.abs(definition.paths[0]);
  }

  /** The path Show in Finder opens for an item; null if there is none. */
  async revealPath(id: StorageItemId): Promise<string | null> {
    if (id === 'saved-files') return this.deps.saveFolder();
    if (id === 'other') return this.deps.userData;
    if (id === 'system') {
      for (const file of this.deps.systemFiles) {
        if (await exists(file)) return file;
      }
      return null;
    }
    const definition = definitions.find((item) => item.id === id);
    for (const relative of definition?.paths ?? []) {
      if (await exists(this.abs(relative))) return this.abs(relative);
    }
    return this.deps.userData;
  }

  async clear(id: StorageItemId): Promise<void> {
    const action = this.deps.actions[id];
    if (!action) throw new Error('This can’t be cleared from here.');
    await action();
  }

  /** Clears every item that can be, except the person's own files. Each
   *  is tried even if an earlier one fails; the first failure is thrown. */
  async eraseAll(): Promise<void> {
    let failure: unknown = null;
    for (const id of Object.keys(this.deps.actions) as StorageItemId[]) {
      if (id === 'saved-files') continue;
      try {
        await this.clear(id);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }
}
