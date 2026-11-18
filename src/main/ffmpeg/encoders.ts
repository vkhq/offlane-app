// Which H.264 encoder an FFmpeg build has. Shared by the tools (compress,
// convert) and the in-app player's re-encode fallback.
//
// No Electron import, so the integration tests can use it with plain Node.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const found = new Map<string, Promise<string>>();

/**
 * The best H.264 encoder `ffmpeg` has: x264 in the full (GPL) build,
 * otherwise the system's own (VideoToolbox on macOS, Media Foundation on
 * Windows) or OpenH264. Looked up once per FFmpeg; a failed look-up is
 * tried again next time.
 */
export function pickH264Encoder(ffmpeg: string): Promise<string> {
  let pick = found.get(ffmpeg);
  if (!pick) {
    pick = run(ffmpeg, ['-hide_banner', '-encoders']).then(({ stdout }) => {
      const has = (name: string) => new RegExp(`\\s${name}\\s`).test(stdout);
      const encoder = [
        'libx264',
        'h264_videotoolbox',
        'h264_mf',
        'libopenh264',
      ].find(has);
      if (!encoder) throw new Error('This FFmpeg has no H.264 encoder.');
      return encoder;
    });
    pick.catch(() => found.delete(ffmpeg));
    found.set(ffmpeg, pick);
  }
  return pick;
}
