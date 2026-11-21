// Plays a finished download inside the app. Chromium's <video> plays MP4
// and WebM with H.264, VP8/9, AV1 (and HEVC on macOS), AAC, MP3, Opus,
// Vorbis and FLAC. A file is checked with ffprobe first:
//   - one Chromium can play is served as it is;
//   - one whose streams it can play but whose container it can't (MKV,
//     mostly) is rewrapped without re-encoding, which takes seconds;
//   - one with a stream it can't decode has only that stream re-encoded,
//     to H.264 or AAC.
// Chromium plays only a file's first audio track, so a file with several
// gets a rewrapped copy per track asked for, the page swapping between
// them; and it shows no subtitles from inside a file, so text subtitle
// tracks are handed to the page as WebVTT, for a <track> element.
// Rewrapped and re-encoded copies go in a cache folder that is emptied at
// every launch. Files are served over media://job/<id>, and only files this
// module prepared for a job are ever served: the page never names a path.
//
// No Electron import, so the integration tests can use it with plain Node.
import { execFile } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';

import {
  canonicalLanguage,
  languageName,
  sameLanguage,
} from '../shared/languages';
import type {
  PlaybackProgress,
  PlaybackSource,
  PlaybackSubtitles,
  PlaybackTrack,
} from '../shared/types';
import { run } from './engine/runner';
import { pickH264Encoder } from './ffmpeg/encoders';

const execFileAsync = promisify(execFile);

export type PlayerDeps = {
  /** Paths of the ffmpeg and ffprobe to use, or null if there are none. */
  getFfmpeg: () => { ffmpeg: string; ffprobe: string } | null;
  cacheDir: string;
  onProgress: (progress: PlaybackProgress) => void;
};

type Stream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  disposition?: { attached_pic?: number };
  side_data_list?: { rotation?: number }[];
  tags?: { language?: string; title?: string };
};

/** What the download asked for, to name tracks a file doesn't label: the
 *  audio languages in the order they were saved, and the original one. */
export type TrackHints = {
  languages?: (string | undefined)[];
  original?: string;
};

/** Subtitle formats that are text, and so become WebVTT; pictures (as on
 *  a Blu-ray) can't. */
const textSubtitles = new Set([
  'mov_text',
  'subrip',
  'srt',
  'webvtt',
  'ass',
  'ssa',
  'text',
]);
type Probed = {
  streams?: Stream[];
  format?: { format_name?: string; duration?: string };
};

const playableVideo = new Set([
  'h264',
  'vp8',
  'vp9',
  'av1',
  // Decoded by the hardware; every Mac Chromium supports has it.
  ...(process.platform === 'darwin' ? ['hevc'] : []),
]);
const playableAudio = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
/** What WebM may hold; anything else rewraps to MP4. */
const webmVideo = new Set(['vp8', 'vp9', 'av1']);
const webmAudio = new Set(['opus', 'vorbis']);

const types: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
};

export class Player {
  /** Each prepared job's file, the only files media:// serves: the copy
   *  with the audio track last asked for. */
  private served = new Map<string, string>();
  private pending = new Map<
    string,
    { promise: Promise<PlaybackSource>; abort: AbortController }
  >();

  constructor(private deps: PlayerDeps) {}

  /** Empties the cache; its copies are only for this session's playback. */
  async clearCache() {
    await fs.rm(this.deps.cacheDir, { recursive: true, force: true });
  }

  /**
   * Makes job `id`'s finished file, at `file`, playable with its audio
   * track `track`, and returns the URL to play it from. Asked twice while
   * preparing, it answers both at once.
   */
  prepare(
    id: string,
    file: string,
    track = 0,
    hints: TrackHints = {},
  ): Promise<PlaybackSource> {
    const key = `${id}:${track}`;
    const running = this.pending.get(key);
    if (running) return running.promise;
    const abort = new AbortController();
    const promise = this.make(id, file, track, hints, abort.signal).finally(
      () => {
        if (this.pending.get(key)?.abort === abort) this.pending.delete(key);
      },
    );
    this.pending.set(key, { promise, abort });
    return promise;
  }

  /** Stops preparing job `id`, when its player is closed before it plays. */
  cancel(id: string) {
    for (const [key, { abort }] of this.pending) {
      if (!key.startsWith(`${id}:`)) continue;
      abort.abort();
      this.pending.delete(key);
    }
  }

