// A saved file's picture and length, for History: one frame of a video (or
// the picture itself, or an audio file's cover art), fitted within
// previewBox, and how long it plays. Made with the app's ffprobe and ffmpeg, which read nearly
// any format; a file they can't read simply has no preview.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import type { FilePreview } from '../shared/types';

const execFileAsync = promisify(execFile);

/**
 * The most a session's picture is kept at: sharp on History's largest card
 * (230px tall, up to 307px wide) on a 2x screen. A wide picture comes out
 * 640px across, an upright one 480px tall; a smaller one stays as it is.
 * The page shrinks downloads' thumbnails to the same (see sessions.ts).
 */
export const previewBox = { width: 640, height: 480 };

/** ffmpeg's arguments for one picture fitted within previewBox, as JPEG. */
const fitted = [
  '-frames:v',
  '1',
  '-vf',
  `scale=w='min(${previewBox.width},iw)':h='min(${previewBox.height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
  '-f',
  'image2pipe',
  '-c:v',
  'mjpeg',
  '-q:v',
  '4',
  'pipe:1',
];

/**
 * A picture (JPEG, PNG or WebP, as a data: URL) fitted within previewBox,
 * as a JPEG data: URL; null if ffmpeg can't read it.
 */
export function fitPicture(ffmpeg: string, dataUrl: string) {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  return new Promise<string | null>((resolve) => {
    const child = spawn(ffmpeg, ['-v', 'error', '-i', 'pipe:0', ...fitted]);
    const out: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      clearTimeout(timer);
      const jpeg = Buffer.concat(out);
      resolve(
        code === 0 && jpeg.length
          ? `data:image/jpeg;base64,${jpeg.toString('base64')}`
          : null,
      );
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

type Probed = {
  streams?: { codec_type?: string }[];
  format?: { format_name?: string; duration?: string };
};

export async function previewFile(
  tools: { ffmpeg: string; ffprobe: string } | null,
  file: string,
): Promise<FilePreview> {
  const none = { thumbnail: null, duration: null };
  if (!tools) return none;
  let info: Probed;
  try {
    const { stdout } = await execFileAsync(
      tools.ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'format=format_name,duration:stream=codec_type',
        '-of',
        'json',
        `file:${file}`,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    info = JSON.parse(stdout) as Probed;
  } catch {
    return none;
  }

  const format = info.format?.format_name ?? '';
  // A still picture reads as a one-frame "video" with no real length.
  const still = /image2|_pipe|^gif$|^webp/.test(format);
  const seconds = Number(info.format?.duration);
  const duration = !still && seconds > 0 ? seconds : null;
  const visual = info.streams?.some((stream) => stream.codec_type === 'video');
  if (!visual) return { thumbnail: null, duration };

  // A moment in, past any fade from black; the first frame of a picture.
  const at = duration ? Math.min(2, duration / 3) : 0;
  try {
    const { stdout } = await execFileAsync(
      tools.ffmpeg,
      [
        '-v',
        'error',
        ...(at ? ['-ss', at.toFixed(2)] : []),
        '-i',
        `file:${file}`,
        ...fitted,
      ],
      { timeout: 20_000, maxBuffer: 2 * 1024 * 1024, encoding: 'buffer' },
    );
    const thumbnail = stdout.length
      ? `data:image/jpeg;base64,${stdout.toString('base64')}`
      : null;
    return { thumbnail, duration };
  } catch {
    return { thumbnail: null, duration };
  }
}

/**
 * Width over height of a video file's picture as it plays (turned for a
 * phone video stored on its side), or undefined for audio or a file
 * ffprobe can't read.
 */
export async function videoAspect(
  ffprobe: string,
  file: string,
): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:stream_disposition=attached_pic:stream_side_data=rotation',
        '-of',
        'json',
        `file:${file}`,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const [stream] =
      (
        JSON.parse(stdout) as {
          streams?: {
            width?: number;
            height?: number;
            disposition?: { attached_pic?: number };
            side_data_list?: { rotation?: number }[];
          }[];
        }
      ).streams ?? [];
    // Cover art in an audio file is not a picture that plays.
    if (!stream?.width || !stream.height || stream.disposition?.attached_pic) {
      return undefined;
    }
    const rotation = Math.abs(stream.side_data_list?.[0]?.rotation ?? 0) % 180;
    return rotation === 90
      ? stream.height / stream.width
      : stream.width / stream.height;
  } catch {
    return undefined;
  }
}
