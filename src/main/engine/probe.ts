// "What is at this URL?", using `yt-dlp -J --flat-playlist`. The raw JSON is
// saved too: the download then passes it back with --load-info-json, so
// yt-dlp doesn't scrape the page again (faster, and one request fewer that
// could get rate-limited).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  FormatSummary,
  JobError,
  PlaylistEntry,
  ProbeResult,
} from '../../shared/types';
import { buildProbeArgs, type CommonOptions } from './args';
import { isDemo, runDemo } from './demo';
import { classifyError, engineStartError } from './errors';
import { run } from './runner';

/** A failed probe, carrying the classified error for the UI. */
export class ProbeError extends Error {
  constructor(readonly jobError: JobError) {
    super(jobError.message);
  }
}

export type ProbeOutcome = {
  result: ProbeResult;
  /** Single videos only: where the -J output was saved. */
  infoJsonPath: string | null;
  /** Sent back with Download to reuse the saved JSON. */
  token: string;
  fetchedAt: number;
};

// yt-dlp's info dict is loosely typed, so fields are read defensively.
type Json = Record<string, unknown>;
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const numOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function summarizeFormats(info: Json) {
  const raw = Array.isArray(info.formats) ? (info.formats as Json[]) : [];
  const formats = raw.map((format): FormatSummary => {
    // "none" means the stream is absent; a missing field means the site
    // didn't say, as for a plain .mp4 link, so assume it's there.
    const vcodec = str(format.vcodec);
    const acodec = str(format.acodec);
    return {
      id: String(format.format_id ?? ''),
      ext: String(format.ext ?? ''),
      height: numOrNull(format.height),
      width: numOrNull(format.width),
      fps: numOrNull(format.fps),
      hasVideo: vcodec !== 'none',
      hasAudio: acodec !== 'none',
      size: numOrNull(format.filesize) ?? numOrNull(format.filesize_approx),
    };
  });
  const heights = [
    ...new Set(
      formats.flatMap((format) =>
        format.hasVideo && format.height ? [format.height] : [],
      ),
    ),
  ].sort((a, b) => b - a);
  return { formats, heights };
}

type Thumbnail = { url: string; width: number; height: number };

/** Width over height of the video's picture, if it says. */
function aspectOf(info: Json): number | null {
  const width = numOrNull(info.width);
  const height = numOrNull(info.height);
  if (width && height) return width / height;
  return numOrNull(info.aspect_ratio);
}

/**
 * The thumbnail to show: of those at the picture's shape (16:9 unless the
 * video says otherwise), the smallest at least 960px wide, sharp on a
 * Retina screen without fetching the largest; else the site's own pick.
 *
 * YouTube lists only wide thumbnails, even for a Short, but has an upright
 * one at a fixed address; a vertical YouTube video gets that, with the
 * site's own pick to fall back on.
 */
function pickThumbnail(info: Json): {
  thumbnail: string | null;
  thumbnailFallback: string | null;
} {
  const raw = Array.isArray(info.thumbnails) ? (info.thumbnails as Json[]) : [];
  const shape = aspectOf(info) ?? 16 / 9;
  const sized = raw.flatMap((thumbnail): Thumbnail[] => {
    const url = str(thumbnail.url);
    const w = numOrNull(thumbnail.width);
    const h = numOrNull(thumbnail.height);
    return url && w && h && Math.abs(w / h / shape - 1) < 0.05
      ? [{ url, width: w, height: h }]
      : [];
  });
  sized.sort((a, b) => a.width - b.width);
  const fallback = str(info.thumbnail);
  const shaped =
    sized.find((thumbnail) => thumbnail.width >= 960)?.url ?? sized.at(-1)?.url;
  if (shaped) return { thumbnail: shaped, thumbnailFallback: fallback };
  const id = str(info.id);
  const youtube = /youtube/i.test(str(info.extractor_key) ?? '');
  if (shape < 0.9 && youtube && id && /^[\w-]{6,20}$/.test(id)) {
    return {
      thumbnail: `https://i.ytimg.com/vi/${id}/oardefault.jpg`,
      thumbnailFallback: fallback,
    };
  }
  return { thumbnail: fallback, thumbnailFallback: null };
}

/** When it was published: its timestamp, else its YYYYMMDD date. */
function uploadedAt(info: Json): number | null {
  const timestamp = numOrNull(info.timestamp);
  if (timestamp) return timestamp * 1000;
  const date = str(info.upload_date);
  const match = date && /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  return match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) : null;
}

/** Subtitle languages on offer, leaving out YouTube's live chat replay. */
function subtitleLanguages(info: Json): string[] {
  const subtitles = info.subtitles;
  if (typeof subtitles !== 'object' || subtitles === null) return [];
  return Object.keys(subtitles).filter((language) => language !== 'live_chat');
}

