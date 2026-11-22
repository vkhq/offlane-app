// Types shared by the main process, the preload bridge and the renderer.
// Nothing here may import Electron, Node or React.

/**
 * How a download picks its streams: the best there is, audio only, or the
 * best at or under a height in pixels ("1080"), any height a site offers.
 * Each maps to a yt-dlp format selector.
 */
export type QualityPreset = 'best' | 'audio' | `${number}`;

/** Whether a value is a quality: 'best', 'audio' or a height of 1 to 99999. */
export const isQualityPreset = (value: unknown): value is QualityPreset =>
  value === 'best' ||
  value === 'audio' ||
  (typeof value === 'string' && /^[1-9]\d{0,4}$/.test(value));

/** Lifecycle of one download. */
export type JobStatus =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled';

/** Categories the raw yt-dlp error text is sorted into. */
export type ErrorCategory =
  | 'unsupported_url'
  | 'auth_required'
  | 'bot_check'
  | 'drm'
  | 'geo_blocked'
  | 'rate_limited'
  | 'unavailable'
  | 'format_unavailable'
  | 'network'
  | 'disk_full'
  | 'permission'
  | 'postprocess'
  | 'missing_codec'
  | 'extractor_broken'
  | 'engine_missing'
  /** A toolkit the job needs isn't installed (see shared/toolkits.ts). */
  | 'toolkit_missing'
  | 'browser_cookies'
  /** macOS keeps the app out of the browser's data (Full Disk Access). */
  | 'browser_blocked'
  | 'unknown';

/** What the UI can offer the user to do about an error. */
export type ErrorAction =
  | 'set_proxy'
  | 'install_full_ffmpeg'
  | 'retry_later'
  | 'choose_folder'
  /** Sign in through a browser the person is signed in to (see Settings.cookiesBrowser). */
  | 'use_browser_cookies'
  /** Install the toolkit named in the error's `toolkit`. */
  | 'install_toolkit'
  | 'none';

export type JobError = {
  category: ErrorCategory;
  /** Friendly sentence for the UI. */
  message: string;
  /** The original yt-dlp ERROR line, for "Copy debug info". */
  raw: string;
  action: ErrorAction;
  /** True when retrying automatically might succeed. */
  retryable: boolean;
  /** For `toolkit_missing`: which toolkit to install. */
  toolkit?: import('./toolkits').ToolkitId;
};

export type Progress = {
  /** 0–100 across all stages, or null when unknown (live streams). */
  percent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  /** Bytes per second. */
  speed: number | null;
  /** Seconds remaining for the current stage. */
  eta: number | null;
  /** 1-based index of the stream being downloaded. */
  stage: number;
  stageCount: number;
  fragmentIndex: number | null;
  fragmentCount: number | null;
};

export type Job = {
  id: string;
  url: string;
  status: JobStatus;
  quality: QualityPreset;
  /** English subtitles, as a playlist's downloads ask for them. */
  subtitles: boolean;
  /** The one subtitle language chosen, as the site codes it ("es"). */
  subtitleLanguage?: string;
  /** `subtitleLanguage` is captions the site made, not subtitles. */
  subtitleAuto?: boolean;
  /** The audio language chosen, played first. */
  audioLanguage?: string;
  /** The video's original audio language, saved too when it isn't the one
   *  chosen, so the player can switch to it. */
  originalLanguage?: string;
  outputDir: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
  thumbnail?: string;
  extractor?: string;
  duration?: number;
  isLive?: boolean;
  progress?: Progress;
  /** Absolute path of the finished file. */
  outputPath?: string;
  /** The finished file's size in bytes. */
  fileSize?: number;
  /** Width over height of the finished video's picture (9:16 for a reel). */
  aspect?: number;
  error?: JobError;
  attempts: number;
  retryAt?: number;
};

export type FormatSummary = {
  id: string;
  ext: string;
  height: number | null;
  width: number | null;
  /** Frames per second, for video. */
  fps: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  size: number | null;
  /** The language of its audio, as the site codes it ("es", "en-US"). */
  language?: string | null;
  /** Its audio is in the video's original language, not a dub. */
  original?: boolean;
};

/** An audio language a video offers. */
export type AudioLanguage = { code: string; original: boolean };

export type VideoInfo = {
  kind: 'video';
  url: string;
  id: string;
  title: string;
  extractor: string;
  thumbnail: string | null;
  /** Another picture to try when `thumbnail` can't be had. */
  thumbnailFallback?: string | null;
  /** The thumbnail inlined as a data: URL, for the page to show. */
  thumbnailImage: string | null;
  /** Width over height of the picture (9:16 for a Short); null if unknown. */
  aspectRatio?: number | null;
  duration: number | null;
  uploader: string | null;
  /** When it was published, in ms since the epoch. */
  uploadedAt: number | null;
  isLive: boolean;
  formats: FormatSummary[];
  /** Heights available, highest first. */
  availableHeights: number[];
  /** Languages with subtitles the site wrote, not automatic captions. */
  subtitleLanguages: string[];
  /** Captions made from the speech, in the language spoken, as the site
   *  codes them ("en-orig"). Missing from a lookup from an older build. */
  autoCaptionLanguages?: string[];
  /** The languages its audio comes in, the original first; empty when the
   *  site doesn't say. Missing from a lookup kept from an older build. */
  audioLanguages?: AudioLanguage[];
};

