// Everything a tool's handler.ts uses, in one place. Main process only: no
// React, and nothing a page imports.
import type { Options } from '../shared/tools';
import {
  pickAacEncoder,
  pickEncoder,
  pickH264Encoder,
} from '../main/ffmpeg/encoders';
import type { HandlerContext, ToolHandler } from '../main/tools/queue';

export type { HandlerContext } from '../main/tools/queue';

/** Declares a tool's back end; only here so its values are typed. */
export const defineHandler = <O extends Options>(handler: ToolHandler<O>) =>
  handler as unknown as ToolHandler;

/** An input path as FFmpeg should read it: always as a file, never as one of
 *  its protocols (`concat:`, `http:` and so on). */
export const fileInput = (input: string) => `file:${input}`;

/** Video formats Offlane's FFmpeg can read the details of and copy, but has
 *  no decoder for: their patents are pooled, so none is shipped. */
const undecodable: Record<string, string> = {
  hevc: 'HEVC (H.265)',
  vvc: 'VVC (H.266)',
};

/** What to tell the person when FFmpeg fails: why, for a video it has no
 *  decoder for, or otherwise its last error line, without the
 *  `file:<path>: ` it starts with. */
const lastError = (stderr: string[], fallback: string) => {
  for (const line of stderr) {
    const codec = /no decoder found for: (\w+)/.exec(line)?.[1];
    if (codec && codec in undecodable) {
      return `This video is in ${undecodable[codec]}, which Offlane can’t convert yet.`;
    }
  }
  return stderr.at(-1)?.replace(/^file:.+?\.\w+: /, '') || fallback;
};

export type VideoStream = {
  codec: string;
  /** As the picture is seen: after a phone's rotation tag, so a portrait
   *  phone video stored as 1920×1080 with a 90° tag is 1080×1920. */
  width: number;
  height: number;
  /** The rotation tag in degrees (0, 90, 180 or 270), already applied to
   *  width and height above. FFmpeg applies it when decoding. */
  rotation: number;
  /** Frames per second, or null if unknown. */
  fps: number | null;
  /** Bits per second, or null if unknown. */
  bitrate: number | null;
};

export type AudioStream = {
  codec: string;
  /** Bits per second, or null if unknown. */
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
};

export type MediaInfo = {
  /** Seconds, or null if unknown. */
  duration: number | null;
  /** Bits per second over the whole file, or null if unknown. */
  bitrate: number | null;
  /** The first video stream (cover art doesn't count), or null. */
  video: VideoStream | null;
  /** The first audio stream, or null. */
  audio: AudioStream | null;
};

/** A positive number from ffprobe's text, or null. */
const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/** "30000/1001" as 29.97…, or null. */
const rate = (value: unknown) => {
  const [top, bottom] = String(value ?? '')
    .split('/')
    .map(Number);
  return bottom ? positive(top / bottom) : null;
};

type ProbedStream = Record<string, unknown> & {
  disposition?: { attached_pic?: number };
  side_data_list?: { rotation?: number }[];
};

/** Reads a media file's length, bitrate and streams with ffprobe. */
export async function probeMedia(
  context: HandlerContext<unknown>,
  input: string,
): Promise<MediaInfo> {
  const { ffprobe } = context.ffmpeg();
  const lines: string[] = [];
  const result = await context.run(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,bit_rate:stream=codec_type,codec_name,width,height,avg_frame_rate,bit_rate,sample_rate,channels:stream_side_data=rotation:stream_disposition=attached_pic',
      '-of',
      'json',
      fileInput(input),
    ],
    {
      signal: context.signal,
      timeoutMs: 30_000,
      onStdout: (line) => void lines.push(line),
    },
  );
  if (result.code !== 0 && !result.killed) {
    throw new Error(
      lastError(result.stderrTail, "Can't read this file's media details."),
    );
  }
  let probed: { format?: Record<string, unknown>; streams?: ProbedStream[] };
  try {
    probed = JSON.parse(lines.join('\n') || '{}');
  } catch {
    throw new Error("Can't read this file's media details.");
  }
  const streams = probed.streams ?? [];
  const video = streams.find(
    (stream) =>
      stream.codec_type === 'video' && !stream.disposition?.attached_pic,
  );
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  let videoStream: VideoStream | null = null;
  if (video && positive(video.width) && positive(video.height)) {
    // ffprobe gives it as -90, 90, 180…; kept here as 0–359.
    const tag = Math.round(Number(video.side_data_list?.[0]?.rotation ?? 0));
    const rotation = ((tag % 360) + 360) % 360;
    const turned = rotation === 90 || rotation === 270;
    videoStream = {
      codec: String(video.codec_name ?? ''),
      width: Number(turned ? video.height : video.width),
      height: Number(turned ? video.width : video.height),
      rotation,
      fps: rate(video.avg_frame_rate),
      bitrate: positive(video.bit_rate),
    };
  }
  return {
    duration: positive(probed.format?.duration),
    bitrate: positive(probed.format?.bit_rate),
    video: videoStream,
    audio: audio
      ? {
          codec: String(audio.codec_name ?? ''),
          bitrate: positive(audio.bit_rate),
          sampleRate: positive(audio.sample_rate),
          channels: positive(audio.channels),
        }
      : null,
  };
}

