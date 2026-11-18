// Finds the yt-dlp and ffmpeg executables: yt-dlp as the person installed
// it (see ./external.ts; the app never ships it),
// FFmpeg and FFprobe in the Media toolkit (see ../toolkits). Resolved again
// for every job, so installing or removing either applies without a
// restart.
//
// No Electron import, so the integration tests can use it with plain Node.
import path from 'node:path';

import type { ToolkitStore } from '../toolkits/store';
import type { ExternalTools } from './external';

/** The FFmpeg in use: the Media toolkit's. */
export type ResolvedFfmpeg = {
  /** Folder holding ffmpeg and ffprobe. */
  dir: string;
  ffmpeg: string;
  ffprobe: string;
  /** Which build: "lgpl" (standard) or "gpl" (all codecs). */
  variant: string;
  version: string | null;
};

export type Binaries = {
  ytdlp: string;
  /** Folder passed to --ffmpeg-location; null when there is no ffmpeg. */
  ffmpegDir: string | null;
  ffmpeg: ResolvedFfmpeg | null;
  /** Folders to put at the front of PATH for yt-dlp: its own, then the
   *  person's terminal's, so it finds whatever it needs as it would there. */
  pathDirs: string[];
};

/** The Media toolkit's FFmpeg, or null when it isn't installed. */
export function resolveFfmpeg(store: ToolkitStore): ResolvedFfmpeg | null {
  const media = store.installed('media');
  const ffmpeg = store.findBinary('media', 'ffmpeg');
  const ffprobe = store.findBinary('media', 'ffprobe');
  if (!media || !ffmpeg || !ffprobe) return null;
  return {
    dir: path.dirname(ffmpeg),
    ffmpeg,
    ffprobe,
    variant: media.variant,
    version: media.version || null,
  };
}

/**
 * Resolves every binary. Throws ExternalToolError while Download Video is
 * off or yt-dlp is gone, since nothing downloads without it; a missing
 * FFmpeg is reported as null instead, because many single-file downloads
 * work without it.
 */
export function resolveBinaries(
  store: ToolkitStore,
  external: Pick<ExternalTools, 'forJob'>,
): Binaries {
  const { ytdlp, pathDirs } = external.forJob();
  const ffmpeg = resolveFfmpeg(store);
  return {
    ytdlp,
    ffmpegDir: ffmpeg?.dir ?? null,
    ffmpeg,
    pathDirs,
  };
}
