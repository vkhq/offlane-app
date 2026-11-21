// The only place that builds yt-dlp command lines.
//
// yt-dlp has options that run commands (--exec), load code (plugins), read
// local files (file:// URLs) or read browser data. None of them can be
// reached from the renderer: it sends only a URL and a quality preset, every
// flag here is a constant, and user values (URL, proxy, rate limit) are
// validated and passed as separate argv entries; there is never a shell.
import { isBrowser } from './browsers';
import type { QualityPreset, Settings } from '../../shared/types';
import type { Binaries } from './binaries';

/** Prefixes on the machine-readable lines we pick out of stdout. */
export const MARK = {
  progress: '__P__',
  postprocess: '__PP__',
  formats: '__R__',
  file: '__F__',
} as const;

/**
 * Accepts only absolute http(s) URLs, which rules out file:, data: and
 * anything starting with "-" (which yt-dlp would read as an option).
 */
export function validateUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 4096) {
    throw new Error('Please enter a valid link.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('That doesn’t look like a web link.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https links are supported.');
  }
  return url.toString();
}

const proxySchemes = [
  'http:',
  'https:',
  'socks4:',
  'socks4a:',
  'socks5:',
  'socks5h:',
];

export function validateProxy(input: string): string {
  if (input === '') return '';
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Proxy must be a URL such as socks5://127.0.0.1:1080');
  }
  if (!proxySchemes.includes(url.protocol)) {
    throw new Error('Proxy must start with http://, https:// or socks5://');
  }
  return input;
}

/** Rate limit like "500K", "4.2M" or "1G". */
export function validateRateLimit(input: string): string {
  if (input === '') return '';
  if (!/^\d+(\.\d+)?[KMG]?$/i.test(input)) {
    throw new Error('Rate limit must look like 500K or 5M');
  }
  return input.toUpperCase();
}

export type CommonOptions = {
  bin: Binaries;
  settings: Pick<Settings, 'proxy'> & Partial<Pick<Settings, 'cookiesBrowser'>>;
};

function commonArgs({ bin, settings }: CommonOptions): string[] {
  const args = [
    // A user's own yt-dlp config (with --exec, say) must never apply to us.
    '--ignore-config',
    // Plugins are Python code loaded from user folders; never load them.
    '--no-plugin-dirs',
    // The app manages the engine; it must never replace itself.
    '--no-update',
    '--color',
    'never',
    '--socket-timeout',
    '30',
    '--retries',
    '10',
    '--fragment-retries',
    '10',
  ];
  if (bin.ffmpegDir) args.push('--ffmpeg-location', bin.ffmpegDir);
  if (settings.proxy) args.push('--proxy', settings.proxy);
  // Sign-ins from the browser the person chose, for sites that ask for one.
  // Only a known browser's name is ever saved (see storage/settings.ts).
  if (settings.cookiesBrowser && isBrowser(settings.cookiesBrowser)) {
    args.push('--cookies-from-browser', settings.cookiesBrowser);
  }
  return args;
}

/**
 * `-J` prints one JSON object and downloads nothing. `--flat-playlist` lists
 * playlist entries without visiting each page, and `--no-playlist` treats a
 * video opened from inside a playlist as just that video.
 */
export function buildProbeArgs(url: string, opts: CommonOptions): string[] {
  return [
    ...commonArgs(opts),
    '-J',
    '--flat-playlist',
    '--no-playlist',
    '--no-warnings',
    '--',
    validateUrl(url),
  ];
}

/** Format selection per preset; see yt-dlp's "FORMAT SELECTION" docs. */
export function formatArgs(
  quality: QualityPreset,
  preferCompatible: boolean,
  audio: AudioChoice = {},
): string[] {
  const chosen = audio.language ? `ba[language=${audio.language}]` : null;
  // Best audio-only stream, else a combined file; -x keeps the audio track.
  // The language chosen first, if it can be had.
  if (quality === 'audio') {
    return ['-f', [chosen, 'ba', 'b'].filter(Boolean).join('/'), '-x'];
  }

  // Best video + best audio merged by ffmpeg, else the best single file. A
  // capped height falls back to whatever exists rather than failing.
  const video = quality === 'best' ? 'bv*' : `bv*[height<=${quality}]`;
  const fallback =
    quality === 'best'
      ? 'bv*+ba/b'
      : `bv*[height<=${quality}]+ba/b[height<=${quality}]/bv*+ba/b`;
  // A language chosen: that audio, and the original beside it when that is
  // another, so the player can switch back. Either way the chosen one comes
  // first, so it plays by default.
  const original =
    chosen && audio.original && audio.original !== audio.language
      ? `ba[language=${audio.original}]`
      : null;
  const selector = [
    original && `${video}+${chosen}+${original}`,
    chosen && `${video}+${chosen}`,
    fallback,
  ]
    .filter(Boolean)
    .join('/');
  const args = ['-f', selector];
  if (original) args.push('--audio-multistreams');
  // Highest resolution first, then H.264 + AAC, which play everywhere.
  if (preferCompatible) args.push('-S', 'res,vcodec:h264,acodec:aac');
  // MP4 when the codecs allow it, otherwise MKV, which holds anything.
  args.push('--merge-output-format', 'mp4/mkv');
  return args;
}

