// Everything a tool's handler.ts uses, in one place. Main process only: no
// React, and nothing a page imports.
import type { Options } from '../shared/tools';
import { pickH264Encoder } from '../main/ffmpeg/encoders';
import type { HandlerContext, ToolHandler } from '../main/tools/queue';

export type { HandlerContext } from '../main/tools/queue';

/** Declares a tool's back end; only here so its values are typed. */
export const defineHandler = <O extends Options>(handler: ToolHandler<O>) =>
  handler as unknown as ToolHandler;

/** An input path as FFmpeg should read it: always as a file, never as one of
 *  its protocols (`concat:`, `http:` and so on). */
export const fileInput = (input: string) => `file:${input}`;

/** FFmpeg's last error line, without the `file:<path>: ` it starts with. */
const lastError = (stderr: string[], fallback: string) =>
  stderr.at(-1)?.replace(/^file:.+?\.\w+: /, '') || fallback;

export type MediaInfo = {
  /** Seconds, or null if unknown. */
  duration: number | null;
  /** Bits per second over the whole file, or null if unknown. */
  bitrate: number | null;
};

/** Reads a media file's length and overall bitrate with ffprobe. */
export async function probeMedia(
  context: HandlerContext<unknown>,
  input: string,
): Promise<MediaInfo> {
  const { ffprobe } = context.ffmpeg();
  let duration: number | null = null;
  let bitrate: number | null = null;
  const result = await context.run(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,bit_rate',
      '-of',
      'default=noprint_wrappers=1',
      fileInput(input),
    ],
    {
      signal: context.signal,
      timeoutMs: 30_000,
      onStdout: (line) => {
        const [key, value] = line.split('=');
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) return;
        if (key === 'duration') duration = number;
        if (key === 'bit_rate') bitrate = number;
      },
    },
  );
  if (result.code !== 0 && !result.killed) {
    throw new Error(
      lastError(result.stderrTail, "Can't read this file's media details."),
    );
  }
  return { duration, bitrate };
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
