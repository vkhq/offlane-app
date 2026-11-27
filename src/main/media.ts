// What an editor on a tool's page shows of a video before it runs: a frame
// at any moment (the video track's pictures) and how loud its sound is
// along its length (the audio track's waveform). Made with the app's
// ffmpeg; the page names the file by a reference, never a path.
//
// No Electron import, so the integration tests can use it with plain Node.
import { spawn } from 'node:child_process';

import {
  type AudioFileInfo,
  type ProbedAudioStream,
  audioTracksFrom,
} from '../shared/audioTracks';

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
 * How loud `file`'s audio track `track` (the first by default) is along its length, as `count`
 * peaks from 0 to 1 (the loudest is 1), evenly spaced; null if it has no
 * sound. Its channels are mixed into one.
 */
export async function waveform(
  ffmpeg: string,
  file: string,
  count: number,
  track = 0,
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
      `0:a:${track}`,
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

/**
 * `file`'s audio tracks (see shared/audioTracks.ts), its size and its
 * length, read with ffprobe; no tracks for a file without sound. A file
 * of one stream whose stream doesn't say its bitrate (FLAC, Opus, Vorbis)
 * takes the file's. Throws when ffprobe can't read it.
 */
export function audioFileInfo(
  ffprobe: string,
  file: string,
): Promise<AudioFileInfo> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,channels,sample_rate,bit_rate,bits_per_raw_sample,bits_per_sample:stream_disposition=default,attached_pic:stream_tags:format=nb_streams,bit_rate,size,duration:format_tags',
      '-of',
      'json',
      `file:${file}`,
    ]);
    const out: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error();
        const probed = JSON.parse(Buffer.concat(out).toString() || '{}') as {
          streams?: (ProbedAudioStream & {
            disposition?: { attached_pic?: number };
          })[];
          format?: Record<string, unknown> & {
            tags?: Record<string, string | undefined>;
          };
        };
        const number = (value: unknown) => {
          const found = Number(value);
          return Number.isFinite(found) && found > 0 ? found : null;
        };
        // Cover art is a picture, not a stream of the sound's.
        const streams = (probed.streams ?? []).filter(
          (stream) => !stream.disposition?.attached_pic,
        );
        let tracks = audioTracksFrom(streams);
        const alone = streams.length === 1 && tracks.length === 1;
        const fileRate = number(probed.format?.bit_rate);
        if (alone && !tracks[0].bitrate && fileRate) {
          tracks = [{ ...tracks[0], bitrate: fileRate }];
        }
        // Ogg keeps its tags on the sound, not the file; any case.
        const tagged = (key: string) => {
          const sources = [probed.format?.tags, streams[0]?.tags];
          for (const tags of sources) {
            const found = Object.entries(tags ?? {}).find(
              ([name]) => name.toLowerCase() === key,
            )?.[1];
            if (found?.trim()) return found.trim();
          }
          return null;
        };
        resolve({
          tracks,
          size: number(probed.format?.size),
          duration: number(probed.format?.duration),
          tags: {
            title: tagged('title'),
            artist: tagged('artist'),
            album: tagged('album'),
          },
        });
      } catch {
        reject(new Error("Can't read this file's audio."));
      }
    });
  });
}

/** `file`'s audio tracks (see audioFileInfo). */
export const audioTracks = async (ffprobe: string, file: string) =>
  (await audioFileInfo(ffprobe, file)).tracks;
