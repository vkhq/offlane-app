// Toolkits: the native programs and libraries tools depend on (FFmpeg, and
// later PDF, OCR and AI ones). The app doesn't ship them; they are
// downloaded on demand, in groups, from pinned sources (see
// src/main/toolkits). yt-dlp is never one: the app neither ships nor
// downloads it, and uses one only if the person installed it themselves
// (see ./externalTools.ts). A tool's manifest lists the toolkits it needs in
// `requires`, and the tool can't be used until they are installed.
//
// No Electron, Node or React import: both processes use this file.

export const toolkitIds = ['media', 'pdf', 'ocr', 'ai'] as const;

export type ToolkitId = (typeof toolkitIds)[number];

/** Each toolkit's name, for messages that name one. */
export const toolkitNames: Record<ToolkitId, string> = {
  media: 'Media',
  pdf: 'PDF',
  ocr: 'Text Recognition',
  ai: 'AI',
};

export const isToolkitId = (value: unknown): value is ToolkitId =>
  toolkitIds.includes(value as ToolkitId);

/** How an install, update or removal of one toolkit is going. */
export type ToolkitInstallState =
  | { state: 'idle' }
  | { state: 'downloading'; received: number; total: number | null }
  | { state: 'verifying' }
  | { state: 'extracting' }
  | { state: 'checking' }
  | { state: 'error'; message: string };

/** A build of a toolkit offered for this computer. */
export type ToolkitVariantOffer = {
  id: string;
  /** "Standard", "All Codecs". */
  name: string;
  /** One line on what sets it apart, shown under its name. */
  note: string;
  version: string;
  /** Download size in bytes, all its archives together. */
  size: number;
  /** Where it comes from, shown before downloading: "github.com/BtbN". */
  host: string;
  /** A licence the person should see before choosing it, if any. */
  license?: { name: string; url: string };
  /** Installed when no variant is named. */
  default: boolean;
};

/** One toolkit, as Settings, the splash screen and the tool pages show it. */
export type ToolkitStatus = {
  id: ToolkitId;
  name: string;
  description: string;
  /** What it contains: "FFmpeg", "FFprobe". */
  contents: string[];
  /** Not offered yet on any computer: its contents are still being chosen. */
  planned: boolean;
  /** What is installed, or null. */
  installed: {
    variant: string;
    version: string;
    /** Bytes on disk, when known. */
    size: number | null;
    /**
     * `user`: downloaded into the app's data folder. `development`: the
     * vendor/ folder of a development checkout, which can't be removed here.
     */
    source: 'user' | 'development';
  } | null;
  /** The builds offered for this computer; empty if none is. */
  offers: ToolkitVariantOffer[];
  /** The installed variant has a newer version on offer. */
  updateAvailable: boolean;
  install: ToolkitInstallState;
};

/** What the preload exposes to the page as `window.toolkits`. */
export type ToolkitsApi = {
  list(): Promise<ToolkitStatus[]>;
  /**
   * Downloads, checks and switches to a toolkit: its default variant, or
   * `variant`. Also how an installed toolkit is updated or changes variant.
   */
  install(id: ToolkitId, variant?: string): Promise<ToolkitStatus[]>;
  cancel(id: ToolkitId): Promise<void>;
  remove(id: ToolkitId): Promise<ToolkitStatus[]>;
  /** Fetches the signed toolkit feed, if the app has one, for updates. */
  checkForUpdates(): Promise<ToolkitStatus[]>;
  onChanged(cb: (list: ToolkitStatus[]) => void): () => void;
};

/** The toolkits in `required` that `list` says aren't installed. */
export const missingToolkits = (
  required: readonly ToolkitId[] | undefined,
  list: readonly ToolkitStatus[],
): ToolkitStatus[] =>
  (required ?? []).flatMap((id) => {
    const status = list.find((toolkit) => toolkit.id === id);
    return status && !status.installed ? [status] : [];
  });

/** Whether `status` is downloading, checking or unpacking right now. */
export const isInstalling = (status: ToolkitStatus) =>
  status.install.state !== 'idle' && status.install.state !== 'error';