/**
 * Runs FFmpeg with `args` (which should not include -progress), reporting
 * progress against `duration` seconds. Throws with FFmpeg's last error line
 * if it fails.
 */
export async function runFfmpeg(
  context: HandlerContext<unknown>,
  args: string[],
  duration: number | null,
) {
  const { ffmpeg } = context.ffmpeg();
  const result = await context.run(
    ffmpeg,
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-nostats',
      '-progress',
      'pipe:1',
      ...args,
    ],
    {
      signal: context.signal,
      onStdout: (line) => {
        const match = /^out_time_us=(\d+)/.exec(line);
        if (match && duration) {
          context.progress((Number(match[1]) / 1e6 / duration) * 100);
        }
      },
    },
  );
  if (result.killed) return;
  if (result.code !== 0) {
    throw new Error(
      lastError(result.stderrTail, 'FFmpeg stopped with an error.'),
    );
  }
}

/**
 * The best H.264 encoder this FFmpeg has: x264 in the full (GPL) build,
 * otherwise the system's own (VideoToolbox on macOS, Media Foundation on
 * Windows) or OpenH264.
 */
export const h264Encoder = (context: HandlerContext<unknown>) =>
  pickH264Encoder(context.ffmpeg().ffmpeg);

/** Bits per second for a re-encoded video when the source's is unknown. */
const fallbackVideoBitrate = 4_000_000;

/**
 * What a source's video bitrate is, for re-encoding it at about the same
 * quality: its video stream's, else the file's less 128 kbps of audio,
 * else 4 Mbps.
 */
export const sourceVideoBitrate = (media: MediaInfo) =>
  media.video?.bitrate ??
  (media.bitrate ? Math.max(200_000, media.bitrate - 128_000) : null) ??
  fallbackVideoBitrate;

/**
 * The output arguments every video tool that re-encodes uses: H.264 (the
 * best encoder this FFmpeg has) at `bitrate` bits per second, in 4:2:0 for
 * players everywhere, with AAC audio at 128 kbps, and the index at the
 * front so it plays while it loads. Add the maps, filters and output path.
 */
export async function h264Args(
  context: HandlerContext<unknown>,
  bitrate: number,
): Promise<string[]> {
  const { ffmpeg } = context.ffmpeg();
  const [video, audio] = await Promise.all([
    pickH264Encoder(ffmpeg),
    pickAacEncoder(ffmpeg),
  ]);
  return [
    '-c:v',
    video,
    '-b:v',
    String(Math.max(100_000, Math.round(bitrate))),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    audio,
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
  ];
}

/** The audio formats the audio tools offer, as their options name them. */
export const audioFormats = ['MP3', 'M4A', 'WAV', 'FLAC', 'OGG'] as const;
export type AudioFormat = (typeof audioFormats)[number];

/** Whether a format is lossless, so a bitrate means nothing for it. */
export const lossless = (format: string) =>
  format === 'WAV' || format === 'FLAC';

/**
 * The encoder arguments and file extension for one of `audioFormats`, at
 * `kbps` where the format takes a bitrate (MP3, M4A, OGG). Throws a message
 * a person can act on for an unknown format or a missing encoder.
 */
