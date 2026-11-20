// Which encoders an FFmpeg build has. Shared by the tools (compress,
// convert) and the in-app player's re-encode fallback.
//
// No Electron import, so the integration tests can use it with plain Node.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const listed = new Map<string, Promise<string>>();

/** `ffmpeg -encoders`, asked once per FFmpeg; a failed look-up is tried
 *  again next time. */
function encoderList(ffmpeg: string): Promise<string> {
  let list = listed.get(ffmpeg);
  if (!list) {
    list = run(ffmpeg, ['-hide_banner', '-encoders']).then(
      ({ stdout }) => stdout,
    );
    list.catch(() => listed.delete(ffmpeg));
    listed.set(ffmpeg, list);
  }
  return list;
}

/** The first of `candidates` that `ffmpeg` has; throws `missing` if none. */
export async function pickEncoder(
  ffmpeg: string,
  candidates: string[],
  missing: string,
): Promise<string> {
  const list = await encoderList(ffmpeg);
  const encoder = candidates.find((name) =>
    new RegExp(`\\s${name}\\s`).test(list),
  );
  if (!encoder) throw new Error(missing);
  return encoder;
}

/**
 * The best H.264 encoder `ffmpeg` has: x264 in the full (GPL) build,
 * otherwise the system's own (VideoToolbox on macOS, Media Foundation on
 * Windows) or OpenH264.
 */
export const pickH264Encoder = (ffmpeg: string) =>
  pickEncoder(
    ffmpeg,
    ['libx264', 'h264_videotoolbox', 'h264_mf', 'libopenh264'],
    'This FFmpeg has no H.264 encoder.',
  );

/** The best AAC encoder: macOS's own (AudioToolbox), else FFmpeg's. */
export const pickAacEncoder = (ffmpeg: string) =>
  pickEncoder(ffmpeg, ['aac_at', 'aac'], 'This FFmpeg has no AAC encoder.');