export type PlaylistEntry = {
  url: string;
  title: string;
  duration: number | null;
  index: number;
  /** Its thumbnail's address, when the playlist lists one. */
  thumbnail?: string | null;
};

export type PlaylistInfo = {
  kind: 'playlist';
  url: string;
  id: string;
  title: string;
  extractor: string;
  uploader: string | null;
  thumbnail: string | null;
  /** The thumbnail inlined as a data: URL, for the page to show. */
  thumbnailImage: string | null;
  entries: PlaylistEntry[];
};

export type ProbeResult = VideoInfo | PlaylistInfo;

export type DownloadRequest = {
  url: string;
  quality: QualityPreset;
  subtitles?: boolean;
  subtitleLanguage?: string;
  subtitleAuto?: boolean;
  audioLanguage?: string;
  originalLanguage?: string;
  /** Set by the main process only; the renderer cannot choose folders. */
  outputDir?: string;
  /** From a fresh probe, so the job can skip probing again. */
  probeToken?: string;
  /**
   * What a playlist listed for this video, shown while it waits its turn
   * (its own lookup replaces them when it starts).
   */
  title?: string;
  thumbnail?: string;
  /** Seconds. */
  duration?: number;
};

export type Settings = {
  downloadDir: string;
  maxConcurrent: number;
  /** Max simultaneous jobs for one site, to avoid rate-limit bans. */
  perSiteLimit: number;
  /** Concurrent HLS/DASH fragments per job (yt-dlp -N). */
  fragmentConcurrency: number;
  /** e.g. "socks5://127.0.0.1:1080". Empty means direct. */
  proxy: string;
  /** e.g. "5M" (bytes/s). Empty means unlimited. */
  rateLimit: string;
  /** Prefer MP4/H.264/AAC over the absolute best codec. */
  preferCompatible: boolean;
  embedMetadata: boolean;
  /**
   * The browser whose sign-ins yt-dlp may use (yt-dlp's name for it, such as
   * "chrome"), for sites that only show a video to signed-in people. Empty
   * means none.
   */
  cookiesBrowser: string;
  /** The first-launch toolkit screen has been seen (installed or skipped). */
  toolkitsOnboarded: boolean;
};

/** A lookup's result, or why it failed. */
export type ProbeAnswer =
  | { ok: true; result: ProbeResult & { probeToken: string } }
  | {
      ok: false;
      error: {
        message: string;
        category?: ErrorCategory;
        action?: ErrorAction;
        toolkit?: import('./toolkits').ToolkitId;
      };
    };

/** A browser the app can use sign-ins from. */
export type BrowserChoice = { id: string; name: string };

/** Where to play a finished download from inside the app. */
export type PlaybackSource = {
  /** A media:// URL for a <video> element. */
  url: string;
  /** What it took: nothing, a rewrap into another container, or a
   *  re-encode of a stream Chromium can't decode. */
  prepared: 'direct' | 'remux' | 'transcode';
  /** Width over height of its picture, as shown; null for audio or if unknown. */
  aspect: number | null;
  /** The file's audio tracks, in its order; empty if it has one or none. */
  audioTracks: PlaybackTrack[];
  /** Which of `audioTracks` this URL plays. */
  audioTrack: number;
  /** Its subtitle tracks, as WebVTT text, for a <track> element. */
  subtitles: PlaybackSubtitles[];
};

export type PlaybackTrack = {
  /** "Spanish", or "Track 2" when the file doesn't say. */
  label: string;
  /** The video's original language, not a dub. */
  original: boolean;
};

export type PlaybackSubtitles = {
  label: string;
  /** The language code, for the <track>'s srclang; '' if unknown. */
  language: string;
  vtt: string;
};

/** How a rewrap or re-encode for playback is going. */
export type PlaybackProgress = {
  id: string;
  stage: 'remux' | 'transcode';
  /** 0–100, or null before FFmpeg reports. */
  percent: number | null;
  /** Width over height of its picture; null for audio or if unknown. */
  aspect: number | null;
};