/** The audio asked for: a language as the site codes it, and the video's
 *  original language, kept too when it is another. */
export type AudioChoice = { language?: string; original?: string };

export type DownloadArgsInput = CommonOptions & {
  settings: Settings;
  quality: QualityPreset;
  /** English subtitles (a playlist's choice). */
  subtitles: boolean;
  /** One subtitle language, as the site codes it; takes over `subtitles`. */
  subtitleLanguage?: string;
  /** `subtitleLanguage` is the site's automatic captions. */
  subtitleAuto?: boolean;
  audio?: AudioChoice;
  outputDir: string;
  /** Per-job folder for .part files, so pause/resume and cleanup are easy. */
  tempDir: string;
  /** A URL, or a saved -J result (skips scraping the page again). */
  source: { url: string } | { infoJsonPath: string };
  isLive?: boolean;
};

export function buildDownloadArgs(input: DownloadArgsInput): string[] {
  const { settings, quality, outputDir, tempDir, source, isLive } = input;
  const args = commonArgs(input);

  args.push(...formatArgs(quality, settings.preferCompatible, input.audio));
  args.push(
    '-P',
    outputDir,
    '-P',
    `temp:${tempDir}`,
    // ".150B" cuts the title to 150 bytes, keeping paths under OS limits
    // even for CJK titles; the id keeps same-titled videos apart.
    '-o',
    '%(title).150B [%(id)s].%(ext)s',
    // Names stay valid when the file is copied to Windows or exFAT.
    '--windows-filenames',
    // One item per job; playlists are expanded into separate jobs.
    '--no-playlist',
    '-N',
    String(settings.fragmentConcurrency),
  );

  if (settings.rateLimit) args.push('--limit-rate', settings.rateLimit);
  if (settings.embedMetadata) args.push('--embed-metadata', '--embed-chapters');
  // --sub-langs takes regular expressions; a code is matched exactly.
  const subLangs = input.subtitleLanguage
    ? `^${input.subtitleLanguage.replace(/[^A-Za-z0-9]/g, '\\$&')}$`
    : input.subtitles
      ? 'en.*,-live_chat'
      : null;
  if (subLangs && quality !== 'audio') {
    args.push(
      input.subtitleLanguage && input.subtitleAuto
        ? '--write-auto-subs'
        : '--write-subs',
      '--embed-subs',
      '--sub-langs',
      subLangs,
    );
  }
  // MPEG-TS survives being stopped mid-stream; MP4 would be unreadable.
  if (isLive) args.push('--hls-use-mpegts');

  // Machine-readable output. --print implies --quiet, which drops the
  // post-processing progress lines (the UI would never see "Merging"), so
  // --no-quiet goes after the --print options.
  args.push(
    '--newline',
    '--progress',
    '--progress-delta',
    '0.5',
    '--progress-template',
    `download:${MARK.progress}{"fmt":%(info.format_id)j,"p":%(progress)j}`,
    '--progress-template',
    `postprocess:${MARK.postprocess}{"pp":%(progress.postprocessor)j,"status":%(progress.status)j}`,
    '--print',
    `before_dl:${MARK.formats}%(format_id)j`,
    '--print',
    `after_move:${MARK.file}%(filepath)j`,
    '--no-quiet',
  );

  if ('infoJsonPath' in source) {
    args.push('--load-info-json', source.infoJsonPath);
  } else {
    // "--" ends option parsing, so a URL can never become a flag.
    args.push('--', validateUrl(source.url));
  }
  return args;
}