  private async make(
    id: string,
    file: string,
    track: number,
    hints: TrackHints,
    signal: AbortSignal,
  ): Promise<PlaybackSource> {
    const tools = this.deps.getFfmpeg();
    // Without ffprobe there is no telling; let Chromium try the file as is.
    if (!tools) {
      return this.serve(id, file, 'direct', null, {
        audioTracks: [],
        audioTrack: 0,
        subtitles: [],
      });
    }

    const info = await probe(tools.ffprobe, file);
    const streams = (info.streams ?? []).filter(
      (stream) => !stream.disposition?.attached_pic,
    );
    const video = streams.filter((stream) => stream.codec_type === 'video');
    const audio = streams.filter((stream) => stream.codec_type === 'audio');
    if (video.length === 0 && audio.length === 0) {
      throw new Error('This file has no video or audio to play.');
    }
    const stat = await fs.stat(file);
    const chosen = Math.min(
      Math.max(0, Math.floor(track) || 0),
      Math.max(0, audio.length - 1),
    );
    const tracks = {
      audioTracks: audio.length > 1 ? audioTracksOf(audio, hints) : [],
      audioTrack: chosen,
      subtitles: await this.subtitlesOf(
        tools.ffmpeg,
        file,
        streams,
        `${id}-${Math.round(stat.mtimeMs)}`,
        signal,
      ),
    };
    const aspect = aspectOf(video[0]);
    const videoCodec = video[0]?.codec_name ?? null;
    const audioCodec = audio[chosen]?.codec_name ?? null;
    const videoOk = !videoCodec || playableVideo.has(videoCodec);
    const audioOk = !audioCodec || playableAudio.has(audioCodec);

    // With several audio tracks, Chromium would play only the first: each
    // gets a copy of its own.
    if (videoOk && audioOk && audio.length <= 1 && containerOk(info, file)) {
      return this.serve(id, file, 'direct', aspect, tracks);
    }

    const remux = videoOk && audioOk;
    const webm =
      remux &&
      (!videoCodec || webmVideo.has(videoCodec)) &&
      (!audioCodec || webmAudio.has(audioCodec));
    const ext = webm ? '.webm' : video.length ? '.mp4' : '.m4a';
    const output = path.join(
      this.deps.cacheDir,
      `${id}-${Math.round(stat.mtimeMs)}${audio.length > 1 ? `-a${chosen}` : ''}${ext}`,
    );
    const prepared = remux ? 'remux' : 'transcode';
    if (existsSync(output)) {
      return this.serve(id, output, prepared, aspect, tracks);
    }

    const args = [
      '-i',
      `file:${file}`,
      '-map',
      '0:v:0?',
      '-map',
      `0:a:${chosen}?`,
    ];
    if (videoOk) {
      args.push('-c:v', 'copy');
    } else {
      const encoder = await pickH264Encoder(tools.ffmpeg);
      args.push(
        '-c:v',
        encoder,
        ...encoderArgs(encoder),
        '-pix_fmt',
        'yuv420p',
      );
    }
    if (audioOk) args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-b:a', '192k');
    if (!webm) args.push('-movflags', '+faststart');

    await fs.mkdir(this.deps.cacheDir, { recursive: true });
    // Written beside the final name, then renamed: a copy cut short by a
    // cancel or a crash is never mistaken for a finished one.
    const partial = `${output}.${process.pid}-${Date.now()}.part${ext}`;
    const duration = Number(info.format?.duration) || null;
    this.deps.onProgress({ id, stage: prepared, percent: null, aspect });
    const result = await run(
      tools.ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-nostats',
        '-progress',
        'pipe:1',
        ...args,
        partial,
      ],
      {
        signal,
        onStdout: (line) => {
          const match = /^out_time_us=(\d+)/.exec(line);
          if (!match || !duration) return;
          const percent = Math.min(
            100,
            (Number(match[1]) / 1e6 / duration) * 100,
          );
          this.deps.onProgress({ id, stage: prepared, percent, aspect });
        },
      },
    );
    if (result.killed || result.code !== 0) {
      await fs.rm(partial, { force: true });
      if (result.killed) throw new Error('Canceled');
      throw new Error(
        result.stderrTail.at(-1) ??
          "This video couldn't be converted for playback.",
      );
    }
    await fs.rename(partial, output);
    return this.serve(id, output, prepared, aspect, tracks);
  }

  private serve(
    id: string,
    file: string,
    prepared: PlaybackSource['prepared'],
    aspect: number | null,
    tracks: Pick<PlaybackSource, 'audioTracks' | 'audioTrack' | 'subtitles'>,
  ): PlaybackSource {
    this.served.set(id, file);
    // The file's name in the URL changes when the copy does, so the page
    // never plays a stale one from its cache.
    const version = encodeURIComponent(path.basename(file));
    return {
      url: `media://job/${id}?v=${version}`,
      prepared,
      aspect,
      ...tracks,
    };
  }

  /**
   * The file's text subtitle tracks as WebVTT, made once per file and kept
   * in the cache (named from `stem`). A track that won't convert is left
   * out rather than stopping playback.
   */
  private async subtitlesOf(
    ffmpeg: string,
    file: string,
    streams: Stream[],
    stem: string,
    signal: AbortSignal,
  ): Promise<PlaybackSubtitles[]> {
    const subtitles = streams.filter(
      (stream) => stream.codec_type === 'subtitle',
    );
    const found: PlaybackSubtitles[] = [];
    for (const [index, stream] of subtitles.entries()) {
      if (!textSubtitles.has(stream.codec_name ?? '')) continue;
      const output = path.join(this.deps.cacheDir, `${stem}-s${index}.vtt`);
      if (!existsSync(output)) {
        await fs.mkdir(this.deps.cacheDir, { recursive: true });
        const partial = `${output}.${process.pid}-${Date.now()}.part.vtt`;
        const result = await run(
          ffmpeg,
          [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-loglevel',
            'error',
            '-i',
            `file:${file}`,
            '-map',
            `0:s:${index}`,
            '-c:s',
            'webvtt',
            partial,
          ],
          { signal, timeoutMs: 60_000 },
        );
        if (result.killed) throw new Error('Canceled');
        if (result.code !== 0) {
          await fs.rm(partial, { force: true });
          continue;
        }
        await fs.rename(partial, output);
      }
      const language = canonicalLanguage(stream.tags?.language) ?? '';
      found.push({
        label:
          stream.tags?.title ||
          (language ? languageName(language) : `Subtitles ${index + 1}`),
        language,
        vtt: await fs.readFile(output, 'utf8'),
      });
    }
    return found;
  }

  /**
   * Answers a media:// request, in byte ranges so the player can seek.
   * Only a file prepared for the job in the URL is ever read.
   */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const file =
      url.host === 'job' ? this.served.get(url.pathname.slice(1)) : undefined;
    if (!file) return new Response(null, { status: 404 });
    let size: number;
    try {
      size = (await fs.stat(file)).size;
    } catch {
      return new Response(null, { status: 404 });
    }
    const headers: Record<string, string> = {
      'Content-Type':
        types[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    };

    const range = /^bytes=(\d*)-(\d*)$/.exec(
      request.headers.get('range') ?? '',
    );
    if (!range || (!range[1] && !range[2])) {
      headers['Content-Length'] = String(size);
      return new Response(body(file), { headers });
    }
    // "bytes=500-" from 500 on; "bytes=-500" the last 500.
    let start = range[1]
      ? Number(range[1])
      : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }
    start = Math.max(0, start);
    headers['Content-Length'] = String(end - start + 1);
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(body(file, start, end), { status: 206, headers });
  }
}

