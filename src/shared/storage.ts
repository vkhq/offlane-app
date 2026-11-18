// What the app keeps on this computer, as Settings › Storage shows it: each
// kind of data, where it is, how much space it takes, and whether it can be
// cleared from there. The page names an item by id to clear or show it;
// which files that means is the main process's business, never the page's.
//
// No Electron, Node or React import: both processes use this file.

export const storageItemIds = [
  'saved-files',
  'toolkits',
  'history',
  'download-list',
  'unfinished-downloads',
  'lookups',
  'playback',
  'web-cache',
  'page-data',
  'settings',
  'electron',
  'other',
  'system',
] as const;

export type StorageItemId = (typeof storageItemIds)[number];

export const isStorageItemId = (value: unknown): value is StorageItemId =>
  storageItemIds.includes(value as StorageItemId);

export type StorageGroup =
  | 'Your Files'
  | 'App Data'
  | 'Caches'
  | 'Electron and System';

export type StorageItem = {
  id: StorageItemId;
  group: StorageGroup;
  name: string;
  /** What it is and what clearing it means, in a sentence or two. */
  description: string;
  /** Where it is, for display: "~/Library/Application Support/…". */
  location: string;
  /** Bytes on disk. */
  size: number;
  /** How many files it is, or null when counting them says nothing. */
  files: number | null;
  /** Whether Show in Finder can open its location. */
  revealable: boolean;
  /** How it is cleared, if it can be from here. */
  clear: {
    /** The button: "Clear", "Move to Trash…". */
    label: string;
    /** Said before clearing; null when clearing needs no second thought. */
    confirm: string | null;
  } | null;
};

export type StorageReport = {
  /** The app's data folder, for display. */
  dataFolder: string;
  /** Everything listed, together. */
  total: number;
  items: StorageItem[];
};

/** What the preload exposes to the page as `window.storage`. */
export type StorageApi = {
  report(): Promise<StorageReport>;
  clear(id: StorageItemId): Promise<StorageReport>;
  reveal(id: StorageItemId): Promise<void>;
  /** Clears everything the app keeps except the files you saved. */
  eraseAll(): Promise<StorageReport>;
};