/** A playlist item's thumbnail address: the largest it lists, https only. */
function entryThumbnail(entry: Json): string | null {
  const list = Array.isArray(entry.thumbnails)
    ? (entry.thumbnails as Json[])
    : [];
  const largest = [...list]
    .filter((thumb) => str(thumb.url))
    .sort((a, b) => (numOrNull(b.width) ?? 0) - (numOrNull(a.width) ?? 0))[0];
  const url = str(largest?.url) ?? str(entry.thumbnail);
  return url && /^https:\/\//i.test(url) ? url : null;
}

function toEntries(info: Json): PlaylistEntry[] {
  const raw = Array.isArray(info.entries)
    ? (info.entries as (Json | null)[])
    : [];
  const entries: PlaylistEntry[] = [];
  raw.forEach((entry, i) => {
    // Unavailable or private items appear as null.
    if (!entry) return;
    const url =
      str(entry.webpage_url) ?? str(entry.url) ?? str(entry.original_url);
    if (!url || !/^https?:\/\//i.test(url)) return;
    entries.push({
      url,
      title: str(entry.title) ?? `Item ${i + 1}`,
      duration: numOrNull(entry.duration),
      index: numOrNull(entry.playlist_index) ?? i + 1,
      thumbnail: entryThumbnail(entry),
    });
  });
  return entries;
}

/** Converts the raw -J output into the small shape the renderer needs. */
export function toProbeResult(url: string, info: Json): ProbeResult {
  const extractor = str(info.extractor_key) ?? str(info.extractor) ?? 'Generic';
  const type = str(info._type);

  if (type === 'playlist' || type === 'multi_video') {
    return {
      kind: 'playlist',
      url,
      id: String(info.id ?? ''),
      title: str(info.title) ?? 'Playlist',
      extractor,
      uploader: str(info.uploader) ?? str(info.channel),
      thumbnail: pickThumbnail(info).thumbnail,
      thumbnailImage: null,
      entries: toEntries(info),
    };
  }

  const { formats, heights } = summarizeFormats(info);
  return {
    kind: 'video',
    url: str(info.webpage_url) ?? url,
    id: String(info.id ?? ''),
    title: str(info.title) ?? str(info.id) ?? 'Untitled',
    extractor,
    ...pickThumbnail(info),
    // Filled in by the download manager, which fetches it.
    thumbnailImage: null,
    aspectRatio: aspectOf(info),
    duration: numOrNull(info.duration),
    uploader: str(info.uploader) ?? str(info.channel),
    uploadedAt: uploadedAt(info),
    isLive: info.is_live === true || info.live_status === 'is_live',
    formats,
    availableHeights: heights,
    subtitleLanguages: subtitleLanguages(info),
  };
}

export type ProbeInput = CommonOptions & {
  url: string;
  /** Folder for saved -J files. */
  probeDir: string;
  signal?: AbortSignal;
};

export async function probe(input: ProbeInput): Promise<ProbeOutcome> {
  const chunks: string[] = [];
  let result;
  try {
    const args = buildProbeArgs(input.url, input);
    const opts = {
      onStdout: (line: string) => chunks.push(line),
      signal: input.signal,
      // Big channels can take a while even when flat.
      timeoutMs: 120_000,
      prependPath: input.bin.pathDirs,
    };
    result = isDemo(input.url)
      ? await runDemo(input.url, args, opts, input.bin.ffmpegDir)
      : await run(input.bin.ytdlp, args, opts);
  } catch (error) {
    throw new ProbeError(engineStartError(error));
  }

  if (result.killed) {
    throw new ProbeError({
      category: result.timedOut ? 'network' : 'unknown',
      message: result.timedOut
        ? 'The site took too long to respond.'
        : 'Canceled.',
      raw: result.stderrTail.join('\n'),
      action: result.timedOut ? 'retry_later' : 'none',
      retryable: result.timedOut,
    });
  }
  if (result.code !== 0 || chunks.length === 0) {
    throw new ProbeError(classifyError(result.stderrTail));
  }

  const text = chunks.join('\n');
  let info: Json;
  try {
    info = JSON.parse(text) as Json;
  } catch {
    throw new ProbeError(
      classifyError([
        ...result.stderrTail,
        'ERROR: Failed to parse JSON from yt-dlp',
      ]),
    );
  }

  const probed = toProbeResult(input.url, info);
  const token = randomUUID();
  let infoJsonPath: string | null = null;
  if (probed.kind === 'video') {
    await fs.mkdir(input.probeDir, { recursive: true });
    infoJsonPath = path.join(input.probeDir, `${token}.info.json`);
    await fs.writeFile(infoJsonPath, text, 'utf8');
  }
  return { result: probed, infoJsonPath, token, fetchedAt: Date.now() };
}