export async function audioArgs(
  context: HandlerContext<unknown>,
  format: string,
  kbps = 192,
): Promise<{ ext: string; args: string[] }> {
  const { ffmpeg } = context.ffmpeg();
  const bitrate = ['-b:a', `${Math.round(kbps)}k`];
  switch (format) {
    case 'MP3':
      return {
        ext: 'mp3',
        args: [
          '-c:a',
          await pickEncoder(
            ffmpeg,
            ['libmp3lame'],
            "This FFmpeg can't make MP3 files.",
          ),
          ...bitrate,
        ],
      };
    case 'M4A':
      return {
        ext: 'm4a',
        args: ['-c:a', await pickAacEncoder(ffmpeg), ...bitrate],
      };
    case 'WAV':
      return { ext: 'wav', args: ['-c:a', 'pcm_s16le'] };
    case 'FLAC':
      return { ext: 'flac', args: ['-c:a', 'flac'] };
    case 'OGG':
      return {
        ext: 'ogg',
        args: [
          '-c:a',
          await pickEncoder(
            ffmpeg,
            ['libvorbis'],
            "This FFmpeg can't make OGG files.",
          ),
          ...bitrate,
        ],
      };
    default:
      throw new Error(
        `Offlane can't make ${format || 'that kind of'} audio files.`,
      );
  }
}

/** The video formats Convert Video offers, as its options name them. */
export const videoFormats = ['MP4', 'MOV', 'WebM', 'MKV', 'AVI'] as const;

/**
 * The encoder arguments and file extension for one of `videoFormats`:
 * MP4 and MOV as H.264 and AAC (see `h264Args`), WebM as VP9 and Opus, MKV
 * as a copy of every stream (Matroska holds almost anything), AVI as
 * MPEG-4 Part 2 and MP3. Add the maps and output path.
 */
export async function videoArgs(
  context: HandlerContext<unknown>,
  format: string,
  bitrate: number,
): Promise<{ ext: string; args: string[] }> {
  const { ffmpeg } = context.ffmpeg();
  switch (format) {
    case 'MP4':
    case 'MOV':
      return {
        ext: format.toLowerCase(),
        args: await h264Args(context, bitrate),
      };
    case 'WebM':
      return {
        ext: 'webm',
        args: [
          '-c:v',
          await pickEncoder(
            ffmpeg,
            ['libvpx-vp9'],
            "This FFmpeg can't make WebM video.",
          ),
          '-crf',
          '32',
          '-b:v',
          '0',
          '-row-mt',
          '1',
          '-deadline',
          'good',
          '-cpu-used',
          '4',
          '-c:a',
          await pickEncoder(
            ffmpeg,
            ['libopus'],
            "This FFmpeg can't make WebM audio.",
          ),
          '-b:a',
          '128k',
        ],
      };
    case 'MKV':
      return { ext: 'mkv', args: ['-c', 'copy'] };
    case 'AVI':
      return {
        ext: 'avi',
        args: [
          '-c:v',
          'mpeg4',
          '-q:v',
          '4',
          '-c:a',
          await pickEncoder(
            ffmpeg,
            ['libmp3lame'],
            "This FFmpeg can't make AVI audio.",
          ),
          '-b:a',
          '192k',
        ],
      };
    default:
      throw new Error(
        `Offlane can't make ${format || 'that kind of'} video files.`,
      );
  }
}

/** Seconds as the messages show them: "12.5 s". */
const seconds = (value: number) => `${Math.round(value * 10) / 10} s`;

/**
 * Checks a Start and End (in seconds) against a file's length and returns
 * the part to keep: `start` and `length`, and `inputArgs` to put before the
 * file's `-i` (reading only that part, cut on the exact frame when the
 * output is re-encoded). End is capped at the length. Throws a message a
 * person can act on.
 */
export function timeRange(
  range: { start: number; end: number },
  duration: number | null,
): { start: number; length: number; inputArgs: string[] } {
  const { start } = range;
  if (!Number.isFinite(start) || start < 0) {
    throw new Error("Start can't be before the beginning.");
  }
  if (!Number.isFinite(range.end) || range.end <= start) {
    throw new Error('End must be after Start.');
  }
  if (duration !== null && start >= duration) {
    throw new Error(
      `Start is after the end of the file, which is ${seconds(duration)} long.`,
    );
  }
  const end = duration === null ? range.end : Math.min(range.end, duration);
  const length = end - start;
  return {
    start,
    length,
    inputArgs: ['-ss', String(start), '-t', String(length)],
  };
}

// Picture shapes, as Change Aspect Ratio's editor works them out too.
export {
  aspectPlan,
  parseRatio,
  type AspectFit,
  type AspectPlan,
} from '../shared/aspectFrame';

// Picture sizes, as Resize Video's editor works them out too.
export {
  fitInside,
  maxSide,
  minSide,
  parseSize,
  sizeLabel,
  type FrameSize,
} from '../shared/frameSize';