const body = (file: string, start?: number, end?: number) =>
  Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;

async function probe(ffprobe: string, file: string): Promise<Probed> {
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'format=format_name,duration:stream=codec_type,codec_name,width,height:stream_disposition=attached_pic:stream_side_data=rotation:stream_tags=language,title',
        '-of',
        'json',
        `file:${file}`,
      ],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as Probed;
  } catch {
    throw new Error("Can't read this file's video details.");
  }
}

/** Whether Chromium opens this container (it reads MKV only as WebM). */
function containerOk(info: Probed, file: string) {
  const names = (info.format?.format_name ?? '').split(',');
  const ext = path.extname(file).toLowerCase();
  if (names.includes('mp4') || names.includes('mov')) return true;
  if (names.includes('webm')) return ext === '.webm';
  return ['mp3', 'ogg', 'flac', 'wav'].some((name) => names.includes(name));
}

/** Settings for each H.264 encoder: quality for x264, a bitrate for the rest. */
function encoderArgs(encoder: string) {
  if (encoder === 'libx264') return ['-preset', 'veryfast', '-crf', '20'];
  // VideoToolbox may fall back to software on Macs without the hardware.
  if (encoder === 'h264_videotoolbox') return ['-b:v', '8M', '-allow_sw', '1'];
  return ['-b:v', '8M'];
}

/**
 * A video stream's shape as it plays: width over height, turned for a
 * phone video stored on its side.
 */
function aspectOf(stream: Stream | undefined): number | null {
  if (!stream?.width || !stream.height) return null;
  const rotation = Math.abs(stream.side_data_list?.[0]?.rotation ?? 0) % 180;
  return rotation === 90
    ? stream.height / stream.width
    : stream.width / stream.height;
}

/**
 * A file's audio tracks as the player lists them: by language, from the
 * file's own tags or else from what the download asked for, in order. The
 * original is marked; "Track 2" when nothing says.
 */
function audioTracksOf(audio: Stream[], hints: TrackHints): PlaybackTrack[] {
  const tracks = audio.map((stream, index) => {
    const language =
      canonicalLanguage(stream.tags?.language) ??
      canonicalLanguage(hints.languages?.[index]);
    return {
      label: language ? languageName(language) : `Track ${index + 1}`,
      original: !!hints.original && sameLanguage(language, hints.original),
    };
  });
  // Two tracks with one name (two English mixes) are told apart by number.
  return tracks.map((track, index) =>
    tracks.filter((other) => other.label === track.label).length > 1
      ? { ...track, label: `${track.label} ${index + 1}` }
      : track,
  );
}
