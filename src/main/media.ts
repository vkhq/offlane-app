// What an editor on a tool's page shows of a video before it runs: a frame
// at any moment (the video track's pictures) and how loud its sound is
// along its length (the audio track's waveform). Made with the app's
// ffmpeg; the page names the file by a reference, never a path.
//
// No Electron import, so the integration tests can use it with plain Node.
import { spawn } from 'node:child_process';

/** Frames made at once; the track asks for several together. */
const framesAtOnce = 3;
let running = 0;
const waiting: (() => void)[] = [];

/** Runs `task` once fewer than framesAtOnce others are running. */
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= framesAtOnce) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Runs ffmpeg with `args`, handing each chunk of its output to
 *  `onData`; resolves with its exit code, or null if it couldn't start or
 *  was stopped after `timeoutMs`. */
function ffmpegOut(
  ffmpeg: string,
  args: string[],
  onData: (chunk: Buffer) => void,
  timeoutMs: number,
) {
  return new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', ...args]);
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk: Buffer) => {
      // Only its last lines say why it failed.
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, stderr });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

/**
 * The frame `seconds` into `file`, `height` pixels tall (its width in
 * proportion), as a JPEG data: URL; null past its end or if ffmpeg can't
 * read it. Cut on the exact frame, not the nearest keyframe.
 */
export function frameAt(
  ffmpeg: string,
  file: string,
  seconds: number,
  height: number,
): Promise<string | null> {
  return limited(async () => {
    const out: Buffer[] = [];
    const { code } = await ffmpegOut(
      ffmpeg,
      [
        '-v',
        'error',
        '-ss',
        Math.max(0, seconds).toFixed(3),
        '-i',
        `file:${file}`,
        '-frames:v',
        '1',
        '-vf',
        `scale=-2:${Math.round(height)}`,
        '-f',
        'image2pipe',
        '-c:v',
        'mjpeg',
        '-q:v',
        '5',
        'pipe:1',
      ],
      (chunk) => out.push(chunk),
      20_000,
    );
    const jpeg = Buffer.concat(out);
    return code === 0 && jpeg.length
      ? `data:image/jpeg;base64,${jpeg.toString('base64')}`
      : null;
  });
}

/** Samples a second the sound is read at: plenty for a waveform. */
const sampleRate = 2000;

/**
 * How loud `file`'s first audio track is along its length, as `count`
 * peaks from 0 to 1 (the loudest is 1), evenly spaced; null if it has no
 * sound. Its channels are mixed into one.
 */
export async function waveform(
  ffmpeg: string,
  file: string,
  count: number,
): Promise<number[] | null> {
  // The loudest sample of every hundredth of a second, as it is read.
  const block = sampleRate / 100;
  const blocks: number[] = [];
  let peak = 0;
  let inBlock = 0;
  let carry: Buffer | null = null;
  const { code, stderr } = await ffmpegOut(
    ffmpeg,
    [
      '-v',
      'error',
      '-i',
      `file:${file}`,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      'pipe:1',
    ],
    (chunk) => {
      // A sample is two bytes, which a chunk may split.
      const bytes: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
      const whole = bytes.length - (bytes.length % 2);
      carry = whole < bytes.length ? bytes.subarray(whole) : null;
      for (let at = 0; at < whole; at += 2) {
        peak = Math.max(peak, Math.abs(bytes.readInt16LE(at)));
        if (++inBlock === block) {
          blocks.push(peak);
          peak = 0;
          inBlock = 0;
        }
      }
    },
    120_000,
  );
  if (inBlock) blocks.push(peak);
  // No audio track to map: a silent video.
  if (/matches no streams/i.test(stderr)) return null;
  if (code !== 0 || blocks.length === 0) {
    throw new Error("Can't read this file's sound.");
  }
  const peaks = Array.from({ length: count }, (_, index) => {
    const from = Math.floor((index * blocks.length) / count);
    const to = Math.max(
      from + 1,
      Math.floor(((index + 1) * blocks.length) / count),
    );
    let loudest = 0;
    for (let at = from; at < to && at < blocks.length; at++) {
      loudest = Math.max(loudest, blocks[at]);
    }
    return loudest;
  });
  const loudest = Math.max(...peaks);
  return peaks.map((value) =>
    loudest ? Math.round((value / loudest) * 1000) / 1000 : 0,
  );
}