/** The API the preload exposes as `window.downloader`. */
export type DownloaderApi = {
  /**
   * Looks a link up. A failure is answered, not thrown: an error loses all
   * but its message on its way through the context bridge, and the page
   * needs its category and action (to offer a browser sign-in, say).
   */
  probe(url: string): Promise<ProbeAnswer>;
  enqueue(requests: DownloadRequest[]): Promise<Job[]>;
  listJobs(): Promise<Job[]>;
  cancel(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  revealFile(id: string): Promise<void>;
  /**
   * A download's picture as a data: URL: the site's thumbnail once known,
   * else a frame of the saved file; null if neither yet.
   */
  preview(id: string): Promise<string | null>;
  /**
   * The thumbnail of video `index` of the playlist a lookup found, as a
   * data: URL; null if it has none, can't be had, or the lookup has expired.
   */
  entryThumbnail(probeToken: string, index: number): Promise<string | null>;
  /** Opens a finished download in its default app. */
  openFile(id: string): Promise<void>;
  /** Makes a finished download playable in the app (see main/player.ts). */
  /** Readies a finished download to play, with audio track `audioTrack`
   *  (the first by default). */
  preparePlayback(id: string, audioTrack?: number): Promise<PlaybackSource>;
  /** Stops preparing, when the player closes first. */
  cancelPlayback(id: string): Promise<void>;
  onPlaybackProgress(cb: (progress: PlaybackProgress) => void): () => void;
  copyDebugInfo(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  /** The installed browsers the app can use sign-ins from. */
  browsers(): Promise<BrowserChoice[]>;
  /** Opens System Settings at Full Disk Access (macOS). */
  openPrivacySettings(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  chooseDownloadDir(): Promise<string | null>;
  onJobUpdated(cb: (job: Job) => void): () => void;
  onJobRemoved(cb: (id: string) => void): () => void;
};

/**
 * A file the user dropped or picked, saved with a session by reference: the
 * main process keeps its path under `token`, and the page only ever sees the
 * token, name and size (see main/storage/sessions.ts).
 */
export type SavedFile = {
  kind: 'saved-file';
  token: string;
  name: string;
  size: number;
  type: string;
};

/** How a session's runs stand, as History shows it. */
export type SessionStatus =
  | 'draft'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

/** What History shows of a session besides its title. */
export type SessionMeta = {
  /** A small picture of what it worked on, as a data: URL. */
  thumbnail?: string;
  /** The video's or audio's length, in seconds. */
  duration?: number;
  /** Width over height of what it worked on (9:16 for a Short). */
  aspect?: number;
  /**
   * Its runs (downloads or tool jobs) by id, with how each last stood. The
   * main process keeps these current as runs finish.
   */
  jobs?: Record<string, SessionStatus>;
  /** What its runs are called while under way: Downloading. */
  doing?: string;
  /** And once finished: Downloaded, Compressed. */
  done?: string;
  /** For a playlist, how many videos it has. */
  playlist?: number;
};

/** A file's picture and length, for History; null where it has none. */
export type FilePreview = { thumbnail: string | null; duration: number | null };

/**
 * A file an editor on a tool's page shows (see MediaApi): one the user
 * dropped or picked, by the token it was saved under, or an earlier
 * stage's output, by the job that made it. Never a path.
 */
export type MediaRef =
  | { source: 'file'; token: string }
  | { source: 'tool' | 'download'; jobId: string; index: number };

/** The API the preload exposes as `window.media`: a file's video to play,
 *  its frames and its sound, for an editor such as Trim Video's. */
export type MediaApi = {
  /** Makes it playable in the page, as the player does a download. */
  play(ref: MediaRef): Promise<PlaybackSource>;
  /** Stops making it playable, when the editor goes first. */
  cancelPlay(ref: MediaRef): Promise<void>;
  /** Its frame `seconds` in, `height` pixels tall, as a data: URL. */
  frame(ref: MediaRef, seconds: number, height: number): Promise<string | null>;
  /** How loud it is along its length, as `count` peaks from 0 to 1; null
   *  if it has no sound. */
  waveform(ref: MediaRef, count: number): Promise<number[] | null>;
};

/** A tool session as History lists it. */
export type SessionSummary = {
  id: string;
  toolId: string;
  /** What it worked on: a video's title, a file's name, a link. */
  title: string;
  /** A line under the title: its options, how many files, how it went. */
  summary: string;
  meta: SessionMeta;
  createdAt: number;
  updatedAt: number;
};

/** A session with what its page held, to open it again as it was. */
export type SessionRecord = SessionSummary & {
  /** The page's tab state, as JSON. */
  state: string;
};

/** What a page saves: its summary and its state. */
export type SessionInput = Omit<SessionSummary, 'createdAt' | 'updatedAt'> & {
  state: string;
};

/** The API the preload exposes as `window.sessions`. */
export type SessionsApi = {
  save(session: SessionInput): Promise<SessionSummary>;
  list(): Promise<SessionSummary[]>;
  get(id: string): Promise<SessionRecord | null>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /** Saves a dropped or picked File by reference. */
  saveFile(file: File): Promise<SavedFile>;
  /** A saved file's picture and length, made once and kept. */
  preview(token: string): Promise<FilePreview>;
  /** After any save, removal or clear, from any tab. */
  onChanged(cb: () => void): () => void;
};
